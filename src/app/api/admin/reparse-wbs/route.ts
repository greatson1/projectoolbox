import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/reparse-wbs — Re-parse all approved WBS artefacts.
 * One-time admin utility to re-trigger task materialisation after parser fixes.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { parseScheduleArtefactIntoTasks } = await import("@/lib/agents/schedule-parser");

  // Find all approved WBS/Schedule artefacts
  const wbsArtefacts = await db.agentArtefact.findMany({
    where: {
      status: "APPROVED",
      OR: [
        { name: { contains: "WBS", mode: "insensitive" } },
        { name: { contains: "Work Breakdown", mode: "insensitive" } },
        { name: { contains: "Schedule Baseline", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, format: true, content: true, projectId: true, agentId: true },
  });

  const results: any[] = [];
  for (const art of wbsArtefacts) {
    if (!art.projectId || !art.agentId) continue;
    try {
      const result = await parseScheduleArtefactIntoTasks(
        { id: art.id, name: art.name, format: art.format || "csv", content: art.content, projectId: art.projectId },
        art.agentId,
      );
      results.push({ name: art.name, projectId: art.projectId, ...result });
    } catch (e: any) {
      results.push({ name: art.name, projectId: art.projectId, error: e.message });
    }
  }

  return NextResponse.json({ data: { reparsed: results.length, results } });
}
