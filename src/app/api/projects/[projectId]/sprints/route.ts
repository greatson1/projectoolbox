import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─── GET — list all sprints ───────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const sprints = await db.sprint.findMany({
    where: { projectId },
    orderBy: { startDate: "asc" },
    include: { _count: { select: { tasks: true } } },
  });

  return NextResponse.json({ data: sprints });
}

// ─── POST — create sprint ─────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const body = await req.json();

  if (!body.name || !body.startDate || !body.endDate) {
    return NextResponse.json({ error: "name, startDate and endDate are required" }, { status: 400 });
  }

  // Prevent duplicate sprint names within the same project
  const existing = await db.sprint.findFirst({
    where: { projectId, name: body.name },
  });
  if (existing) {
    return NextResponse.json({ error: `A sprint named "${body.name}" already exists` }, { status: 409 });
  }

  const sprint = await db.sprint.create({
    data: {
      projectId,
      name: body.name,
      goal: body.goal || null,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
      status: body.status || "PLANNING",
    },
  });

  return NextResponse.json({ data: sprint }, { status: 201 });
}
