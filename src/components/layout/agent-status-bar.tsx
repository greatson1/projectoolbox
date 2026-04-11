"use client";

/**
 * AgentStatusBar — Global floating status strip.
 *
 * Fixed to the bottom of every dashboard page.
 * Polls the active project's metrics every 20 s and tells the user
 * exactly what the agent is doing and what they need to do next.
 */

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import {
  Bot, CheckCircle2, AlertCircle, Sparkles, ChevronUp,
  ChevronDown, ArrowRight, RefreshCw, X, Clock,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type BarState = "generating" | "review" | "phase_complete" | "monitoring" | "idle";

interface StatusData {
  state:          BarState;
  agentName:      string;
  agentColor:     string;
  agentInitial:   string;
  phaseName:      string;
  phaseNumber:    number;
  totalPhases:    number;
  nextPhaseName:  string | null;
  pendingCount:   number;
  lastActivity:   string | null;
  lastActivityAt: Date | null;
  projectId:      string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60)  return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ── Main component ───────────────────────────────────────────────────────────

export function AgentStatusBar() {
  const pathname = usePathname();
  const { activeProjectId, sidebarCollapsed } = useAppStore();

  const [status,    setStatus]    = useState<StatusData | null>(null);
  const [expanded,  setExpanded]  = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const prevStateRef = useRef<BarState | null>(null);

  // Re-show bar whenever state changes meaningfully
  useEffect(() => {
    if (status && status.state !== prevStateRef.current) {
      setDismissed(false);
      prevStateRef.current = status.state;
    }
  }, [status?.state]);

  // Reset dismissed when project changes
  useEffect(() => { setDismissed(false); }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) { setStatus(null); return; }

    const load = async () => {
      try {
        const [metricsRes, projectRes] = await Promise.all([
          fetch(`/api/projects/${activeProjectId}/metrics`).then(r => r.json()),
          fetch(`/api/projects/${activeProjectId}`).then(r => r.json()),
        ]);

        const m  = metricsRes?.data;
        const p  = projectRes?.data;
        if (!m || !p) return;

        // Agent info
        const agent       = m.deployment?.agent || p.agents?.[0]?.agent || null;
        const agentName   = agent?.name    || "Agent";
        const rawGrad     = agent?.gradient || "#6366f1";
        const agentColor  = rawGrad.match(/#[0-9A-Fa-f]{6}/)?.[0] || "#6366f1";
        const agentInitial = agentName[0].toUpperCase();

        // Phase info
        const phases     = p.phases || [];
        const activeIdx  = phases.findIndex((ph: any) => ph.status === "ACTIVE");
        const activePh   = activeIdx >= 0 ? phases[activeIdx] : phases[0] || null;
        const nextPh     = activeIdx >= 0 && activeIdx < phases.length - 1 ? phases[activeIdx + 1] : null;
        const phaseName  = activePh?.name  || "Pre-Project";
        const phaseNum   = activeIdx >= 0  ? activeIdx + 1 : 1;

        // Artefacts
        const arts         = m.artefacts || [];
        const pendingCount = arts.filter((a: any) =>
          a.status === "DRAFT" || a.status === "PENDING_REVIEW"
        ).length;
        const totalArts    = arts.length;

        // Most recent activity
        const activities    = m.activities || [];
        const lastAct       = activities[0] || null;
        const lastActivity  = lastAct?.summary || null;
        const lastActAt     = lastAct?.createdAt ? new Date(lastAct.createdAt) : null;

        // Detect "generating" — activity type document/lifecycle_init within last 4 min
        const isGenerating  = lastAct
          && (lastAct.type === "document" || lastAct.type === "lifecycle_init")
          && lastActAt
          && (Date.now() - lastActAt.getTime()) < 4 * 60 * 1000;

        // Determine bar state
        let state: BarState = "monitoring";
        if (isGenerating)                     state = "generating";
        else if (pendingCount > 0)            state = "review";
        else if (totalArts > 0 && pendingCount === 0) state = "phase_complete";
        else if (!agent)                      state = "idle";

        setStatus({
          state, agentName, agentColor, agentInitial,
          phaseName, phaseNumber: phaseNum,
          totalPhases: phases.length,
          nextPhaseName: nextPh?.name || null,
          pendingCount, lastActivity, lastActivityAt: lastActAt,
          projectId: activeProjectId,
        });
      } catch { /* silent — bar is non-critical */ }
    };

    load();
    const iv = setInterval(load, 20_000);
    return () => clearInterval(iv);
  }, [activeProjectId]);

  // Hide on sign-in / auth pages
  if (!activeProjectId || !status || dismissed) return null;

  const { state, agentName, agentColor, agentInitial,
          phaseName, phaseNumber, totalPhases, nextPhaseName,
          pendingCount, lastActivity, lastActivityAt, projectId } = status;

  const sidebarW = sidebarCollapsed ? 60 : 240;

  // ── Per-state config ────────────────────────────────────────────────────
  const CFG: Record<BarState, {
    border: string; bg: string; pulse: string;
    icon: React.ReactNode; label: string;
    headline: string; sub: string;
    ctaLabel: string | null; ctaHref: string | null;
  }> = {
    generating: {
      border: "border-primary/40",
      bg: "bg-card/95",
      pulse: "bg-primary animate-pulse",
      icon: <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" />,
      label: "Generating",
      headline: `Writing ${phaseName} documents…`,
      sub: "Your agent is generating phase documents. This takes 30–60 seconds — they will appear in Artefacts when ready.",
      ctaLabel: "View Artefacts",
      ctaHref: `/projects/${projectId}/artefacts`,
    },
    review: {
      border: "border-amber-500/40",
      bg: "bg-card/95",
      pulse: "bg-amber-500 animate-pulse",
      icon: <AlertCircle className="w-3.5 h-3.5 text-amber-500" />,
      label: "Action Required",
      headline: `${pendingCount} document${pendingCount === 1 ? "" : "s"} waiting for your review`,
      sub: `Open the Artefacts page, read each document, then click the green ✓ to approve. Once all are approved your agent will automatically generate the ${nextPhaseName ?? "next"} phase documents.`,
      ctaLabel: `Review ${pendingCount} Document${pendingCount === 1 ? "" : "s"} →`,
      ctaHref: `/projects/${projectId}/artefacts`,
    },
    phase_complete: {
      border: "border-emerald-500/40",
      bg: "bg-card/95",
      pulse: "bg-emerald-500",
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
      label: "Phase Complete",
      headline: nextPhaseName
        ? `${phaseName} approved — ready to start ${nextPhaseName}`
        : `All phases complete — full document set approved`,
      sub: nextPhaseName
        ? `All ${phaseName} documents are approved. Go to Artefacts and click "Generate ${nextPhaseName} Phase" to continue.`
        : "Every project phase is complete and approved. Well done.",
      ctaLabel: nextPhaseName ? `Generate ${nextPhaseName} Phase →` : null,
      ctaHref: nextPhaseName ? `/projects/${projectId}/artefacts` : null,
    },
    monitoring: {
      border: "border-border/60",
      bg: "bg-card/95",
      pulse: "bg-emerald-400",
      icon: <Bot className="w-3.5 h-3.5 text-muted-foreground" />,
      label: "Monitoring",
      headline: `Monitoring project health · ${phaseName}`,
      sub: lastActivity
        ? `Last action: ${lastActivity}`
        : "Agent is active and monitoring your project in the background.",
      ctaLabel: null,
      ctaHref: null,
    },
    idle: {
      border: "border-border/40",
      bg: "bg-card/95",
      pulse: "bg-muted-foreground/40",
      icon: <Bot className="w-3.5 h-3.5 text-muted-foreground" />,
      label: "Idle",
      headline: "No agent deployed on this project",
      sub: "Deploy an agent from the Fleet Overview to start generating documents and monitoring your project.",
      ctaLabel: "Deploy Agent →",
      ctaHref: "/agents/deploy",
    },
  };

  const cfg = CFG[state];

  return (
    <div
      className={cn(
        "fixed bottom-0 right-0 z-50 transition-all duration-300",
        `border-t ${cfg.border} ${cfg.bg} backdrop-blur-md shadow-lg`,
      )}
      style={{ left: sidebarW }}
    >
      {/* ── Compact bar (always visible) ─────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 h-12">

        {/* Agent avatar + pulse */}
        <div className="relative flex-shrink-0">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
            style={{ background: agentColor }}
          >
            {agentInitial}
          </div>
          <span className={cn("absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card", cfg.pulse)} />
        </div>

        {/* Agent name */}
        <span className="text-[12px] font-semibold text-foreground whitespace-nowrap hidden sm:block">
          {agentName}
        </span>

        {/* Divider */}
        <span className="text-border/60 hidden sm:block">|</span>

        {/* Status icon + label */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {cfg.icon}
          <span className={cn(
            "text-[11px] font-semibold whitespace-nowrap",
            state === "review"         ? "text-amber-500"
            : state === "phase_complete" ? "text-emerald-500"
            : state === "generating"     ? "text-primary"
            : "text-muted-foreground"
          )}>
            {cfg.label}
          </span>
        </div>

        {/* Headline */}
        <span className="text-[12px] text-foreground/80 truncate flex-1 min-w-0">
          {cfg.headline}
        </span>

        {/* Phase pill */}
        {totalPhases > 0 && (
          <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">
            <Clock className="w-2.5 h-2.5" />
            {phaseName} {totalPhases > 1 && `· ${phaseNumber}/${totalPhases}`}
          </span>
        )}

        {/* Last activity time */}
        {lastActivityAt && state === "monitoring" && (
          <span className="hidden lg:block text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
            {timeAgo(lastActivityAt)}
          </span>
        )}

        {/* CTA */}
        {cfg.ctaLabel && cfg.ctaHref && (
          <Link
            href={cfg.ctaHref}
            className={cn(
              "flex-shrink-0 flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap",
              state === "review"
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 border border-amber-500/30"
                : state === "phase_complete"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30"
                : "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30"
            )}
          >
            {state === "review" && <AlertCircle className="w-3 h-3" />}
            {state === "phase_complete" && <Sparkles className="w-3 h-3" />}
            {state === "generating" && <ArrowRight className="w-3 h-3" />}
            {cfg.ctaLabel}
          </Link>
        )}

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted/40 text-muted-foreground hover:text-foreground transition-colors"
          title={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>

        {/* Dismiss */}
        <button
          onClick={() => setDismissed(true)}
          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted/40 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          title="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Expanded detail panel ─────────────────────────────────────── */}
      {expanded && (
        <div className={cn("border-t px-5 py-4", cfg.border)}>
          <div className="flex items-start gap-4 max-w-3xl">

            {/* Big agent avatar */}
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
              style={{ background: agentColor }}
            >
              {agentInitial}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold mb-0.5">{cfg.headline}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{cfg.sub}</p>

              {/* Phase progress pills */}
              {totalPhases > 0 && (
                <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                  {Array.from({ length: totalPhases }).map((_, i) => {
                    const isDone    = i < phaseNumber - 1;
                    const isActive  = i === phaseNumber - 1;
                    return (
                      <div key={i} className="flex items-center gap-1">
                        <div className={cn(
                          "text-[9px] font-semibold px-2 py-0.5 rounded-full",
                          isDone   ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : isActive ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                          : "bg-muted text-muted-foreground"
                        )}>
                          {isDone && "✓ "}
                          Phase {i + 1}
                        </div>
                        {i < totalPhases - 1 && (
                          <ArrowRight className="w-2.5 h-2.5 text-muted-foreground/30" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* CTA in expanded view */}
            {cfg.ctaLabel && cfg.ctaHref && (
              <Link
                href={cfg.ctaHref}
                onClick={() => setExpanded(false)}
                className={cn(
                  "flex-shrink-0 flex items-center gap-1.5 text-[12px] font-semibold px-4 py-2 rounded-lg border transition-colors",
                  state === "review"
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 border-amber-500/30"
                    : state === "phase_complete"
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 border-emerald-500/30"
                    : "bg-primary/10 text-primary hover:bg-primary/20 border-primary/30"
                )}
              >
                {cfg.ctaLabel}
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
