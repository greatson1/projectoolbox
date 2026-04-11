import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const { email, role } = await req.json();
  if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });

  const existing = await db.user.findUnique({ where: { email } });
  if (existing?.orgId === orgId) {
    return NextResponse.json({ error: "User already in organisation" }, { status: 409 });
  }

  await db.auditLog.create({
    data: { orgId, userId: session.user.id, action: "INVITE_SENT", target: email, details: { role } },
  });

  return NextResponse.json({ data: { message: `Invitation sent to ${email}` } });
}
