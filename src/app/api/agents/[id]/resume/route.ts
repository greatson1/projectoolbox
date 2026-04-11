import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createJob } from "@/lib/agents/job-queue";
import { nudgeJobProcessor } from "@/lib/agents/agent-backend";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const agent = await db.agent.update({
    where: { id },
    data: { status: "ACTIVE" },
  });

  await db.agentActivity.create({
    data: { agentId: id, type: "resumed", summary: `Agent resumed by ${session.user.name || "user"}` },
  });

  // Create an immediate autonomous cycle job to restart the agent
  const deployment = await db.agentDeployment.findFirst({
    where: { agentId: id, isActive: true },
  });
  if (deployment) {
    await createJob({
      agentId: id,
      deploymentId: deployment.id,
      type: "autonomous_cycle",
      priority: 2,
    });
    nudgeJobProcessor().catch(() => {});
  }

  return NextResponse.json({ data: agent });
}
