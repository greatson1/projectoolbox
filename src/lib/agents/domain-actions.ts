/**
 * Domain-Specific Action Handlers
 *
 * Per spec Sections 5.8-5.14: Change Request lifecycle, Issue Management,
 * Team/Resource Management, Vendor Management, Benefits Realisation.
 *
 * These extend the action executor with PM domain-specific logic.
 */

import { db } from "@/lib/db";
import type { ActionProposal } from "./decision-classifier";

// ─── Change Request Management (Section 5.8) ───

/**
 * Check for change request conditions and generate proposals.
 */
export async function checkChangeRequests(projectId: string): Promise<ActionProposal[]> {
  const proposals: ActionProposal[] = [];

  const crs = await db.changeRequest.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });

  // Stale CRs (submitted >5 days ago without resolution)
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const staleCrs = crs.filter(cr =>
    (cr.status === "SUBMITTED" || cr.status === "UNDER_REVIEW") && cr.createdAt < fiveDaysAgo
  );

  if (staleCrs.length > 0) {
    proposals.push({
      type: "ESCALATION",
      description: `${staleCrs.length} Change Request${staleCrs.length > 1 ? "s" : ""} pending >5 days: ${staleCrs.map(cr => `"${cr.title}"`).slice(0, 3).join(", ")}`,
      reasoning: `Unresolved change requests create scope uncertainty and can delay project delivery. These CRs have been pending for over 5 working days and need a decision from the Change Authority.`,
      confidence: 0.85,
      scheduleImpact: 2, costImpact: 1, scopeImpact: 3, stakeholderImpact: 2,
    });
  }

  return proposals;
}

// ─── Issue Management (Section 5.9) ───

/**
 * Check for issue management conditions.
 */
export async function checkIssues(projectId: string): Promise<ActionProposal[]> {
  const proposals: ActionProposal[] = [];

  const issues = await db.issue.findMany({
    where: { projectId, status: { in: ["OPEN", "IN_PROGRESS"] } },
  });

  // Critical unassigned issues
  const criticalUnassigned = issues.filter(i => i.priority === "CRITICAL" && !i.assigneeId);
  if (criticalUnassigned.length > 0) {
    proposals.push({
      type: "TASK_ASSIGNMENT",
      description: `${criticalUnassigned.length} CRITICAL issue${criticalUnassigned.length > 1 ? "s" : ""} unassigned: ${criticalUnassigned.map(i => `"${i.title}"`).slice(0, 2).join(", ")}`,
      reasoning: `Critical issues without an assigned owner cannot be resolved. These need immediate assignment. Target resolution: 24 hours for CRITICAL priority.`,
      confidence: 0.9,
      scheduleImpact: 3, costImpact: 1, scopeImpact: 1, stakeholderImpact: 2,
      affectedItems: criticalUnassigned.map(i => ({ type: "issue", id: i.id, title: i.title })),
    });
  }

  // Overdue issues (past their due date)
  const overdueIssues = issues.filter(i => i.dueDate && new Date(i.dueDate) < new Date());
  if (overdueIssues.length > 0) {
    proposals.push({
      type: "ESCALATION",
      description: `${overdueIssues.length} overdue issue${overdueIssues.length > 1 ? "s" : ""} require escalation`,
      reasoning: `Issues past their target resolution date: ${overdueIssues.map(i => `"${i.title}" (${i.priority})`).slice(0, 3).join(", ")}. Recommend reassigning to a higher-authority owner or re-prioritising.`,
      confidence: 0.85,
      scheduleImpact: 2, costImpact: 1, scopeImpact: 1, stakeholderImpact: overdueIssues.some(i => i.priority === "CRITICAL") ? 3 : 2,
    });
  }

  return proposals;
}

// ─── Team & Resource Management (Section 5.12) ───

/**
 * Check team health and generate proposals.
 */
export async function checkTeamHealth(projectId: string): Promise<ActionProposal[]> {
  const proposals: ActionProposal[] = [];

  const tasks = await db.task.findMany({
    where: { projectId, status: { in: ["TODO", "IN_PROGRESS"] } },
    select: { assigneeId: true, storyPoints: true, status: true },
  });

  // Check for overloaded team members (>8 active SP)
  const workloadByMember: Record<string, number> = {};
  for (const t of tasks) {
    if (t.assigneeId) {
      workloadByMember[t.assigneeId] = (workloadByMember[t.assigneeId] || 0) + (t.storyPoints || 1);
    }
  }

  const overloaded = Object.entries(workloadByMember).filter(([, sp]) => sp > 10);
  if (overloaded.length > 0) {
    proposals.push({
      type: "RESOURCE_ALLOCATION",
      description: `${overloaded.length} team member${overloaded.length > 1 ? "s" : ""} overloaded (>10 SP active). Recommend resource levelling.`,
      reasoning: `Team members with excessive workload: ${overloaded.map(([id, sp]) => `${sp} SP assigned`).join(", ")}. This risks burnout and delivery delays. Propose redistributing tasks to members with available capacity.`,
      confidence: 0.8,
      scheduleImpact: 2, costImpact: 1, scopeImpact: 1, stakeholderImpact: 1,
    });
  }

  // Unassigned tasks
  const unassigned = tasks.filter(t => !t.assigneeId && t.status !== "DONE");
  if (unassigned.length > 3) {
    proposals.push({
      type: "TASK_ASSIGNMENT",
      description: `${unassigned.length} tasks are unassigned. Recommend auto-assigning based on team capacity and skills.`,
      reasoning: `${unassigned.length} tasks have no owner, which means no one is accountable for their delivery. These should be assigned to team members with available capacity.`,
      confidence: 0.8,
      scheduleImpact: 2, costImpact: 1, scopeImpact: 1, stakeholderImpact: 1,
    });
  }

  return proposals;
}

// ─── Vendor Management (Section 5.13) ───

/**
 * Check vendor-related conditions (stakeholders with vendor role).
 */
export async function checkVendors(projectId: string): Promise<ActionProposal[]> {
  const proposals: ActionProposal[] = [];

  // Check if any vendor-type stakeholders have issues
  const vendors = await db.stakeholder.findMany({
    where: { projectId, role: { contains: "vendor", mode: "insensitive" as any } },
  });

  if (vendors.length === 0) return proposals;

  // Check for vendor-related risks
  const vendorRisks = await db.risk.findMany({
    where: {
      projectId,
      status: "OPEN",
      OR: [
        { category: { contains: "vendor", mode: "insensitive" as any } },
        { title: { contains: "vendor", mode: "insensitive" as any } },
        { title: { contains: "supplier", mode: "insensitive" as any } },
      ],
    },
  });

  const highVendorRisks = vendorRisks.filter(r => (r.score || 0) >= 9);
  if (highVendorRisks.length > 0) {
    proposals.push({
      type: "RISK_RESPONSE",
      description: `${highVendorRisks.length} high vendor risk${highVendorRisks.length > 1 ? "s" : ""}: ${highVendorRisks.map(r => `"${r.title}" (score ${r.score})`).slice(0, 2).join(", ")}`,
      reasoning: `Vendor-related risks with high scores require proactive mitigation. Consider: vendor performance review, SLA enforcement, or contingency planning for vendor failure.`,
      confidence: 0.8,
      scheduleImpact: 2, costImpact: 2, scopeImpact: 1, stakeholderImpact: 2,
    });
  }

  return proposals;
}

// ─── Capability Matrix Enforcement (Section 2.6) ───

/**
 * Per-level capability check.
 * Returns whether the agent can perform a specific capability at its autonomy level.
 */
type CapabilityAction = "Auto" | "HITL" | "Draft" | "—";

const CAPABILITY_MATRIX: Record<string, [CapabilityAction, CapabilityAction, CapabilityAction]> = {
  // [L1 Advisor, L2 Co-pilot, L3 Autonomous]
  "project_charter": ["Draft", "HITL", "Auto"],
  "communications_plan": ["Draft", "HITL", "Auto"],
  "risk_register_initial": ["Draft", "HITL", "Auto"],
  "task_status_update": ["HITL", "Auto", "Auto"],
  "task_reassign_same_role": ["HITL", "Auto", "Auto"],
  "task_reschedule_noncritical": ["HITL", "HITL", "Auto"],
  "task_reschedule_critical": ["HITL", "HITL", "Auto"],
  "sprint_planning": ["HITL", "Auto", "Auto"],
  "sprint_retrospective": ["HITL", "Auto", "Auto"],
  "log_new_risk": ["Draft", "Auto", "Auto"],
  "update_risk_score": ["HITL", "Auto", "Auto"],
  "risk_mitigation_under_5k": ["HITL", "HITL", "Auto"],
  "risk_mitigation_over_5k": ["HITL", "HITL", "Auto"],
  "raise_change_request": ["HITL", "Auto", "Auto"],
  "approve_change_request": ["HITL", "HITL", "HITL"],
  "budget_realloc_under_10pct": ["HITL", "HITL", "Auto"],
  "budget_realloc_over_10pct": ["HITL", "HITL", "Auto"],
  "status_report_generate": ["Draft", "Auto", "Auto"],
  "status_report_distribute": ["HITL", "HITL", "Auto"],
  "executive_communication": ["Draft", "HITL", "Auto"],
  "meeting_scheduling": ["HITL", "HITL", "Auto"],
  "phase_gate": ["HITL", "HITL", "HITL"],
  "exception_report": ["HITL", "HITL", "HITL"],
  "pestle_scan": ["Draft", "Auto", "Auto"],
  "evm_calculation": ["Auto", "Auto", "Auto"],
  "corrective_action_plan": ["Draft", "HITL", "Auto"],
  "cross_project_optimization": ["—", "—", "Auto"],
  "portfolio_health_mapping": ["—", "—", "Auto"],
  // Stakeholder management
  "stakeholder_identification": ["Auto", "Auto", "Auto"],
  "stakeholder_gap_detection": ["HITL", "Auto", "Auto"],
  "influence_interest_mapping": ["Auto", "Auto", "Auto"],
  "first_contact_stakeholder": ["HITL", "HITL", "Auto"],
  "stakeholder_landscape_monitoring": ["HITL", "Auto", "Auto"],
  // Supplier/Procurement research
  "supplier_market_research": ["Auto", "Auto", "Auto"],
  "supplier_evaluation_matrix": ["Auto", "Auto", "Auto"],
  "rfp_rfq_dispatch": ["HITL", "HITL", "Auto"],
  "supplier_proposal_analysis": ["HITL", "Auto", "Auto"],
  "supplier_selection_recommendation": ["HITL", "HITL", "HITL"],
  // Market rates & cost estimation
  "live_market_rate_research": ["Auto", "Auto", "Auto"],
  "range_based_cost_estimates": ["Auto", "Auto", "Auto"],
  "supplier_quote_benchmarking": ["Auto", "Auto", "Auto"],
  "market_price_monitoring": ["HITL", "Auto", "Auto"],
  // Contracts & documents
  "contract_sow_nda_creation": ["Draft", "HITL", "Auto"],
  "esignature_workflow": ["HITL", "HITL", "HITL"],
  "internal_document_signing": ["HITL", "HITL", "Auto"],
  "signature_tracking_chasing": ["HITL", "Auto", "Auto"],
  "document_version_control": ["HITL", "Auto", "Auto"],
  // Purchase Orders & invoicing
  "raise_purchase_order": ["HITL", "HITL", "HITL"],
  "send_po_to_supplier": ["HITL", "HITL", "Auto"],
  "po_acknowledgement_matching": ["HITL", "Auto", "Auto"],
  "invoice_three_way_matching": ["HITL", "Auto", "Auto"],
  // Vendor communications
  "routine_vendor_updates": ["HITL", "HITL", "Auto"],
  "commercial_commitment_comms": ["HITL", "HITL", "HITL"],
  "formal_notices_breach": ["HITL", "HITL", "HITL"],
  "inbound_vendor_email_reply": ["HITL", "HITL", "Auto"],
  // Resource/contractor management
  "external_resource_research": ["Auto", "Auto", "Auto"],
  "role_brief_job_spec": ["HITL", "HITL", "HITL"],
  "cv_screening_interview_scheduling": ["HITL", "Auto", "Auto"],
  "contractor_onboarding": ["HITL", "Auto", "Auto"],
  "contractor_timesheet_tracking": ["HITL", "Auto", "Auto"],
};

/**
 * Check if an agent can perform a capability at its current level.
 */
export function getCapabilityAction(capability: string, autonomyLevel: number): CapabilityAction {
  const matrix = CAPABILITY_MATRIX[capability];
  if (!matrix) return "HITL"; // Default to HITL for unknown capabilities
  const idx = Math.max(0, Math.min(2, autonomyLevel - 1));
  return matrix[idx];
}

/**
 * Map an ActionProposal type to the relevant capability key.
 */
export function proposalToCapability(proposal: ActionProposal): string {
  switch (proposal.type) {
    case "TASK_ASSIGNMENT": {
      if (proposal.description?.toLowerCase().includes("critical path")) return "task_reschedule_critical";
      if (proposal.description?.toLowerCase().includes("reschedule")) return "task_reschedule_noncritical";
      return "task_status_update";
    }
    case "RISK_RESPONSE": {
      if (proposal.costImpact >= 3) return "risk_mitigation_over_5k";
      if (proposal.costImpact >= 2) return "risk_mitigation_under_5k";
      return "update_risk_score";
    }
    case "BUDGET_CHANGE": return proposal.costImpact >= 3 ? "budget_realloc_over_10pct" : "budget_realloc_under_10pct";
    case "SCOPE_CHANGE": return "raise_change_request";
    case "COMMUNICATION": return proposal.stakeholderImpact >= 3 ? "executive_communication" : "status_report_distribute";
    case "DOCUMENT_GENERATION": return "status_report_generate";
    case "ESCALATION": return "exception_report";
    case "PHASE_GATE": return "phase_gate";
    default: return "task_status_update";
  }
}
