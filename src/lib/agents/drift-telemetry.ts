/**
 * Drift telemetry — makes the self-heal sweeps visible (review P2,
 * docs/REVIEW-2026-07-10.md).
 *
 * The agent-tick cron repairs state drift every minute (orphan relinks,
 * stale-phase downgrades, premature-gate cancels, deployment unsticks).
 * Historically those repairs were silent console.logs — the system healed
 * itself without anyone learning WHAT keeps breaking, so the causes never
 * got fixed. Every repair now lands in AuditLog as a DRIFT_* event, visible
 * in Admin → Audit Log, so recurring drift patterns can be burned down at
 * the source. The healing behaviour itself is unchanged — telemetry first,
 * removal of the heals once their causes are dead.
 */

import { db } from "@/lib/db";

export type DriftAction =
  | "DRIFT_ORPHAN_ARTEFACT_PROJECT" // artefact had no projectId — relinked
  | "DRIFT_ORPHAN_ARTEFACT_PHASE" // artefact had no phaseId — relinked
  | "DRIFT_ORPHAN_TASK_PHASE" // task had no phaseId — relinked
  | "DRIFT_STALE_PHASE_DOWNGRADE" // COMPLETED phase without research audit → STALE
  | "DRIFT_DEPLOYMENT_UNSTUCK" // deployment stuck >1h in onboarding status → reset
  | "DRIFT_PREMATURE_GATE_REJECTED" // phase gate raised with 0 artefacts → rejected
  | "DRIFT_STALE_GATE_DEFERRED" // phase gate no longer advance-ready → deferred
  | "DRIFT_MISSING_ARTEFACTS_BACKFILL" // active phase had 0 artefacts → regeneration fired
  | "DRIFT_VPS_INIT_FALLBACK" // VPS never processed a lifecycle_init job → ran inline
  | "DRIFT_JOB_EVIDENCE_MISSING"; // job marked COMPLETED with no verifiable output

export interface DriftRow {
  /** id of the repaired row (artefact/task/phase/approval/deployment/job) */
  entityId: string;
  projectId?: string | null;
}

/**
 * Record one drift event per organisation touched by a sweep. AuditLog
 * requires an orgId, and tick sweeps run cross-org — rows are grouped via
 * their projectId → Project.orgId. Rows whose org can't be resolved are
 * counted under the first resolvable org (better slightly misattributed
 * telemetry than silently dropped). Never throws — telemetry must not be
 * able to break the heal it observes.
 */
export async function recordDrift(
  action: DriftAction,
  entityType: string,
  rows: DriftRow[],
  rationale: string,
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const projectIds = [...new Set(rows.map((r) => r.projectId).filter(Boolean) as string[])];
    const projects = projectIds.length
      ? await db.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, orgId: true } })
      : [];
    const orgByProject = new Map(projects.map((p) => [p.id, p.orgId]));
    const fallbackOrg = projects[0]?.orgId ?? null;

    const byOrg = new Map<string, DriftRow[]>();
    for (const row of rows) {
      const orgId = (row.projectId && orgByProject.get(row.projectId)) || fallbackOrg;
      if (!orgId) continue; // no org resolvable at all — nothing to attach to
      byOrg.set(orgId, [...(byOrg.get(orgId) ?? []), row]);
    }

    for (const [orgId, orgRows] of byOrg.entries()) {
      await db.auditLog.create({
        data: {
          orgId,
          action,
          target: `${orgRows.length} ${entityType}${orgRows.length === 1 ? "" : "s"}`,
          entityType,
          projectId: orgRows[0]?.projectId ?? null,
          rationale,
          details: {
            count: orgRows.length,
            entityIds: orgRows.slice(0, 50).map((r) => r.entityId),
            projectIds: [...new Set(orgRows.map((r) => r.projectId).filter(Boolean))],
          } as any,
        },
      });
    }
  } catch (e) {
    console.error(`[drift-telemetry] recording ${action} failed (heal unaffected):`, e);
  }
}
