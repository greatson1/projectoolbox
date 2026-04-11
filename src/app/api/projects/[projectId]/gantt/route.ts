import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/projects/:id/gantt — Full task tree with dates for Gantt rendering
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;

  const tasks = await db.task.findMany({
    where: { projectId },
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

  return NextResponse.json({ data: { tasks, phases } });
}
