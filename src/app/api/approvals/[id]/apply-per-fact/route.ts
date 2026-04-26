import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/approvals/[id]/apply-per-fact
 *
 * Per-fact resolution for research-finding approvals. Body:
 *   { approveIds: string[], rejectIds: string[] }
 *
 * Splits a single research-finding approval bundle into two effects:
 *   approveIds → strip pending_user_confirmation, add user_confirmed,
 *                trustLevel = HIGH
 *   rejectIds  → deleteMany
 *
 * The approval row itself is then marked APPROVED with a comment
 * summarising the split (or REJECTED if every fact was rejected and
 * none approved). This is a superset of the all-or-nothing handler in
 * /api/approvals/[id]/route.ts — used by the inline checkbox UI when
 * the user wants to keep some findings and discard others.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const approveIds: string[] = Array.isArray(body?.approveIds) ? body.approveIds.filter((v: unknown) => typeof v === "string") : [];
  const rejectIds: string[] = Array.isArray(body?.rejectIds) ? body.rejectIds.filter((v: unknown) => typeof v === "string") : [];

  const approval = await db.approval.findUnique({ where: { id } });
  if (!approval) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const meta = approval.impact as Record<string, unknown> | null;
  if (!meta || meta.subtype !== "research_finding") {
    return NextResponse.json({ error: "Not a research-finding approval" }, { status: 400 });
  }

  const allIds: string[] = Array.isArray(meta.kbItemIds)
    ? (meta.kbItemIds as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  // Refuse to act on ids that weren't part of the original bundle — defends
  // against a stale UI state submitting ids from a different approval.
  const inBundle = (id: string) => allIds.includes(id);
  const safeApprove = approveIds.filter(inBundle);
  const safeReject = rejectIds.filter(inBundle);

  let approvedCount = 0;
  let rejectedCount = 0;

  // Apply approves
  if (safeApprove.length > 0) {
    const rows = await db.knowledgeBaseItem.findMany({
      where: { id: { in: safeApprove } },
      select: { id: true, tags: true },
    });
    for (const r of rows) {
      const tags = (r.tags || []).filter(t => t !== "pending_user_confirmation");
      if (!tags.includes("user_confirmed")) tags.push("user_confirmed");
      await db.knowledgeBaseItem.update({
        where: { id: r.id },
        data: { tags: { set: tags }, trustLevel: "HIGH" },
      }).catch(() => {});
      approvedCount += 1;
    }
  }

  // Apply rejects
  if (safeReject.length > 0) {
    const out = await db.knowledgeBaseItem.deleteMany({ where: { id: { in: safeReject } } }).catch(() => ({ count: 0 }));
    rejectedCount = out.count;
  }

  const totalDecided = approvedCount + rejectedCount;
  if (totalDecided === 0) {
    return NextResponse.json({ error: "No facts to act on" }, { status: 400 });
  }

  // Decide the parent approval's final status:
  //   any approved → APPROVED with mixed-result note
  //   all rejected → REJECTED
  const finalStatus = approvedCount > 0 ? "APPROVED" : "REJECTED";
  const resolverName = session.user?.name || session.user?.email || "Unknown";
  const resolverId = (session.user as any)?.id || null;
  const summary = `${approvedCount} approved, ${rejectedCount} rejected — resolved per-fact by ${resolverName}.`;

  await db.approval.update({
    where: { id },
    data: {
      status: finalStatus as any,
      comment: summary,
      resolvedAt: new Date(),
      assignedToId: resolverId || undefined,
      impact: {
        ...(meta as object),
        resolvedByName: resolverName,
        resolvedById: resolverId,
        resolvedVia: "per_fact_ui",
        perFactSplit: { approved: safeApprove, rejected: safeReject },
      } as any,
    },
  });

  // Audit trail in the activity feed
  if (approval.requestedById) {
    await db.agentActivity.create({
      data: {
        agentId: approval.requestedById,
        type: "approval",
        summary: `Research findings — ${summary}`,
      },
    }).catch(() => {});
  }

  return NextResponse.json({ data: { approvedCount, rejectedCount, status: finalStatus } });
}
