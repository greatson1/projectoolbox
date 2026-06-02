import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/notifications
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const unreadOnly = searchParams.get("unread") === "true";

  const notifications = await db.notification.findMany({
    where: {
      userId: session.user.id,
      ...(type && { type: type as any }),
      ...(unreadOnly && { isRead: false }),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ data: notifications });
}

// POST /api/notifications — mark read (single or all)
//
// Body:
//   { action: "mark-all-read" }           → updateMany on userId + isRead:false
//   { action: "mark-read", id: "cm..." }  → update by id, scoped to userId
//
// Returns { success: true, updated: <number> } so the client can sanity-check
// the badge decrement.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  if (body.action === "mark-all-read") {
    const result = await db.notification.updateMany({
      where: { userId: session.user.id, isRead: false },
      data: { isRead: true },
    });
    return NextResponse.json({ success: true, updated: result.count });
  }

  if (body.action === "mark-read" && typeof body.id === "string") {
    // Scope by userId so a user can't mark someone else's row read by
    // brute-forcing IDs.
    const result = await db.notification.updateMany({
      where: { id: body.id, userId: session.user.id },
      data: { isRead: true },
    });
    return NextResponse.json({ success: true, updated: result.count });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
