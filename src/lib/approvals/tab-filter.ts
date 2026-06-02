/**
 * Pure tab-filter for the Approvals page.
 *
 * Extracted from the page so the contract is testable. The page used to
 * inline this conditional ladder, which made it impossible to verify that
 * (for example) research-finding approvals actually land under both the
 * "All" and "Research" tabs as expected.
 *
 * The categorisation is intentionally redundant with the resolver in
 * `lib/agents/phase-next-action.ts:130` — both call sites check
 * `impact.subtype === "research_finding"` so the chat banner count
 * and the page tab content come from the same source-of-truth shape.
 * If you change one, update the other AND the unit test.
 */

export type ApprovalTab =
  | "All"
  | "High Priority"
  | "Phase Gates"
  | "Research"
  | "Change Requests"
  | "Scope & Risk"
  | "Communications";

export interface ApprovalRowForTabFilter {
  type: string;
  urgency?: string | null;
  impact?: { subtype?: string } | null;
}

export function matchesApprovalTab(item: ApprovalRowForTabFilter, tab: ApprovalTab): boolean {
  if (tab === "All") return true;
  if (tab === "High Priority") return item.urgency === "HIGH" || item.urgency === "CRITICAL";
  if (tab === "Phase Gates") return item.type === "PHASE_GATE";
  if (tab === "Research") {
    return item.type === "CHANGE_REQUEST" && item.impact?.subtype === "research_finding";
  }
  if (tab === "Change Requests") {
    return (item.type === "CHANGE_REQUEST" && item.impact?.subtype !== "research_finding")
      || item.type === "BUDGET";
  }
  if (tab === "Scope & Risk") {
    return item.type === "SCOPE_CHANGE" || item.type === "RISK_RESPONSE" || item.type === "RESOURCE";
  }
  if (tab === "Communications") return item.type === "COMMUNICATION";
  return true;
}
