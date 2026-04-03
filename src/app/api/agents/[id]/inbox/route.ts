import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

/**
 * GET /api/agents/:id/inbox — View agent's received emails (org-scoped)
 * Only the owning organisation's users can see their agent's emails.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ data: [] });

  const { id: agentId } = await params;

  // Verify the agent belongs to this org
  const agent = await db.agent.findFirst({
    where: { id: agentId, orgId },
    select: { id: true },
  });

  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status"); // UNREAD, READ, PROCESSED, ARCHIVED
  const type = searchParams.get("type"); // GENERAL, MEETING_INVITE, MEETING_NOTES, STATUS_UPDATE

  const messages = await db.agentInboxMessage.findMany({
    where: {
      agentId,
      orgId, // CRITICAL: org-scoped query
      ...(status && { status }),
      ...(type && { type }),
    },
    orderBy: { receivedAt: "desc" },
    take: 50,
  });

  const unreadCount = await db.agentInboxMessage.count({
    where: { agentId, orgId, status: "UNREAD" },
  });

  return NextResponse.json({ data: { messages, unreadCount } });
}

/**
 * PATCH /api/agents/:id/inbox — Mark messages as read/archived
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  const { id: agentId } = await params;
  const body = await req.json();
  const { messageIds, status } = body;

  if (!messageIds?.length || !status) {
    return NextResponse.json({ error: "messageIds and status required" }, { status: 400 });
  }

  // Only update messages belonging to this org
  await db.agentInboxMessage.updateMany({
    where: {
      id: { in: messageIds },
      agentId,
      orgId, // CRITICAL: org-scoped
    },
    data: { status },
  });

  return NextResponse.json({ data: { updated: messageIds.length } });
}
