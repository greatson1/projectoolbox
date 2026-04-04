import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const decisions = await db.decision.findMany({
    where: { projectId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ data: decisions });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json();
  const decision = await db.decision.create({
    data: {
      projectId: id,
      userId: session.user.id,
      text: body.text,
      decidedBy: body.decidedBy,
      rationale: body.rationale,
      meetingId: body.meetingId,
    },
  });

  return NextResponse.json({ data: decision }, { status: 201 });
}
