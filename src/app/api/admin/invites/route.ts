import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// ─── POST — generate an invite token (admin only) ────────────────────────────
// Usage: POST { email?: string, expiresInDays?: number }
// Returns: { token, inviteUrl }

export async function POST(req: NextRequest) {
  const adminKey = req.headers.get("x-admin-key");
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { email, expiresInDays = 7 } = body;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  const invite = await db.inviteToken.create({
    data: { email: email || null, expiresAt },
  });

  const baseUrl = process.env.NEXTAUTH_URL || "https://www.projectoolbox.com";
  const inviteUrl = `${baseUrl}/signup?invite=${invite.token}${email ? `&email=${encodeURIComponent(email)}` : ""}`;

  // Mark waitlist entry as invited if email provided
  if (email) {
    await db.waitlistEntry.updateMany({
      where: { email },
      data: { status: "INVITED" },
    });
  }

  return NextResponse.json({ token: invite.token, inviteUrl, expiresAt });
}

// ─── GET — list all invite tokens ────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const adminKey = req.headers.get("x-admin-key");
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tokens = await db.inviteToken.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ data: tokens });
}
