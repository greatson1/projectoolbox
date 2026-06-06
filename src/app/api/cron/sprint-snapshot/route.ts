/**
 * Sprint Snapshot cron — runs daily.
 *
 * Schedule via Vercel cron: "0 23 * * *" (23:00 UTC daily, end-of-day).
 * Protected by CRON_SECRET; also accepts a session caller (used by the
 * Sprint Tracker "capture now" affordance / manual backfill).
 *
 * For every ACTIVE sprint, writes one SprintSnapshot row capturing the
 * burndown/burnup state at end of day: total committed SP, completed SP,
 * and remaining SP. Upserts by (sprintId, dayIndex) so a re-run on the same
 * day overwrites rather than duplicating. These rows give the Sprint Tracker
 * burndown/burnup charts the daily history they need.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DONE = new Set(["done", "completed"]);

async function captureSnapshots(scopeProjectId?: string) {
  // Only ACTIVE sprints accrue burndown history. Completed/planning sprints
  // are static, and snapshotting them would add noise.
  const sprints = await db.sprint.findMany({
    where: { status: "ACTIVE", ...(scopeProjectId ? { projectId: scopeProjectId } : {}) },
    select: { id: true, projectId: true, startDate: true, committedPoints: true },
  });

  let written = 0;
  for (const s of sprints) {
    const tasks = await db.task.findMany({
      where: { sprintId: s.id },
      select: { status: true, storyPoints: true },
    }).catch(() => [] as Array<{ status: string; storyPoints: number | null }>);

    // SP weighting with a 1-SP fallback so unestimated tasks still count —
    // matches the Sprint Tracker's progress maths.
    const sp = (t: { storyPoints: number | null }) => (Number(t.storyPoints) > 0 ? Number(t.storyPoints) : 1);
    const totalFromTasks = tasks.reduce((acc, t) => acc + sp(t), 0);
    const totalPoints = totalFromTasks || s.committedPoints || 0;
    const completedPoints = tasks.filter(t => DONE.has((t.status || "").toLowerCase())).reduce((acc, t) => acc + sp(t), 0);
    const remainingPoints = Math.max(0, totalPoints - completedPoints);

    const dayIndex = Math.max(0, Math.floor((Date.now() - new Date(s.startDate).getTime()) / 86_400_000));

    await db.sprintSnapshot.upsert({
      where: { sprintId_dayIndex: { sprintId: s.id, dayIndex } },
      create: { sprintId: s.id, projectId: s.projectId, dayIndex, totalPoints, completedPoints, remainingPoints },
      update: { totalPoints, completedPoints, remainingPoints, capturedAt: new Date() },
    }).catch((e) => console.error(`[sprint-snapshot] upsert failed for sprint ${s.id}:`, e));
    written++;
  }
  return { sprints: sprints.length, written };
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    const result = await captureSnapshots();
    return NextResponse.json({ data: result });
  }

  // Session fallback — scope to the caller's org's active sprints. Used by a
  // manual "capture now" so a fresh project doesn't wait until 23:00 UTC for
  // its first burndown point.
  const { auth } = await import("@/lib/auth");
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  // Resolve the caller's projects so the session path can't snapshot another
  // org's sprints.
  const projects = await db.project.findMany({ where: { orgId }, select: { id: true } });
  let total = { sprints: 0, written: 0 };
  for (const p of projects) {
    const r = await captureSnapshots(p.id);
    total = { sprints: total.sprints + r.sprints, written: total.written + r.written };
  }
  return NextResponse.json({ data: total });
}

export async function POST(req: NextRequest) { return GET(req); }
