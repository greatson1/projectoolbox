import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// GET /api/orgs/switch — List all orgs user belongs to
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const memberships = await db.userOrganisation.findMany({
    where: { userId: session.user.id },
    include: { org: { select: { id: true, name: true, logoUrl: true, plan: true } } },
    orderBy: { joinedAt: "asc" },
  });

  const activeOrgId = (session.user as any).orgId;

  return NextResponse.json({
    data: {
      activeOrgId,
      orgs: memberships.map(m => ({
        id: m.org.id,
        name: m.org.name,
        logoUrl: m.org.logoUrl,
        plan: m.org.plan,
        role: m.role,
        active: m.org.id === activeOrgId,
      })),
    },
  });
}

// POST /api/orgs/switch — Switch active org
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { orgId } = await req.json();
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });

  // Verify membership
  const membership = await db.userOrganisation.findUnique({
    where: { userId_orgId: { userId: session.user.id!, orgId } },
  });

  if (!membership) return NextResponse.json({ error: "Not a member of this organisation" }, { status: 403 });

  // Update active org and role
  await db.user.update({
    where: { id: session.user.id },
    data: { orgId, role: membership.role },
  });

  return NextResponse.json({ data: { activeOrgId: orgId, role: membership.role } });
}
