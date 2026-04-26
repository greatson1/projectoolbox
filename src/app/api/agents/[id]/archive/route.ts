import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { cancelAgentJobs } from "@/lib/agents/job-queue";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason: string = (body.reason || "completed").toString().slice(0, 200);

  const agent = await db.agent.update({
    where: { id },
    data: {
      status: "ARCHIVED",
      archivedAt: new Date(),
      archivedBy: session.user.id || session.user.email || null,
      archiveReason: reason,
    },
  });

  // Stop any pending autonomous work and deactivate deployments so the agent
  // is fully inert.
  await cancelAgentJobs(id);
  await db.agentDeployment.updateMany({
    where: { agentId: id, isActive: true },
    data: { isActive: false },
  });

  await db.agentActivity.create({
    data: {
      agentId: id,
      type: "archived",
      summary: `Agent archived by ${session.user.name || "user"} — reason: ${reason}`,
    },
  });

  return NextResponse.json({ data: agent });
}
