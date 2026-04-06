import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// GET /api/agents/:id/email — Get agent's email address
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const agentEmail = await db.agentEmail.findUnique({ where: { agentId: id } });

  return NextResponse.json({ data: agentEmail });
}

// POST /api/agents/:id/email — Generate email address for agent
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Check agent exists
  const agent = await db.agent.findUnique({
    where: { id },
    include: { agentEmail: true },
  });

  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  // Already has email
  if (agent.agentEmail) {
    return NextResponse.json({ data: agent.agentEmail });
  }

  // Generate email address namespaced by org: agentname.orgslug@agents.projectoolbox.com
  const orgRecord = await db.organisation.findUnique({ where: { id: agent.orgId }, select: { slug: true } });
  const agentSlug = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const orgSlug = (orgRecord?.slug || "org").replace(/[^a-z0-9-]/g, "").slice(0, 15);
  const address = `${agentSlug}.${orgSlug}@agents.projectoolbox.com`;

  // Check for collision (shouldn't happen with org namespace, but safety first)
  const existing = await db.agentEmail.findUnique({ where: { address } });
  const finalAddress = existing
    ? `${agentSlug}.${orgSlug}-${id.slice(-4)}@agents.projectoolbox.com`
    : address;

  const agentEmail = await db.agentEmail.create({
    data: {
      agentId: id,
      address: finalAddress,
      isActive: true,
    },
  });

  // Log activity
  await db.agentActivity.create({
    data: {
      agentId: id,
      type: "config_change",
      summary: `Email address activated: ${finalAddress}`,
    },
  });

  return NextResponse.json({ data: agentEmail }, { status: 201 });
}

// DELETE /api/agents/:id/email — Deactivate agent email
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  await db.agentEmail.updateMany({
    where: { agentId: id },
    data: { isActive: false },
  });

  return NextResponse.json({ data: { deactivated: true } });
}
