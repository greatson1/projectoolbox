/**
 * Multi-factor auth (TOTP) routes.
 *
 *   POST /api/auth/mfa { action: "enroll" }
 *     → Generates a fresh TOTP secret + otpauth URL + QR PNG (base64 data URI).
 *       Stores the secret on the user row but leaves mfaEnabled=false.
 *       Returns { secret, otpauthUrl, qrDataUrl } so the client can render the
 *       QR for the authenticator app. The user MUST verify before MFA is
 *       considered live — see `verify` below.
 *
 *   POST /api/auth/mfa { action: "verify", code }
 *     → Verifies the 6-digit TOTP code against the currently-stored secret.
 *       On success, sets mfaEnabled=true and writes an audit-log entry.
 *       On failure, returns 400 — the secret stays so the user can retry
 *       without re-scanning the QR.
 *
 *   POST /api/auth/mfa { action: "disable", code }
 *     → Requires a valid current TOTP code to prevent a session-hijack from
 *       turning MFA off. Clears mfaSecret and sets mfaEnabled=false atomically.
 *
 * Why a single route with `action`: each endpoint shares the session
 * lookup + audit-log scaffolding; splitting into three files duplicates
 * the boilerplate for no gain. The verb is the only difference.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";

// 30-second TOTP step with ±30s tolerance — accounts for clock drift without
// making brute force trivial. Passed to verifySync at every call site.
const TOTP_EPOCH_TOLERANCE_SECONDS = 30;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { action, code } = await req.json();
  const userId = session.user.id;

  if (action === "enroll") {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true, mfaEnabled: true },
    });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (user.mfaEnabled) {
      return NextResponse.json({ error: "MFA is already enabled. Disable it first to re-enroll." }, { status: 409 });
    }

    const secret = generateSecret();
    const otpauthUrl = generateURI({ issuer: "Projectoolbox", label: user.email, secret });
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 256, margin: 1 });

    await db.user.update({
      where: { id: userId },
      data: { mfaSecret: secret },
    });

    return NextResponse.json({ data: { secret, otpauthUrl, qrDataUrl } });
  }

  if (action === "verify") {
    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "TOTP code is required" }, { status: 400 });
    }
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabled: true, orgId: true },
    });
    if (!user?.mfaSecret) {
      return NextResponse.json({ error: "No enrollment in progress. Run enroll first." }, { status: 400 });
    }
    const valid = verifySync({
      secret: user.mfaSecret,
      token: code.replace(/\s+/g, ""),
      epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
    }).valid;
    if (!valid) {
      return NextResponse.json({ error: "Invalid code. Try again — the code rotates every 30 seconds." }, { status: 400 });
    }
    if (user.mfaEnabled) {
      return NextResponse.json({ data: { verified: true, alreadyEnabled: true } });
    }

    await db.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });

    if (user.orgId) {
      await db.auditLog.create({
        data: { orgId: user.orgId, userId, action: "Enabled MFA", target: "TOTP" },
      });
    }

    return NextResponse.json({ data: { verified: true, mfaEnabled: true } });
  }

  if (action === "disable") {
    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "TOTP code is required to disable MFA" }, { status: 400 });
    }
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabled: true, orgId: true },
    });
    if (!user?.mfaEnabled || !user.mfaSecret) {
      return NextResponse.json({ error: "MFA is not enabled" }, { status: 400 });
    }
    const valid = verifySync({
      secret: user.mfaSecret,
      token: code.replace(/\s+/g, ""),
      epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
    }).valid;
    if (!valid) {
      return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    }

    await db.user.update({
      where: { id: userId },
      data: { mfaSecret: null, mfaEnabled: false },
    });

    if (user.orgId) {
      await db.auditLog.create({
        data: { orgId: user.orgId, userId, action: "Disabled MFA", target: "TOTP" },
      });
    }

    return NextResponse.json({ data: { disabled: true } });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

// GET — read-only status check for the settings page. Never returns the
// secret; just whether MFA is on.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { mfaEnabled: true, mfaSecret: true },
  });
  return NextResponse.json({ data: { mfaEnabled: !!user?.mfaEnabled, enrollmentInProgress: !!user?.mfaSecret && !user?.mfaEnabled } });
}
