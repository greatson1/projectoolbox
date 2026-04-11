import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/agents/:id/metrics — Agent performance metrics
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const { computeAgentMetrics } = await import("@/lib/agents/metrics");
  const metrics = await computeAgentMetrics(id);

  return NextResponse.json({ data: metrics });
}
