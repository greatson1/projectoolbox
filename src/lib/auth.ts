import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import MicrosoftEntraIDProvider from "next-auth/providers/microsoft-entra-id";
import { db } from "./db";
import bcrypt from "bcryptjs";
import { verifySync as verifyTotp } from "otplib";
import { createHmac } from "crypto";

// Same ±30s tolerance as the enrollment route — accounts for clock drift.
const TOTP_EPOCH_TOLERANCE_SECONDS = 30;

// ── E2E auth bypass — DEV/TEST ONLY ──
// Active only when BOTH env vars are set:
//   E2E_AUTH_BYPASS=1
//   E2E_AUTH_BYPASS_TOKEN=<long random string>
// In that mode an additional CredentialsProvider accepts a userId + the
// shared token; if the token matches it returns the user's session
// without touching the password. This is the auth shim Playwright tests
// use to reach authenticated pages without scripting Google OAuth or
// hardcoding a real password.
//
// Hard rules to keep this safe:
//   - BOTH env vars must be set; either alone is rejected at module load
//     (see assertion below).
//   - The token comparison is constant-time.
//   - The provider is GATED behind the env check so it isn't even
//     registered when the flags are off — there's nothing to attack.
//   - This file logs a one-line warning at boot when the bypass is live.
const e2eBypassActive = process.env.E2E_AUTH_BYPASS === "1";
const e2eBypassToken = process.env.E2E_AUTH_BYPASS_TOKEN || "";
if (e2eBypassActive && (!e2eBypassToken || e2eBypassToken.length < 32)) {
  throw new Error(
    "E2E_AUTH_BYPASS=1 requires E2E_AUTH_BYPASS_TOKEN to be set to a string of >=32 chars. " +
    "Refusing to boot with a weak or missing bypass token.",
  );
}
if (e2eBypassActive && process.env.NODE_ENV === "production") {
  throw new Error(
    "E2E_AUTH_BYPASS must NEVER be set in production. " +
    "Refusing to boot with NODE_ENV=production and E2E_AUTH_BYPASS=1.",
  );
}
if (e2eBypassActive) {
  console.warn(
    "[auth] ⚠️ E2E AUTH BYPASS ACTIVE — accept-by-token credential provider registered. " +
    "This MUST NEVER run in production.",
  );
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

// Microsoft Entra ID (formerly Azure AD) — only registered when both env vars
// are set. The provider supports both the multi-tenant "common" endpoint
// (lets any work / school account sign in) and a tenant-scoped endpoint.
// Default to common; for single-tenant deployments, set MICROSOFT_TENANT_ID
// to that tenant's GUID and the SDK will scope the issuer to it.
const microsoftConfigured = !!(
  (process.env.MICROSOFT_CLIENT_ID || process.env.AUTH_MICROSOFT_ENTRA_ID_ID) &&
  (process.env.MICROSOFT_CLIENT_SECRET || process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET)
);

const baseProviders = [
  GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID || process.env.AUTH_GOOGLE_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET || "",
  }),
  ...(microsoftConfigured
    ? [
        MicrosoftEntraIDProvider({
          clientId: process.env.MICROSOFT_CLIENT_ID || process.env.AUTH_MICROSOFT_ENTRA_ID_ID || "",
          clientSecret: process.env.MICROSOFT_CLIENT_SECRET || process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET || "",
          issuer: process.env.MICROSOFT_TENANT_ID
            ? `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/v2.0`
            : "https://login.microsoftonline.com/common/v2.0",
        }),
      ]
    : []),
  CredentialsProvider({
    name: "credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
      // Optional second-factor field. The login UI only renders it once the
      // first authorize attempt returns the MFA_REQUIRED error, so most
      // logins still flow through with only email + password.
      mfaCode: { label: "MFA Code", type: "text" },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) return null;

      const user = await db.user.findUnique({
        where: { email: credentials.email as string },
      });

      if (!user?.passwordHash) return null;

      const valid = await bcrypt.compare(
        credentials.password as string,
        user.passwordHash
      );

      if (!valid) return null;

      // ── MFA gate ──────────────────────────────────────────────────────
      // If the user has TOTP enrolled, require a valid 6-digit code before
      // minting a session. Error string "MFA_REQUIRED" / "MFA_INVALID" are
      // contracted with the login page — see /(auth)/login/page.tsx — which
      // pivots to the code-entry form on the former and shows an inline
      // error on the latter. Both throws keep NextAuth from minting a
      // session; the user sees the appropriate state on the login page.
      if (user.mfaEnabled && user.mfaSecret) {
        const code = (credentials.mfaCode as string | undefined)?.replace(/\s+/g, "") || "";
        if (!code) {
          throw new Error("MFA_REQUIRED");
        }
        const codeOk = verifyTotp({
          secret: user.mfaSecret,
          token: code,
          epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
        }).valid;
        if (!codeOk) {
          throw new Error("MFA_INVALID");
        }
      }

      return { id: user.id, email: user.email, name: user.name, image: user.image };
    },
  }),
];

// ── WorkOS SAML handoff provider ─────────────────────────────────────────
// The WorkOS callback at /api/auth/workos/callback completes the SAML
// round-trip, JIT-provisions the user, then redirects to /sso-complete with
// a short-lived signed handoff token. That page calls `signIn("workos-
// handoff", { token })` which posts here. We verify the HMAC signature +
// expiry, load the User row, and return it — NextAuth then mints the
// session like for any other Credentials provider.
//
// This pattern keeps NextAuth as the single source of truth for sessions
// without WorkOS needing to know NextAuth internals.
function verifyHandoffToken(raw: string): { userId: string } | null {
  const secret = process.env.NEXTAUTH_SECRET || "";
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.userId || !payload?.exp || Date.now() > payload.exp) return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

const workosHandoffProvider = CredentialsProvider({
  id: "workos-handoff",
  name: "workos-handoff",
  credentials: {
    token: { label: "token", type: "text" },
  },
  async authorize(credentials) {
    const token = credentials?.token as string | undefined;
    if (!token) return null;
    const verified = verifyHandoffToken(token);
    if (!verified) return null;
    const user = await db.user.findUnique({ where: { id: verified.userId } });
    if (!user) return null;
    return { id: user.id, email: user.email, name: user.name, image: user.image };
  },
});

const e2eProvider = e2eBypassActive
  ? CredentialsProvider({
      id: "e2e-bypass",
      name: "e2e-bypass",
      credentials: {
        userId: { label: "userId", type: "text" },
        token: { label: "token", type: "text" },
      },
      async authorize(credentials) {
        const userId = credentials?.userId as string | undefined;
        const token = credentials?.token as string | undefined;
        if (!userId || !token) return null;
        if (!constantTimeEqual(token, e2eBypassToken)) return null;
        const user = await db.user.findUnique({ where: { id: userId } });
        if (!user) return null;
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    })
  : null;

// Defensive env normalisation. Operators pasting values into the Vercel
// dashboard sometimes copy a trailing newline; NextAuth v5 then tries to
// parse "https://projectoolbox.com\n" as a URL and throws Configuration
// (live incident on 2026-06-11 — login was broken for ~30min until the
// env value was scrubbed). Strip whitespace around every URL/secret env
// var we hand to NextAuth so the class of bug can't recur.
const cleanEnv = (name: string) => (process.env[name] ?? "").trim();
if (cleanEnv("NEXTAUTH_URL")) process.env.NEXTAUTH_URL = cleanEnv("NEXTAUTH_URL");
if (cleanEnv("AUTH_URL")) process.env.AUTH_URL = cleanEnv("AUTH_URL");
if (cleanEnv("NEXTAUTH_SECRET")) process.env.NEXTAUTH_SECRET = cleanEnv("NEXTAUTH_SECRET");
if (cleanEnv("AUTH_SECRET")) process.env.AUTH_SECRET = cleanEnv("AUTH_SECRET");

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  trustHost: true,
  pages: {
    signIn: "/login",
    newUser: "/onboarding",
  },
  providers: [
    ...baseProviders,
    workosHandoffProvider,
    ...(e2eProvider ? [e2eProvider] : []),
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        // Both OAuth providers (Google + Microsoft Entra ID) follow the same
        // shape: lookup-or-create the User row by email, then seed the JWT
        // with org+role from the DB. Credentials-based logins (password +
        // E2E bypass) skip this branch — the User row already exists.
        const isOAuthSignup = account?.provider === "google" || account?.provider === "microsoft-entra-id";
        if (isOAuthSignup) {
          let dbUser = await db.user.findUnique({ where: { email: user.email! } });
          if (!dbUser) {
            dbUser = await db.user.create({
              data: {
                email: user.email!,
                name: user.name,
                image: user.image,
                emailVerified: new Date(),
              },
            });
          }
          token.sub = dbUser.id;
          token.role = dbUser.role;
          token.orgId = dbUser.orgId;
          token.onboardingComplete = dbUser.onboardingComplete;
        } else {
          const dbUser = await db.user.findUnique({
            where: { id: user.id },
            select: { role: true, orgId: true, onboardingComplete: true },
          });
          token.role = dbUser?.role;
          token.orgId = dbUser?.orgId;
          token.onboardingComplete = dbUser?.onboardingComplete;
        }
        // Stamp the org's plan + createdAt so middleware can evaluate the
        // paywall verdict on every request without a DB round-trip. Re-fetched
        // below in the throttled self-heal block when orgId is missing or
        // becomes set later in the session.
        if (token.orgId) {
          const orgRow = await db.organisation.findUnique({
            where: { id: token.orgId as string },
            select: { plan: true, createdAt: true, ipAllowlist: true, trialEndsAt: true },
          }).catch(() => null);
          (token as any).orgPlan = orgRow?.plan ?? null;
          (token as any).orgCreatedAt = orgRow?.createdAt?.toISOString() ?? null;
          (token as any).orgIpAllowlist = orgRow?.ipAllowlist ?? [];
          (token as any).orgTrialEndsAt = orgRow?.trialEndsAt?.toISOString() ?? null;
        }
      }
      // Re-fetch orgId if it's missing from a stale token. Throttled to at
      // most once per 60s per token: previously this ran on EVERY API request
      // for any user whose token lacked an orgId (newly-signed-up users, or
      // users mid-onboarding) which translated to a `db.user.findUnique` on
      // every page load. The check is still self-healing — we just don't pay
      // the latency on every request.
      if (!token.orgId && token.sub) {
        const last = (token as any).orgIdCheckedAt as number | undefined;
        if (!last || Date.now() - last > 60_000) {
          const dbUser = await db.user.findUnique({
            where: { id: token.sub as string },
            select: { role: true, orgId: true, onboardingComplete: true },
          });
          (token as any).orgIdCheckedAt = Date.now();
          if (dbUser?.orgId) {
            token.orgId = dbUser.orgId;
            token.role = dbUser.role;
            token.onboardingComplete = dbUser.onboardingComplete;
            // Same plan/createdAt/trial stamp as the initial mint path.
            const orgRow = await db.organisation.findUnique({
              where: { id: dbUser.orgId },
              select: { plan: true, createdAt: true, trialEndsAt: true },
            }).catch(() => null);
            (token as any).orgPlan = orgRow?.plan ?? null;
            (token as any).orgCreatedAt = orgRow?.createdAt?.toISOString() ?? null;
            (token as any).orgTrialEndsAt = orgRow?.trialEndsAt?.toISOString() ?? null;
          }
        }
      }

      // Refresh the cached plan + ipAllowlist periodically so a Stripe
      // upgrade/downgrade or an IP allowlist edit takes effect within
      // ~5 minutes without forcing the user to sign out. Throttled per-
      // token to avoid hitting the DB on every request.
      if (token.orgId) {
        const lastPlanCheck = (token as any).orgPlanCheckedAt as number | undefined;
        if (!lastPlanCheck || Date.now() - lastPlanCheck > 5 * 60_000) {
          const orgRow = await db.organisation.findUnique({
            where: { id: token.orgId as string },
            select: { plan: true, createdAt: true, ipAllowlist: true, trialEndsAt: true },
          }).catch(() => null);
          (token as any).orgPlanCheckedAt = Date.now();
          if (orgRow) {
            (token as any).orgPlan = orgRow.plan;
            (token as any).orgCreatedAt = orgRow.createdAt?.toISOString() ?? null;
            (token as any).orgIpAllowlist = orgRow.ipAllowlist;
            (token as any).orgTrialEndsAt = orgRow.trialEndsAt?.toISOString() ?? null;
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        (session.user as any).role = token.role;
        (session.user as any).orgId = token.orgId;
        (session.user as any).onboardingComplete = token.onboardingComplete;
        // Plan-tier fields stamped on the JWT — exposed to the client so
        // UI components (useOrgPlan hook) can render upgrade hints
        // without making a billing API round-trip on every mount. The
        // server still re-enforces every feature flag at the route
        // layer — this is for UI gating only.
        (session.user as any).orgPlan = (token as any).orgPlan ?? null;
        (session.user as any).orgTrialEndsAt = (token as any).orgTrialEndsAt ?? null;
      }
      return session;
    },
  },
});
