/**
 * KB Event Tracker — captures execution-level events into the Knowledge Base.
 *
 * The KB already captures planning knowledge (research, artefacts, user answers).
 * This module fills the gap for execution knowledge: what actually happened,
 * what decisions were made, what changed during the project.
 *
 * All writes are fire-and-forget (non-blocking) to avoid slowing down the
 * originating API route. Failures are logged but never thrown.
 *
 * Trust levels:
 *   HIGH_TRUST  — user-confirmed facts, decisions with human approval
 *   STANDARD    — system-detected events, status changes
 */

import { db } from "@/lib/db";

// ─── Helper ──────────────────────────────────────────────────────────────────

async function resolveAgentContext(projectId: string): Promise<{ agentId: string; orgId: string } | null> {
  try {
    const dep = await db.agentDeployment.findFirst({
      where: { projectId, isActive: true },
      include: { agent: { select: { id: true, orgId: true } } },
    });
    if (dep?.agent) return { agentId: dep.agent.id, orgId: dep.agent.orgId };
  } catch {}
  return null;
}

async function writeKB(
  agentId: string,
  projectId: string,
  orgId: string,
  title: string,
  content: string,
  tags: string[],
  trustLevel: "HIGH_TRUST" | "STANDARD" = "STANDARD",
): Promise<void> {
  try {
    await db.knowledgeBaseItem.create({
      data: {
        orgId, agentId, projectId,
        layer: "PROJECT",
        type: "TEXT",
        title,
        content: `[${new Date().toLocaleDateString("en-GB")}] ${content}`,
        trustLevel,
        tags: ["execution_event", ...tags],
        metadata: { source: "kb_event_tracker", recordedAt: new Date().toISOString() } as any,
      },
    });
  } catch (e) {
    console.error(`[kb-event-tracker] failed to write "${title}":`, e);
  }
}

// ─── Approval Decisions ──────────────────────────────────────────────────────

export async function trackApprovalDecision(
  projectId: string,
  approvalTitle: string,
  decision: "APPROVED" | "REJECTED",
  approverName: string,
  feedback?: string,
): Promise<void> {
  const ctx = await resolveAgentContext(projectId);
  if (!ctx) return;

  const content = feedback
    ? `${approvalTitle} — ${decision} by ${approverName}. Feedback: "${feedback}"`
    : `${approvalTitle} — ${decision} by ${approverName}`;

  await writeKB(ctx.agentId, projectId, ctx.orgId,
    `Approval: ${approvalTitle.slice(0, 60)}`,
    content,
    ["approval", decision.toLowerCase()],
    "HIGH_TRUST", // Human decision = high trust
  );
}

// ─── Task Status Changes ─────────────────────────────────────────────────────

export async function trackTaskStatusChange(
  projectId: string,
  taskTitle: string,
  oldStatus: string,
  newStatus: string,
  updatedBy?: string,
): Promise<void> {
  const ctx = await resolveAgentContext(projectId);
  if (!ctx) return;

  // Only track meaningful transitions, not minor edits
  const significant = ["DONE", "BLOCKED", "CANCELLED"].includes(newStatus) ||
    (oldStatus === "BLOCKED" && newStatus !== "BLOCKED");
  if (!significant) return;

  await writeKB(ctx.agentId, projectId, ctx.orgId,
    `Task ${newStatus}: ${taskTitle.slice(0, 60)}`,
    `"${taskTitle}" moved from ${oldStatus} to ${newStatus}${updatedBy ? ` by ${updatedBy}` : ""}`,
    ["task", "status_change", newStatus.toLowerCase()],
  );
}

// ─── Risk Status Changes ─────────────────────────────────────────────────────

export async function trackRiskChange(
  projectId: string,
  riskTitle: string,
  change: string, // e.g. "status changed to MITIGATED", "score increased to 15"
  details?: string,
): Promise<void> {
  const ctx = await resolveAgentContext(projectId);
  if (!ctx) return;

  await writeKB(ctx.agentId, projectId, ctx.orgId,
    `Risk update: ${riskTitle.slice(0, 60)}`,
    `${riskTitle}: ${change}${details ? `. ${details}` : ""}`,
    ["risk", "status_change"],
  );
}

// ─── Stakeholder Updates ─────────────────────────────────────────────────────

export async function trackStakeholderChange(
  projectId: string,
  stakeholderName: string,
  change: string, // e.g. "sentiment changed to resistant", "added as key stakeholder"
): Promise<void> {
  const ctx = await resolveAgentContext(projectId);
  if (!ctx) return;

  await writeKB(ctx.agentId, projectId, ctx.orgId,
    `Stakeholder: ${stakeholderName.slice(0, 60)}`,
    `${stakeholderName}: ${change}`,
    ["stakeholder", "update"],
  );
}

// ─── Cost Entries ────────────────────────────────────────────────────────────

export async function trackCostEntry(
  projectId: string,
  entryType: string, // ACTUAL, ESTIMATE, COMMITMENT
  amount: number,
  category: string,
  description?: string,
): Promise<void> {
  const ctx = await resolveAgentContext(projectId);
  if (!ctx) return;

  // Only track actuals and commitments (estimates are planning, not execution)
  if (entryType !== "ACTUAL" && entryType !== "COMMITMENT") return;

  await writeKB(ctx.agentId, projectId, ctx.orgId,
    `Cost ${entryType}: £${amount.toLocaleString()} (${category})`,
    `${entryType} cost recorded: £${amount.toLocaleString()} for ${category}${description ? ` — ${description}` : ""}`,
    ["cost", entryType.toLowerCase(), category.toLowerCase()],
  );
}

// ─── Benefit Realisation ─────────────────────────────────────────────────────

export async function trackBenefitUpdate(
  projectId: string,
  benefitName: string,
  oldStatus: string,
  newStatus: string,
  realisedValue?: number,
): Promise<void> {
  const ctx = await resolveAgentContext(projectId);
  if (!ctx) return;

  const content = realisedValue !== undefined
    ? `"${benefitName}" status: ${oldStatus} → ${newStatus}. Realised value: £${realisedValue.toLocaleString()}`
    : `"${benefitName}" status: ${oldStatus} → ${newStatus}`;

  await writeKB(ctx.agentId, projectId, ctx.orgId,
    `Benefit: ${benefitName.slice(0, 60)}`,
    content,
    ["benefit", "realisation", newStatus.toLowerCase()],
  );
}

// ─── Sprint Completions ──────────────────────────────────────────────────────

export async function trackSprintCompletion(
  projectId: string,
  sprintName: string,
  completedPoints: number,
  totalPoints: number,
  carryOver: number,
): Promise<void> {
  const ctx = await resolveAgentContext(projectId);
  if (!ctx) return;

  const velocity = totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;

  await writeKB(ctx.agentId, projectId, ctx.orgId,
    `Sprint complete: ${sprintName}`,
    `${sprintName} finished. ${completedPoints}/${totalPoints} points delivered (${velocity}% velocity). ${carryOver} item${carryOver !== 1 ? "s" : ""} carried over.`,
    ["sprint", "completion", "velocity"],
    "HIGH_TRUST",
  );
}

// ─── Phase Gate Decisions ────────────────────────────────────────────────────

export async function trackPhaseGateDecision(
  projectId: string,
  phaseName: string,
  nextPhase: string | null,
  decision: "APPROVED" | "REJECTED",
  approverName: string,
): Promise<void> {
  const ctx = await resolveAgentContext(projectId);
  if (!ctx) return;

  const content = decision === "APPROVED"
    ? `Phase gate "${phaseName}" approved by ${approverName}. Project advancing to ${nextPhase || "closure"}.`
    : `Phase gate "${phaseName}" rejected by ${approverName}. Project remains in ${phaseName}.`;

  await writeKB(ctx.agentId, projectId, ctx.orgId,
    `Phase gate: ${phaseName} ${decision}`,
    content,
    ["phase_gate", decision.toLowerCase()],
    "HIGH_TRUST",
  );
}

// ─── Issue Resolutions ───────────────────────────────────────────────────────

export async function trackIssueResolution(
  projectId: string,
  issueTitle: string,
  resolution: string,
  severity: string,
): Promise<void> {
  const ctx = await resolveAgentContext(projectId);
  if (!ctx) return;

  await writeKB(ctx.agentId, projectId, ctx.orgId,
    `Issue resolved: ${issueTitle.slice(0, 60)}`,
    `[${severity}] "${issueTitle}" resolved: ${resolution}`,
    ["issue", "resolution", severity.toLowerCase()],
  );
}
