import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/me — current user profile
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, image: true, role: true },
  });
  return NextResponse.json({ data: user });
}

// PATCH /api/me — update own profile (name only; email is the identity key
// and changing it would orphan the OAuth account linkage).
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id;

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (name.length > 120) return NextResponse.json({ error: "Name is too long" }, { status: 400 });

  const user = await db.user.update({
    where: { id: userId },
    data: { name },
    select: { id: true, name: true, email: true },
  });

  return NextResponse.json({ data: user });
}
