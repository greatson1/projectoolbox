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
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { definitionOfDone: true, definitionOfReady: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const dod = (project.definitionOfDone as any) || null;
  const dor = (project.definitionOfReady as any) || null;

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
