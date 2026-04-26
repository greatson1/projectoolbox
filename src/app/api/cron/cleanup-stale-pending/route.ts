/**
 * Cleanup Stale Pending KB Items — runs daily.
 *
 * Schedule via Vercel cron: "30 4 * * *" (04:30 UTC daily)
 * Protected by CRON_SECRET. Also accepts a session caller for their own org
 * (used by the Settings → Health "Run cleanup now" button if we add one).
 *
 * What it does: deletes any KnowledgeBaseItem tagged `pending_user_confirmation`
 * that hasn't been touched in 30+ days. The premise is that if a user hasn't
 * confirmed it by then, they're never going to — and these items pollute the
 * Pending review tab. They were never used as authoritative facts (the tag
 * blocks promotion to artefacts), so deleting them is safe.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STALE_DAYS = 30;

async function runCleanup(scopeOrgId?: string) {
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

  const stale = await db.knowledgeBaseItem.findMany({
    where: {
      ...(scopeOrgId ? { orgId: scopeOrgId } : {}),
      tags: { has: "pending_user_confirmation" },
      updatedAt: { lt: cutoff },
    },
    select: { id: true, orgId: true, agentId: true, title: true },
  });

  if (stale.length === 0) {
    return { deleted: 0, items: [] as typeof stale, scopeOrgId: scopeOrgId || null };
  }

  await db.knowledgeBaseItem.deleteMany({
    where: { id: { in: stale.map((s) => s.id) } },
  });

  // Best-effort audit log so the user can see what disappeared.
  try {
    const byOrg = new Map<string, number>();
    for (const it of stale) byOrg.set(it.orgId, (byOrg.get(it.orgId) || 0) + 1);
    for (const [orgId, count] of byOrg) {
      await db.auditLog.create({
        data: {
          orgId,
          action: "KB_PENDING_AUTO_DISCARD",
          target: "knowledge_base_item",
          rationale: `Auto-discarded ${count} stale pending KB item${count !== 1 ? "s" : ""} (${STALE_DAYS}+ days unconfirmed)`,
          details: { count, cutoff: cutoff.toISOString() } as any,
        },
      }).catch(() => {});
    }
  } catch {
    // Fail silently — audit log shouldn't break cleanup.
  }

  return { deleted: stale.length, items: stale, scopeOrgId: scopeOrgId || null };
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    const result = await runCleanup();
    return NextResponse.json({ data: result });
  }

  // Fall back to session auth — only the user's own org gets cleaned up.
  const { auth } = await import("@/lib/auth");
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const result = await runCleanup(orgId);
  return NextResponse.json({ data: result });
}

export async function POST(req: NextRequest) { return GET(req); }