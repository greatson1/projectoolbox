import { NextRequest, NextResponse } from "next/server";
import { after as waitUntil } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { EmailService } from "@/lib/email";
import { looksLikeRandomName, RANDOM_NAME_ERROR } from "@/lib/waitlist-validators";

export const dynamic = "force-dynamic";

/**
 * Robust boolean-env parser. `process.env.INVITE_ONLY === "true"` looks
 * fine until someone pastes `"true\n"` into the Vercel dashboard (live
 * incident — both INVITE_ONLY and NEXT_PUBLIC_INVITE_ONLY shipped with
 * a literal trailing \\n). The strict comparison fails silently, the
 * gate disengages, and any unauthenticated POST can create a user.
 * Trim + lowercase removes the whole class of failure.
 */
function envFlag(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  return raw.trim().toLowerCase() === "true";
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, email, password, inviteToken } = body;

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  // Reject random-looking names (same heuristic the waitlist uses). Stops
  // bot signups planting strings like "ccBLBPrVViYauVjkl" as the user's
  // name even when the bot has somehow obtained an invite token.
  if (name && looksLikeRandomName(name)) {
    return NextResponse.json({ error: RANDOM_NAME_ERROR }, { status: 400 });
  }

  // ── Invite gate (server-side) ─────────────────────────────────────────────
  // If INVITE_ONLY=true, a valid unused non-expired token is required.
  // This is checked server-side so it cannot be bypassed by calling the API directly.
  const inviteOnly = envFlag("INVITE_ONLY") || envFlag("NEXT_PUBLIC_INVITE_ONLY");
  let invitedFromWaitlist = false;

  if (inviteOnly) {
    if (!inviteToken) {
      return NextResponse.json({ error: "An invite is required to create an account." }, { status: 403 });
    }

    const token = await db.inviteToken.findUnique({ where: { token: inviteToken } });

    if (!token) {
      return NextResponse.json({ error: "Invalid invite link." }, { status: 403 });
    }
    if (token.usedAt) {
      return NextResponse.json({ error: "This invite link has already been used." }, { status: 403 });
    }
    if (token.expiresAt && token.expiresAt < new Date()) {
      return NextResponse.json({ error: "This invite link has expired. Contact us for a new one." }, { status: 403 });
    }
    if (token.email && token.email.toLowerCase() !== email.toLowerCase()) {
      return NextResponse.json({ error: "This invite link was issued for a different email address." }, { status: 403 });
    }
    invitedFromWaitlist = true;
  }

  // ── Check for existing account ────────────────────────────────────────────
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }

  // ── Create account ────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const user = await db.user.create({
      data: { name, email, passwordHash },
    });

    // Mark token as used and waitlist entry as REGISTERED
    if (inviteOnly && inviteToken) {
      await db.inviteToken.update({
        where: { token: inviteToken },
        data: { usedAt: new Date() },
      });
      await db.waitlistEntry.updateMany({
        where: { email },
        data: { status: "REGISTERED" },
      });
    }

    // ── Notifications ──────────────────────────────────────────────────────
    // Symmetric with the waitlist signup: confirmation to the user + heads-up
    // to the team. Without this the team only learned about new accounts by
    // checking the admin/users page or staring at the DB. Both wrapped in
    // waitUntil so the API response returns immediately while the lambda
    // stays warm long enough to actually send.
    waitUntil((async () => {
      try {
        await Promise.all([
          EmailService.sendSignupWelcome(email, { name: name?.trim() || null }),
          EmailService.sendSignupAdminNotification({
            email,
            name: name?.trim() || null,
            invitedFromWaitlist,
          }),
        ]);
      } catch (e) {
        console.error("[register] notification emails failed:", e);
      }
    })());

    return NextResponse.json({ data: { userId: user.id, message: "Account created" } }, { status: 201 });
  } catch (err: any) {
    console.error("Registration error:", err);
    return NextResponse.json({ error: err.message || "Registration failed" }, { status: 500 });
  }
}
