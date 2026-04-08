/**
 * Artefact type classification — single source of truth.
 *
 * Determines how an artefact is generated (prose vs structured CSV),
 * rendered (DocumentEditor vs SpreadsheetViewer), and exported (DOCX vs XLSX).
 */

/** Artefacts that are inherently tabular and must be generated as CSV / rendered as spreadsheets */
export const SPREADSHEET_ARTEFACTS = new Set([
  "Work Breakdown Structure",
  "Schedule with Dependencies",
  "Cost Management Plan",
  "Resource Management Plan",
  "Budget Breakdown",
  "RACI Matrix",
  "Initial Risk Register",
  "Initial Stakeholder Register",
  "Stakeholder Register",
  "Risk Management Plan",
  "Resource Plan",
  "Schedule Baseline",
  "Sprint Plans",
  "Iteration Plans",
  "Flow Metrics Reports",
]);

/** Column definitions per artefact type — used in the generation prompt and xlsx formatting */
export const ARTEFACT_COLUMNS: Record<string, string[]> = {
  "Work Breakdown Structure": ["WBS ID", "Deliverable", "Work Package", "Description", "Owner", "Est. Duration (days)", "Planned Start", "Planned End", "Dependencies", "% Complete", "Status"],
  "Schedule with Dependencies": ["Task ID", "Activity", "Category", "Owner", "Planned Start", "Planned End", "Duration (days)", "Predecessors", "Actual Start", "Actual End", "% Complete", "Status", "RAG", "Float (days)", "Critical Path", "Notes"],
  "Cost Management Plan": ["Work Package", "Category", "Resource/Item", "Unit", "Qty", "Unit Cost (£)", "Planned Total (£)", "Actual Cost (£)", "Variance (£)", "% Spent", "Phase", "Status", "Notes"],
  "Resource Management Plan": ["Role", "Name/TBD", "Work Package", "Allocation (%)", "Start Date", "End Date", "Cost Rate (£/day)", "Planned Cost (£)", "Actual Cost (£)", "RACI", "Status"],
  "Budget Breakdown": ["Category", "Sub-Category / Item", "Planned Cost (£)", "Actual Cost (£)", "Variance (£)", "% Spent", "% of Total Budget", "Status", "Notes"],
  "RACI Matrix": ["Activity / Deliverable", "Project Manager", "Sponsor", "Team Lead", "Stakeholder", "Finance", "External", "Notes"],
  "Initial Risk Register": ["Risk ID", "Category", "Title", "Description", "Likelihood (1-5)", "Impact (1-5)", "Score", "Risk Rating", "Owner", "Mitigation Actions", "Contingency Plan", "Residual Score", "Status", "Last Reviewed"],
  "Initial Stakeholder Register": ["ID", "Name / Role", "Organisation", "Stake / Interest", "Power (H/M/L)", "Interest (H/M/L)", "Current Engagement", "Target Engagement", "Communication Method", "Frequency", "Owner", "Notes"],
  "Stakeholder Register": ["ID", "Name / Role", "Organisation", "Stake / Interest", "Power (H/M/L)", "Interest (H/M/L)", "Current Engagement", "Target Engagement", "Communication Method", "Frequency", "Owner", "Key Concerns"],
  "Risk Management Plan": ["Risk ID", "Category", "Title", "Likelihood (1-5)", "Impact (1-5)", "Risk Score", "Risk Rating", "Response Strategy", "Owner", "Mitigation Deadline", "Contingency", "Residual Score", "Status", "Last Reviewed"],
  "Resource Plan": ["Role", "Name", "Phase", "Task", "Hours/Days", "Start", "End", "Cost (£)", "% Allocated", "Status", "Notes"],
  "Schedule Baseline": ["Task ID", "Activity", "Category", "Owner", "Baseline Start", "Baseline End", "Duration (days)", "Dependencies", "Actual Start", "Actual End", "% Complete", "Status", "RAG", "Milestone?"],
  "Sprint Plans": ["Sprint", "Story ID", "User Story", "Points", "Owner", "Status", "Start", "End", "Actual Completion", "Notes"],
  "Iteration Plans": ["Iteration", "Item ID", "Work Item", "Owner", "Planned Points", "Completed Points", "Status", "Start", "End", "Notes"],
  "Flow Metrics Reports": ["Week", "Items Started", "Items Completed", "WIP Count", "Avg Cycle Time (days)", "Throughput", "Lead Time (days)", "Blockers", "RAG"],
};

/** Returns true if this artefact should be generated as CSV and shown in SpreadsheetViewer */
export function isSpreadsheetArtefact(name: string): boolean {
  return SPREADSHEET_ARTEFACTS.has(name);
}

/** Returns the expected CSV header columns for a given artefact, or empty array */
export function getArtefactColumns(name: string): string[] {
  return ARTEFACT_COLUMNS[name] || [];
}
