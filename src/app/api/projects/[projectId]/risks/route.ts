import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const risks = await db.risk.findMany({
    where: { projectId },
    orderBy: { score: "desc" },
  });

  return NextResponse.json({ data: risks });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const body = await req.json();

  const risk = await db.risk.create({
    data: { ...body, score: (body.probability || 3) * (body.impact || 3), projectId },
  });

  return NextResponse.json({ data: risk }, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;

  const body = await req.json();
  const { riskId, ...data } = body;
  if (!riskId) return NextResponse.json({ error: "riskId required" }, { status: 400 });

  if (data.probability || data.impact) {
    const existing = await db.risk.findUnique({ where: { id: riskId } });
    if (existing) {
      data.score = (data.probability || existing.probability) * (data.impact || existing.impact);
    }
  }

  const risk = await db.risk.update({
    where: { id: riskId, projectId },
    data,
  });

  return NextResponse.json({ data: risk });
}
