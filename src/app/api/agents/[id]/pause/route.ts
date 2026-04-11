import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { cancelAgentJobs } from "@/lib/agents/job-queue";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const agent = await db.agent.update({
    where: { id },
    data: { status: "PAUSED" },
  });

  // Cancel all pending autonomous jobs
  await cancelAgentJobs(id);

  await db.agentActivity.create({
    data: { agentId: id, type: "paused", summary: `Agent paused by ${session.user.name || "user"}` },
  });

  return NextResponse.json({ data: agent });
}
