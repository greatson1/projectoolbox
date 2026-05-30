/**
 * Org-wide security policy.
 *
 * GET  /api/org/policy           — read current policy (any member)
 * PATCH /api/org/policy { requireMfa } — toggle (OWNER only, audit-logged)
 *
 * Currently exposes one knob: requireMfa. When true, every member must have
 * TOTP enrolled before they can use any org-scoped surface — enforced by
 * the layout-level gate in /lib/auth-guards.ts and the /mfa-required
 * interstitial. Future knobs (sessionTimeoutMinutes, ipAllowlist, etc.) go
 * on the same model + endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId as string | undefined;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const org = await db.organisation.findUnique({
    where: { id: orgId },
    select: { requireMfa: true },
  });
  return NextResponse.json({ data: { requireMfa: !!org?.requireMfa } });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId as string | undefined;
  const role = (session.user as any).role as string | undefined;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });
  if (role !== "OWNER") {
    return NextResponse.json({ error: "Only the organisation Owner can change security policy" }, { status: 403 });
  }

  const body = await req.json();
  const requireMfa = body?.requireMfa;
  if (typeof requireMfa !== "boolean") {
    return NextResponse.json({ error: "requireMfa must be boolean" }, { status: 400 });
  }

  const before = await db.organisation.findUnique({ where: { id: orgId }, select: { requireMfa: true } });
  if (before?.requireMfa === requireMfa) {
    return NextResponse.json({ data: { requireMfa, changed: false } });
  }

  // If turning ON: count members who don't yet have MFA so the UI can show
  // the OWNER who'll get locked out until they enrol.
  let affectedMembers = 0;
  if (requireMfa) {
    affectedMembers = await db.userOrganisation.count({
      where: { orgId, user: { mfaEnabled: false } },
    });
  }

  await db.organisation.update({
    where: { id: orgId },
    data: { requireMfa },
  });

  await db.auditLog.create({
    data: {
      orgId,
      userId: session.user.id,
      action: requireMfa ? "Enabled require-MFA policy" : "Disabled require-MFA policy",
      target: requireMfa ? `${affectedMembers} member(s) will be locked out until they enrol` : "All members can sign in without MFA",
    },
  });

  return NextResponse.json({ data: { requireMfa, changed: true, affectedMembers } });
}
