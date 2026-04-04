import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// POST /api/admin/team/remove — Remove member from org
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  const userRole = (session.user as any).role;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });
  if (userRole !== "OWNER" && userRole !== "ADMIN") {
    return NextResponse.json({ error: "Only Owner or Admin can remove members" }, { status: 403 });
  }

  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  // Can't remove yourself
  if (userId === session.user.id) {
    return NextResponse.json({ error: "You cannot remove yourself" }, { status: 400 });
  }

  // Verify the user is in this org
  const membership = await db.userOrganisation.findUnique({
    where: { userId_orgId: { userId, orgId } },
  });
  if (!membership) return NextResponse.json({ error: "User is not in this organisation" }, { status: 404 });

  // Can't remove the owner
  if (membership.role === "OWNER") {
    return NextResponse.json({ error: "Cannot remove the organisation owner" }, { status: 403 });
  }

  // Unassign their tasks (move to backlog)
  await db.task.updateMany({
    where: { assigneeId: userId, project: { orgId } },
    data: { assigneeId: null, status: "TODO" },
  });

  // Remove org membership
  await db.userOrganisation.delete({
    where: { userId_orgId: { userId, orgId } },
  });

  // If this was their active org, clear it
  const user = await db.user.findUnique({ where: { id: userId }, select: { orgId: true } });
  if (user?.orgId === orgId) {
    // Find another org they belong to, or set to null
    const otherMembership = await db.userOrganisation.findFirst({ where: { userId } });
    await db.user.update({
      where: { id: userId },
      data: { orgId: otherMembership?.orgId || null, role: otherMembership?.role || "MEMBER" },
    });
  }

  // Audit log
  await db.auditLog.create({
    data: { orgId, userId: session.user.id, action: "Removed member", target: userId },
  });

  return NextResponse.json({ data: { removed: true } });
}
