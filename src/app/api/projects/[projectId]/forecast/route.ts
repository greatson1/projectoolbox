import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { EXCLUDE_PM_OVERHEAD } from "@/lib/agents/task-filters";

export const dynamic = "force-dynamic";

// GET /api/projects/:id/forecast — AI forecast: projected end date, on-budget probability
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;

  const project = await db.project.findUnique({ where: { id: projectId }, select: { budget: true, startDate: true, endDate: true } });
  const tasks = await db.task.findMany({ where: { projectId, ...EXCLUDE_PM_OVERHEAD }, select: { status: true, endDate: true, storyPoints: true } });

  if (!project?.budget || !project.startDate || !project.endDate) {
    return NextResponse.json({ data: null });
  }

  const totalTasks = tasks.length || 1;
  const doneTasks = tasks.filter(t => t.status === "DONE").length;
  const progress = doneTasks / totalTasks;

  const now = new Date();
  const start = new Date(project.startDate);
  const end = new Date(project.endDate);
  const totalDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  const elapsedDays = (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);

  // SPI-based forecast
  const spi = elapsedDays > 0 && progress > 0 ? (progress / (elapsedDays / totalDays)) : 1;
  const forecastDays = spi > 0 ? totalDays / spi : totalDays * 1.5;
  const forecastEndDate = new Date(start.getTime() + forecastDays * 24 * 60 * 60 * 1000);

  // On-budget probability (simplified)
  const cpi = progress > 0 ? 0.95 : 1; // Simplified — real CPI from cost entries
  const onBudgetProbability = Math.min(1, Math.max(0, cpi * spi));

  // 3 scenarios
  const scenarios = [
    { label: "Optimistic", endDate: new Date(start.getTime() + totalDays * 0.95 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), probability: Math.min(1, onBudgetProbability * 1.1) },
    { label: "Most Likely", endDate: forecastEndDate.toISOString().slice(0, 10), probability: onBudgetProbability },
    { label: "Pessimistic", endDate: new Date(start.getTime() + forecastDays * 1.15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), probability: Math.max(0, onBudgetProbability * 0.8) },
  ];

  return NextResponse.json({
    data: {
      forecastEndDate: forecastEndDate.toISOString().slice(0, 10),
      plannedEndDate: end.toISOString().slice(0, 10),
      slippageDays: Math.max(0, Math.round((forecastEndDate.getTime() - end.getTime()) / (1000 * 60 * 60 * 24))),
      onBudgetProbability: Math.round(onBudgetProbability * 100),
      spi: Math.round(spi * 100) / 100,
      scenarios,
    },
  });
}
