"use client";

/**
 * DoD / DoR checklist for a single Task.
 *
 * Renders one row per criterion from the project's Definition of Done (or
 * Definition of Ready) with a checkbox bound to the task's dodChecks /
 * dorChecks array. Click a checkbox → PATCH the task with the updated
 * array. The PATCH route also enforces the same gate server-side, so if a
 * stale UI somehow allows transitioning to DONE with unmet criteria the
 * 422 response is the final word.
 *
 * Empty state: when the project hasn't approved a DoD/DoR yet we show an
 * inline hint pointing at where to find the artefact, rather than hiding
 * the section — the absence of a DoD is itself information.
 */

import { useState } from "react";
import { toast } from "sonner";
import { criterionKey } from "@/lib/agents/criteria-parser";

interface Props {
  kind: "dod" | "dor";
  criteria: string[];
  /** Either the legacy boolean[] (positional) or the keyed
   *  Record<criterionKey,boolean>. The component reads both and writes
   *  the keyed shape on every save so reordering the criteria in the
   *  artefact won't shuffle existing ticks. */
  checks: unknown;
  taskId: string;
  projectId: string;
  /** Called after a successful PATCH so the parent can refetch its task
   *  query. The mutation hook used by the parent already invalidates the
   *  `["tasks", projectId]` cache, so callers typically just pass that
   *  hook's `mutate`. */
  onPatch: (payload: { dodChecks?: Record<string, boolean>; dorChecks?: Record<string, boolean> }) => Promise<void> | void;
}

export function CriteriaChecklist({ kind, criteria, checks, taskId: _taskId, projectId: _projectId, onPatch }: Props) {
  const [pendingIdx, setPendingIdx] = useState<number | null>(null);

  const label = kind === "dod" ? "Definition of Done" : "Definition of Ready";
  const fieldName = kind === "dod" ? "dodChecks" : "dorChecks";
  const accentColor = kind === "dod" ? "#10B981" : "#6366F1";

  // Project the persisted shape (either positional or keyed) onto a stable
  // keyed record we use for rendering AND the next write. Keys are the
  // normalised criterion text — same key the server uses in dodComplete.
  // Any old positional array gets migrated to keyed form on the first save.
  const checksRecord: Record<string, boolean> = (() => {
    const out: Record<string, boolean> = {};
    if (Array.isArray(checks)) {
      // Legacy positional shape — map by index.
      for (let i = 0; i < criteria.length; i++) {
        if (checks[i] === true) out[criterionKey(criteria[i])] = true;
      }
    } else if (checks && typeof checks === "object") {
      // Already keyed — copy through only the criteria we recognise so a
      // criterion that was removed from the DoD doesn't keep a stale tick.
      for (const c of criteria) {
        const k = criterionKey(c);
        if ((checks as Record<string, unknown>)[k] === true) out[k] = true;
      }
    }
    return out;
  })();

  const satisfied = criteria.filter(c => checksRecord[criterionKey(c)] === true).length;
  const total = criteria.length;

  async function toggle(idx: number) {
    setPendingIdx(idx);
    const k = criterionKey(criteria[idx]);
    const next: Record<string, boolean> = { ...checksRecord };
    if (next[k]) delete next[k]; else next[k] = true;
    try {
      await onPatch({ [fieldName]: next } as any);
    } catch (e: any) {
      toast.error(e?.message || "Failed to update");
    } finally {
      setPendingIdx(null);
    }
  }

  if (total === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 p-3 text-[11px] text-muted-foreground">
        <span className="font-semibold uppercase tracking-wider mr-2" style={{ color: accentColor }}>{label}</span>
        not yet approved for this project — generate and approve the artefact in the Artefacts tab to enable this gate.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: accentColor }}>
          {label}
        </span>
        <span className="text-[10px] font-mono font-semibold" style={{ color: satisfied === total ? accentColor : "var(--muted-foreground)" }}>
          {satisfied} / {total}
        </span>
      </div>
      <ul className="space-y-1.5">
        {criteria.map((c, i) => {
          const checked = checksRecord[criterionKey(c)] === true;
          return (
            <li key={`${i}-${c}`} className="flex items-start gap-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                disabled={pendingIdx !== null}
                onClick={() => toggle(i)}
                className={`mt-[2px] w-4 h-4 rounded border flex items-center justify-center text-[10px] font-bold transition-colors disabled:opacity-50 ${checked ? "text-white" : "text-transparent hover:bg-muted"}`}
                style={{
                  background: checked ? accentColor : "transparent",
                  borderColor: checked ? accentColor : "var(--border)",
                }}
              >
                ✓
              </button>
              <span className={`text-xs leading-snug ${checked ? "line-through text-muted-foreground" : ""}`}>{c}</span>
            </li>
          );
        })}
      </ul>
      {kind === "dod" && satisfied < total && (
        <p className="mt-2 text-[10px] text-muted-foreground italic">
          {total - satisfied} criterion{total - satisfied === 1 ? "" : "a"} unmet — moving this to Done will be refused until all are ticked.
        </p>
      )}
    </div>
  );
}
