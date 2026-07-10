/**
 * Agent Job Queue — DB-backed job queue using the AgentJob table.
 * Creates, queries, and claims jobs for the autonomous agent runtime.
 */

import { db } from "@/lib/db";

export type JobType =
  | "autonomous_cycle"
  | "lifecycle_init"
  | "approval_resume"
  | "report_generate"
  | "user_edit_reconcile";

interface CreateJobOptions {
  agentId: string;
  deploymentId: string;
  type: JobType;
  priority?: number; // 1=highest, default 5
  payload?: Record<string, unknown>;
  scheduledFor?: Date;
}

/** Create a job, skipping if a PENDING/RUNNING job of the same type already exists for this agent */
export async function createJob(opts: CreateJobOptions) {
  // Deduplicate: don't create if one already pending/running for this agent+type
  const existing = await db.agentJob.findFirst({
    where: {
      agentId: opts.agentId,
      type: opts.type,
      status: { in: ["PENDING", "CLAIMED", "RUNNING"] },
    },
  });
  if (existing) return existing;

  return db.agentJob.create({
    data: {
      agentId: opts.agentId,
      deploymentId: opts.deploymentId,
      type: opts.type,
      priority: opts.priority ?? 5,
      payload: (opts.payload ?? undefined) as any,
      scheduledFor: opts.scheduledFor ?? new Date(),
    },
  });
}

/** Get all pending jobs due for processing, ordered by priority then creation time */
export async function getPendingJobs(limit = 20) {
  return db.agentJob.findMany({
    where: {
      status: "PENDING",
      scheduledFor: { lte: new Date() },
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    take: limit,
  });
}

/** Atomically claim a job (PENDING → CLAIMED). Returns null if already claimed. */
export async function claimJob(jobId: string) {
  try {
    return await db.agentJob.update({
      where: { id: jobId, status: "PENDING" },
      data: { status: "CLAIMED", startedAt: new Date(), attempts: { increment: 1 } },
    });
  } catch {
    return null; // Already claimed by another worker
  }
}

/** Mark a job as running */
export async function markRunning(jobId: string) {
  return db.agentJob.update({
    where: { id: jobId },
    data: { status: "RUNNING" },
  });
}

/**
 * Output-evidence contract per job type (review P2): a job may only be
 * COMPLETED when its result carries proof the work actually happened. The
 * 3-week billed-while-broken incident was jobs flipping COMPLETED with no
 * output and nothing noticing.
 *   - lifecycle_init:   artefacts must have been produced
 *   - report_generate:  a report row must exist
 *   - everything else:  a non-empty result object (cycles legitimately
 *                       conclude "no action needed", but must SAY so)
 */
export function jobEvidenceError(type: string, result?: Record<string, unknown> | null): string | null {
  const r = result ?? {};
  if (type === "lifecycle_init") {
    const created = (r as any).artefactsCreated;
    const ids = (r as any).artefactIds;
    if ((typeof created === "number" && created > 0) || (Array.isArray(ids) && ids.length > 0)) return null;
    return "completed without output evidence: lifecycle_init must report artefactsCreated > 0 or artefactIds";
  }
  if (type === "report_generate") {
    if ((r as any).reportId) return null;
    return "completed without output evidence: report_generate must report a reportId";
  }
  if (Object.keys(r).length === 0) {
    return "completed without output evidence: result must describe what the job did (or state that no action was needed)";
  }
  return null;
}

/** Mark a job as completed — refuses (marks FAILED) without output evidence. */
export async function completeJob(jobId: string, result?: Record<string, unknown>) {
  const job = await db.agentJob.findUnique({ where: { id: jobId }, select: { type: true } });
  const evidenceError = job ? jobEvidenceError(job.type, result) : null;
  if (evidenceError) {
    console.error(`[job-queue] refusing COMPLETED for ${jobId} (${job?.type}): ${evidenceError}`);
    return db.agentJob.update({
      where: { id: jobId },
      data: { status: "FAILED", error: evidenceError, completedAt: new Date(), result: (result ?? undefined) as any },
    });
  }
  return db.agentJob.update({
    where: { id: jobId },
    data: { status: "COMPLETED", completedAt: new Date(), result: (result ?? undefined) as any },
  });
}

/** Mark a job as failed. Retries if under maxAttempts. */
export async function failJob(jobId: string, error: string) {
  const job = await db.agentJob.findUnique({ where: { id: jobId } });
  if (!job) return null;

  const shouldRetry = job.attempts < job.maxAttempts;
  return db.agentJob.update({
    where: { id: jobId },
    data: {
      status: shouldRetry ? "PENDING" : "FAILED",
      error,
      // Retry with backoff: 1min, 5min, 15min
      scheduledFor: shouldRetry
        ? new Date(Date.now() + Math.pow(5, job.attempts) * 60_000)
        : undefined,
    },
  });
}

/** Cancel all pending jobs for an agent (used when pausing) */
export async function cancelAgentJobs(agentId: string) {
  return db.agentJob.updateMany({
    where: { agentId, status: { in: ["PENDING", "CLAIMED"] } },
    data: { status: "FAILED", error: "Cancelled: agent paused" },
  });
}

/**
 * Per-tick fan-out cap for the agent-tick cron. The cron route runs each due
 * deployment serially through monitoring + Sonnet + alerts + KB scan + outreach
 * + calibration (~5-15s each on a hot path); at scale the 30s `maxDuration` on
 * the route will time out long before we drain a large queue. Anything we don't
 * pick this tick stays `nextCycleAt <= now()` and gets drained on the next tick
 * (~5 min later). Tune up only after we add concurrency or move the heavy work
 * to the VPS queue.
 */
export const AGENT_TICK_FANOUT_CAP = 25;

/** Get active deployments that are due for an autonomous cycle */
export async function getDueDeployments() {
  return db.agentDeployment.findMany({
    where: {
      isActive: true,
      cyclePaused: false, // Cost guard — paused deployments never run cycles
      agent: { status: "ACTIVE" },
      OR: [
        { nextCycleAt: null }, // Never ran
        { nextCycleAt: { lte: new Date() } }, // Due
      ],
    },
    include: {
      agent: { select: { id: true, name: true, autonomyLevel: true, orgId: true, org: { select: { id: true } } } },
      project: { select: { id: true, name: true, methodology: true } },
    },
    // Process oldest-due first so no deployment starves under load.
    orderBy: { nextCycleAt: { sort: "asc", nulls: "first" } },
    take: AGENT_TICK_FANOUT_CAP,
  });
}

// ── Phase-aware cycle interval ─────────────────────────────────────────────
// During setup phases (research, clarification, gate review) the cycle adds
// no value — there's no schedule pressure to monitor, no team velocity to
// track. Stretch the interval to 24h so even an "active" deployment in a
// setup state doesn't burn Claude on every tick.
// During execution phases (active with real work in flight) use the
// configured cycleInterval (default 10 min) for tight monitoring.

const SETUP_PHASE_STATUSES = new Set([
  "researching",
  "awaiting_research_approval",
  "awaiting_clarification",
  "waiting_approval",
  // "pending_approval" was MISSING here — the codebase writes two spellings
  // of the artefact-review state ("waiting_approval" from phase-advance,
  // "pending_approval" from artefact PATCH) and only one was covered.
  // Deployments parked on artefact review therefore cycled at the 10-min
  // execution cadence: Nova burned ~200 credits/day for weeks while DTI sat
  // in pending_approval waiting for the user to review drafts.
  "pending_approval",
  "blocked_tasks_incomplete",
  // Phase finished, waiting on the advance action — nothing to monitor.
  "complete",
]);

/** Effective interval in minutes for a deployment, given its current phase status. */
export function getEffectiveCycleInterval(deployment: {
  cycleInterval: number;
  phaseStatus?: string | null;
}): number {
  const status = (deployment.phaseStatus || "active").toLowerCase();
  if (SETUP_PHASE_STATUSES.has(status)) {
    // 24h cadence during setup — covers daily check-in scenarios but
    // doesn't waste Sonnet on a project that's waiting for the user.
    return 24 * 60;
  }
  return Math.max(1, deployment.cycleInterval || 10);
}
