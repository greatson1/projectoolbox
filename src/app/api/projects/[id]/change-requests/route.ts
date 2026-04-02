import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const crs = await db.changeRequest.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ data: crs });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const cr = await db.changeRequest.create({ data: { ...body, projectId: id } });
  return NextResponse.json({ data: cr }, { status: 201 });
}
