import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCycleTimeByStatus } from "@/lib/agents/cycle-time";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/:projectId/cycle-time
 * Average time-in-status (days) per status, from TaskStatusTransition rows.
 * Drives the Sprint Tracker "Avg Cycle Time by Status" chart. Empty array
 * until status changes have been captured.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const data = await getCycleTimeByStatus(projectId);
  return NextResponse.json({ data });
}
