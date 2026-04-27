/**
 * Research Findings Approval — gates research output behind a human review
 * before it can influence artefact generation.
 *
 * Why:
 *   Perplexity / web research currently lands in KB tagged "research" with
 *   trustLevel STANDARD and is immediately readable by getProjectKnowledge-
 *   Context. That makes the research a silent input — the agent might
 *   surface a wrong claim from a stale or low-quality source and the user
 *   would only notice when an artefact reflects it.
 *
 * How:
 *   - createResearchApproval tags the named KB rows with
 *     "pending_user_confirmation" (so getProjectKnowledgeContext skips
 *     them) and creates a single CHANGE_REQUEST approval row carrying
 *     metadata.subtype = "research_finding" with the KB ids and a short
 *     summary. Reused enum value avoids a Prisma migration.
 *   - applyResearchApprovalDecision reads metadata.kbItemIds and either:
 *       APPROVED → strip pending tag, add user_confirmed, trustLevel=HIGH
 *       REJECTED → delete the KB rows entirely
 *
 * The approvals PATCH route calls applyResearchApprovalDecision after
 * recording the decision, so the rest of the queue plumbing (audit trail,
 * activity log, ML approval-likelihood) works unchanged.
 */

import { db } from "@/lib/db";

export interface ResearchFindingMetadata {
  subtype: "research_finding";
  kbItemIds: string[];
  factCount: number;
  source: string;          // e.g. "perplexity", "web_research"
  query?: string;          // human-readable query / topic label
  flaggedCount?: number;   // how many were flagged as "needs review"
}

export interface CreateResearchApprovalInput {
  agentId: string;
  projectId: string;
  /** Existing KB row ids to gate. They MUST already be persisted. */
  kbItemIds: string[];
  source: string;
  query?: string;
  /** Number of facts the agent flagged as low-confidence / conflicting. */
  flaggedCount?: number;
  /** Optional human-readable preview of the findings (first ~3 facts). */
  preview?: string;
}

/**
 * Tags every passed KB row with `pending_user_confirmation` (idempotent —
 * skips rows already so tagged) and creates a single approval row that
 * bundles them for human review.
 *
 * Returns the approval id, or null if there was nothing to gate.
 */
export async function createResearchApproval(
  input: CreateResearchApprovalInput,
): Promise<string | null> {
  if (input.kbItemIds.length === 0) return null;

  // 1. Tag the KB rows pending so getProjectKnowledgeContext filters them
  //    out of artefact prompts until the user approves the bundle.
  const rows = await db.knowledgeBaseItem.findMany({
    where: { id: { in: input.kbItemIds } },
    select: { id: true, tags: true, title: true },
  });
  for (const r of rows) {
    if ((r.tags || []).includes("pending_user_confirmation")) continue;
    await db.knowledgeBaseItem.update({
      where: { id: r.id },
      data: { tags: { set: [...(r.tags || []), "pending_user_confirmation"] } },
    }).catch(() => {});
  }

  // 2. Resolve project name for the approval title
  const project = await db.project.findUnique({
    where: { id: input.projectId },
    select: { name: true },
  });

  const queryLabel = input.query ? input.query : "research";
  const flaggedSuffix = (input.flaggedCount && input.flaggedCount > 0)
    ? ` (${input.flaggedCount} flagged for review)`
    : "";

  const meta: ResearchFindingMetadata = {
    subtype: "research_finding",
    kbItemIds: input.kbItemIds,
    factCount: input.kbItemIds.length,
    source: input.source,
    query: input.query,
    flaggedCount: input.flaggedCount,
  };

  const titles = rows.slice(0, 3).map(r => `• ${r.title}`).join("\n");
  const moreSuffix = rows.length > 3 ? `\n…and ${rows.length - 3} more` : "";
  const description = input.preview
    ? input.preview
    : `${input.kbItemIds.length} fact${input.kbItemIds.length === 1 ? "" : "s"} extracted from ${input.source}${input.query ? ` query "${input.query}"` : ""}.\n\n${titles}${moreSuffix}\n\nNothing here will influence artefact generation until you approve.`;

  // 3. Create the approval row
  const approval = await db.approval.create({
    data: {
      projectId: input.projectId,
      requestedById: input.agentId,
      type: "CHANGE_REQUEST", // reuse existing enum to avoid a migration
      title: `Research findings — ${queryLabel} — ${input.kbItemIds.length} fact${input.kbItemIds.length === 1 ? "" : "s"}${flaggedSuffix}`,
      description,
      status: "PENDING",
      urgency: "LOW",
      impactScores: { schedule: 1, cost: 1, scope: 2, stakeholder: 1 } as any,
      reasoningChain: `Research output gated for human review before it can influence artefact generation. ${project?.name ? `Project: ${project.name}.` : ""}`,
      affectedItems: rows.map(r => ({ type: "kb_item", id: r.id, title: r.title })) as any,
      impact: meta as any, // store the typed metadata in the impact JSON
    },
  });

  return approval.id;
}

/**
 * Apply the user's decision on a research-finding approval to the linked
 * KB rows. Called from the approvals PATCH handler after the approval
 * row's status has been updated. No-op when subtype is not research.
 */
export async function applyResearchApprovalDecision(
  approval: { impact: any; id: string },
  decision: "APPROVED" | "REJECTED",
): Promise<{ applied: number }> {
  const meta = approval.impact as Partial<ResearchFindingMetadata> | null;
  if (!meta || meta.subtype !== "research_finding") return { applied: 0 };
  const ids = Array.isArray(meta.kbItemIds) ? meta.kbItemIds.filter((v): v is string => typeof v === "string") : [];
  if (ids.length === 0) return { applied: 0 };

  if (decision === "REJECTED") {
    const out = await db.knowledgeBaseItem.deleteMany({ where: { id: { in: ids } } }).catch(() => ({ count: 0 }));
    return { applied: out.count };
  }

  // APPROVED — strip pending, add user_confirmed, bump trust
  const rows = await db.knowledgeBaseItem.findMany({
    where: { id: { in: ids } },
    select: { id: true, tags: true, projectId: true, agentId: true },
  });
  let applied = 0;
  for (const r of rows) {
    const tags = (r.tags || []).filter(t => t !== "pending_user_confirmation");
    if (!tags.includes("user_confirmed")) tags.push("user_confirmed");
    await db.knowledgeBaseItem.update({
      where: { id: r.id },
      data: { tags: { set: tags }, trustLevel: "HIGH" },
    }).catch(() => {});
    applied += 1;
  }

  // ── Strict-sequencing trigger ──
  // If the deployment is in awaiting_research_approval state and there
  // are now zero pending research-finding approvals, kick off the
  // clarification flow. lifecycle-init / phase-advance both deferred
  // clarification waiting for this moment.
  try {
    const projectId = rows[0]?.projectId;
    const agentId = rows[0]?.agentId;
    if (projectId && agentId) {
      const stillPending = await db.approval.count({
        where: {
          projectId,
          status: "PENDING",
          type: "CHANGE_REQUEST",
          impact: { path: ["subtype"], equals: "research_finding" },
        },
      });
      if (stillPending === 0) {
        const deployment = await db.agentDeployment.findFirst({
          where: { agentId, projectId, isActive: true },
          select: { id: true, currentPhase: true, phaseStatus: true },
        });
        if (deployment?.phaseStatus === "awaiting_research_approval" && deployment.currentPhase) {
          const orgId = (await db.agent.findUnique({ where: { id: agentId }, select: { orgId: true } }))?.orgId;
          const phaseRow = await db.phase.findFirst({
            where: { projectId, name: deployment.currentPhase },
            select: { artefacts: true },
          });
          const artefactNames = Array.isArray(phaseRow?.artefacts) ? (phaseRow.artefacts as string[]) : [];
          if (artefactNames.length > 0 && orgId) {
            // Flip to awaiting_clarification + start the session.
            await db.agentDeployment.update({
              where: { id: deployment.id },
              data: { phaseStatus: "awaiting_clarification" },
            }).catch(() => {});
            const { startClarificationSession } = await import("@/lib/agents/clarification-session");
            const { markClarificationSkipped } = await import("@/lib/agents/phase-next-action");
            try {
              const outcome = await startClarificationSession(agentId, projectId, orgId, artefactNames);
              if (outcome.outcome === "no_questions") {
                await markClarificationSkipped(projectId, deployment.currentPhase, "no_questions_needed");
                // Trigger generation directly — same path as
                // post-clarification, but skipping clarification.
                const { generatePhaseArtefacts } = await import("@/lib/agents/lifecycle-init");
                await generatePhaseArtefacts(agentId, projectId, deployment.currentPhase, undefined, "post_clarification");
              } else if (outcome.outcome === "failed") {
                await db.chatMessage.create({
                  data: {
                    agentId,
                    role: "agent",
                    content: `## Clarification setup hit a snag\n\nResearch is approved, but I couldn't generate clarification questions: \`${outcome.reason}\`. Reply **"Skip questions and generate"** or send me what you'd like me to know.`,
                    metadata: { type: "clarification_failed", reason: outcome.reason, phase: deployment.currentPhase } as any,
                  },
                }).catch(() => {});
              }
              // started/already_active → questions are already posted, nothing more to do.
            } catch (e: any) {
              console.error("[applyResearchApprovalDecision] clarification kick-off failed:", e);
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("[applyResearchApprovalDecision] post-approval sequencing failed:", e);
  }

  return { applied };
}
