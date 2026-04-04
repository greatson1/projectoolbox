import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// GET /api/invitations/:token — Get invitation details
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const invitation = await db.invitation.findUnique({
    where: { token },
    include: { org: { select: { name: true, industry: true, logoUrl: true } } },
  });

  if (!invitation) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  if (invitation.status !== "PENDING") return NextResponse.json({ error: `Invitation already ${invitation.status.toLowerCase()}` }, { status: 410 });
  if (invitation.expiresAt < new Date()) {
    await db.invitation.update({ where: { token }, data: { status: "EXPIRED" } });
    return NextResponse.json({ error: "Invitation has expired" }, { status: 410 });
  }

  return NextResponse.json({ data: { email: invitation.email, role: invitation.role, orgName: invitation.org.name, orgLogo: invitation.org.logoUrl, orgIndustry: invitation.org.industry } });
}

// POST /api/invitations/:token — Accept or decline
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { action } = await req.json(); // "accept" | "decline"

  const invitation = await db.invitation.findUnique({ where: { token } });
  if (!invitation) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  if (invitation.status !== "PENDING") return NextResponse.json({ error: `Already ${invitation.status.toLowerCase()}` }, { status: 410 });
  if (invitation.expiresAt < new Date()) {
    await db.invitation.update({ where: { token }, data: { status: "EXPIRED" } });
    return NextResponse.json({ error: "Expired" }, { status: 410 });
  }

  if (action === "decline") {
    await db.invitation.update({ where: { token }, data: { status: "DECLINED" } });
    return NextResponse.json({ data: { status: "declined" } });
  }

  // Accept — find or require the user
  const session = await auth();
  let userId: string;

  if (session?.user?.id) {
    userId = session.user.id;
  } else {
    // Check if a user with this email exists
    const existing = await db.user.findUnique({ where: { email: invitation.email } });
    if (existing) {
      userId = existing.id;
    } else {
      // No user exists — they need to sign up first
      return NextResponse.json({ error: "Please sign up first", signupRequired: true, email: invitation.email }, { status: 401 });
    }
  }

  // Create org membership
  await db.userOrganisation.upsert({
    where: { userId_orgId: { userId, orgId: invitation.orgId } },
    update: { role: invitation.role },
    create: { userId, orgId: invitation.orgId, role: invitation.role },
  });

  // Set as active org
  await db.user.update({
    where: { id: userId },
    data: { orgId: invitation.orgId, role: invitation.role },
  });

  // Mark invitation accepted
  await db.invitation.update({
    where: { token },
    data: { status: "ACCEPTED", acceptedAt: new Date() },
  });

  // Audit log
  await db.auditLog.create({
    data: { orgId: invitation.orgId, userId, action: "Accepted invitation", target: `Joined as ${invitation.role}` },
  });

  return NextResponse.json({ data: { status: "accepted", orgId: invitation.orgId } });
}
