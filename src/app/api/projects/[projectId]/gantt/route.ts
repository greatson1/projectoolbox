import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { EXCLUDE_PM_OVERHEAD } from "@/lib/agents/task-filters";

export const dynamic = "force-dynamic";

// GET /api/projects/:id/gantt — Full task tree with dates for Gantt rendering
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;

  const tasks = await db.task.findMany({
    where: { projectId, ...EXCLUDE_PM_OVERHEAD },
    orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, title: true, status: true, priority: true,
      startDate: true, endDate: true, progress: true,
      assigneeId: true, parentId: true, phaseId: true,
      dependencies: true, isCriticalPath: true,
      storyPoints: true, estimatedHours: true, actualHours: true,
    },
  });

  const phases = await db.phase.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
    select: { id: true, name: true, status: true, startDate: true, endDate: true },
  });

  // Undated tasks render as invisible zero-width bars on the Gantt (Kanban
  // projects seed work items with no dates by design). Fall back to the
  // owning phase's window, then the project window, so every row draws.
  // The fallback is presentation-only — the DB rows keep null dates.
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { startDate: true, endDate: true },
  });
  const defaultStart = project?.startDate ?? new Date();
  const defaultEnd = project?.endDate ?? new Date(defaultStart.getTime() + 30 * 86_400_000);
  const phaseById = new Map(phases.map((p) => [p.id, p]));
  const phaseByName = new Map(phases.map((p) => [p.name, p]));
  const withDates = tasks.map((t) => {
    if (t.startDate || t.endDate) return t;
    const phase = (t.phaseId && (phaseById.get(t.phaseId) || phaseByName.get(t.phaseId))) || null;
    return {
      ...t,
      startDate: phase?.startDate ?? defaultStart,
      endDate: phase?.endDate ?? defaultEnd,
      datesInferred: true,
    };
  });

  return NextResponse.json({ data: { tasks: withDates, phases } });
}
