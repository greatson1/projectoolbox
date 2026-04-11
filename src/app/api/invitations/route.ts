import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

// GET /api/invitations — List pending invitations for org
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ data: [] });

  const invitations = await db.invitation.findMany({
    where: { orgId },
    orderBy: { sentAt: "desc" },
  });

  return NextResponse.json({ data: invitations });
}

// POST /api/invitations — Send invitation (Owner/Admin only)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  const userRole = (session.user as any).role;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });
  if (userRole !== "OWNER" && userRole !== "ADMIN") {
    return NextResponse.json({ error: "Only Owner or Admin can send invitations" }, { status: 403 });
  }

  const { email, role } = await req.json();
  if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });

  // Check if already a member
  const existingMember = await db.userOrganisation.findFirst({
    where: { orgId, user: { email } },
  });
  if (existingMember) {
    return NextResponse.json({ error: "This person is already a member of your organisation" }, { status: 409 });
  }

  // Check for existing pending invitation
  const existingInvite = await db.invitation.findFirst({
    where: { email, orgId, status: "PENDING" },
  });
  if (existingInvite) {
    return NextResponse.json({ error: "An invitation is already pending for this email" }, { status: 409 });
  }

  // Create invitation
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const invitation = await db.invitation.create({
    data: {
      email,
      orgId,
      role: (role as any) || "MEMBER",
      token,
      invitedBy: session.user.id,
      expiresAt,
    },
  });

  // Get org name for email
  const org = await db.organisation.findUnique({ where: { id: orgId }, select: { name: true } });

  // Send invitation email
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const acceptUrl = `${process.env.NEXTAUTH_URL || "https://projectoolbox.com"}/invite?token=${token}`;

    await resend.emails.send({
      from: "Projectoolbox <noreply@projectoolbox.com>",
      to: email,
      subject: `You've been invited to join ${org?.name || "an organisation"} on Projectoolbox`,
      html: `
        <div style="font-family: Inter, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #6366F1, #8B5CF6); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 22px;">You're Invited</h1>
          </div>
          <div style="padding: 32px; background: #F8FAFC; border: 1px solid #E2E8F0; border-top: 0; border-radius: 0 0 12px 12px;">
            <p style="color: #0F172A; font-size: 16px; margin: 0 0 8px;">Join <strong>${org?.name}</strong> on Projectoolbox</p>
            <p style="color: #64748B; font-size: 14px; margin: 0 0 24px;">You've been invited as a <strong>${role || "Member"}</strong>. Projectoolbox is an AI-powered project management platform with autonomous agents.</p>
            <a href="${acceptUrl}" style="display: inline-block; background: #6366F1; color: white; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 15px;">Accept Invitation</a>
            <p style="color: #94A3B8; font-size: 12px; margin: 24px 0 0;">This invitation expires in 7 days. If you didn't expect this, you can ignore this email.</p>
          </div>
        </div>
      `,
    });
  } catch (e) {
    console.error("Invitation email failed:", e);
  }

  // Audit log
  await db.auditLog.create({
    data: { orgId, userId: session.user.id, action: "Sent invitation", target: `${email} as ${role || "MEMBER"}` },
  });

  return NextResponse.json({ data: invitation }, { status: 201 });
}
