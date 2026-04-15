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

  // ── Sprint completion side-effects ────────────────────────────────────────
  // When marking a sprint COMPLETED:
  //   1. Capture committed/completed story points for velocity tracking
  //   2. Move any non-DONE tasks back to the backlog
  if (body.status === "COMPLETED") {
    const sprintTasks = await db.task.findMany({
      where: { sprintId, projectId },
      select: { id: true, status: true, storyPoints: true },
    });

    const committedPoints = sprintTasks.reduce((s, t) => s + (t.storyPoints ?? 0), 0);
    const completedPoints = sprintTasks
      .filter(t => t.status === "DONE" || t.status === "COMPLETED")
      .reduce((s, t) => s + (t.storyPoints ?? 0), 0);

    data.committedPoints = committedPoints;
    data.completedPoints = completedPoints;

    // Move non-DONE tasks to backlog
    const incomplete = sprintTasks.filter(t => t.status !== "DONE" && t.status !== "COMPLETED");
    if (incomplete.length > 0) {
      await db.task.updateMany({
        where: { id: { in: incomplete.map(t => t.id) }, projectId },
        data: { sprintId: null, status: "BACKLOG" },
      });
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

  // Track sprint completion in KB
  if (body.status === "COMPLETED") {
    import("@/lib/agents/kb-event-tracker").then(({ trackSprintCompletion }) => {
      const incomplete = data.committedPoints - (data.completedPoints || 0);
      trackSprintCompletion(projectId, sprint.name || `Sprint ${sprintId.slice(-4)}`, data.completedPoints || 0, data.committedPoints || 0, incomplete > 0 ? 1 : 0).catch(() => {});
    }).catch(() => {});
  }

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
