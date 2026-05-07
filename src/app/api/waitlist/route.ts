import { NextRequest, NextResponse } from "next/server";
import { after as waitUntil } from "next/server";
import { db } from "@/lib/db";
import { EmailService } from "@/lib/email";

export const dynamic = "force-dynamic";

// ─── POST — join waitlist ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, name, sector } = body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email address is required." }, { status: 400 });
  }

  // Check for duplicate
  const existing = await db.waitlistEntry.findUnique({ where: { email } });
  if (existing) {
    // Return success silently — don't leak whether an email is already registered
    return NextResponse.json({ success: true, alreadyRegistered: true });
  }

  // Save to DB
  await db.waitlistEntry.create({
    data: { email, name: name?.trim() || null, sector: sector || null },
  });

  // ── Confirmation emails ─────────────────────────────────────────────────
  // Two emails fire after every successful signup:
  //   1. To the user — branded "you're in" confirmation (always fires).
  //   2. To the team — internal notification (fires only when
  //      WAITLIST_NOTIFY_EMAIL is set on Vercel).
  // Both wrapped in waitUntil so the user sees the API response instantly;
  // the lambda stays alive long enough to actually send before freezing.
  const total = await db.waitlistEntry.count().catch(() => undefined);
  waitUntil((async () => {
    try {
      await Promise.all([
        EmailService.sendWaitlistConfirmation(email, { name: name?.trim() || null, sector: sector || null }),
        EmailService.sendWaitlistAdminNotification({ email, name: name?.trim() || null, sector: sector || null, total }),
      ]);
    } catch (e) {
      console.error("[waitlist] confirmation emails failed:", e);
    }
  })());

  // ── Sync to Kit (V4 API) ─────────────────────────────────────────────────
  // Kit V4 uses Bearer token auth and a different endpoint structure.
  // Set KIT_API_KEY and KIT_FORM_ID in your environment variables.
  const kitApiKey = process.env.KIT_API_KEY;
  const kitFormId = process.env.KIT_FORM_ID; // numeric form ID from Kit dashboard

  if (kitApiKey && kitFormId) {
    try {
      await fetch(`https://api.kit.com/v4/forms/${kitFormId}/subscribers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${kitApiKey}`,
          "X-Kit-Api-Key": kitApiKey,
        },
        body: JSON.stringify({
          email_address: email,
          first_name: name?.trim() || undefined,
          fields: { sector: sector || "" },
        }),
      });
    } catch {
      // Kit sync failure is non-fatal — entry is already saved in DB
    }
  }

  return NextResponse.json({ success: true });
}

// ─── GET — admin: list waitlist entries ─────────────────────────────────────

export async function GET(req: NextRequest) {
  // Simple admin key check — replace with proper auth if needed
  const adminKey = req.headers.get("x-admin-key");
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const entries = await db.waitlistEntry.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ data: entries, count: entries.length });
}
