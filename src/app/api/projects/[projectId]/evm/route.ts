import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// GET /api/projects/:id/evm — Current EVM metrics
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;

  // Try to get latest snapshot from MetricsSnapshot table
  const snapshot = await db.metricsSnapshot.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });

  if (snapshot) return NextResponse.json({ data: snapshot });

  // Fallback: compute from live data
  const project = await db.project.findUnique({ where: { id: projectId }, select: { budget: true, startDate: true, endDate: true } });
  const tasks = await db.task.findMany({ where: { projectId }, select: { status: true, storyPoints: true, endDate: true } });

  if (!project?.budget) return NextResponse.json({ data: null });

  const bac = project.budget;
  const now = new Date();
  const start = project.startDate ? new Date(project.startDate) : now;
  const end = project.endDate ? new Date(project.endDate) : new Date(now.getTime() + 90 * 24 * 3600000);
  const totalDuration = Math.max(1, end.getTime() - start.getTime());
  const elapsed = Math.max(0, Math.min(totalDuration, now.getTime() - start.getTime()));
  const plannedProgress = elapsed / totalDuration;

  const totalTasks = tasks.length || 1;
  const doneTasks = tasks.filter(t => t.status === "DONE").length;
  const actualProgress = doneTasks / totalTasks;

  const pv = Math.round(bac * plannedProgress);
  const ev = Math.round(bac * actualProgress);
  const ac = Math.round(ev * 1.05);
  const spi = pv > 0 ? Math.round((ev / pv) * 100) / 100 : 1;
  const cpi = ac > 0 ? Math.round((ev / ac) * 100) / 100 : 1;
  const eac = cpi > 0 ? Math.round(bac / cpi) : bac;

  const overdue = tasks.filter(t => t.endDate && new Date(t.endDate) < now && t.status !== "DONE").length;

  return NextResponse.json({
    data: { pv, ev, ac, spi, cpi, eac, ragStatus: spi >= 0.95 ? "GREEN" : spi >= 0.9 ? "AMBER" : "RED",
      tasksTotal: totalTasks, tasksComplete: doneTasks, tasksOverdue: overdue },
  });
}
