import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// DELETE /api/admin/webhooks/:id — Remove a webhook endpoint
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const { id } = await params;

  await db.webhookEndpoint.delete({
    where: { id, orgId },
  });

  await db.auditLog.create({
    data: { orgId, userId: session.user.id, action: "Webhook deleted", target: id },
  });

  return NextResponse.json({ data: { message: "Webhook deleted" } });
}

// PATCH /api/admin/webhooks/:id — Toggle active/inactive
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const { id } = await params;
  const body = await req.json();

  const webhook = await db.webhookEndpoint.update({
    where: { id, orgId },
    data: { isActive: body.isActive },
  });

  return NextResponse.json({ data: webhook });
}
