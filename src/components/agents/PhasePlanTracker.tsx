"use client";

/**
 * PhasePlanTracker — full per-phase view for the PM Tracker page.
 *
 * Replaces the collapsed/single-phase tracker with an always-expanded
 * list. Each phase block shows:
 *   - status pill (Pending / Active / Done) + overall progress
 *   - the methodology's required artefacts and their status
 *   - scaffolded PM tasks grouped by category
 *   - the phase gate criteria + per-prereq evaluation (✓ / ✗ / draft / manual)
 *   - blockers preventing advancement
 *
 * Source: GET /api/projects/:projectId/phase-tracker
 *
 * Manual prereqs (those that can't be auto-checked from project state)
 * have a clickable circle that toggles a confirmation row in the
 * /api/projects/:projectId/prereq-confirmations endpoint.
 */

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  Circle,
  XCircle,
  AlertCircle,
  FileText,
  Shield,
  Users,
  BarChart3,
  Truck,
  ChevronRight,
} from "lucide-react";

const CATEGORY_ICONS: Record<string, any> = {
  "Document Generation": FileText,
  "Governance & Approvals": Shield,
  "Monitoring & Control": BarChart3,
  "Stakeholder Management": Users,
  "Delivery & Execution": Truck,
};

interface EvaluatedPrereq {
  description: string;
  category: string;
  isMandatory: boolean;
  requiresHumanApproval: boolean;
  state: "met" | "rejected" | "draft" | "unmet" | "manual";
  evidence?: string;
  manuallyConfirmed?: boolean;
}

interface ArtefactStatus {
  name: string;
  required: boolean;
  aiGeneratable: boolean;
  artefactId: string | null;
  status: string;
}

interface TaskChild {
  id: string;
  title: string;
  status: string;
  progress: number;
  done: boolean;
  linkedArtefact?: string;
  linkedEvent?: string;
  /** ISO timestamp — surfaced as "Last completed: …" for recurring tasks. */
  completedAt?: string | null;
}

// Maps a task's auto-tick driver to a one-line user-facing hint.
// Returned text starts with "auto — " so it formats consistently.
function autoTickHint(t: { linkedArtefact?: string; linkedEvent?: string }): string | null {
  if (t.linkedArtefact) return `auto — ticks when "${t.linkedArtefact}" is generated`;
  switch (t.linkedEvent) {
    case "clarification_complete": return "auto — ticks once you answer the agent's clarification questions";
    case "gate_request":           return "auto — ticks when the phase gate approval is created";
    case "phase_advanced":         return "auto — ticks after the phase advances";
    case "risk_register_updated":  return "auto — ticks when you add or edit a risk on the Risk Register";
    case "stakeholder_updated":    return "auto — ticks when you add a stakeholder on the People page";
    default:                       return null;
  }
}

// Maps a task to the page where the underlying action actually happens. Pair
// with autoTickHint for context: hint = how it auto-ticks, destination = where
// to do the work. Returns null when there's no useful destination (purely
// agent-driven events the user can't act on directly, e.g. phase_advanced).
function taskDestination(
  t: { linkedArtefact?: string; linkedEvent?: string; title?: string },
  projectId: string,
): { href: string; label: string } | null {
  if (t.linkedArtefact) return { href: `/projects/${projectId}/artefacts`, label: "Open Documents" };
  switch (t.linkedEvent) {
    case "clarification_complete": return { href: `/agents/chat`, label: "Open Chat" };
    case "gate_request":           return { href: `/approvals`, label: "Open Approvals" };
    case "risk_register_updated":  return { href: `/projects/${projectId}/risk`, label: "Open Risk Register" };
    case "stakeholder_updated":    return { href: `/projects/${projectId}/stakeholders`, label: "Open People" };
    case "phase_advanced":         return null; // Nothing the user can click to advance besides the gate
    default: break;
  }
  // Fall back to the task title — covers "soft" tasks without a linkedEvent
  // (e.g. "Stakeholder communication and updates", "Review and update Risk
  // Register") so they still get a deep link even though the agent didn't
  // tag them with an event marker.
  const title = (t.title || "").toLowerCase();
  if (title.includes("stakeholder")) return { href: `/projects/${projectId}/stakeholders`, label: "Open People" };
  if (title.includes("risk"))        return { href: `/projects/${projectId}/risk`, label: "Open Risk Register" };
  if (title.includes("approval") || title.includes("gate")) return { href: `/approvals`, label: "Open Approvals" };
  if (title.includes("issue"))       return { href: `/projects/${projectId}/issues`, label: "Open Issues" };
  if (title.includes("change"))      return { href: `/projects/${projectId}/change-control`, label: "Open Change Control" };
  if (title.includes("schedule") || title.includes("milestone")) return { href: `/projects/${projectId}/schedule`, label: "Open Schedule" };
  if (title.includes("cost") || title.includes("budget")) return { href: `/projects/${projectId}/cost`, label: "Open Cost" };
  if (title.includes("report") || title.includes("status update")) return { href: `/projects/${projectId}/reports`, label: "Open Reports" };
  if (title.includes("meeting"))     return { href: `/agents/chat`, label: "Open Chat" };
  return null;
}

function formatRelative(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

interface TaskGroup {
  category: string;
  total: number;
  done: number;
  children: TaskChild[];
}

interface PhaseBlock {
  order: number;
  name: string;
  description: string;
  color: string;
  status: string;
  isCurrent: boolean;
  artefacts: ArtefactStatus[];
  taskGroups: TaskGroup[];
  gate: {
    name: string;
    criteria: string;
    prerequisites: EvaluatedPrereq[];
    summary: { total: number; met: number; blockers: number; manual: number; canAdvance: boolean };
  };
  completion: {
    artefactsPct: number;
    pmTasksPct: number;
    deliveryPct: number;
    overall: number;
    canAdvance: boolean;
    blockers: string[];
  } | null;
}

interface PhasePlanTrackerProps {
  data: {
    methodology: { id: string; name: string; framework: string };
    currentPhase: string | null;
    phases: PhaseBlock[];
  };
  projectId: string;
}

const PHASE_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  COMPLETED: { label: "Done",    bg: "bg-emerald-500/10",         text: "text-emerald-600 dark:text-emerald-400" },
  ACTIVE:    { label: "Active",  bg: "bg-primary/10",             text: "text-primary" },
  PENDING:   { label: "Pending", bg: "bg-muted",                  text: "text-muted-foreground" },
  BLOCKED:   { label: "Blocked", bg: "bg-red-500/10",             text: "text-red-600 dark:text-red-400" },
};

const ARTEFACT_BADGE: Record<string, { label: string; cls: string }> = {
  APPROVED:        { label: "Approved",  cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  PENDING_REVIEW:  { label: "In review", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  DRAFT:           { label: "Draft",     cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  REJECTED:        { label: "Rejected",  cls: "bg-red-500/10 text-red-600 dark:text-red-400" },
  MISSING:         { label: "Missing",   cls: "bg-muted text-muted-foreground" },
};

function PrereqIcon({ state }: { state: EvaluatedPrereq["state"] }) {
  switch (state) {
    case "met":
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />;
    case "rejected":
      return <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />;
    case "draft":
      return <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />;
    case "manual":
      return <Circle className="w-3.5 h-3.5 text-blue-500/70 flex-shrink-0" />;
    case "unmet":
    default:
      return <Circle className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />;
  }
}

export function PhasePlanTracker({ data, projectId }: PhasePlanTrackerProps) {
  const { phases, methodology } = data;

  // Local override layer so a click feels instant — the next refetch
  // (parent page re-fetches after save) will reconcile with the server.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  // Same pattern for PM task ticks — soft tasks (Stakeholder
  // communication, Risk Register review) have no auto-tick path, so the
  // user marks them done by clicking the circle. Map keyed by task id.
  const [taskOverrides, setTaskOverrides] = useState<Record<string, boolean>>({});
  const [, startTransition] = useTransition();

  const overrideKey = (phase: string, prereq: string) => `${phase}::${prereq}`;

  async function toggleManualConfirm(phase: string, p: EvaluatedPrereq) {
    // Only allow toggling on prereqs that are either manual or already
    // manually confirmed — auto-detected metas should not be hand-flipped.
    const isCurrentlyConfirmed = !!p.manuallyConfirmed || overrides[overrideKey(phase, p.description)] === true;
    const willConfirm = !isCurrentlyConfirmed;
    const key = overrideKey(phase, p.description);

    setOverrides(prev => ({ ...prev, [key]: willConfirm }));

    startTransition(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/prereq-confirmations`, {
          method: willConfirm ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase, prereq: p.description }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error || `${res.status}`);
        }
        toast.success(willConfirm ? "Prerequisite confirmed" : "Confirmation removed");
      } catch (e: any) {
        // Roll back optimistic state on failure
        setOverrides(prev => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        toast.error(e?.message || "Could not save");
      }
    });
  }

  // Click handler for soft PM tasks ("Stakeholder communication",
  // "Review and update Risk Register") that have no auto-tick path.
  // Hits the existing /api/projects/:id/tasks/:taskId PATCH and applies
  // the same optimistic-then-reconcile pattern as toggleManualConfirm.
  async function toggleTaskDone(t: TaskChild) {
    const isCurrentlyDone = t.done || taskOverrides[t.id] === true;
    const willMarkDone = !isCurrentlyDone;
    setTaskOverrides(prev => ({ ...prev, [t.id]: willMarkDone }));
    startTransition(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/tasks/${t.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: willMarkDone ? "DONE" : "TODO",
            progress: willMarkDone ? 100 : 0,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error || `${res.status}`);
        }
        toast.success(willMarkDone ? "Task marked done" : "Task reopened");
      } catch (e: any) {
        setTaskOverrides(prev => {
          const next = { ...prev };
          delete next[t.id];
          return next;
        });
        toast.error(e?.message || "Could not save");
      }
    });
  }

  function effectiveState(phaseName: string, p: EvaluatedPrereq): EvaluatedPrereq {
    const key = overrideKey(phaseName, p.description);
    if (overrides[key] === true && p.state !== "met") {
      return { ...p, state: "met", manuallyConfirmed: true, evidence: "Manually confirmed" };
    }
    if (overrides[key] === false && p.manuallyConfirmed) {
      // Roll back to manual — the server will reconcile on next fetch.
      return { ...p, state: "manual", manuallyConfirmed: false, evidence: undefined };
    }
    return p;
  }

  return (
    <div className="space-y-4">
      {/* Methodology context */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Methodology: <span className="font-semibold text-foreground">{methodology.name}</span></span>
        <span>{phases.length} phase{phases.length === 1 ? "" : "s"}</span>
      </div>

      {phases.map((phase, idx) => {
        const badge = PHASE_BADGE[phase.status] || PHASE_BADGE.PENDING;
        const overall = phase.completion?.overall ?? 0;
        const accent = phase.color || "#6366F1";

        return (
          <div
            key={phase.name}
            className={`rounded-xl border bg-card overflow-hidden ${phase.isCurrent ? "ring-1 ring-primary/40 border-primary/30" : "border-border/40"}`}
          >
            {/* ── Phase header ───────────────────────────────────────── */}
            <div className="px-4 py-3 border-b border-border/40 flex items-center gap-3">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                style={{ background: `${accent}18`, color: accent }}
              >
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground">{phase.name}</span>
                  <Badge className={`text-[9px] ${badge.bg} ${badge.text} border-0`}>{badge.label}</Badge>
                  {phase.isCurrent && (
                    <Badge className="text-[9px] bg-primary/10 text-primary border-0">Current</Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{phase.description}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs font-bold text-foreground tabular-nums">{overall}%</p>
                <Progress value={overall} className="w-20 h-1 mt-1" />
              </div>
            </div>

            {/* ── Artefacts ──────────────────────────────────────────── */}
            {phase.artefacts.length > 0 && (
              <div className="px-4 py-3 border-b border-border/30">
                <div className="flex items-center gap-1.5 mb-2">
                  <FileText className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Artefacts</span>
                  <span className="text-[10px] text-muted-foreground/60">
                    {phase.artefacts.filter(a => a.status === "APPROVED").length}/{phase.artefacts.length} approved
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {phase.artefacts.map(a => {
                    const ab = ARTEFACT_BADGE[a.status] || ARTEFACT_BADGE.MISSING;
                    return (
                      <a
                        key={a.name}
                        href={a.artefactId ? `/projects/${projectId}/artefacts` : `/projects/${projectId}/artefacts`}
                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/40 transition-colors text-[11px]"
                      >
                        <ChevronRight className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
                        <span className={`flex-1 truncate ${a.status === "APPROVED" ? "text-foreground" : "text-foreground/80"}`}>
                          {a.name}
                          {a.required && <span className="ml-1 text-red-500/70">*</span>}
                        </span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${ab.cls}`}>{ab.label}</span>
                      </a>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Scaffolded PM tasks ────────────────────────────────── */}
            {phase.taskGroups.length > 0 && (
              <div
                className="px-4 py-3 border-b border-border/30"
                /* The pm-tracker page reads this attribute to scroll the
                   user to the current phase's PM tasks when they land via
                   the agent status-bar "Open PM Tracker" CTA with
                   ?focus=blocking. */
                {...(phase.isCurrent ? { "data-current-pm-tasks": "true" } : {})}
              >
                <div className="flex items-center gap-1.5 mb-2">
                  <Shield className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">PM tasks</span>
                </div>
                <div className="space-y-2">
                  {phase.taskGroups.map(group => {
                    const Icon = CATEGORY_ICONS[group.category] || FileText;
                    return (
                      <div key={group.category}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Icon className="w-3 h-3 text-muted-foreground" />
                          <span className="text-[10px] font-semibold text-muted-foreground">{group.category}</span>
                          <span className="text-[9px] text-muted-foreground/60">{group.done}/{group.total}</span>
                        </div>
                        <div className="ml-5 space-y-0.5">
                          {group.children.map(t => {
                            const overrideDone = taskOverrides[t.id];
                            const effectiveDone = overrideDone === true ? true : overrideDone === false ? false : t.done;
                            // Document-generation tasks are auto-driven by
                            // artefact existence — don't let the user
                            // hand-tick them; they'd just resync next refresh.
                            // Other auto-tick tasks (e.g. risk_register_updated)
                            // CAN be hand-ticked as a fallback if the user has
                            // already done the work elsewhere.
                            const hint = autoTickHint(t);
                            const dest = taskDestination(t, projectId);
                            const lastDoneLabel = formatRelative(t.completedAt);
                            const isArtefactDriven = !!t.linkedArtefact;
                            const canToggle = !isArtefactDriven;
                            const isBlocking = phase.isCurrent && !effectiveDone;
                            return (
                              <div
                                key={t.id}
                                className="group/task flex items-start gap-2 py-1 rounded transition-colors hover:bg-muted/30"
                                {...(isBlocking ? { "data-incomplete-pm-task": "true" } : {})}
                              >
                                {canToggle ? (
                                  <button
                                    type="button"
                                    onClick={() => toggleTaskDone({ ...t, done: effectiveDone })}
                                    title={effectiveDone ? "Click to reopen" : "Mark done"}
                                    aria-label={effectiveDone ? "Mark not done" : "Mark done"}
                                    className={`flex-shrink-0 mt-0.5 w-4 h-4 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                                      effectiveDone
                                        ? "bg-emerald-500/15 ring-1 ring-emerald-500/40"
                                        : "ring-1 ring-muted-foreground/30 hover:ring-foreground/60 hover:bg-muted/60"
                                    }`}
                                  >
                                    {effectiveDone
                                      ? <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                      : <Circle className="w-2.5 h-2.5 text-muted-foreground/50 group-hover/task:text-foreground/80" />}
                                  </button>
                                ) : (
                                  <span className="flex-shrink-0 mt-0.5 w-4 h-4 flex items-center justify-center" title="Auto-driven by artefact existence">
                                    {effectiveDone
                                      ? <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                      : <Circle className="w-3 h-3 text-muted-foreground/30" />}
                                  </span>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-baseline flex-wrap gap-x-2 gap-y-0.5">
                                    <span className={`text-[11px] leading-tight ${effectiveDone ? "text-muted-foreground line-through" : "text-foreground font-medium"}`}>
                                      {t.title}
                                    </span>
                                    {!effectiveDone && t.progress > 0 && (
                                      <span className="text-[9px] text-primary tabular-nums">{t.progress}%</span>
                                    )}
                                    {effectiveDone && lastDoneLabel && (
                                      <span className="text-[9px] text-emerald-600/80 dark:text-emerald-400/80">· done {lastDoneLabel}</span>
                                    )}
                                  </div>
                                  {/* Hint + deep link line — same row of context, lighter typography. */}
                                  {(hint || dest) && (
                                    <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                                      {hint && !effectiveDone && (
                                        <span className="text-[9.5px] text-muted-foreground/70 italic">{hint}</span>
                                      )}
                                      {dest && (
                                        <a
                                          href={dest.href}
                                          className="text-[9.5px] font-semibold text-primary hover:underline inline-flex items-center gap-0.5"
                                        >
                                          {dest.label} <ChevronRight className="w-2.5 h-2.5" />
                                        </a>
                                      )}
                                      {canToggle && !effectiveDone && !hint && (
                                        <span className="text-[9.5px] text-muted-foreground/70 italic">click the circle to mark done</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Gate criteria + prereqs ────────────────────────────── */}
            <div className="px-4 py-3 bg-muted/20">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Shield className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Gate: {phase.gate.name}
                </span>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                    phase.gate.summary.canAdvance
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {phase.gate.summary.met}/{phase.gate.summary.total} met
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mb-2 italic">{phase.gate.criteria}</p>
              <div className="space-y-1">
                {phase.gate.prerequisites.map((rawP, i) => {
                  const p = effectiveState(phase.name, rawP);
                  const canToggle = p.state === "manual" || p.manuallyConfirmed;
                  const Wrapper: any = canToggle ? "button" : "div";
                  return (
                    <Wrapper
                      key={i}
                      type={canToggle ? "button" : undefined}
                      onClick={canToggle ? () => toggleManualConfirm(phase.name, p) : undefined}
                      className={`w-full flex items-start gap-2 py-0.5 text-left ${canToggle ? "rounded px-1 -mx-1 hover:bg-muted/40 transition-colors cursor-pointer" : ""}`}
                    >
                      <PrereqIcon state={p.state} />
                      <div className="flex-1 min-w-0">
                        <span className={`text-[11px] ${p.state === "met" ? "text-foreground/80 line-through" : "text-foreground"}`}>
                          {p.description}
                          {p.isMandatory && <span className="ml-1 text-red-500/70" title="Mandatory">*</span>}
                          {p.manuallyConfirmed && (
                            <span className="ml-1 text-[8px] uppercase tracking-wider text-emerald-500 font-bold">manual</span>
                          )}
                        </span>
                        {p.evidence && (
                          <p className="text-[9px] text-muted-foreground mt-0.5">{p.evidence}</p>
                        )}
                        {p.state === "manual" && !p.manuallyConfirmed && (
                          <p className="text-[9px] text-blue-500/80 mt-0.5">Click to mark as manually confirmed.</p>
                        )}
                        {p.manuallyConfirmed && (
                          <p className="text-[9px] text-muted-foreground mt-0.5">Click to undo this manual confirmation.</p>
                        )}
                      </div>
                    </Wrapper>
                  );
                })}
              </div>
              {phase.completion?.blockers && phase.completion.blockers.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/30">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-red-500 mb-1">Blockers</p>
                  <ul className="space-y-0.5">
                    {phase.completion.blockers.map((b, i) => (
                      <li key={i} className="text-[10px] text-red-600 dark:text-red-400 flex items-start gap-1">
                        <span className="text-red-500">•</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        );
      })}

      <p className="text-[10px] text-muted-foreground text-center pt-2">
        Required artefacts marked with <span className="text-red-500">*</span>. Mandatory prerequisites also marked <span className="text-red-500">*</span>.
        Items marked "Needs human confirmation" can't be auto-checked from project data and must be ticked off manually before advancing the phase.
      </p>
    </div>
  );
}
