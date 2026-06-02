/**
 * Single source of truth for "approvals the user can act on right now".
 *
 * Both the dashboard count endpoint and the SSE poller used to call
 *   db.approval.count({ where: { project: { orgId }, status: "PENDING" } })
 * — which counted EVERYTHING pending, including premature PHASE_GATE rows
 * that the Approvals page filters out client-side. Result: the sidebar
 * badge showed "4 pending" while the page showed "All clear".
 *
 * This helper mirrors the client-side regex filter from
 * /src/app/(dashboard)/approvals/page.tsx so badge == page.
 *
 * Performance: at most ~50 pending rows per org in practice; one SELECT
 * with a tiny projection, then a JS filter. Far cheaper than two queries.
 */

import { db } from "@/lib/db";

const PREMATURE_GATE_REGEXES = [
  /generated\s+0\s+artefact/i,
  /0\s+artefact\(s\)/i,
];

function isPremaureGate(row: { type: string; description: string | null; reasoningChain: string | null }): boolean {
  if (row.type !== "PHASE_GATE") return false;
  const text = `${row.description ?? ""} ${row.reasoningChain ?? ""}`;
  return PREMATURE_GATE_REGEXES.some((re) => re.test(text));
}

/**
 * Count PENDING approvals for an org, excluding premature PHASE_GATE rows
 * that the page filters out. Used by the dashboard endpoint and the SSE
 * poller so the sidebar badge agrees with what the user sees on /approvals.
 */
export async function countVisiblePendingApprovals(orgId: string): Promise<number> {
  const rows = await db.approval.findMany({
    where: { project: { orgId }, status: "PENDING" },
    select: { id: true, type: true, description: true, reasoningChain: true },
  });
  return rows.filter((r) => !isPremaureGate(r as never)).length;
}
