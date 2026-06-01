/**
 * GET /api/auth/workos/callback?code=...&state=...
 *
 * WorkOS lands the browser here after the IdP authenticates the user. We:
 *   1. Verify the signed `state` to defend against CSRF and ensure the
 *      flow originated from our own /login route.
 *   2. Exchange the short-lived `code` for the user profile via WorkOS.
 *   3. JIT-provision: lookup-or-create the User row by email, ensure the
 *      UserOrganisation membership exists with the org's default role.
 *   4. Mint a short-lived signed JWT containing the userId + a nonce.
 *   5. Redirect to /api/auth/callback/credentials?provider=workos with the
 *      JWT in a query param — the NextAuth WorkOS credentials provider
 *      verifies the JWT signature and turns it into a session.
 *
 * The handoff JWT approach keeps NextAuth as the session source of truth:
 * we don't write cookies ourselves, we hand a verified payload to NextAuth
 * which uses its standard cookie/JWT machinery to mint the session.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getWorkOS, WORKOS_CLIENT_ID } from "@/lib/workos";
import { createHmac, randomBytes } from "crypto";

export const dynamic = "force-dynamic";

function verifyState(state: string): { ok: false } | { ok: true; payload: { returnTo: string; ts: number; nonce: string } } {
  const secret = process.env.NEXTAUTH_SECRET || "";
  const parts = state.split(".");
  if (parts.length !== 2) return { ok: false };
  const [body, sig] = parts;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (sig !== expected) return { ok: false };
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    // 10-minute hard cap on state validity — the SAML round-trip is
    // normally seconds; anything older suggests a replay.
    if (!payload?.ts || Date.now() - payload.ts > 10 * 60 * 1000) return { ok: false };
    return { ok: true, payload };
  } catch {
    return { ok: false };
  }
}

function signHandoffToken(userId: string): string {
  const secret = process.env.NEXTAUTH_SECRET || "";
  const payload = { userId, nonce: randomBytes(16).toString("base64url"), exp: Date.now() + 60_000 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export async function GET(req: NextRequest) {
  const workos = getWorkOS();
  if (!workos || !WORKOS_CLIENT_ID) {
    return NextResponse.redirect(new URL("/login?error=sso_unavailable", req.url));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(new URL("/login?error=sso_bad_request", req.url));
  }

  const stateCheck = verifyState(state);
  if (!stateCheck.ok) {
    return NextResponse.redirect(new URL("/login?error=sso_state_invalid", req.url));
  }
  const returnTo = stateCheck.payload.returnTo || "/dashboard";

  let profile;
  try {
    const res = await workos.sso.getProfileAndToken({ code, clientId: WORKOS_CLIENT_ID });
    profile = res.profile;
  } catch (e) {
    console.error("[workos callback] getProfileAndToken failed:", e);
    return NextResponse.redirect(new URL("/login?error=sso_exchange_failed", req.url));
  }

  if (!profile?.email) {
    return NextResponse.redirect(new URL("/login?error=sso_no_email", req.url));
  }
  const email = profile.email.toLowerCase();

  // Resolve which projectoolbox Organisation this WorkOS Organization
  // maps to. Without that we can't grant org membership.
  const org = profile.organizationId
    ? await db.organisation.findFirst({
        where: { workosOrgId: profile.organizationId },
        select: { id: true },
      })
    : null;
  if (!org) {
    return NextResponse.redirect(new URL("/login?error=sso_org_not_mapped", req.url));
  }

  // JIT provision the user.
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() || null;
  const user = await db.user.upsert({
    where: { email },
    update: {
      name: fullName ?? undefined,
      ssoProvisionedAt: new Date(),
      orgId: org.id,
    },
    create: {
      email,
      name: fullName,
      ssoProvisionedAt: new Date(),
      orgId: org.id,
    },
  });

  // Ensure membership row exists. SAML attributes don't carry a stable
  // role mapping by default, so we use MEMBER unless the user already had
  // a higher role (idempotent — re-running SSO can't demote an OWNER).
  await db.userOrganisation.upsert({
    where: { userId_orgId: { userId: user.id, orgId: org.id } },
    update: {},
    create: { userId: user.id, orgId: org.id, role: "MEMBER" },
  });

  await db.auditLog.create({
    data: {
      orgId: org.id,
      userId: user.id,
      action: "Signed in via SAML SSO",
      target: profile.connectionType || "saml",
    },
  });

  // Hand off to NextAuth via the credentials provider. We post the token
  // through a tiny middleman page that calls `signIn` on the client — that
  // way NextAuth writes its session cookies and we get a real session
  // without the WorkOS layer needing to know NextAuth internals.
  const token = signHandoffToken(user.id);
  const handoffUrl = new URL("/sso-complete", req.url);
  handoffUrl.searchParams.set("token", token);
  handoffUrl.searchParams.set("returnTo", returnTo);
  return NextResponse.redirect(handoffUrl);
}
