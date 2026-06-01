/**
 * POST /api/auth/sso-discover { email }
 *
 * Login-page discovery endpoint. The browser sends the email the user typed;
 * we extract the domain, look it up in `Organisation.emailDomains`, and tell
 * the client whether SSO is configured for that org.
 *
 * Returns:
 *   - 200 { sso: true,  workosOrgId, ssoRequired } — start SAML
 *   - 200 { sso: false } — fall through to password / OAuth
 *
 * Deliberately returns 200 for "not configured" so attackers can't probe for
 * a list of SSO-enabled domains via status-code differences. Rate-limited
 * via the existing infrastructure.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normaliseDomain } from "@/lib/workos";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ sso: false });
  }

  const domain = normaliseDomain(email.slice(email.indexOf("@") + 1));
  if (!domain) return NextResponse.json({ sso: false });

  // Look for an org whose emailDomains array contains this domain AND has a
  // WorkOS Organization configured. Without `workosOrgId` we have nothing to
  // start SAML against.
  const org = await db.organisation.findFirst({
    where: {
      emailDomains: { has: domain },
      workosOrgId: { not: null },
    },
    select: { id: true, workosOrgId: true, ssoRequired: true, name: true },
  });

  if (!org?.workosOrgId) {
    return NextResponse.json({ sso: false });
  }

  return NextResponse.json({
    sso: true,
    workosOrgId: org.workosOrgId,
    ssoRequired: org.ssoRequired,
    orgName: org.name,
  });
}
