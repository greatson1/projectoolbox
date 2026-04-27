import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/[projectId]/kb-by-ids?ids=cmAbc,cmDef,...
 *
 * Returns the named KnowledgeBaseItem rows scoped to the project + caller's
 * org. Used by the approvals UI to preview the actual content of facts
 * gated behind a research-finding approval — without exposing the full KB
 * for the project (which can be large).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const { projectId } = await params;
  const idsParam = req.nextUrl.searchParams.get("ids") || "";
  const ids = idsParam.split(",").map(s => s.trim()).filter(Boolean).slice(0, 100);
  if (ids.length === 0) return NextResponse.json({ data: [] });

  const project = await db.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const rows = await db.knowledgeBaseItem.findMany({
    where: { id: { in: ids }, projectId, orgId },
    select: {
      id: true,
      title: true,
      content: true,
      tags: true,
      trustLevel: true,
      type: true,
      // metadata carries source / phase / query / researchedAt / citations
      // for research-finding rows. Surfaced to the approval UI so the user
      // can see WHY each fact was researched and WHERE it'll apply.
      metadata: true,
    },
  });

  // Heuristic enrichment: for each fact, list which artefacts in the
  // current phase are LIKELY to use it, scored by keyword overlap. This
  // tells the user "approving this Cost Benchmarking fact will inform the
  // Cost Management Plan" instead of just "approve a fact". Built once
  // per project from the methodology definition + per-row keyword scoring.
  const likelyArtefactsByRow = new Map<string, string[]>();
  let projectName = "";
  try {
    const projectRow = await db.project.findUnique({
      where: { id: projectId },
      select: { methodology: true, name: true },
    });
    projectName = projectRow?.name || "";
    const methodologyId = (projectRow?.methodology || "traditional").toLowerCase().replace("agile_", "");
    const { getMethodology } = await import("@/lib/methodology-definitions");
    const methodology = getMethodology(methodologyId);
    for (const row of rows) {
      const meta = row.metadata as any;
      const phaseName = meta?.phase || meta?.phaseName;
      if (!phaseName) continue;
      const phaseDef = methodology.phases.find((p) => p.name.toLowerCase() === String(phaseName).toLowerCase());
      if (!phaseDef) continue;

      const factText = `${row.title} ${row.content || ""}`.toLowerCase();
      const matches: Array<{ name: string; score: number }> = [];
      for (const a of phaseDef.artefacts) {
        const an = a.name.toLowerCase();
        let score = 0;
        if (/\b(budget|cost|price|spend|expenditure)\b/.test(factText) && /(cost|budget|estimate|finance)/.test(an)) score += 3;
        if (/\b(risk|issue|threat|hazard)\b/.test(factText) && /risk/.test(an)) score += 3;
        if (/\b(stakeholder|sponsor|vendor|supplier|client|partner)\b/.test(factText) && /(stakeholder|communication|engagement)/.test(an)) score += 2;
        if (/\b(schedule|duration|timeline|milestone|deadline|delivery)\b/.test(factText) && /(schedule|plan|wbs|work breakdown|gantt|sprint)/.test(an)) score += 2;
        if (/\b(scope|deliverable|requirement|outcome|objective)\b/.test(factText) && /(charter|scope|brief|requirement|business case)/.test(an)) score += 2;
        if (/\b(quality|standard|benchmark|criteria|acceptance)\b/.test(factText) && /quality/.test(an)) score += 2;
        if (/\b(benefit|roi|value|return)\b/.test(factText) && /(benefit|business case)/.test(an)) score += 2;
        // Generic fallback: artefact name token appears in fact text
        const artefactTokens = an.split(/\s+/).filter((t) => t.length > 4);
        for (const tok of artefactTokens) {
          if (factText.includes(tok)) { score += 1; break; }
        }
        if (score > 0) matches.push({ name: a.name, score });
      }
      matches.sort((a, b) => b.score - a.score);
      const top = matches.slice(0, 4).map((m) => m.name);
      // If nothing scored, surface the phase's required artefacts as the
      // safety net so the user sees what the phase produces overall.
      const fallback = top.length > 0
        ? []
        : phaseDef.artefacts.filter((a) => a.required && a.aiGeneratable).slice(0, 3).map((a) => a.name);
      likelyArtefactsByRow.set(row.id, [...top, ...fallback]);
    }
  } catch (e) {
    console.error("[kb-by-ids] likely-artefacts heuristic failed:", e);
  }

  const enriched = rows.map((r) => {
    const meta = r.metadata as any;
    return {
      ...r,
      query: meta?.query || null,
      phase: meta?.phase || meta?.phaseName || null,
      source: meta?.source || null,
      researchedAt: meta?.researchedAt || null,
      citations: Array.isArray(meta?.citations) ? meta.citations.slice(0, 5) : null,
      likelyArtefacts: likelyArtefactsByRow.get(r.id) || [],
    };
  });

  return NextResponse.json({ data: enriched, projectName });
}
