/**
 * Phase Completion Utility
 *
 * Single source of truth for whether a phase is ready to advance.
 * Checks three layers:
 *   1. Artefacts — all approved
 *   2. PM Tasks — scaffolded governance tasks complete
 *   3. Delivery Tasks — WBS/schedule work items substantially complete
 *
 * Used by: approval handler, pipeline API, agent system prompt, phase-advance endpoint.
 */

import { db } from "@/lib/db";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LayerStatus {
  total: number;
  done: number;
  pct: number;
  items?: Array<{ id: string; title: string; status: string; progress?: number }>;
}

export interface PhaseCompletionStatus {
  phaseName: string;
  phaseId: string;
  phaseStatus: string;
  artefacts: LayerStatus;
  pmTasks: LayerStatus;
  deliveryTasks: LayerStatus;
  overall: number;
  canAdvance: boolean;
  blockers: string[];
}

export interface PhaseCompletionConfig {
  deliveryThreshold: number;  // 0-1, default 0.8 (80%)
  pmTaskThreshold: number;    // 0-1, default 1.0 (100%)
  artefactThreshold: number;  // 0-1, default 1.0 (all approved)
}

const DEFAULT_CONFIG: PhaseCompletionConfig = {
  deliveryThreshold: 0.8,
  pmTaskThreshold: 1.0,
  artefactThreshold: 1.0,
};

// ─── Core Function ──────────────────────────────────────────────────────────

export async function getPhaseCompletion(
  projectId: string,
  phaseName: string,
  agentId: string,
  config?: Partial<PhaseCompletionConfig>,
): Promise<PhaseCompletionStatus> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Look up Phase row to get the CUID (phaseId is stored inconsistently)
  const phaseRow = await db.phase.findFirst({
    where: { projectId, name: phaseName },
    select: { id: true, name: true, status: true },
  });

  const phaseId = phaseRow?.id || "";
  const phaseStatus = phaseRow?.status || "PENDING";

  // Build OR condition for phaseId (some tasks store name, some store CUID)
  const phaseIdMatch = phaseRow
    ? [{ phaseId: phaseName }, { phaseId: phaseRow.id }]
    : [{ phaseId: phaseName }];

  // ── Retroactive event-task self-heal ─────────────────────────────────
  // Scaffolded tasks declare linkedEvents (clarification_complete,
  // gate_request, phase_advanced). The handlers that fire those events
  // were wired AFTER projects were already running, so on existing
  // deployments those tasks sit at 10% forever. Before counting, scan
  // them and mark done if the underlying event has effectively happened.
  // This is idempotent — runs on every getPhaseCompletion call (every
  // metrics poll), self-heals legacy state within seconds.
  try {
    const eventTasks = await db.task.findMany({
      where: {
        projectId,
        OR: phaseIdMatch,
        description: { contains: "[event:" },
        status: { not: "DONE" },
        parentId: { not: null },
      },
      select: { id: true, description: true, phaseId: true },
    });
    if (eventTasks.length > 0) {
      // Pull the signals we need to decide each event's truth, in parallel.
      const [deployment, gateApprovals, kbConfirmed, kbActiveSession] = await Promise.all([
        db.agentDeployment.findFirst({
          where: { projectId, isActive: true },
          select: { currentPhase: true },
        }),
        db.approval.findMany({
          where: { projectId, type: "PHASE_GATE" },
          select: { id: true, title: true, status: true, createdAt: true },
        }),
        db.knowledgeBaseItem.count({
          where: { projectId, agentId, tags: { hasSome: ["user_confirmed", "user_answer"] } },
        }),
        db.knowledgeBaseItem.findFirst({
          where: { projectId, agentId, title: "__clarification_session__", tags: { has: "active" } },
          select: { id: true },
        }),
      ]);

      // Phase-order map: any phase strictly EARLIER than the current
      // deployment phase is considered "advanced past".
      const phaseOrders = await db.phase.findMany({
        where: { projectId },
        select: { name: true, order: true },
      });
      const orderByName = new Map(phaseOrders.map(p => [p.name, p.order]));
      const currentOrder = deployment?.currentPhase ? orderByName.get(deployment.currentPhase) ?? -1 : -1;
      const myOrder = phaseRow ? orderByName.get(phaseRow.name) ?? -1 : -1;
      const isPastPhase = currentOrder >= 0 && myOrder >= 0 && myOrder < currentOrder;

      const phaseLC = phaseName.toLowerCase();
      const gateForThisPhase = gateApprovals.find(g =>
        (g.title || "").toLowerCase().startsWith(`${phaseLC} gate`)
        || (g.title || "").toLowerCase().startsWith(`${phaseLC}:`)
        || (g.title || "").toLowerCase().includes(`gate: ${phaseLC}`),
      );

      const toMarkDone: string[] = [];
      for (const t of eventTasks) {
        const desc = t.description || "";
        if (desc.includes("[event:clarification_complete]")) {
          // Event has effectively happened if no active session AND user
          // has confirmed at least one fact (proves they answered).
          if (!kbActiveSession && kbConfirmed > 0) toMarkDone.push(t.id);
        } else if (desc.includes("[event:gate_request]")) {
          // Event has happened if a phase gate exists for this phase.
          if (gateForThisPhase) toMarkDone.push(t.id);
        } else if (desc.includes("[event:phase_advanced]")) {
          // Event has happened if the deployment has moved past this phase.
          if (isPastPhase) toMarkDone.push(t.id);
        }
      }

      if (toMarkDone.length > 0) {
        await db.task.updateMany({
          where: { id: { in: toMarkDone } },
          data: { progress: 100, status: "DONE" },
        });
      }
    }
  } catch (e) {
    console.error("[phase-completion] retroactive event-task self-heal failed:", e);
  }

  // ── 1. Artefacts ──────────────────────────────────────────────────────

  const [artefacts, projectForMethodology] = await Promise.all([
    db.agentArtefact.findMany({
      where: {
        projectId,
        agentId,
        OR: phaseIdMatch.map((p) => ({ phaseId: p.phaseId })),
      },
      select: { id: true, name: true, status: true },
    }),
    db.project.findUnique({
      where: { id: projectId },
      select: { methodology: true },
    }),
  ]);

  // Resolve the methodology's required artefact list for THIS phase. A
  // phase isn't really "complete" if a required document was never even
  // generated — e.g. user has Project Charter approved but WBS / Cost
  // Management Plan / Schedule were never produced. Detect those gaps
  // and add them to the blocker list.
  let missingRequired: string[] = [];
  try {
    const { getMethodology } = await import("@/lib/methodology-definitions");
    const methodologyId = (projectForMethodology?.methodology || "traditional").toLowerCase().replace("agile_", "");
    const methodology = getMethodology(methodologyId);
    const phaseDef = methodology.phases.find(p => p.name === phaseName);
    if (phaseDef) {
      const generatedNames = new Set(artefacts.map(a => a.name.toLowerCase()));
      missingRequired = phaseDef.artefacts
        .filter(a => a.required && a.aiGeneratable)
        .map(a => a.name)
        .filter(n => !generatedNames.has(n.toLowerCase()));
    }
  } catch (e) {
    console.error("[phase-completion] required-artefact lookup failed:", e);
  }

  const artefactsDone = artefacts.filter((a) => a.status === "APPROVED").length;
  const artefactsTotal = artefacts.length;
  const artefactsPct = artefactsTotal > 0 ? Math.round((artefactsDone / artefactsTotal) * 100) : 100;

  // ── 2. PM Tasks (scaffolded overhead) ─────────────────────────────────

  const pmTasksRaw = await db.task.findMany({
    where: {
      projectId,
      OR: phaseIdMatch,
      description: { contains: "[scaffolded]" },
      // Exclude delivery-tagged scaffolded tasks
      NOT: { description: { contains: "[scaffolded:delivery]" } },
      // Only leaf tasks (not parent groupings)
      parentId: { not: null },
    },
    select: { id: true, title: true, status: true, progress: true, description: true },
  });

  // Recurring universal tasks (e.g. "Review and update Risk Register",
  // "Stakeholder communication and updates") are scaffolded into every phase
  // and have no terminal state by design — they're cyclic monitoring work.
  // Counting them as gate-blockers means a phase can never advance even when
  // every meaningful task is done. Filter them out of the gate count; they
  // remain visible on the PM Tracker as recurring activities.
  const RECURRING_UNIVERSAL_TITLES = new Set([
    "review and update risk register",
    "stakeholder communication and updates",
  ]);
  // Bookkeeping tasks whose linkedEvent is "phase_advanced" only tick DONE
  // AFTER the phase advances. Counting them as a gate-blocker creates a
  // deadlock — the phase can't advance because the task isn't done, and
  // the task can't be done because the phase hasn't advanced. Exempt them.
  const pmTasks = pmTasksRaw.filter((t) => {
    const title = (t.title || "").trim().toLowerCase();
    if (RECURRING_UNIVERSAL_TITLES.has(title)) return false;
    const desc = (t.description || "").toLowerCase();
    if (desc.includes("[event:phase_advanced]")) return false;
    return true;
  });

  const pmTasksDone = pmTasks.filter((t) => t.status === "DONE" || t.status === "COMPLETE" || (t.progress || 0) >= 100).length;
  const pmTasksTotal = pmTasks.length;
  const pmTasksPct = pmTasksTotal > 0 ? Math.round((pmTasksDone / pmTasksTotal) * 100) : 100;

  // ── 3. Delivery Tasks (WBS/schedule + scaffolded delivery) ────────────

  const deliveryTasks = await db.task.findMany({
    where: {
      projectId,
      OR: [
        // WBS/schedule-sourced tasks
        ...phaseIdMatch.map((p) => ({
          phaseId: p.phaseId,
          description: { contains: "[source:" },
        })),
        // Scaffolded delivery tasks
        ...phaseIdMatch.map((p) => ({
          phaseId: p.phaseId,
          description: { contains: "[scaffolded:delivery]" },
        })),
        // User-created tasks with phaseId (manual additions)
        ...phaseIdMatch.map((p) => ({
          phaseId: p.phaseId,
          NOT: { description: { contains: "[scaffolded]" } },
          createdBy: { not: { startsWith: "agent:" } },
        })),
      ],
    },
    select: { id: true, title: true, status: true, progress: true },
  });

  // Deduplicate (OR queries can overlap)
  const seen = new Set<string>();
  const uniqueDelivery = deliveryTasks.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    // Exclude parent tasks and pure scaffolded overhead
    return !t.title.includes(":") || t.title.split(":").length <= 2;
  });

  // Use actual progress field for delivery — not just binary done/not-done
  const deliveryDone = uniqueDelivery.filter((t) => t.status === "DONE" || t.status === "COMPLETE" || (t.progress || 0) >= 100).length;
  const deliveryTotal = uniqueDelivery.length;
  // Progress-based percentage: average of individual task progress values
  const deliveryPct = deliveryTotal > 0
    ? Math.round(uniqueDelivery.reduce((sum, t) => {
        if (t.status === "DONE" || t.status === "COMPLETE") return sum + 100;
        return sum + (t.progress || 0);
      }, 0) / deliveryTotal)
    : 100;

  // ── 4. KB-informed gate check — scan for unresolved risks/blockers ────

  let kbBlockers: string[] = [];
  try {
    const phaseLC = phaseName.toLowerCase();
    // Only consider KB items EXPLICITLY tagged with this phase — not text-matched
    const recentKBItems = await db.knowledgeBaseItem.findMany({
      where: {
        projectId,
        tags: { hasEvery: [phaseLC] }, // must be explicitly tagged with the phase
        // AND at least one risk-related tag
        AND: [
          { tags: { hasSome: ["risk", "blocker", "issue", "concern"] } },
        ],
        trustLevel: { in: ["HIGH_TRUST", "STANDARD"] },
        createdAt: { gte: new Date(Date.now() - 30 * 86400000) }, // last 30 days
      },
      select: { title: true, content: true, tags: true },
      take: 10,
      orderBy: { createdAt: "desc" },
    });

    const UNRESOLVED_KEYWORDS = [
      "unresolved", "outstanding", "blocker", "critical",
      "pending resolution", "tbd", "tbc", "open issue",
      "awaiting", "blocked by", "stuck",
    ];
    for (const item of recentKBItems) {
      const contentLC = (item.content || "").toLowerCase();
      if (UNRESOLVED_KEYWORDS.some((k) => contentLC.includes(k))) {
        kbBlockers.push(`KB flag: "${item.title}"`);
      }
    }
  } catch {}

  // ── Compute overall + blockers ────────────────────────────────────────

  const blockers: string[] = [];

  // Artefact check
  if (artefactsTotal > 0 && artefactsDone / artefactsTotal < cfg.artefactThreshold) {
    const remaining = artefactsTotal - artefactsDone;
    blockers.push(`${remaining} artefact${remaining !== 1 ? "s" : ""} not yet approved`);
  }

  // Required-artefact gap — methodology says these MUST exist for this
  // phase but they were never generated. Without them downstream layers
  // are starved (no WBS = no delivery tasks; no Cost Plan = no budget).
  if (missingRequired.length > 0) {
    blockers.push(
      `Missing required artefact${missingRequired.length === 1 ? "" : "s"}: ${missingRequired.join(", ")} — generate these before advancing`,
    );
  }

  // PM task check
  if (pmTasksTotal > 0 && pmTasksDone / pmTasksTotal < cfg.pmTaskThreshold) {
    const remaining = pmTasksTotal - pmTasksDone;
    blockers.push(`${remaining} PM task${remaining !== 1 ? "s" : ""} incomplete`);
  }

  // Delivery task check — uses progress-based percentage
  if (deliveryTotal > 0 && deliveryPct / 100 < cfg.deliveryThreshold) {
    blockers.push(`Delivery tasks at ${deliveryPct}% progress (${deliveryDone}/${deliveryTotal} complete) — need ${Math.round(cfg.deliveryThreshold * 100)}%`);
  }

  // KB-informed blockers
  blockers.push(...kbBlockers);

  // ── Methodology gate prerequisites ──────────────────────────────────────
  // Heuristic evaluator + manual confirmations. Without this, the phase
  // could advance even though a mandatory prereq from methodology-definitions
  // (e.g. "Sponsor identified", "Funding confirmed") had not been satisfied.
  // The PM Tracker UI was already showing these — now they actually block.
  try {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { methodology: true, orgId: true },
    });
    if (project?.orgId) {
      const { getMethodology } = await import("@/lib/methodology-definitions");
      const methodologyId = (project.methodology || "traditional").toLowerCase().replace("agile_", "");
      const methodology = getMethodology(methodologyId);
      const phaseDef = methodology.phases.find(p => p.name === phaseName);
      if (phaseDef && phaseDef.gate.preRequisites.length > 0) {
        const [allArtefacts, stakeholders, gateApprovals, riskCount, manualConfirmations] = await Promise.all([
          db.agentArtefact.findMany({ where: { projectId }, select: { name: true, status: true } }),
          db.stakeholder.findMany({ where: { projectId }, select: { role: true } }),
          db.approval.findMany({
            where: { projectId, type: "PHASE_GATE", status: "APPROVED" },
            select: { title: true },
          }),
          db.risk.count({ where: { projectId } }),
          db.knowledgeBaseItem.findMany({
            where: { projectId, orgId: project.orgId, tags: { has: "prereq_confirmation" } },
            select: { metadata: true },
          }),
        ]);
        const { evaluatePrerequisites, summarisePrerequisites, manualKey } =
          await import("@/lib/agents/phase-prerequisites");
        const manuallyConfirmed = new Set<string>();
        for (const row of manualConfirmations) {
          const meta = (row.metadata as Record<string, unknown>) || {};
          if (typeof meta.phase === "string" && typeof meta.prereq === "string") {
            manuallyConfirmed.add(manualKey(meta.phase, meta.prereq));
          }
        }
        const evaluated = evaluatePrerequisites(phaseDef.gate.preRequisites, {
          approvedArtefactNames: allArtefacts.filter(a => a.status === "APPROVED").map(a => a.name),
          rejectedArtefactNames: allArtefacts.filter(a => a.status === "REJECTED").map(a => a.name),
          draftArtefactNames: allArtefacts
            .filter(a => a.status === "DRAFT" || a.status === "PENDING_REVIEW")
            .map(a => a.name),
          stakeholderRoles: stakeholders.map(s => s.role || "").filter(Boolean),
          approvedPhaseGateNames: gateApprovals.map(a => a.title || ""),
          hasRisks: riskCount > 0,
          manuallyConfirmed,
          phaseName,
        });
        const summary = summarisePrerequisites(evaluated);
        if (!summary.canAdvance) {
          // Add one blocker per unmet mandatory prereq, with hint where to fix it
          for (const p of evaluated) {
            if (p.state === "met") continue;
            if (!p.isMandatory) continue;
            const where =
              p.state === "manual" ? "tick it on the PM Tracker"
              : p.state === "draft" ? "approve the referenced artefact"
              : p.state === "rejected" ? "regenerate and approve the referenced artefact"
              : "complete the referenced work or tick manually on the PM Tracker";
            blockers.push(`Gate prereq unmet: "${p.description}" — ${where}`);
          }
        }
      }
    }
  } catch (e) {
    console.error("[phase-completion] gate prerequisite evaluation failed:", e);
  }

  // If no artefacts AND no tasks exist at all, phase hasn't started — can't advance
  const hasAnyWork = artefactsTotal > 0 || pmTasksTotal > 0 || deliveryTotal > 0;
  if (!hasAnyWork) {
    blockers.push("Phase has no artefacts, PM tasks, or delivery tasks yet — work must be generated before advancement");
  }

  // Pipeline-step audit gate — research and clarification MUST be marked
  // complete (or clarification explicitly skipped with an allowed reason)
  // before the phase can be considered ready to advance. Without this,
  // older code paths that skipped research/clarification could still let
  // the gate pass purely on artefact/task counts.
  try {
    const phaseAudit = await db.phase.findFirst({
      where: { projectId, name: phaseName },
      select: {
        researchCompletedAt: true,
        clarificationCompletedAt: true,
        clarificationSkippedReason: true,
      },
    });
    if (phaseAudit) {
      if (!phaseAudit.researchCompletedAt) {
        blockers.push(`Phase research has not been completed — re-run research before advancement.`);
      }
      const clarificationSatisfied =
        !!phaseAudit.clarificationCompletedAt ||
        phaseAudit.clarificationSkippedReason === "no_questions_needed" ||
        phaseAudit.clarificationSkippedReason === "user_skipped_explicit";
      if (!clarificationSatisfied) {
        blockers.push(`Clarification has not been completed — answer the open questions or explicitly skip.`);
      }
    }
  } catch (e) {
    console.error("[phase-completion] audit-timestamp gate check failed:", e);
  }

  const canAdvance = blockers.length === 0;

  // Weighted overall: only include layers that have content.
  // If ALL layers are empty (0/0/0), overall is 0% — don't claim a phase is
  // complete just because it has no work yet.
  const layers: Array<{ pct: number; weight: number }> = [];
  if (artefactsTotal > 0) layers.push({ pct: artefactsPct, weight: 0.3 });
  if (pmTasksTotal > 0) layers.push({ pct: pmTasksPct, weight: 0.3 });
  if (deliveryTotal > 0) layers.push({ pct: deliveryPct, weight: 0.4 });

  let overall = 0;
  if (layers.length > 0) {
    const totalWeight = layers.reduce((s, l) => s + l.weight, 0);
    overall = Math.round(layers.reduce((s, l) => s + l.pct * (l.weight / totalWeight), 0));
  }
  // If nothing exists yet, overall stays 0 (correct — phase hasn't started)

  return {
    phaseName,
    phaseId,
    phaseStatus,
    artefacts: { total: artefactsTotal, done: artefactsDone, pct: artefactsPct },
    pmTasks: { total: pmTasksTotal, done: pmTasksDone, pct: pmTasksPct },
    deliveryTasks: { total: deliveryTotal, done: deliveryDone, pct: deliveryPct },
    overall,
    canAdvance,
    blockers,
  };
}

// ─── All Phases ─────────────────────────────────────────────────────────────

export async function getAllPhasesCompletion(
  projectId: string,
  agentId: string,
  config?: Partial<PhaseCompletionConfig>,
): Promise<PhaseCompletionStatus[]> {
  const phases = await db.phase.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
    select: { name: true },
  });

  const results: PhaseCompletionStatus[] = [];
  for (const phase of phases) {
    results.push(await getPhaseCompletion(projectId, phase.name, agentId, config));
  }

  return results;
}
