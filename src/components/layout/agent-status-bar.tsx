"use client";

/**
 * AgentStatusBar — Global floating co-pilot strip.
 *
 * Polls the full agent fleet every 20 s.
 * - Shows the most urgent agent first (needs-review > generating > monitoring)
 * - Commentary uses the ACTUAL latest activity summary, not templates
 * - Cycles through recent activities when monitoring
 * - Multi-agent switcher: coloured dots for every deployed agent
 * - Clicking a dot switches focus to that agent
 * - Expand panel: blockquote commentary + phase pills + live activity feed
 */

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import {
  CheckCircle2, AlertCircle, Sparkles, ChevronUp, ChevronDown,
  ArrowRight, RefreshCw, X, Clock, Activity, FileText, Zap, Shield, Bot, MessageSquare,
  Rocket, Pause,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentState = "questions_waiting" | "generating" | "review" | "phase_complete" | "blocked_by_tasks" | "setup" | "paused" | "monitoring" | "idle";

interface RawActivity {
  id?: string;
  type: string;
  summary: string;
  date?: string;
  createdAt?: string;
}

interface PhaseInfo {
  name: string;
  status: "completed" | "active" | "upcoming";
}

interface AgentSlot {
  // identity
  agentId:       string;
  agentName:     string;
  agentGradient: string;
  projectId:     string;
  projectName:   string;
  // computed state
  state:         AgentState;
  hasActiveSession: boolean;
  // phase
  currentPhase:  string | null;
  nextPhase:     string | null;
  phases:        PhaseInfo[];
  // artefacts
  pendingCount:  number;
  totalArtefacts: number;
  // current-phase completion — drives whether "Generate next phase" is honest
  canAdvance:    boolean;
  blockers:      string[];
  pmTasksDone:   number;
  pmTasksTotal:  number;
  deliveryDone:  number;
  deliveryTotal: number;
  // activity
  activities:    RawActivity[];
}

// ─── State colours ────────────────────────────────────────────────────────────

const COLOURS: Record<AgentState, { border: string; glow: string; badge: string; badgeBg: string; ring: string; pulse: string }> = {
  questions_waiting: { border: "#F97316", glow: "rgba(249,115,22,0.25)", badge: "#F97316", badgeBg: "rgba(249,115,22,0.13)", ring: "#F97316", pulse: "rgba(249,115,22,0.4)" },
  review:         { border: "#F59E0B", glow: "rgba(245,158,11,0.22)", badge: "#F59E0B", badgeBg: "rgba(245,158,11,0.13)", ring: "#F59E0B", pulse: "rgba(245,158,11,0.35)" },
  generating:     { border: "#6366F1", glow: "rgba(99,102,241,0.22)",  badge: "#6366F1", badgeBg: "rgba(99,102,241,0.13)",  ring: "#6366F1", pulse: "rgba(99,102,241,0.35)"  },
  phase_complete: { border: "#10B981", glow: "rgba(16,185,129,0.22)",  badge: "#10B981", badgeBg: "rgba(16,185,129,0.13)",  ring: "#10B981", pulse: "rgba(16,185,129,0.35)"  },
  blocked_by_tasks: { border: "#F59E0B", glow: "rgba(245,158,11,0.22)", badge: "#F59E0B", badgeBg: "rgba(245,158,11,0.13)", ring: "#F59E0B", pulse: "rgba(245,158,11,0.35)" },
  setup:          { border: "#8B5CF6", glow: "rgba(139,92,246,0.22)",  badge: "#8B5CF6", badgeBg: "rgba(139,92,246,0.13)",  ring: "#8B5CF6", pulse: "rgba(139,92,246,0.35)"  },
  paused:         { border: "#94A3B8", glow: "rgba(148,163,184,0.18)", badge: "#94A3B8", badgeBg: "rgba(148,163,184,0.12)", ring: "#94A3B8", pulse: "rgba(148,163,184,0.25)" },
  monitoring:     { border: "rgba(100,116,139,0.3)", glow: "rgba(100,116,139,0.08)", badge: "#64748B", badgeBg: "rgba(100,116,139,0.1)", ring: "#64748B", pulse: "rgba(100,116,139,0.2)" },
  idle:           { border: "rgba(100,116,139,0.2)", glow: "rgba(100,116,139,0.05)", badge: "#94A3B8", badgeBg: "rgba(100,116,139,0.08)", ring: "#94A3B8", pulse: "rgba(100,116,139,0.15)" },
};

const ACTIVITY_COLOURS: Record<string, string> = {
  document: "#22D3EE", lifecycle_init: "#6366F1", proactive_alert: "#F59E0B",
  approval: "#10B981", risk: "#EF4444", chat: "#8B5CF6", cost_planning: "#F59E0B",
};
const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  document: <FileText size={9} />, lifecycle_init: <Zap size={9} />,
  proactive_alert: <AlertCircle size={9} />, approval: <CheckCircle2 size={9} />,
  risk: <AlertCircle size={9} />, chat: <Activity size={9} />,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5)   return "just now";
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function activityAt(a: RawActivity): string {
  return a.date ?? a.createdAt ?? new Date().toISOString();
}

function deriveState(
  agentDeployed: boolean,
  pendingCount: number,
  totalArtefacts: number,
  activities: RawActivity[],
  hasActiveSession: boolean,
  phaseStatus?: string | null,
  canAdvance?: boolean,
  hasCompletionData?: boolean,
  agentStatus?: string | null,
): AgentState {
  if (!agentDeployed) return "idle";

  // PAUSED is an explicit user action and overrides everything else — we
  // never want to show "Monitoring · everything is under control" when the
  // user has actively stopped the agent.
  if (agentStatus === "PAUSED") return "paused";

  // hasActiveSession is the LIVE source of truth — phaseStatus can lag if the
  // deployment column update missed (recovered on next pipeline fetch via
  // self-heal). Always trust the active session presence first.
  if (phaseStatus === "blocked_tasks_incomplete") return "blocked_by_tasks";
  if (hasActiveSession) return "questions_waiting";
  // Only fall back to phaseStatus when there's no active session — and only if
  // it's a definitive non-clarification status. A stale "awaiting_clarification"
  // with no live session means the user just finished answering and the
  // server-side phaseStatus update is in flight; show the next state instead
  // of a misleading "Questions waiting".
  if (phaseStatus === "researching") return "generating"; // research pulses too
  if (phaseStatus === "pending_approval" || phaseStatus === "waiting_approval") return "review";

  // Fallback signals when phaseStatus is "active" or unset
  const fourMinAgo = Date.now() - 4 * 60 * 1000;
  const isGenerating = activities.some(
    a => (a.type === "document" || a.type === "lifecycle_init" || a.type === "decision") &&
         new Date(activityAt(a)).getTime() > fourMinAgo
  );
  if (isGenerating)           return "generating";
  if (pendingCount > 0)       return "review";
  if (totalArtefacts > 0) {
    // Don't claim "phase_complete" (which renders the green "Click Generate"
    // banner) when getPhaseCompletion says we cannot advance because PM tasks
    // or delivery tasks are still outstanding. Surface the blockers instead.
    if (hasCompletionData && canAdvance === false) return "blocked_by_tasks";
    return "phase_complete";
  }
  // No artefacts yet AND no active clarification session AND no recent
  // generating activity → the agent has just deployed and is preparing the
  // project context. "monitoring everything is under control" is a lie at
  // this stage; "setup" makes the actual state clear and tells the user
  // what's coming.
  return "setup";
}

/** Priority for auto-focus: lower = more urgent */
function statePriority(s: AgentState): number {
  return { questions_waiting: 0, review: 1, blocked_by_tasks: 2, generating: 3, phase_complete: 4, setup: 5, paused: 6, monitoring: 7, idle: 8 }[s] ?? 9;
}

function gradientColour(gradient: string | null | undefined): string {
  return gradient?.match(/#[0-9A-Fa-f]{6}/)?.[0] ?? "#6366F1";
}

/** Build the main commentary line from actual data */
function buildCommentary(slot: AgentSlot, _activityIdx: number): string {
  const { state, activities, pendingCount, currentPhase, nextPhase, projectName } = slot;
  const phase = currentPhase ?? "current";
  const next  = nextPhase ?? "next";

  // Only use activity summary text when it genuinely matches the current state.
  // Previously any recent activity (e.g. a stale monitoring summary) would be
  // quoted inside state-specific messages like "Writing X documents — '<stale text>'".
  const relevantTypes: Record<string, Set<string>> = {
    generating:     new Set(["document", "artefact_generated", "artefact", "lifecycle_init"]),
    review:         new Set(["document", "artefact_generated", "artefact"]),
    phase_complete: new Set(["approval", "document", "artefact_generated"]),
    monitoring:     new Set(["monitoring", "risk", "proactive_alert", "report", "decision"]),
  };
  const allowedTypes = relevantTypes[state] || new Set<string>();
  const relevantAct = activities.find((a) => allowedTypes.has(a.type));
  const recentEnough = relevantAct
    ? (Date.now() - new Date(activityAt(relevantAct)).getTime()) < 15 * 60_000 // 15 min
    : false;
  const actText = recentEnough ? relevantAct?.summary ?? null : null;

  switch (state) {
    case "questions_waiting":
      return `${slot.agentName} has questions that need your answers before documents can be generated — open Chat to respond`;

    case "generating":
      return actText
        ? `Writing ${phase} documents — ${actText.slice(0, 120)}`
        : `Writing ${phase} phase documents — ready in ~30–60 s`;

    case "review":
      return `${pendingCount} ${phase} document${pendingCount === 1 ? "" : "s"} ready for your review. Approve them to unlock ${next}.`;

    case "phase_complete":
      return `All ${phase} documents approved. Click Generate to start the ${next} phase.`;

    case "blocked_by_tasks": {
      // Read the truth from getPhaseCompletion's blockers — the only
      // canonical "why" source. Don't compose contradictory prefixes
      // like "All documents approved" because the blocker list often
      // includes "X artefacts not yet approved" — saying both reads as
      // a bug to the user.
      if (slot.blockers.length > 0) {
        const headline = slot.blockers.slice(0, 2).join(" · ");
        return `${phase} cannot advance to ${next} yet — ${headline}.`;
      }
      // Fallback when blockers haven't loaded yet
      const pm = `${slot.pmTasksDone}/${slot.pmTasksTotal} PM tasks`;
      const del = `${slot.deliveryDone}/${slot.deliveryTotal} delivery tasks`;
      return `${phase} blocked from advancing — ${pm}, ${del}.`;
    }

    case "setup":
      return phase
        ? `${slot.agentName} just deployed — about to research and ask clarification questions for the ${phase} phase. Sit tight or open Chat to nudge.`
        : `${slot.agentName} just deployed and is preparing the project context. The first clarification questions land in Chat shortly.`;

    case "paused":
      return `${slot.agentName} is paused — resume from the agent header to continue working on ${projectName}.`;

    case "monitoring":
      return actText
        ? `${actText.slice(0, 160)} — monitoring ${projectName}`
        : `Monitoring ${projectName} · everything is under control`;

    case "idle":
      return `No agent deployed on ${projectName}. Go to Fleet Overview to deploy one.`;
  }
}

/** Label shown in the coloured badge */
function badgeLabel(slot: AgentSlot): string {
  switch (slot.state) {
    case "questions_waiting": return "Questions waiting";
    case "review":         return `${slot.pendingCount} doc${slot.pendingCount === 1 ? "" : "s"} to review`;
    case "generating":     return "Writing…";
    case "phase_complete": return slot.nextPhase ? `Start ${slot.nextPhase}` : "All done";
    case "blocked_by_tasks": {
      const remainingPm = Math.max(0, slot.pmTasksTotal - slot.pmTasksDone);
      const remainingDel = Math.max(0, slot.deliveryTotal - slot.deliveryDone);
      if (remainingPm > 0 && remainingDel > 0) return `${remainingPm} PM + ${remainingDel} delivery to finish`;
      if (remainingPm > 0) return `${remainingPm} PM task${remainingPm === 1 ? "" : "s"} to finish`;
      if (remainingDel > 0) return `${remainingDel} delivery task${remainingDel === 1 ? "" : "s"} to finish`;
      return "Tasks blocking advance";
    }
    case "setup":          return "Just deployed";
    case "paused":         return "Paused";
    case "monitoring":     return "Monitoring";
    case "idle":           return "Not deployed";
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AgentStatusBar() {
  const { activeProjectId, sidebarCollapsed } = useAppStore();

  const [slots,        setSlots]        = useState<AgentSlot[]>([]);
  const [focusedIdx,   setFocusedIdx]   = useState(0);
  const [expanded,     setExpanded]     = useState(false);
  const [dismissed,    setDismissed]    = useState(false);
  const [activityIdx,  setActivityIdx]  = useState(0);  // cycles commentary
  const [loading,      setLoading]      = useState(false);

  const prevStateRef     = useRef<AgentState | null>(null);
  const manualSwitchRef  = useRef<number>(0);   // timestamp of last manual switch

  // ── Fetch fleet + metrics ────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    try {
      // 1. Fleet overview — all agents, cross-agent activities, alerts
      const fleetRes  = await fetch("/api/agents");
      if (!fleetRes.ok) return;
      const fleetData = (await fleetRes.json())?.data;
      if (!fleetData) return;

      const rawAgents: any[] = fleetData.agents ?? [];
      const deployed = rawAgents.filter(a =>
        a.deployments?.length > 0 && a.status !== "DECOMMISSIONED"
      );
      if (deployed.length === 0) { setSlots([]); return; }

      // 2. For each deployed agent, fetch project metrics + clarification session in parallel (max 4)
      const capped = deployed.slice(0, 4);
      const [metricsResults, sessionResults] = await Promise.all([
        Promise.allSettled(
          capped.map(a => {
            const pid = a.deployments[0]?.project?.id;
            return pid
              ? fetch(`/api/projects/${pid}/metrics`).then(r => r.ok ? r.json() : null)
              : Promise.resolve(null);
          })
        ),
        Promise.allSettled(
          capped.map(a =>
            fetch(`/api/agents/${a.id}/clarification/session`)
              .then(r => r.ok ? r.json() : null)
              .catch(() => null)
          )
        ),
      ]);

      const built: AgentSlot[] = capped.map((agent, i) => {
        const dep     = agent.deployments[0];
        const pid     = dep?.project?.id ?? null;
        const pname   = dep?.project?.name ?? "Project";
        const mraw    = metricsResults[i].status === "fulfilled" ? metricsResults[i].value : null;
        const m       = mraw?.data ?? mraw;
        const sraw    = sessionResults[i].status === "fulfilled" ? sessionResults[i].value : null;
        const hasActiveSession = !!(sraw?.data?.session);

        // Phases
        const phaseList: any[] = m?.phases?.list ?? [];
        const phases: PhaseInfo[] = phaseList.map((ph: any) => ({
          name:   ph.name ?? "Phase",
          status: ph.status === "COMPLETED" ? "completed"
                : ph.status === "ACTIVE"    ? "active"
                : "upcoming",
        }));
        const activePhaseIdx = phases.findIndex(p => p.status === "active");
        const currentPhase   = m?.phases?.current ?? phases.find(p => p.status === "active")?.name ?? null;
        const nextPhase      = activePhaseIdx >= 0 && activePhaseIdx < phases.length - 1
          ? phases[activePhaseIdx + 1].name : null;

        // Artefacts
        const arts         = m?.artefacts ?? [];
        const pendingCount = arts.filter((a: any) => a.status === "DRAFT" || a.status === "PENDING_REVIEW").length;
        const totalArtefacts = arts.length;

        // Activities — use agent's own activities from metrics, fall back to fleet feed filtered by agent
        const metricActivities: RawActivity[] = (m?.activities ?? []).map((a: any) => ({
          id:       a.id ?? String(Math.random()),
          type:     a.type,
          summary:  a.summary,
          date:     a.date ?? a.createdAt,
          createdAt: a.date ?? a.createdAt,
        }));
        const fleetActivities: RawActivity[] = (fleetData.activities ?? [])
          .filter((a: any) => a.agentName === agent.name)
          .map((a: any) => ({ id: a.id, type: a.type, summary: a.summary, createdAt: a.createdAt }));
        const activities = metricActivities.length > 0 ? metricActivities : fleetActivities;

        const phaseStatus = (dep as any)?.phaseStatus ?? null;
        // Current-phase completion data — drives the canAdvance / blockers banner
        const completion = m?.phases?.currentCompletion ?? null;
        const canAdvance = completion ? !!completion.canAdvance : undefined;
        const blockers: string[] = Array.isArray(completion?.blockers) ? completion.blockers : [];
        const pmTasksDone   = completion?.pmTasks?.done   ?? 0;
        const pmTasksTotal  = completion?.pmTasks?.total  ?? 0;
        const deliveryDone  = completion?.deliveryTasks?.done  ?? 0;
        const deliveryTotal = completion?.deliveryTasks?.total ?? 0;

        const state = deriveState(
          true,
          pendingCount,
          totalArtefacts,
          activities,
          hasActiveSession,
          phaseStatus,
          canAdvance,
          completion !== null,
          (agent as any).status ?? null,
        );

        return {
          agentId:       agent.id,
          agentName:     agent.name,
          agentGradient: agent.gradient ?? "",
          projectId:     pid ?? "",
          projectName:   pname,
          state,
          hasActiveSession,
          currentPhase,
          nextPhase,
          phases,
          pendingCount,
          totalArtefacts,
          canAdvance: canAdvance ?? true,
          blockers,
          pmTasksDone,
          pmTasksTotal,
          deliveryDone,
          deliveryTotal,
          activities,
        };
      });

      setSlots(built);

      // Auto-focus most urgent agent (unless user manually switched recently)
      const now = Date.now();
      if (now - manualSwitchRef.current > 60_000) {
        // Prefer active project if it has a slot
        const activeSlotIdx = activeProjectId
          ? built.findIndex(s => s.projectId === activeProjectId)
          : -1;
        const mostUrgentIdx = built.reduce((best, s, i) =>
          statePriority(s.state) < statePriority(built[best].state) ? i : best, 0
        );
        setFocusedIdx(activeSlotIdx >= 0 ? activeSlotIdx : mostUrgentIdx);
      }

      // Un-dismiss when state changes
      const focused = built[focusedIdx] ?? built[0];
      if (focused && prevStateRef.current !== null && prevStateRef.current !== focused.state) {
        setDismissed(false);
      }
      if (focused) prevStateRef.current = focused.state;

    } catch { /* non-critical */ }
    finally { setLoading(false); }
  }, [activeProjectId, focusedIdx]);

  // Initial fetch + polling
  useEffect(() => {
    setLoading(true);
    fetchAll();
    // 30s — tight enough that task completions, approvals and phase advances
    // reflect on the banner within half a minute. The metrics endpoint that
    // backs this is cheap (single Prisma round-trip + getPhaseCompletion).
    const iv = setInterval(fetchAll, 30_000);
    // Also refetch when the tab regains focus so coming back from another
    // tab doesn't show a 30s-stale banner.
    const onFocus = () => fetchAll();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(iv);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchAll]);

  // Re-dismiss on project change
  useEffect(() => { setDismissed(false); }, [activeProjectId]);

  // Cycle activity index for monitoring state (every 6 s)
  useEffect(() => {
    const slot = slots[focusedIdx];
    if (!slot || slot.state !== "monitoring" || slot.activities.length <= 1) return;
    const iv = setInterval(() => {
      setActivityIdx(i => (i + 1) % Math.min(slot.activities.length, 5));
    }, 6_000);
    return () => clearInterval(iv);
  }, [slots, focusedIdx]);

  // Reset cycle when switching agents
  useEffect(() => { setActivityIdx(0); }, [focusedIdx]);

  // ── Render guards ──────────────────────────────────────────────────────

  if (dismissed || slots.length === 0) return null;

  const slot       = slots[focusedIdx] ?? slots[0];
  const c          = COLOURS[slot.state];
  const agentColour = gradientColour(slot.agentGradient);
  const initial    = (slot.agentName?.[0] ?? "?").toUpperCase();
  const commentary = buildCommentary(slot, activityIdx);
  const label      = badgeLabel(slot);
  const sidebarW   = sidebarCollapsed ? 60 : 240;
  // Route the CTA based on what is actually blocking. PM tasks live on the
  // PM Tracker page; delivery tasks live on the Agile Board. If both are
  // blocking, prefer the bigger blocker (lower completion %). If neither
  // count is set, fall back to the artefacts page.
  const blockedTarget = (() => {
    if (!slot.projectId) return "/agents";
    const pmRemaining = Math.max(0, slot.pmTasksTotal - slot.pmTasksDone);
    const delRemaining = Math.max(0, slot.deliveryTotal - slot.deliveryDone);
    if (pmRemaining > 0 && delRemaining === 0) return `/projects/${slot.projectId}/pm-tracker`;
    if (delRemaining > 0 && pmRemaining === 0) return `/projects/${slot.projectId}/agile`;
    if (pmRemaining > 0 && delRemaining > 0) {
      // Both blocking — go to the bigger gap by % incomplete
      const pmPct  = slot.pmTasksTotal  > 0 ? slot.pmTasksDone  / slot.pmTasksTotal  : 1;
      const delPct = slot.deliveryTotal > 0 ? slot.deliveryDone / slot.deliveryTotal : 1;
      return delPct < pmPct
        ? `/projects/${slot.projectId}/agile`
        : `/projects/${slot.projectId}/pm-tracker`;
    }
    return `/projects/${slot.projectId}/artefacts`;
  })();
  const ctaHref    = slot.state === "questions_waiting"
    ? `/agents/chat?agent=${slot.agentId}`
    : slot.state === "blocked_by_tasks"
    ? blockedTarget
    : slot.projectId ? `/projects/${slot.projectId}/artefacts` : "/agents";

  // Other agents for switcher
  const otherSlots = slots.filter((_, i) => i !== focusedIdx);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed bottom-0 right-0 z-50 transition-[left] duration-300"
      style={{
        left:      sidebarW,
        borderTop: `2px solid ${c.border}`,
        boxShadow: `0 -4px 28px 0 ${c.glow}`,
      }}
    >

      {/* ── Expanded panel ──────────────────────────────────────────── */}
      {expanded && (
        <div
          className="w-full"
          style={{
            background:          "hsl(var(--background) / 0.98)",
            backdropFilter:      "blur(20px)",
            WebkitBackdropFilter:"blur(20px)",
            borderTop:           `1px solid ${c.border}22`,
          }}
        >
          <div className="max-w-screen-xl mx-auto px-5 py-4 flex gap-6 flex-wrap items-start">

            {/* Left — avatar + name + badge */}
            <div className="flex flex-col items-center gap-1.5 w-16 shrink-0">
              <AgentAvatar size={44} colour={agentColour} initial={initial} pulse={c.pulse} ring={c.ring} loading={loading} state={slot.state} />
              <span className="text-[11px] font-bold text-foreground text-center leading-tight">{slot.agentName}</span>
              <span className="text-[9px] text-muted-foreground text-center truncate w-full">{slot.projectName}</span>
              <StateBadge label={label} colour={c.badge} bg={c.badgeBg} state={slot.state} />
            </div>

            {/* Centre — commentary + phase pills */}
            <div className="flex-1 min-w-[180px] space-y-3">
              <blockquote
                className="text-[13px] leading-relaxed text-foreground/80 italic pl-3 m-0"
                style={{ borderLeft: `3px solid ${c.border}` }}
              >
                {commentary}
              </blockquote>

              {slot.phases.length > 0 && (
                <div className="flex items-center flex-wrap gap-1">
                  {slot.phases.map((ph, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <span
                        className="text-[9px] font-semibold px-2 py-0.5 rounded-full transition-all"
                        style={{
                          background: ph.status === "completed" ? "rgba(16,185,129,0.15)"
                                    : ph.status === "active"    ? `${c.badgeBg}`
                                    : "hsl(var(--muted)/0.5)",
                          color:      ph.status === "completed" ? "#10B981"
                                    : ph.status === "active"    ? c.badge
                                    : "hsl(var(--muted-foreground))",
                          boxShadow:  ph.status === "active" ? `0 0 0 1px ${c.border}55` : undefined,
                        }}
                      >
                        {ph.status === "completed" ? "✓ " : ""}{ph.name}
                      </span>
                      {i < slot.phases.length - 1 && <ArrowRight size={9} className="text-muted-foreground/30 shrink-0" />}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right — activity feed */}
            {slot.activities.length > 0 && (
              <div className="w-64 shrink-0 space-y-1.5">
                <p className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground mb-1">Recent Activity</p>
                {slot.activities.slice(0, 4).map((a, i) => {
                  const ac  = activityAt(a);
                  const col = ACTIVITY_COLOURS[a.type] ?? "#64748B";
                  const ico = ACTIVITY_ICONS[a.type] ?? <Activity size={9} />;
                  return (
                    <div key={a.id ?? i} className="flex items-start gap-2">
                      <div className="mt-0.5 shrink-0 w-[18px] h-[18px] rounded-full flex items-center justify-center"
                        style={{ background: `${col}22`, color: col }}>
                        {ico}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-foreground/80 leading-snug line-clamp-2">{a.summary}</p>
                        <p className="text-[9px] text-muted-foreground mt-0.5">{timeAgo(ac)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* All agents summary (if >1) */}
            {slots.length > 1 && (
              <div className="w-48 shrink-0 space-y-1">
                <p className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground mb-1">All Agents</p>
                {slots.map((s, i) => {
                  const sc = COLOURS[s.state];
                  const sc2 = gradientColour(s.agentGradient);
                  return (
                    <button key={s.agentId} onClick={() => { setFocusedIdx(i); manualSwitchRef.current = Date.now(); }}
                      className={cn("w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors",
                        i === focusedIdx ? "bg-muted/60" : "hover:bg-muted/40"
                      )}>
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                        style={{ background: sc2 }}>{s.agentName?.[0] ?? "?"}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-semibold truncate">{s.agentName}</p>
                        <p className="text-[9px] text-muted-foreground truncate">{s.projectName}</p>
                      </div>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: sc.badge }} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* CTA strip */}
          {(slot.state === "questions_waiting" || slot.state === "review" || slot.state === "phase_complete" || slot.state === "blocked_by_tasks") && (
            <div className="border-t px-5 py-2.5 flex items-center justify-between"
              style={{ borderColor: `${c.border}22`, background: `${c.badgeBg}` }}>
              <p className="text-[12px] font-medium" style={{ color: c.badge }}>
                {slot.state === "questions_waiting"
                  ? `${slot.agentName} needs your answers before it can generate documents — open Chat to respond`
                  : slot.state === "review"
                  ? `${slot.pendingCount} document${slot.pendingCount === 1 ? "" : "s"} need your approval before ${slot.agentName} can continue`
                  : slot.state === "blocked_by_tasks"
                  ? `${slot.currentPhase} cannot advance — ${slot.blockers.slice(0, 2).join(" · ") || `${slot.pmTasksDone}/${slot.pmTasksTotal} PM · ${slot.deliveryDone}/${slot.deliveryTotal} delivery tasks`}`
                  : `${slot.currentPhase} complete — ${slot.agentName} is ready to write ${slot.nextPhase ?? "next"} phase documents`}
              </p>
              <Link href={ctaHref} onClick={() => setExpanded(false)}
                className="flex items-center gap-1.5 text-[12px] font-bold px-4 py-1.5 rounded-lg border transition-colors"
                style={{ color: c.badge, borderColor: `${c.badge}44`, background: `${c.badge}11` }}>
                {slot.state === "questions_waiting"
                  ? "Open Chat"
                  : slot.state === "review"
                  ? "Review Documents"
                  : slot.state === "blocked_by_tasks"
                  ? (blockedTarget.endsWith("/pm-tracker") ? "Open PM Tracker"
                    : blockedTarget.endsWith("/agile")     ? "Open Agile Board"
                    : "Open Task Boards")
                  : `Generate ${slot.nextPhase ?? "Next Phase"}`}
                <ArrowRight size={12} />
              </Link>
            </div>
          )}
        </div>
      )}

      {/* ── Compact bar ─────────────────────────────────────────────── */}
      <div
        className="w-full flex items-center"
        style={{
          height:              56,
          background:          "hsl(var(--background) / 0.97)",
          backdropFilter:      "blur(20px)",
          WebkitBackdropFilter:"blur(20px)",
        }}
      >
        <div className="max-w-screen-xl mx-auto flex items-center gap-3 w-full px-4">

          {/* Agent avatar */}
          <AgentAvatar size={28} colour={agentColour} initial={initial} pulse={c.pulse} ring={c.ring} loading={loading} state={slot.state} />

          {/* Name + project */}
          <div className="hidden sm:flex flex-col leading-none">
            <span className="text-[12px] font-bold text-foreground">{slot.agentName}</span>
            <span className="text-[9px] text-muted-foreground mt-0.5">{slot.projectName}</span>
          </div>

          {/* Divider */}
          <div className="h-4 w-px bg-border/40 shrink-0 hidden sm:block" />

          {/* State badge */}
          <StateBadge label={label} colour={c.badge} bg={c.badgeBg} state={slot.state} />

          {/* Commentary — live, cycling */}
          <p className="text-[12.5px] text-foreground/70 flex-1 truncate min-w-0 hidden md:block leading-tight">
            {commentary}
          </p>

          {/* Phase dots */}
          {slot.phases.length > 0 && (
            <div className="items-center gap-1 shrink-0 hidden lg:flex" title="Phase progress">
              {slot.phases.map((ph, i) => (
                <span key={i} className="rounded-full transition-all duration-300"
                  title={ph.name}
                  style={{
                    display: "inline-block",
                    width:  ph.status === "active" ? 8 : 5,
                    height: ph.status === "active" ? 8 : 5,
                    background: ph.status === "upcoming" ? "hsl(var(--muted-foreground)/0.2)" : c.border,
                    boxShadow: ph.status === "active" ? `0 0 6px ${c.glow}` : undefined,
                  }} />
              ))}
            </div>
          )}

          {/* Last activity time */}
          {slot.activities[0] && (
            <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0 hidden xl:flex items-center gap-1">
              <Clock size={9} />
              {timeAgo(activityAt(slot.activities[0]))}
            </span>
          )}

          {/* ── Other-agent switcher dots ────────────────────────── */}
          {otherSlots.length > 0 && (
            <div className="flex items-center gap-1.5 shrink-0 hidden sm:flex">
              {otherSlots.map((s) => {
                const realIdx = slots.findIndex(sl => sl.agentId === s.agentId);
                const sc = COLOURS[s.state];
                const sc2 = gradientColour(s.agentGradient);
                return (
                  <button
                    key={s.agentId}
                    title={`${s.agentName} · ${s.projectName} · ${s.state}`}
                    onClick={() => { setFocusedIdx(realIdx); manualSwitchRef.current = Date.now(); setActivityIdx(0); }}
                    className="relative group flex items-center justify-center w-6 h-6 rounded-full transition-transform hover:scale-110"
                    style={{ background: sc2 }}
                  >
                    <span className="text-[9px] font-bold text-white">{s.agentName?.[0] ?? "?"}</span>
                    {/* Urgency dot */}
                    {(s.state === "questions_waiting" || s.state === "review") && (
                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-background"
                        style={{ background: sc.badge }} />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* CTA button */}
          {(slot.state === "questions_waiting" || slot.state === "review" || slot.state === "phase_complete" || slot.state === "blocked_by_tasks" || slot.state === "generating") && (
            <Link href={ctaHref}
              className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all whitespace-nowrap hover:opacity-90"
              style={{ color: c.badge, borderColor: `${c.badge}55`, background: c.badgeBg }}>
              {slot.state === "questions_waiting" && <MessageSquare size={11} />}
              {slot.state === "review"            && <AlertCircle size={11} />}
              {slot.state === "phase_complete"    && <Sparkles size={11} />}
              {slot.state === "blocked_by_tasks"  && <AlertCircle size={11} />}
              {slot.state === "generating"        && <ArrowRight size={11} />}
              {slot.state === "questions_waiting"
                ? "Answer Questions"
                : slot.state === "review"
                ? `Review ${slot.pendingCount}`
                : slot.state === "phase_complete"
                ? `Generate ${slot.nextPhase ?? "Next"}`
                : slot.state === "blocked_by_tasks"
                ? (blockedTarget.endsWith("/pm-tracker") ? "Open PM Tracker"
                  : blockedTarget.endsWith("/agile")     ? "Open Agile Board"
                  : "Finish Tasks")
                : "View Artefacts"}
            </Link>
          )}

          {/* Expand */}
          <button onClick={() => setExpanded(v => !v)}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
            {expanded ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>

          {/* Dismiss */}
          <button onClick={() => setDismissed(true)}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50 transition-colors">
            <X size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AgentAvatar({ size, colour, initial, pulse, ring, loading, state }: {
  size: number; colour: string; initial: string; pulse: string; ring: string; loading: boolean; state?: AgentState;
}) {
  const outer = size + 8;
  const fs    = Math.round(size * 0.44);
  // Only pulse/spin when the agent is actually active. Idle/monitoring = static.
  const activeStates: AgentState[] = ["generating", "questions_waiting", "review"];
  const isActive = state ? activeStates.includes(state) : false;
  const isWorking = state === "generating" || loading;
  return (
    <div className="relative shrink-0" style={{ width: outer, height: outer }}>
      {/* Conditional pulse ring — only when active */}
      {isActive && (
        <span className="absolute inset-0 rounded-full animate-ping"
          style={{ background: pulse, animationDuration: "2.5s" }} />
      )}
      {/* Static ring border */}
      <span className="absolute inset-0 rounded-full"
        style={{ boxShadow: `0 0 0 1.5px ${ring}` }} />
      {/* Spinning working ring — only when generating/loading */}
      {isWorking && (
        <span
          className="absolute inset-0 rounded-full"
          style={{
            border: `2px dashed ${ring}`,
            animation: "pipeline-spin 3s linear infinite",
          }}
        />
      )}
      <div className="absolute inset-[4px] rounded-full flex items-center justify-center font-bold text-white"
        style={{ background: colour, fontSize: fs, lineHeight: 1 }}>
        {loading
          ? <RefreshCw size={fs} className="animate-spin" style={{ color: "#fff" }} />
          : initial}
      </div>
    </div>
  );
}

function StateBadge({ label, colour, bg, state }: {
  label: string; colour: string; bg: string; state: AgentState;
}) {
  const ico: Record<AgentState, React.ReactNode> = {
    questions_waiting: <MessageSquare size={10} />,
    review:         <AlertCircle size={10} />,
    generating:     <RefreshCw size={10} className="animate-spin" />,
    phase_complete: <CheckCircle2 size={10} />,
    blocked_by_tasks: <AlertCircle size={10} />,
    setup:          <Rocket size={10} />,
    paused:         <Pause size={10} />,
    monitoring:     <Shield size={10} />,
    idle:           <Bot size={10} />,
  };
  // Add glow when actively working so the label stands out
  const activeStates: AgentState[] = ["generating", "questions_waiting", "review"];
  const isActive = activeStates.includes(state);
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap shrink-0"
      style={{
        color: colour,
        background: bg,
        boxShadow: isActive ? `0 0 10px ${bg}` : undefined,
        border: isActive ? `1px solid ${colour}55` : "1px solid transparent",
      }}
    >
      <span style={{ color: colour }}>{ico[state]}</span>
      {label}
    </span>
  );
}
