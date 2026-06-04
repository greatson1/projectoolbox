import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { syncProjectTasksFromArtefacts } from "@/lib/agents/sync-project-tasks-from-artefacts";

export const dynamic = "force-dynamic";

/**
 * POST /api/projects/:projectId/sync-tasks-from-artefacts
 *
 * Manual trigger for the "turn approved Schedule/WBS artefacts into Task
 * rows" backfill. Used by the Sync button on the Schedule page when the
 * automatic on-approval hook didn't fire (seed projects, legacy data,
 * artefacts that were force-approved via a non-PATCH path).
 *
 * Idempotent. Safe to call repeatedly. Returns counts the UI can render
 * inline.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const result = await syncProjectTasksFromArtefacts(projectId);
  return NextResponse.json({ data: result });
}
