/**
 * GET /api/auth/workos/login?workosOrgId=org_xxx&returnTo=/dashboard
 *
 * Kicks off the SAML round-trip. We:
 *   1. Verify the workosOrgId is one we've configured (no open redirect).
 *   2. Sign a CSRF-protective `state` value containing the requested
 *      `returnTo` path so the callback can route the user back where they
 *      came from (e.g. a deep link they hit while logged-out).
 *   3. Call WorkOS for the authorization URL.
 *   4. Redirect the browser there. WorkOS bounces the user to their IdP;
 *      the IdP authenticates; WorkOS callbacks us at
 *      /api/auth/workos/callback.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getWorkOS, WORKOS_CLIENT_ID, workosRedirectUri } from "@/lib/workos";
import { randomBytes, createHmac } from "crypto";

export const dynamic = "force-dynamic";

function signState(payload: Record<string, unknown>): string {
  const secret = process.env.NEXTAUTH_SECRET || "";
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export async function GET(req: NextRequest) {
  const workos = getWorkOS();
  if (!workos || !WORKOS_CLIENT_ID) {
    return NextResponse.json(
      { error: "SSO is not configured on this deployment. Set WORKOS_API_KEY + WORKOS_CLIENT_ID." },
      { status: 503 },
    );
  }

  const workosOrgId = req.nextUrl.searchParams.get("workosOrgId") || "";
  const returnTo = req.nextUrl.searchParams.get("returnTo") || "/dashboard";

  // Confirm the workosOrgId belongs to one of our customers — protects
  // against attackers passing arbitrary org IDs they read from a leak.
  const orgRow = await db.organisation.findFirst({
    where: { workosOrgId },
    select: { id: true, name: true },
  });
  if (!orgRow) {
    return NextResponse.json({ error: "Unknown SSO organisation" }, { status: 400 });
  }

  const nonce = randomBytes(16).toString("base64url");
  const state = signState({ nonce, returnTo, ts: Date.now() });

  const authorizationUrl = workos.sso.getAuthorizationUrl({
    organization: workosOrgId,
    redirectUri: workosRedirectUri(),
    clientId: WORKOS_CLIENT_ID,
    state,
  });

  return NextResponse.redirect(authorizationUrl);
}
