import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/:projectId/sprints/:sprintId/burndown
 *
 * Returns the burndown + burnup series for a sprint, built from the daily
 * SprintSnapshot rows the cron captures. Each point:
 *   { day, label, ideal, actual, completed }
 * - actual    = remaining SP that day (burndown line)
 * - ideal     = straight line from total→0 across the sprint (reference)
 * - completed = cumulative SP done that day (burnup line)
 *
 * Empty array until at least one snapshot exists.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string; sprintId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId, sprintId } = await params;

  const [sprint, snapshots] = await Promise.all([
    db.sprint.findFirst({
      where: { id: sprintId, projectId },
      select: { startDate: true, endDate: true, committedPoints: true },
    }),
    db.sprintSnapshot.findMany({
      where: { sprintId, projectId },
      orderBy: { dayIndex: "asc" },
      select: { dayIndex: true, totalPoints: true, completedPoints: true, remainingPoints: true },
    }),
  ]);

  if (!sprint) return NextResponse.json({ error: "Sprint not found" }, { status: 404 });
  if (snapshots.length === 0) return NextResponse.json({ data: [] });

  // Sprint length in days for the ideal line. Total scope = the latest
  // snapshot's totalPoints (scope can grow mid-sprint; the ideal tracks the
  // most recent commitment).
  const totalDays = Math.max(
    1,
    Math.round((new Date(sprint.endDate).getTime() - new Date(sprint.startDate).getTime()) / 86_400_000),
  );
  const totalScope = snapshots[snapshots.length - 1].totalPoints || sprint.committedPoints || 0;

  const series = snapshots.map((s) => ({
    day: s.dayIndex,
    label: `Day ${s.dayIndex}`,
    actual: s.remainingPoints,
    completed: s.completedPoints,
    total: s.totalPoints,       // scope line for the burnup chart
    // Ideal remaining = linear glide from full scope on day 0 to 0 on the
    // last day. Clamped at 0 if the capture lands past the planned end.
    ideal: Math.max(0, Math.round(totalScope * (1 - s.dayIndex / totalDays))),
  }));

  return NextResponse.json({ data: series });
}
