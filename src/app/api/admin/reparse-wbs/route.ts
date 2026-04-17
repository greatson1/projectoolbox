import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/reparse-wbs — Re-parse all approved WBS artefacts.
 * One-time admin utility to re-trigger task materialisation after parser fixes.
 */
export async function GET(req: NextRequest) { return POST(req); }

export async function POST(req: NextRequest) {
  // Allow auth via session OR internal key header
  const internalKey = req.headers.get("x-admin-key") || req.nextUrl.searchParams.get("key") || "";
  const expectedKey = process.env.INTERNAL_API_KEY || process.env.INTERNAL_SECRET || "";
  const hasValidKey = expectedKey && internalKey === expectedKey;
  if (!hasValidKey) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { parseScheduleArtefactIntoTasks, debugParseCSV } = await import("@/lib/agents/schedule-parser");

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
      // Debug: show what the CSV parser produces
      const debugRows = debugParseCSV ? debugParseCSV(art.content) : [];
      const result = await parseScheduleArtefactIntoTasks(
        { id: art.id, name: art.name, format: art.format || "csv", content: art.content, projectId: art.projectId },
        art.agentId,
      );
      results.push({ name: art.name, projectId: art.projectId, ...result, debugFirstRow: debugRows[0] || null, debugRowCount: debugRows.length });
    } catch (e: any) {
      results.push({ name: art.name, projectId: art.projectId, error: e.message });
    }
  }

  return NextResponse.json({ data: { reparsed: results.length, results } });
}
