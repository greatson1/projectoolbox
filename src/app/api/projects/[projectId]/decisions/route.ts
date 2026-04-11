import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;

  const decisions = await db.decision.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ data: decisions });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;

  const body = await req.json();
  const decision = await db.decision.create({
    data: {
      projectId,
      userId: session.user.id,
      text: body.text,
      decidedBy: body.decidedBy,
      rationale: body.rationale,
      meetingId: body.meetingId,
    },
  });

  return NextResponse.json({ data: decision }, { status: 201 });
}
