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

/** Mark a job as completed with optional result */
export async function completeJob(jobId: string, result?: Record<string, unknown>) {
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
  "blocked_tasks_incomplete",
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
