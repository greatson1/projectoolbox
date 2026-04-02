import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// GET /api/agents/[id] — Agent detail
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const agent = await db.agent.findUnique({
    where: { id },
    include: {
      deployments: { include: { project: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 20 },
      decisions: { orderBy: { createdAt: "desc" }, take: 20, include: { approval: true } },
      chatMessages: { orderBy: { createdAt: "desc" }, take: 5 },
      _count: { select: { activities: true, decisions: true, chatMessages: true } },
    },
  });

  if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Credit usage for this agent
  const creditUsage = await db.creditTransaction.aggregate({
    where: { agentId: id, type: "USAGE" },
    _sum: { amount: true },
    _count: true,
  });

  return NextResponse.json({
    data: {
      ...agent,
      creditsUsed: Math.abs(creditUsage._sum.amount || 0),
      actionCount: creditUsage._count,
    },
  });
}

// PATCH /api/agents/[id] — Update agent config
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const updated = await db.agent.update({
    where: { id },
    data: body,
  });

  await db.agentActivity.create({
    data: { agentId: id, type: "config_change", summary: `Configuration updated by ${session.user.name || "user"}` },
  });

  return NextResponse.json({ data: updated });
}

// DELETE /api/agents/[id] — Decommission agent
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  await db.agent.update({
    where: { id },
    data: { status: "DECOMMISSIONED", decommissionedAt: new Date() },
  });

  await db.agentDeployment.updateMany({
    where: { agentId: id },
    data: { isActive: false },
  });

  await db.agentActivity.create({
    data: { agentId: id, type: "decommissioned", summary: `Agent decommissioned by ${session.user.name || "user"}` },
  });

  return NextResponse.json({ success: true });
}
