"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import {
  Bot,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ChevronUp,
  ChevronDown,
  ArrowRight,
  RefreshCw,
  X,
  Clock,
  Activity,
  FileText,
  Zap,
  Shield,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AgentState = "generating" | "review" | "phase_complete" | "monitoring" | "idle";

interface AgentActivity {
  id: string;
  type: "document" | "lifecycle_init" | "proactive_alert" | "approval" | "risk" | "chat" | string;
  summary: string;
  createdAt: string;
}

interface PhaseInfo {
  name: string;
  status: "completed" | "active" | "upcoming";
}

interface ProjectMetrics {
  totalArtefacts: number;
  pendingArtefacts: number;
  approvedArtefacts: number;
  currentPhase: string | null;
  nextPhase: string | null;
  phases: PhaseInfo[];
  recentActivities: AgentActivity[];
  agentName: string | null;
  agentDeployed: boolean;
  lastActivity: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

interface StateColours {
  border: string;
  glow: string;
  badge: string;
  badgeBg: string;
  ring: string;
  pulse: string;
  text: string;
}

const STATE_COLOURS: Record<AgentState, StateColours> = {
  review: {
    border: "#F59E0B",
    glow: "rgba(245,158,11,0.25)",
    badge: "#F59E0B",
    badgeBg: "rgba(245,158,11,0.15)",
    ring: "#F59E0B",
    pulse: "rgba(245,158,11,0.4)",
    text: "#F59E0B",
  },
  generating: {
    border: "#6366F1",
    glow: "rgba(99,102,241,0.25)",
    badge: "#6366F1",
    badgeBg: "rgba(99,102,241,0.15)",
    ring: "#6366F1",
    pulse: "rgba(99,102,241,0.4)",
    text: "#6366F1",
  },
  phase_complete: {
    border: "#10B981",
    glow: "rgba(16,185,129,0.25)",
    badge: "#10B981",
    badgeBg: "rgba(16,185,129,0.15)",
    ring: "#10B981",
    pulse: "rgba(16,185,129,0.4)",
    text: "#10B981",
  },
  monitoring: {
    border: "rgba(148,163,184,0.25)",
    glow: "rgba(148,163,184,0.08)",
    badge: "#94A3B8",
    badgeBg: "rgba(148,163,184,0.1)",
    ring: "#64748B",
    pulse: "rgba(100,116,139,0.3)",
    text: "#94A3B8",
  },
  idle: {
    border: "rgba(148,163,184,0.2)",
    glow: "rgba(148,163,184,0.06)",
    badge: "#94A3B8",
    badgeBg: "rgba(148,163,184,0.1)",
    ring: "#64748B",
    pulse: "rgba(100,116,139,0.2)",
    text: "#94A3B8",
  },
};

const STATE_LABELS: Record<AgentState, string> = {
  review: "Needs Review",
  generating: "Generating",
  phase_complete: "Phase Complete",
  monitoring: "Monitoring",
  idle: "Not Deployed",
};

const STATE_ICONS: Record<AgentState, React.ReactNode> = {
  review: <AlertCircle size={11} />,
  generating: <Sparkles size={11} />,
  phase_complete: <CheckCircle2 size={11} />,
  monitoring: <Shield size={11} />,
  idle: <Bot size={11} />,
};

const ACTIVITY_COLOURS: Record<string, string> = {
  document: "#22D3EE",
  lifecycle_init: "#6366F1",
  proactive_alert: "#F59E0B",
  approval: "#10B981",
  risk: "#EF4444",
  chat: "#6366F1",
};

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  document: <FileText size={10} />,
  lifecycle_init: <Zap size={10} />,
  proactive_alert: <AlertCircle size={10} />,
  approval: <CheckCircle2 size={10} />,
  risk: <AlertCircle size={10} />,
  chat: <Activity size={10} />,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function deriveState(metrics: ProjectMetrics): AgentState {
  if (!metrics.agentDeployed) return "idle";

  const recentActivities = metrics.recentActivities ?? [];
  const fourMinutesAgo = Date.now() - 4 * 60 * 1000;

  const isGenerating = recentActivities.some(
    (a) =>
      (a.type === "document" || a.type === "lifecycle_init") &&
      new Date(a.createdAt).getTime() > fourMinutesAgo
  );

  if (isGenerating) return "generating";
  if (metrics.pendingArtefacts > 0) return "review";
  if (metrics.totalArtefacts > 0) return "phase_complete";
  return "monitoring";
}

function buildCommentary(state: AgentState, metrics: ProjectMetrics): string {
  const phaseName = metrics.currentPhase ?? "current";
  const nextPhase = metrics.nextPhase ?? null;
  const pendingCount = metrics.pendingArtefacts;
  const lastActivity = metrics.lastActivity;

  switch (state) {
    case "generating":
      return `I'm writing your ${phaseName} phase documents right now — this usually takes 30–60 seconds. They'll appear automatically in Artefacts when ready.`;

    case "review":
      if (pendingCount > 1) {
        return `I've generated ${pendingCount} ${phaseName} documents and they're ready for your review. Open each one, read it, then approve it. Once all are approved I'll automatically start the ${nextPhase ?? "next"} phase.`;
      }
      return `I've generated 1 document that needs your sign-off before I can proceed. Open it in Artefacts, review it, and click Approve.`;

    case "phase_complete":
      if (nextPhase) {
        return `All ${phaseName} documents are approved — excellent work. I'm ready to start the ${nextPhase} phase whenever you are. Click 'Generate ${nextPhase} Phase' to continue.`;
      }
      return `Every project document has been reviewed and approved. Your complete document set is ready. The project is fully documented.`;

    case "monitoring":
      return `I'm actively monitoring your project in real time. ${
        lastActivity ? `Last action: ${lastActivity}.` : "Everything is under control."
      } I'll alert you immediately if anything needs your attention.`;

    case "idle":
      return `No agent is deployed on this project yet. Deploy one from Fleet Overview to begin generating documents, tracking risks, and managing your project automatically.`;
  }
}

// ---------------------------------------------------------------------------
// Default metrics
// ---------------------------------------------------------------------------

const DEFAULT_METRICS: ProjectMetrics = {
  totalArtefacts: 0,
  pendingArtefacts: 0,
  approvedArtefacts: 0,
  currentPhase: null,
  nextPhase: null,
  phases: [],
  recentActivities: [],
  agentName: null,
  agentDeployed: false,
  lastActivity: null,
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AgentStatusBar() {
  const { activeProjectId, sidebarCollapsed } = useAppStore();

  const [metrics, setMetrics] = useState<ProjectMetrics>(DEFAULT_METRICS);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(false);

  const prevStateRef = useRef<AgentState | null>(null);
  const prevProjectRef = useRef<string | null>(null);

  // Re-dismiss when project changes
  useEffect(() => {
    if (activeProjectId !== prevProjectRef.current) {
      setDismissed(false);
      prevProjectRef.current = activeProjectId;
    }
  }, [activeProjectId]);

  // Polling loop
  useEffect(() => {
    if (!activeProjectId) return;

    let cancelled = false;

    async function fetchData() {
      if (!activeProjectId) return;
      try {
        const [metricsRes, projectRes] = await Promise.all([
          fetch(`/api/projects/${activeProjectId}/metrics`),
          fetch(`/api/projects/${activeProjectId}`),
        ]);

        if (!metricsRes.ok || !projectRes.ok) return;

        const [metricsData, projectData] = await Promise.all([
          metricsRes.json(),
          projectRes.json(),
        ]);

        if (cancelled) return;

        // Support both { data: {...} } envelope and flat shapes
        const m = metricsData?.data ?? metricsData;
        const p = projectData?.data ?? projectData;

        // Build phases array from either shape
        const rawPhases: PhaseInfo[] = (m?.phases ?? p?.phases ?? []).map((ph: any) => ({
          name: ph.name ?? ph.phaseName ?? "Phase",
          status:
            ph.status === "COMPLETED" || ph.status === "completed"
              ? "completed"
              : ph.status === "ACTIVE" || ph.status === "active"
              ? "active"
              : "upcoming",
        }));

        // Activities
        const rawActivities: AgentActivity[] = (m?.activities ?? m?.recentActivities ?? []).map(
          (a: any): AgentActivity => ({
            id: a.id ?? String(Math.random()),
            type: a.type ?? "chat",
            summary: a.summary ?? a.description ?? "",
            createdAt: a.createdAt ?? a.created_at ?? new Date().toISOString(),
          })
        );

        const merged: ProjectMetrics = {
          totalArtefacts: m?.totalArtefacts ?? m?.artefacts?.length ?? 0,
          pendingArtefacts:
            m?.pendingArtefacts ??
            (m?.artefacts ?? []).filter(
              (a: any) => a.status === "DRAFT" || a.status === "PENDING_REVIEW"
            ).length,
          approvedArtefacts: m?.approvedArtefacts ?? 0,
          currentPhase:
            m?.currentPhase ??
            p?.currentPhase ??
            rawPhases.find((ph) => ph.status === "active")?.name ??
            null,
          nextPhase: m?.nextPhase ?? null,
          phases: rawPhases,
          recentActivities: rawActivities,
          agentName: p?.agentName ?? m?.agentName ?? p?.agents?.[0]?.agent?.name ?? null,
          agentDeployed:
            p?.agentDeployed ?? m?.agentDeployed ?? Boolean(p?.agents?.length) ?? false,
          lastActivity:
            m?.lastActivity ?? rawActivities[0]?.summary ?? null,
        };

        setMetrics(merged);

        // Un-dismiss if state changed
        const newState = deriveState(merged);
        if (prevStateRef.current !== null && prevStateRef.current !== newState) {
          setDismissed(false);
        }
        prevStateRef.current = newState;
      } catch {
        // Non-critical — bar silently retains last known state
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setLoading(true);
    fetchData();
    const interval = setInterval(fetchData, 20_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeProjectId]);

  if (!activeProjectId || dismissed) return null;

  const state = deriveState(metrics);
  const colours = STATE_COLOURS[state];
  const commentary = buildCommentary(state, metrics);
  const agentLabel = metrics.agentName ?? "PM Agent";
  const pendingCount = metrics.pendingArtefacts;
  const nextPhase = metrics.nextPhase;
  const artefactsHref = `/projects/${activeProjectId}/artefacts`;
  const sidebarW = sidebarCollapsed ? 60 : 240;

  return (
    <div
      className="fixed bottom-0 right-0 z-50 transition-[left] duration-300"
      style={{
        left: sidebarW,
        borderTop: `2px solid ${colours.border}`,
        boxShadow: `0 -6px 32px 0 ${colours.glow}, 0 -1px 0 0 ${colours.border}22`,
      }}
    >
      {/* ── Expanded panel ──────────────────────────────────────────────── */}
      {expanded && (
        <div
          className="w-full border-t px-5 py-4"
          style={{
            background: "hsl(var(--background) / 0.97)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            borderColor: `${colours.border}33`,
          }}
        >
          <div className="max-w-screen-xl mx-auto flex gap-6 flex-wrap items-start">
            {/* Left: avatar block */}
            <div className="flex flex-col items-center gap-2 w-[72px] shrink-0">
              <AvatarWithPulse size={40} colours={colours} loading={loading} />
              <span className="text-[11px] font-semibold text-foreground text-center leading-tight break-all">
                {agentLabel}
              </span>
              <StateBadge state={state} colours={colours} />
            </div>

            {/* Centre: blockquote + phases */}
            <div className="flex-1 min-w-[200px] flex flex-col gap-3">
              <blockquote
                className="text-[13px] italic leading-relaxed text-foreground/80 pl-3 py-1 m-0"
                style={{ borderLeft: `3px solid ${colours.border}` }}
              >
                {commentary}
              </blockquote>

              {metrics.phases.length > 0 && (
                <div className="flex items-center flex-wrap gap-1">
                  {metrics.phases.map((phase, i) => (
                    <div key={`${phase.name}-${i}`} className="flex items-center gap-1">
                      <PhasePill phase={phase} colours={colours} />
                      {i < metrics.phases.length - 1 && (
                        <ArrowRight size={10} className="text-muted-foreground/40 shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right: activity feed */}
            {metrics.recentActivities.length > 0 && (
              <div className="min-w-[200px] max-w-[280px] flex flex-col gap-1.5 shrink-0">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5 font-medium">
                  Recent Activity
                </p>
                {metrics.recentActivities.slice(0, 3).map((activity, i) => {
                  const dotColour = ACTIVITY_COLOURS[activity.type] ?? "#64748B";
                  const icon = ACTIVITY_ICONS[activity.type] ?? <Activity size={10} />;
                  return (
                    <div key={activity.id ?? i} className="flex items-start gap-2">
                      <div
                        className="mt-[3px] shrink-0 w-4 h-4 rounded-full flex items-center justify-center"
                        style={{ background: `${dotColour}22`, color: dotColour }}
                      >
                        {icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-foreground/80 leading-snug truncate">
                          {activity.summary}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {timeAgo(activity.createdAt)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Compact bar ─────────────────────────────────────────────────── */}
      <div
        className="w-full flex items-center"
        style={{
          height: 56,
          background: "hsl(var(--background) / 0.97)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        <div className="max-w-screen-xl mx-auto flex items-center gap-3 w-full px-4">
          {/* 1. Agent avatar */}
          <AvatarWithPulse size={28} colours={colours} loading={loading} />

          {/* 2. Agent name */}
          <span className="text-[12px] font-bold text-foreground leading-none whitespace-nowrap hidden sm:block">
            {agentLabel}
          </span>

          {/* 3. Vertical divider */}
          <div className="h-4 w-px bg-border/50 shrink-0 hidden sm:block" />

          {/* 4. State badge */}
          <StateBadge state={state} colours={colours} />

          {/* 5. Commentary text */}
          <p className="text-[13px] text-foreground/70 flex-1 truncate min-w-0 hidden md:block">
            {commentary}
          </p>

          {/* 6. Phase progress dots */}
          {metrics.phases.length > 0 && (
            <div className="items-center gap-1 shrink-0 hidden lg:flex">
              {metrics.phases.map((phase, i) => (
                <div
                  key={`dot-${i}`}
                  className="rounded-full transition-all duration-200"
                  title={phase.name}
                  style={{
                    width: phase.status === "active" ? 8 : 6,
                    height: phase.status === "active" ? 8 : 6,
                    background:
                      phase.status === "upcoming"
                        ? "hsl(var(--muted-foreground) / 0.25)"
                        : colours.border,
                    boxShadow:
                      phase.status === "active"
                        ? `0 0 6px ${colours.glow}`
                        : undefined,
                  }}
                />
              ))}
            </div>
          )}

          {/* 7. Last activity time */}
          {metrics.recentActivities[0] && (
            <div className="items-center gap-1 text-[11px] text-muted-foreground whitespace-nowrap shrink-0 hidden xl:flex">
              <Clock size={10} />
              <span>{timeAgo(metrics.recentActivities[0].createdAt)}</span>
            </div>
          )}

          {/* 8. CTA */}
          <CtaButton
            state={state}
            colours={colours}
            href={artefactsHref}
            pendingCount={pendingCount}
            nextPhase={nextPhase}
          />

          {/* 9. Expand chevron */}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label={expanded ? "Collapse agent status" : "Expand agent status"}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>

          {/* 10. Dismiss */}
          <button
            onClick={() => setDismissed(true)}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
            aria-label="Dismiss agent status bar"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AvatarWithPulse({
  size,
  colours,
  loading,
}: {
  size: number;
  colours: StateColours;
  loading: boolean;
}) {
  const outer = size + 8;
  return (
    <div className="relative shrink-0" style={{ width: outer, height: outer }}>
      {/* Animated ping ring */}
      <span
        className="absolute inset-0 rounded-full animate-ping"
        style={{
          background: colours.pulse,
          animationDuration: "2s",
        }}
      />
      {/* Static ring */}
      <span
        className="absolute inset-0 rounded-full"
        style={{ boxShadow: `0 0 0 2px ${colours.ring}` }}
      />
      {/* Avatar circle */}
      <div
        className="absolute inset-[4px] rounded-full flex items-center justify-center"
        style={{
          background: `linear-gradient(135deg, ${colours.badge}33, ${colours.badge}11)`,
          border: `1px solid ${colours.badge}44`,
        }}
      >
        {loading ? (
          <RefreshCw
            size={Math.round(size * 0.45)}
            style={{ color: colours.badge }}
            className="animate-spin"
          />
        ) : (
          <Bot size={Math.round(size * 0.45)} style={{ color: colours.badge }} />
        )}
      </div>
    </div>
  );
}

function StateBadge({
  state,
  colours,
}: {
  state: AgentState;
  colours: StateColours;
}) {
  return (
    <div
      className="flex items-center gap-1 px-2 py-1 rounded-full shrink-0"
      style={{
        background: colours.badgeBg,
        border: `1px solid ${colours.badge}44`,
        color: colours.badge,
      }}
    >
      {STATE_ICONS[state]}
      <span className="text-[11px] font-semibold leading-none whitespace-nowrap">
        {STATE_LABELS[state]}
      </span>
    </div>
  );
}

function PhasePill({
  phase,
  colours,
}: {
  phase: PhaseInfo;
  colours: StateColours;
}) {
  const isCompleted = phase.status === "completed";
  const isActive = phase.status === "active";

  return (
    <div
      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap"
      style={{
        background: isActive
          ? `${colours.badge}20`
          : isCompleted
          ? `${colours.badge}10`
          : "hsl(var(--muted) / 0.4)",
        border: isActive
          ? `1px solid ${colours.badge}66`
          : isCompleted
          ? `1px solid ${colours.badge}33`
          : "1px solid hsl(var(--border) / 0.3)",
        color: isActive
          ? colours.badge
          : isCompleted
          ? `${colours.badge}bb`
          : "hsl(var(--muted-foreground))",
      }}
    >
      {isCompleted && <CheckCircle2 size={9} />}
      <span>{phase.name}</span>
    </div>
  );
}

function CtaButton({
  state,
  colours,
  href,
  pendingCount,
  nextPhase,
}: {
  state: AgentState;
  colours: StateColours;
  href: string;
  pendingCount: number;
  nextPhase: string | null;
}) {
  if (state === "monitoring" || state === "idle") return null;

  let label: string;
  let variant: "solid" | "ghost";

  if (state === "review") {
    label = `Review ${pendingCount} Document${pendingCount !== 1 ? "s" : ""} →`;
    variant = "solid";
  } else if (state === "phase_complete") {
    label = nextPhase ? `Generate ${nextPhase} Phase →` : "View Artefacts →";
    variant = "solid";
  } else {
    // generating
    label = "View Artefacts →";
    variant = "ghost";
  }

  return (
    <Link
      href={href}
      className={cn(
        "shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all hover:brightness-110 whitespace-nowrap"
      )}
      style={
        variant === "solid"
          ? {
              background: colours.badge,
              color: "#fff",
              boxShadow: `0 2px 10px ${colours.glow}`,
            }
          : {
              background: "transparent",
              border: `1px solid ${colours.badge}`,
              color: colours.badge,
            }
      }
    >
      {label}
    </Link>
  );
}
