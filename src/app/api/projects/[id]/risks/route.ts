import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const risks = await db.risk.findMany({
    where: { projectId: id },
    orderBy: { score: "desc" },
  });

  return NextResponse.json({ data: risks });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const risk = await db.risk.create({
    data: { ...body, score: (body.probability || 3) * (body.impact || 3), projectId: id },
  });

  return NextResponse.json({ data: risk }, { status: 201 });
}
