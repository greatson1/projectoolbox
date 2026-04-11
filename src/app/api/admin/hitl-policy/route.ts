import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/admin/hitl-policy — Get org-level HITL policy
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ data: null });

  const org = await db.organisation.findUnique({
    where: { id: orgId },
    select: { globalHitlPolicy: true },
  });

  return NextResponse.json({ data: org?.globalHitlPolicy || null });
}

// PUT /api/admin/hitl-policy — Update org-level HITL policy
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  const role = (session.user as any).role;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });
  if (role !== "OWNER" && role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await req.json();

  // Validate policy structure
  const policy = {
    requireApprovalAbove: body.requireApprovalAbove || "MEDIUM",
    maxAutonomyLevel: Math.min(5, Math.max(1, body.maxAutonomyLevel || 5)),
    budgetChangeAlwaysHitl: body.budgetChangeAlwaysHitl ?? true,
    scopeChangeAlwaysHitl: body.scopeChangeAlwaysHitl ?? true,
    phaseGateAlwaysHitl: body.phaseGateAlwaysHitl ?? true,
    approvalRoutingRules: body.approvalRoutingRules || [],
  };

  await db.organisation.update({
    where: { id: orgId },
    data: { globalHitlPolicy: policy as any },
  });

  // Audit log
  await db.auditLog.create({
    data: {
      orgId,
      userId: session.user.id,
      action: "update_hitl_policy",
      target: "Organisation HITL Policy",
      details: policy,
    },
  });

  return NextResponse.json({ data: policy });
}
