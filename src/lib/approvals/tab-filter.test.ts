import { describe, it, expect } from "vitest";
import { matchesApprovalTab } from "./tab-filter";

// A real research-finding row as written by createResearchApproval in
// `lib/agents/research-approval.ts`. The shape here MUST stay in sync with
// what that function produces — drift = banner says "4 to review" while the
// page Research tab shows zero.
const researchFindingRow = {
  type: "CHANGE_REQUEST",
  urgency: "LOW",
  impact: {
    subtype: "research_finding",
    kbItemIds: ["kb_1", "kb_2"],
    factCount: 4,
    source: "perplexity",
  },
};

const phaseGateRow = { type: "PHASE_GATE", urgency: "MEDIUM", impact: null };
const budgetRow = { type: "BUDGET", urgency: "LOW", impact: null };
const scopeChangeRow = { type: "SCOPE_CHANGE", urgency: "HIGH", impact: null };
const ordinaryChangeRequest = { type: "CHANGE_REQUEST", urgency: "LOW", impact: { subtype: "config_drift" } };
const communicationRow = { type: "COMMUNICATION", urgency: "LOW", impact: null };

describe("matchesApprovalTab — research findings (regression for ghost banner)", () => {
  it("Research tab includes research_finding CHANGE_REQUEST rows", () => {
    expect(matchesApprovalTab(researchFindingRow, "Research")).toBe(true);
  });

  it("All tab includes research_finding rows so users don't lose them when the URL has no ?tab", () => {
    expect(matchesApprovalTab(researchFindingRow, "All")).toBe(true);
  });

  it("Change Requests tab does NOT show research_finding rows (they belong to Research)", () => {
    expect(matchesApprovalTab(researchFindingRow, "Change Requests")).toBe(false);
  });

  it("Research tab excludes ordinary (non-research) CHANGE_REQUEST rows", () => {
    expect(matchesApprovalTab(ordinaryChangeRequest, "Research")).toBe(false);
  });

  it("Change Requests tab shows ordinary CHANGE_REQUEST rows AND budget approvals", () => {
    expect(matchesApprovalTab(ordinaryChangeRequest, "Change Requests")).toBe(true);
    expect(matchesApprovalTab(budgetRow, "Change Requests")).toBe(true);
  });
});

describe("matchesApprovalTab — other tabs", () => {
  it("Phase Gates tab matches only PHASE_GATE", () => {
    expect(matchesApprovalTab(phaseGateRow, "Phase Gates")).toBe(true);
    expect(matchesApprovalTab(researchFindingRow, "Phase Gates")).toBe(false);
  });

  it("Scope & Risk groups SCOPE_CHANGE, RISK_RESPONSE, RESOURCE together", () => {
    expect(matchesApprovalTab(scopeChangeRow, "Scope & Risk")).toBe(true);
    expect(matchesApprovalTab({ type: "RISK_RESPONSE", impact: null }, "Scope & Risk")).toBe(true);
    expect(matchesApprovalTab({ type: "RESOURCE", impact: null }, "Scope & Risk")).toBe(true);
  });

  it("High Priority matches urgency HIGH or CRITICAL regardless of type", () => {
    expect(matchesApprovalTab({ ...scopeChangeRow, urgency: "HIGH" }, "High Priority")).toBe(true);
    expect(matchesApprovalTab({ ...phaseGateRow, urgency: "CRITICAL" }, "High Priority")).toBe(true);
    expect(matchesApprovalTab({ ...researchFindingRow, urgency: "LOW" }, "High Priority")).toBe(false);
  });

  it("Communications matches only COMMUNICATION type", () => {
    expect(matchesApprovalTab(communicationRow, "Communications")).toBe(true);
    expect(matchesApprovalTab(researchFindingRow, "Communications")).toBe(false);
  });

  it("All tab matches everything", () => {
    [researchFindingRow, phaseGateRow, budgetRow, scopeChangeRow, ordinaryChangeRequest, communicationRow]
      .forEach((row) => expect(matchesApprovalTab(row, "All")).toBe(true));
  });
});

describe("matchesApprovalTab — Griffin dashboard-vs-page count divergence", () => {
  // Real scenario from the live DB: 4 PENDING CHANGE_REQUEST rows,
  // every one with impact.subtype === "research_finding" and urgency === "LOW".
  // Dashboard counted 4 (correct). Page showed 0 because the user had been
  // on a non-"All" tab that excluded research findings.
  // Each branch below proves where rows go so the count↔tab divergence
  // can't happen again.
  const griffinPending = [
    researchFindingRow,
    researchFindingRow,
    researchFindingRow,
    researchFindingRow,
  ];

  it("All tab surfaces all 4 (matches the dashboard count)", () => {
    const visible = griffinPending.filter(r => matchesApprovalTab(r, "All"));
    expect(visible).toHaveLength(4);
  });

  it("Research tab also surfaces all 4 (canonical home for research findings)", () => {
    const visible = griffinPending.filter(r => matchesApprovalTab(r, "Research"));
    expect(visible).toHaveLength(4);
  });

  it("Change Requests / Phase Gates / Scope & Risk / Communications hide all 4", () => {
    for (const tab of ["Change Requests", "Phase Gates", "Scope & Risk", "Communications"] as const) {
      const visible = griffinPending.filter(r => matchesApprovalTab(r, tab));
      expect(visible, `tab="${tab}" should hide all 4 research findings`).toHaveLength(0);
    }
  });

  it("High Priority hides all 4 because urgency is LOW", () => {
    const visible = griffinPending.filter(r => matchesApprovalTab(r, "High Priority"));
    expect(visible).toHaveLength(0);
  });
});
