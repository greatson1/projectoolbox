import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getReconciliationFindings,
  reconcileProjectArtefacts,
} from "@/lib/agents/cross-artefact-reconciliation";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/:projectId/reconciliation
 *
 * Returns the latest persisted cross-artefact reconciliation findings:
 * WBS hours vs Cost Plan labour, Schedule range vs Charter window, Cost
 * Plan estimate total vs Project budget, etc.
 *
 * The pass runs automatically on every artefact approval. This endpoint
 * is a pure read of the cached result — no LLM, no heavy DB scan.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const result = await getReconciliationFindings(projectId);
  return NextResponse.json({ data: result });
}

/**
 * POST /api/projects/:projectId/reconciliation
 *
 * Manual trigger — re-runs the reconciliation pass for projects whose
 * artefacts were last approved before the pass was wired in (i.e. the
 * persisted findings list is empty / stale).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const result = await reconcileProjectArtefacts(projectId);
  return NextResponse.json({ data: result });
}
