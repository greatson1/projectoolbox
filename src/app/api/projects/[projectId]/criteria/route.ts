import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ projectId: string }> };

// GET /api/projects/:projectId/criteria
// Returns the project's Definition of Done and Definition of Ready criteria.
// Used by the Task detail panel to render the DoD/DoR checklists and by the
// Sprint Tracker to surface a "what 'done' means here" card. Returns empty
// arrays — never 404 — when criteria haven't been approved yet, so the
// caller can render an empty state instead of guarding against null.
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  let project = await db.project.findUnique({
    where: { id: projectId },
    select: { definitionOfDone: true, definitionOfReady: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // ── Lazy backfill: bridge approved DoD/DoR artefact → Project columns ──
  // The criteria-ingest seeder runs on artefact PATCH. Projects whose DoD
  // or DoR was approved BEFORE the seeder existed (commit 4d07e37 and
  // anything before the live schema push) have an approved artefact in
  // the AgentArtefact table but a null Project.definitionOfDone. Sprint
  // Tracker / Task gate then claim "no DoD approved yet" even though one
  // is staring the user in the face on the Artefacts page. Self-heal on
  // read: if either column is empty, scan for an approved artefact
  // matching the name and run the ingest. Quiet on the common path
  // (skips when the column is already populated).
  const dodEmpty = !(project.definitionOfDone as any)?.criteria?.length;
  const dorEmpty = !(project.definitionOfReady as any)?.criteria?.length;
  if (dodEmpty || dorEmpty) {
    try {
      const candidates = await db.agentArtefact.findMany({
        where: {
          projectId,
          status: "APPROVED",
          OR: [
            { name: { contains: "definition of done", mode: "insensitive" } },
            { name: { contains: "definition of ready", mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true, content: true, agentId: true, projectId: true },
        orderBy: { updatedAt: "desc" },
      });
      if (candidates.length > 0) {
        const { ingestCriteriaArtefact } = await import("@/lib/agents/criteria-ingest");
        for (const a of candidates) {
          if (!a.content) continue;
          const lname = a.name.toLowerCase();
          if (lname.includes("definition of done") && !dodEmpty) continue;
          if (lname.includes("definition of ready") && !dorEmpty) continue;
          try {
            const out = await ingestCriteriaArtefact(a, a.agentId);
            console.log(`[criteria GET] lazy backfill: ${a.name} → ${out.kind}, ${out.criteria ?? 0} criteria`);
          } catch (e) {
            console.error(`[criteria GET] backfill failed for "${a.name}":`, e);
          }
        }
        // Re-read after backfill so the response reflects the seeded values.
        project = await db.project.findUnique({
          where: { id: projectId },
          select: { definitionOfDone: true, definitionOfReady: true },
        });
      }
    } catch (e) {
      console.error("[criteria GET] lazy backfill block failed:", e);
    }
  }

  const dod = (project?.definitionOfDone as any) || null;
  const dor = (project?.definitionOfReady as any) || null;

  return NextResponse.json({
    data: {
      definitionOfDone: {
        criteria: Array.isArray(dod?.criteria) ? dod.criteria : [],
        sourceArtefactId: dod?.sourceArtefactId ?? null,
        approvedAt: dod?.approvedAt ?? null,
      },
      definitionOfReady: {
        criteria: Array.isArray(dor?.criteria) ? dor.criteria : [],
        sourceArtefactId: dor?.sourceArtefactId ?? null,
        approvedAt: dor?.approvedAt ?? null,
      },
    },
  });
}
