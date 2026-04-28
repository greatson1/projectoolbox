import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/approvals/[id]/audit-chain
 *
 * Returns the four-step decision provenance for one approval, ready for
 * inline rendering on the approval card:
 *
 *   1. Source       — the original signal (email body / research query /
 *                     artefact reference / risk row) that triggered the
 *                     approval. Resolved from approval.impact metadata
 *                     and affectedItems.
 *   2. Rationale    — the agent's reasoningChain string (already on the
 *                     row; passed back here so the client can render the
 *                     whole chain in one component).
 *   3. Decision     — status / resolvedAt / resolvedByName /
 *                     resolvedVia (UI / per-fact / email reply / SDK) /
 *                     comment.
 *   4. Effects      — agentActivity rows with type "approval" or
 *                     "document" whose createdAt is within ±2 minutes of
 *                     resolvedAt and whose summary references this
 *                     approval. Cheap heuristic — covers the common case
 *                     where the resolution handler logs one activity row.
 *
 * The shape is intentionally flat strings so the component can render
 * without re-typing JSON shapes per approval.type.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const approval = await db.approval.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
      comment: true,
      reasoningChain: true,
      resolvedAt: true,
      createdAt: true,
      requestedById: true,
      projectId: true,
      impact: true,
      affectedItems: true,
    },
  });
  if (!approval) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const meta = (approval.impact as Record<string, unknown> | null) ?? {};
  const affected = Array.isArray(approval.affectedItems) ? (approval.affectedItems as any[]) : [];

  // ── 1. Source ────────────────────────────────────────────────────────
  let source: { kind: string; label: string; detail?: string; link?: string; timestamp?: string } | null = null;

  if (meta.subtype === "research_finding") {
    const factCount = typeof meta.factCount === "number" ? meta.factCount : (Array.isArray(meta.kbItemIds) ? meta.kbItemIds.length : 0);
    source = {
      kind: "Research output",
      label: `${meta.source || "research"} — query "${meta.query || "(unspecified)"}"`,
      detail: `${factCount} fact${factCount === 1 ? "" : "s"} extracted into the Knowledge Base, all gated until decided.`,
      link: approval.projectId ? `/research?project=${approval.projectId}` : undefined,
      timestamp: approval.createdAt.toISOString(),
    };
  } else if (approval.type === "PHASE_GATE") {
    const phaseName = (approval.title || "").split(" Gate")[0]?.trim();
    source = {
      kind: "Phase gate request",
      label: `${phaseName || "Phase"} gate`,
      detail: affected.length > 0 ? `Linked to ${affected.length} artefact${affected.length === 1 ? "" : "s"} that need approval before advancement.` : "Submitted by the agent after artefact generation completed.",
      link: approval.projectId ? `/projects/${approval.projectId}/pm-tracker` : undefined,
      timestamp: approval.createdAt.toISOString(),
    };
  } else if (approval.type === "RISK_RESPONSE") {
    const riskTitle = (meta.riskTitle as string) || affected[0]?.title;
    source = {
      kind: "Risk register",
      label: riskTitle ? `Risk "${riskTitle}"` : "Risk identified by the agent",
      detail: typeof meta.riskScore === "number" ? `Score ${meta.riskScore}/25 — agent escalated for a response decision.` : undefined,
      link: approval.projectId ? `/projects/${approval.projectId}/risk` : undefined,
      timestamp: approval.createdAt.toISOString(),
    };
  } else if (approval.type === "BUDGET") {
    source = {
      kind: "Budget proposal",
      label: typeof meta.proposalSummary === "string" ? meta.proposalSummary : "Cost change proposed by the agent",
      detail: typeof meta.creditCost === "number" ? `Credit cost: ${meta.creditCost}` : undefined,
      link: approval.projectId ? `/projects/${approval.projectId}/cost` : undefined,
      timestamp: approval.createdAt.toISOString(),
    };
  } else if (approval.type === "COMMUNICATION") {
    source = {
      kind: "Outbound communication",
      label: typeof meta.recipient === "string" ? `Email draft to ${meta.recipient}` : "Communication drafted by the agent",
      detail: typeof meta.subject === "string" ? `Subject: ${meta.subject}` : undefined,
      timestamp: approval.createdAt.toISOString(),
    };
  } else {
    source = {
      kind: "Agent proposal",
      label: approval.title,
      detail: affected.length > 0 ? `Linked to ${affected.length} item${affected.length === 1 ? "" : "s"}.` : undefined,
      timestamp: approval.createdAt.toISOString(),
    };
  }

  // ── 2. Rationale ────────────────────────────────────────────────────
  const rationale = approval.reasoningChain || null;

  // ── 3. Decision ─────────────────────────────────────────────────────
  const decision = approval.resolvedAt
    ? {
        status: approval.status as string,
        resolvedAt: approval.resolvedAt.toISOString(),
        resolvedByName: typeof meta.resolvedByName === "string" ? meta.resolvedByName : null,
        resolvedVia: typeof meta.resolvedVia === "string" ? meta.resolvedVia : null,
        comment: approval.comment || null,
      }
    : null;

  // ── 4. Effects ──────────────────────────────────────────────────────
  // Recent agent activity rows whose summary references this approval's
  // title or whose createdAt is within ±2 min of resolvedAt. We don't have
  // a foreign key from activity → approval (activity is a generic feed),
  // so this is heuristic.
  let effects: Array<{ summary: string; timestamp: string; type: string }> = [];
  if (approval.requestedById && approval.resolvedAt) {
    const windowStart = new Date(approval.resolvedAt.getTime() - 2 * 60_000);
    const windowEnd = new Date(approval.resolvedAt.getTime() + 5 * 60_000);
    const rows = await db.agentActivity.findMany({
      where: {
        agentId: approval.requestedById,
        createdAt: { gte: windowStart, lte: windowEnd },
        type: { in: ["approval", "document", "phase_advance", "meeting"] },
      },
      orderBy: { createdAt: "asc" },
      take: 8,
      select: { type: true, summary: true, createdAt: true },
    }).catch(() => []);
    effects = rows
      .filter(r => {
        const lc = (r.summary || "").toLowerCase();
        const tl = (approval.title || "").toLowerCase().slice(0, 30);
        // Keep activity rows that either name the approval, or are close
        // enough in time AND of an effect-shaped type.
        if (tl && lc.includes(tl)) return true;
        return r.type === "approval" || r.type === "phase_advance";
      })
      .map(r => ({ type: r.type, summary: r.summary, timestamp: r.createdAt.toISOString() }));
  }

  return NextResponse.json({
    data: {
      source,
      rationale,
      decision,
      effects,
    },
  });
}
