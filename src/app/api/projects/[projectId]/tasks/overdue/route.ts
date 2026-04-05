import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// GET /api/projects/:id/tasks/overdue — Overdue tasks with slippage data
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;

  const now = new Date();
  const tasks = await db.task.findMany({
    where: {
      projectId,
      endDate: { lt: now },
      status: { notIn: ["DONE", "CANCELLED"] },
    },
    orderBy: { endDate: "asc" },
  });

  const withSlippage = tasks.map(t => ({
    ...t,
    slippageDays: Math.ceil((now.getTime() - new Date(t.endDate!).getTime()) / (1000 * 60 * 60 * 24)),
  }));

  return NextResponse.json({ data: withSlippage });
}
