/**
 * API Authentication helper
 *
 * Accepts EITHER:
 *   - A valid NextAuth browser session (cookie-based, for the dashboard UI)
 *   - A valid API key passed as  Authorization: Bearer ptx_live_<key>
 *
 * Returns { orgId, userId? } on success, or null if neither credential is valid.
 *
 * Usage in route handlers:
 *   const caller = await resolveApiCaller(req);
 *   if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 */

import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export interface ApiCaller {
  orgId: string;
  userId?: string;   // present for session-based callers, absent for API key callers
  keyId?: string;    // present for API key callers, absent for session callers
}

export async function resolveApiCaller(req: NextRequest): Promise<ApiCaller | null> {
  // ── 1. Try bearer token ──────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ptx_live_")) {
    const rawKey = authHeader.slice("Bearer ".length).trim();
    const keyHash = createHash("sha256").update(rawKey).digest("hex");

    const apiKey = await db.apiKey.findFirst({
      where: {
        keyHash,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true, orgId: true },
    });

    if (!apiKey) return null;

    // Update lastUsed (fire-and-forget — don't block the request)
    db.apiKey.update({ where: { id: apiKey.id }, data: { lastUsed: new Date() } }).catch(() => {});

    return { orgId: apiKey.orgId, keyId: apiKey.id };
  }

  // ── 2. Fall back to NextAuth session ────────────────────────────────────
  const session = await auth();
  if (!session?.user) return null;

  const orgId = (session.user as any).orgId;
  if (!orgId) return null;

  return { orgId, userId: session.user.id };
}
