import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/projects/:id/tasks/critical-path — Tasks on critical path
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;

  const tasks = await db.task.findMany({
    where: { projectId, isCriticalPath: true },
    orderBy: { startDate: "asc" },
  });

  // Calculate total float
  const project = await db.project.findUnique({ where: { id: projectId }, select: { endDate: true } });
  const projectEnd = project?.endDate ? new Date(project.endDate) : null;

  const withFloat = tasks.map(t => {
    const taskEnd = t.endDate ? new Date(t.endDate) : null;
    const floatDays = projectEnd && taskEnd ? Math.max(0, Math.ceil((projectEnd.getTime() - taskEnd.getTime()) / (1000 * 60 * 60 * 24))) : null;
    return { ...t, floatDays };
  });

  return NextResponse.json({ data: withFloat });
}
