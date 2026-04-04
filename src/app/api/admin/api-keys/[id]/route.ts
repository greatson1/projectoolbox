import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// DELETE /api/admin/api-keys/:id — Revoke an API key
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const { id } = await params;

  const key = await db.apiKey.update({
    where: { id, orgId },
    data: { revokedAt: new Date() },
  });

  await db.auditLog.create({
    data: { orgId, userId: session.user.id, action: "Revoked API key", target: key.name },
  });

  return NextResponse.json({ data: { message: "Key revoked" } });
}
