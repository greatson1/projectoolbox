import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { requirePlanFeature } from "@/lib/plan-guard";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/audit-log — read the immutable audit trail for the
 * caller's org.
 *
 * BUSINESS+ feature. Below that tier the audit log is still WRITTEN
 * (every PATCH that goes through requirePlanFeature, every SSO/MFA
 * toggle, every artefact approval still logs) — we just don't expose
 * the read endpoint. That way an org upgrading later sees the full
 * history rather than starting fresh.
 *
 * Account/Org data exports (/api/account/export, /api/org/export)
 * remain available on every tier — they're GDPR/UK-DPA right-of-access
 * obligations that we can't gate behind a paid plan.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  const guard = await requirePlanFeature(session, "auditLog");
  if (!guard.ok) return guard.response;

  const orgId = (session as any).user.orgId as string;

  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") || "50");

  const logs = await db.auditLog.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ data: logs });
}
