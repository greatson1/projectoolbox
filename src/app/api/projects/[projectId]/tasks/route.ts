import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/projects/[projectId]/tasks
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const { searchParams } = new URL(req.url);
  const includeAll = searchParams.get("include") === "all";

  let tasks = await db.task.findMany({
    where: {
      projectId,
      // By default, exclude scaffolded PM overhead tasks from delivery views.
      // Pass ?include=all to get everything (used by PM progress tracker).
      ...(!includeAll ? {
        NOT: { description: { contains: "[scaffolded]" } },
      } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  // Second pass: also remove agent-created overhead that slipped through without [scaffolded] tag.
  // Agent overhead tasks have no real dates — delivery tasks always have dates from WBS/Schedule.
  if (!includeAll) {
    tasks = tasks.filter((t) =>
      !(t.createdBy?.startsWith("agent:") && !t.startDate && !t.endDate)
    );
  }

  return NextResponse.json({ data: tasks });
}

// POST /api/projects/[projectId]/tasks
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const body = await req.json();

  const task = await db.task.create({
    data: { ...body, projectId },
  });

  return NextResponse.json({ data: task }, { status: 201 });
}
