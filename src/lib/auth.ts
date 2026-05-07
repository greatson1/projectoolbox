import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { db } from "./db";
import bcrypt from "bcryptjs";

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

const baseProviders = [
  GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID || process.env.AUTH_GOOGLE_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET || "",
  }),
  CredentialsProvider({
    name: "credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
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

      return { id: user.id, email: user.email, name: user.name, image: user.image };
    },
  }),
];

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

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  trustHost: true,
  pages: {
    signIn: "/login",
    newUser: "/onboarding",
  },
  providers: e2eProvider ? [...baseProviders, e2eProvider] : baseProviders,
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        if (account?.provider === "google") {
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
      }
      return session;
    },
  },
});
