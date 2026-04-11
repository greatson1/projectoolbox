import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/projects/[projectId]/tasks
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const tasks = await db.task.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });

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
