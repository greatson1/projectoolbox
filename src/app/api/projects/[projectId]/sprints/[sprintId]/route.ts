import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─── PATCH — update sprint ────────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string; sprintId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId, sprintId } = await params;
  const body = await req.json();

  const allowed = ["name", "goal", "startDate", "endDate", "status"];
  const data: Record<string, any> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) {
      data[key] = key === "startDate" || key === "endDate" ? new Date(body[key]) : body[key];
    }
  }

  const sprint = await db.sprint.update({
    where: { id: sprintId, projectId },
    data,
  });

  // Reverse sync: update Sprint Plans artefact CSV
  try {
    const { syncSprintsToArtefact } = await import("@/lib/agents/artefact-sync");
    syncSprintsToArtefact(projectId).catch(() => {});
  } catch {}

  return NextResponse.json({ data: sprint });
}

// ─── DELETE — delete sprint (moves tasks back to backlog) ────────────────────

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ projectId: string; sprintId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId, sprintId } = await params;

  // Un-assign tasks from this sprint (move to backlog)
  await db.task.updateMany({
    where: { sprintId, projectId },
    data: { sprintId: null, status: "BACKLOG" },
  });

  await db.sprint.delete({ where: { id: sprintId, projectId } });

  // Reverse sync: update Sprint Plans artefact CSV
  try {
    const { syncSprintsToArtefact } = await import("@/lib/agents/artefact-sync");
    syncSprintsToArtefact(projectId).catch(() => {});
  } catch {}

  return NextResponse.json({ success: true });
}
