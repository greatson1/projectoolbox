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
import { requirePlanFeature } from "@/lib/plan-guard";
import { isValidCidrOrIp } from "@/lib/ip-allowlist";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId as string | undefined;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const org = await db.organisation.findUnique({
    where: { id: orgId },
    select: { requireMfa: true, ipAllowlist: true },
  });
  return NextResponse.json({ data: { requireMfa: !!org?.requireMfa, ipAllowlist: org?.ipAllowlist ?? [] } });
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

  // BUSINESS+ gate: org-wide MFA enforcement is part of the enterprise
  // governance bundle. Below BUSINESS the org can still use per-user TOTP
  // (mfaEnabled on the User row); it's only the force-everyone toggle
  // that's gated. canUseFeature returns true on FREE/STARTER/PROFESSIONAL
  // when the user is TURNING IT OFF — we let downgrades pass so an org
  // that dropped from BUSINESS isn't stuck with the policy on forever.
  const body = await req.json();
  const requireMfa = body?.requireMfa;
  if (requireMfa !== undefined && typeof requireMfa !== "boolean") {
    return NextResponse.json({ error: "requireMfa must be boolean" }, { status: 400 });
  }
  if (requireMfa === true) {
    const guard = await requirePlanFeature(session, "orgMfaEnforce");
    if (!guard.ok) return guard.response;
  }

  // ── IP allowlist (BUSINESS+) ─────────────────────────────────────────────
  // Optional in the PATCH body. When provided, every entry must be a valid
  // IPv4 or CIDR — bad input is refused before it lands in the column so
  // the edge middleware never has to guess what a malformed entry means.
  // Setting an empty array disables the policy; setting [] is allowed on
  // any plan so a downgraded org can clear an existing list.
  let nextAllowlist: string[] | undefined;
  if (body?.ipAllowlist !== undefined) {
    if (!Array.isArray(body.ipAllowlist)) {
      return NextResponse.json({ error: "ipAllowlist must be an array of CIDR strings" }, { status: 400 });
    }
    const entries = body.ipAllowlist.filter((e: unknown): e is string => typeof e === "string" && e.trim().length > 0).map((e: string) => e.trim());
    const invalid = entries.filter((e: string) => !isValidCidrOrIp(e));
    if (invalid.length > 0) {
      return NextResponse.json({
        error: `Invalid IP / CIDR entries: ${invalid.join(", ")}. Use either "203.0.113.42" or "203.0.113.0/24".`,
      }, { status: 400 });
    }
    if (entries.length > 0) {
      const guard = await requirePlanFeature(session, "ipAllowlist");
      if (!guard.ok) return guard.response;
    }
    nextAllowlist = entries;
  }

  const before = await db.organisation.findUnique({
    where: { id: orgId },
    select: { requireMfa: true, ipAllowlist: true },
  });

  // Compose the partial update. We only touch fields the caller explicitly
  // sent, so a PATCH with just `requireMfa` doesn't accidentally clear the
  // allowlist and vice versa.
  const updateData: { requireMfa?: boolean; ipAllowlist?: string[] } = {};
  if (requireMfa !== undefined && before?.requireMfa !== requireMfa) updateData.requireMfa = requireMfa;
  if (nextAllowlist !== undefined && JSON.stringify(before?.ipAllowlist ?? []) !== JSON.stringify(nextAllowlist)) {
    updateData.ipAllowlist = nextAllowlist;
  }
  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ data: { changed: false, requireMfa: before?.requireMfa, ipAllowlist: before?.ipAllowlist ?? [] } });
  }

  // If turning ON requireMfa: count members who don't yet have MFA so the
  // UI can show the OWNER who'll get locked out until they enrol.
  let affectedMembers = 0;
  if (updateData.requireMfa === true) {
    affectedMembers = await db.userOrganisation.count({
      where: { orgId, user: { mfaEnabled: false } },
    });
  }

  await db.organisation.update({ where: { id: orgId }, data: updateData });

  // One audit row per change so the trail captures exactly what flipped.
  const auditPromises: Promise<unknown>[] = [];
  if (updateData.requireMfa !== undefined) {
    auditPromises.push(db.auditLog.create({
      data: {
        orgId,
        userId: session.user.id,
        action: updateData.requireMfa ? "Enabled require-MFA policy" : "Disabled require-MFA policy",
        target: updateData.requireMfa ? `${affectedMembers} member(s) will be locked out until they enrol` : "All members can sign in without MFA",
      },
    }));
  }
  if (updateData.ipAllowlist !== undefined) {
    auditPromises.push(db.auditLog.create({
      data: {
        orgId,
        userId: session.user.id,
        action: updateData.ipAllowlist.length > 0 ? "Updated IP allowlist" : "Cleared IP allowlist",
        target: updateData.ipAllowlist.length > 0 ? updateData.ipAllowlist.join(", ") : "(none — no IP restriction)",
      },
    }));
  }
  await Promise.all(auditPromises);

  return NextResponse.json({
    data: {
      changed: true,
      requireMfa: updateData.requireMfa ?? before?.requireMfa,
      ipAllowlist: updateData.ipAllowlist ?? before?.ipAllowlist ?? [],
      affectedMembers,
    },
  });
}
