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
 */

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
              <div className="px-4 py-3 border-b border-border/30">
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
                          {group.children.map(t => (
                            <div key={t.id} className="flex items-center gap-2 py-0.5">
                              {t.done
                                ? <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                                : <Circle className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />}
                              <span className={`text-[10px] flex-1 ${t.done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                                {t.title}
                              </span>
                              {!t.done && t.progress > 0 && (
                                <span className="text-[9px] text-primary">{t.progress}%</span>
                              )}
                            </div>
                          ))}
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
                {phase.gate.prerequisites.map((p, i) => (
                  <div key={i} className="flex items-start gap-2 py-0.5">
                    <PrereqIcon state={p.state} />
                    <div className="flex-1 min-w-0">
                      <span className={`text-[11px] ${p.state === "met" ? "text-foreground/80 line-through" : "text-foreground"}`}>
                        {p.description}
                        {p.isMandatory && <span className="ml-1 text-red-500/70" title="Mandatory">*</span>}
                      </span>
                      {p.evidence && (
                        <p className="text-[9px] text-muted-foreground mt-0.5">{p.evidence}</p>
                      )}
                      {p.state === "manual" && (
                        <p className="text-[9px] text-blue-500/80 mt-0.5">Needs human confirmation — can't be auto-checked from project data.</p>
                      )}
                    </div>
                  </div>
                ))}
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
