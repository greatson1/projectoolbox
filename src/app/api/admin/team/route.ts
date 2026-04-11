import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ data: [] });

  const members = await db.user.findMany({
    where: { orgId },
    select: { id: true, name: true, email: true, role: true, image: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ data: members });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const { userId, role } = await req.json();
  if (!userId || !role) return NextResponse.json({ error: "userId and role required" }, { status: 400 });

  const user = await db.user.update({
    where: { id: userId, orgId },
    data: { role },
  });

  return NextResponse.json({ data: user });
}
