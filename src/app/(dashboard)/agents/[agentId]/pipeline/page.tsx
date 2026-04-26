"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Rocket,
  Microscope,
  MessageSquare,
  FileText,
  Eye,
  CheckCircle2,
  Shield,
  ArrowRight,
  RefreshCw,
  Clock,
  XCircle,
  Minus,
  Circle,
  Loader2,
  ChevronRight,
  X,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type StepStatus = "done" | "running" | "failed" | "skipped" | "waiting";

interface PipelineStep {
  id: string;
  label: string;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  duration?: number;
  error?: string;
  details?: string;
  canRetry?: boolean;
  cycles?: boolean; // true if this step repeats per phase
}

interface Phase {
  name: string;
  status: string;
  order: number;
  artefactsDone?: number;
  artefactsTotal?: number;
  pmTasksDone?: number;
  pmTasksTotal?: number;
  deliveryTasksDone?: number;
  deliveryTasksTotal?: number;
  overallPct?: number;
  canAdvance?: boolean;
  blockers?: string[];
}

interface PipelineData {
  agentId: string;
  agentName: string;
  projectId?: string;
  projectName: string;
  currentPhase: string;
  phaseStatus: string;
  phases: Phase[];
  steps: PipelineStep[];
  overallProgress: number;
  stuckAt?: string;
  lastActivity?: string;
}

/* ------------------------------------------------------------------ */
/*  Icon map                                                           */
/* ------------------------------------------------------------------ */

// Icon keyed by step.id (not label — labels now have phase prefix)
const STEP_ICONS_BY_ID: Record<string, React.ElementType> = {
  deploy: Rocket,
  research: Microscope,
  clarify: MessageSquare,
  generate: FileText,
  review: Eye,
  delivery: CheckCircle2,
  kb_check: Shield,
  gate: Shield,
  advance: ArrowRight,
};

function getStepIcon(stepOrLabel: string | PipelineStep) {
  if (typeof stepOrLabel === "object") {
    return STEP_ICONS_BY_ID[stepOrLabel.id] || Circle;
  }
  // Legacy fallback: try to match keyword in label
  const lower = stepOrLabel.toLowerCase();
  if (lower.includes("deploy")) return Rocket;
  if (lower.includes("research")) return Microscope;
  if (lower.includes("clarif")) return MessageSquare;
  if (lower.includes("generate")) return FileText;
  if (lower.includes("review") || lower.includes("approve")) return Eye;
  if (lower.includes("delivery")) return CheckCircle2;
  if (lower.includes("kb")) return Shield;
  if (lower.includes("gate")) return Shield;
  if (lower.includes("advance")) return ArrowRight;
  return Circle;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDuration(seconds?: number): string {
  if (seconds == null) return "\u2014";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function relativeTime(iso?: string): string {
  if (!iso) return "\u2014";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/* ------------------------------------------------------------------ */
/*  CSS Animations (injected once via <style>)                         */
/* ------------------------------------------------------------------ */

const PIPELINE_STYLES = `
@keyframes pipeline-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(99,102,241,0.4); }
  50% { box-shadow: 0 0 20px 4px rgba(99,102,241,0.25); }
}
@keyframes pipeline-glow-red {
  0%, 100% { box-shadow: 0 0 12px 2px rgba(239,68,68,0.45); }
  50% { box-shadow: 0 0 26px 6px rgba(239,68,68,0.35); }
}
@keyframes pipeline-pulse-soft {
  0%, 100% { transform: translate(-50%, 0) scale(1); }
  50% { transform: translate(-50%, -2px) scale(1.05); }
}
@keyframes pipeline-pulse-soft-2 {
  0%, 100% { background-color: rgb(239,68,68); }
  50% { background-color: rgb(220,38,38); }
}
@keyframes pipeline-dash {
  to { stroke-dashoffset: -20; }
}
@keyframes pipeline-spin {
  to { transform: rotate(360deg); }
}
@keyframes pipeline-fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes pipeline-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}
@keyframes pipeline-ping {
  0% { transform: scale(1); opacity: 1; }
  75%, 100% { transform: scale(2.5); opacity: 0; }
}
.pipeline-step-enter {
  animation: pipeline-fade-in 0.3s ease-out both;
}
`;

/* ------------------------------------------------------------------ */
/*  Status helpers                                                     */
/* ------------------------------------------------------------------ */

function statusColor(status: StepStatus) {
  switch (status) {
    case "done":
      return {
        border: "border-emerald-500/60",
        bg: "bg-emerald-500/10",
        text: "text-emerald-400",
        glow: "",
      };
    case "running":
      return {
        border: "border-blue-500/60",
        bg: "bg-blue-500/10",
        text: "text-blue-400",
        glow: "pipeline-pulse",
      };
    case "failed":
      return {
        border: "border-red-500/60",
        bg: "bg-red-500/10",
        text: "text-red-400",
        glow: "pipeline-glow-red",
      };
    case "skipped":
      return {
        border: "border-gray-500/40",
        bg: "bg-gray-500/5",
        text: "text-gray-400",
        glow: "",
      };
    case "waiting":
    default:
      return {
        border: "border-border/40",
        bg: "bg-card/40",
        text: "text-muted-foreground/40",
        glow: "",
      };
  }
}

function StatusIcon({ status, className }: { status: StepStatus; className?: string }) {
  const base = cn("w-4 h-4", className);
  switch (status) {
    case "done":
      return <CheckCircle2 className={cn(base, "text-emerald-400")} />;
    case "running":
      return (
        <Loader2
          className={cn(base, "text-blue-400")}
          style={{ animation: "pipeline-spin 1s linear infinite" }}
        />
      );
    case "failed":
      return <XCircle className={cn(base, "text-red-400")} />;
    case "skipped":
      return <Minus className={cn(base, "text-gray-400")} />;
    case "waiting":
    default:
      return <Circle className={cn(base, "text-muted-foreground opacity-40")} />;
  }
}

/* ------------------------------------------------------------------ */
/*  Connector SVG between step cards                                   */
/* ------------------------------------------------------------------ */

function Connector({ fromStatus, toStatus }: { fromStatus: StepStatus; toStatus: StepStatus }) {
  const isDone = fromStatus === "done" && toStatus !== "waiting";
  const isActive = fromStatus === "done" && toStatus === "running";
  const isFailed = fromStatus === "failed" || toStatus === "failed";

  let stroke = "#4b5563"; // gray-600
  let dashArray = "6 4";
  let animStyle: React.CSSProperties = {};

  if (isDone && !isActive) {
    stroke = "#10B981"; // emerald-500
    dashArray = "none";
  } else if (isActive) {
    stroke = "#6366F1"; // indigo-500
    dashArray = "8 6";
    animStyle = { animation: "pipeline-dash 0.8s linear infinite" };
  } else if (isFailed) {
    stroke = "#EF4444";
    dashArray = "none";
  }

  return (
    <svg
      width="40"
      height="4"
      className="flex-shrink-0 self-center mx-[-2px]"
      style={{ minWidth: 40 }}
    >
      <line
        x1="0"
        y1="2"
        x2="40"
        y2="2"
        stroke={stroke}
        strokeWidth="2"
        strokeDasharray={dashArray === "none" ? undefined : dashArray}
        style={animStyle}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Step Card                                                          */
/* ------------------------------------------------------------------ */

function StepCard({
  step,
  index,
  isSelected,
  isActiveBlocker,
  onClick,
}: {
  step: PipelineStep;
  index: number;
  isSelected: boolean;
  isActiveBlocker?: boolean;
  onClick: () => void;
}) {
  const colors = statusColor(step.status);
  const Icon = getStepIcon(step);

  return (
    <button
      onClick={onClick}
      className={cn(
        "pipeline-step-enter relative flex flex-col items-center gap-2 rounded-xl border-2 p-3 w-[140px] min-w-[140px] cursor-pointer transition-all duration-200",
        // Active blocker overrides normal status colours — thicker red ring +
        // brighter bg + slight scale lift so the eye lands on it immediately.
        // Extra top padding to make room for the inline "Action needed" banner.
        isActiveBlocker
          ? "border-red-500 bg-red-500/15 scale-[1.04] shadow-lg shadow-red-500/30 pt-7"
          : [colors.border, colors.bg],
        isSelected && !isActiveBlocker && "ring-2 ring-primary/50 scale-[1.03]",
        isSelected && isActiveBlocker && "ring-2 ring-red-500/40",
        // Done = subtle fade so the eye doesn't linger on completed work
        step.status === "done" && "opacity-85",
        // Non-blocker waiting steps fade hard so the active blocker pops more
        step.status === "waiting" && !isActiveBlocker && "opacity-40",
      )}
      style={{
        animationDelay: `${index * 60}ms`,
        // Active blocker pulses red regardless of internal step status; running
        // steps still get their blue glow when no blocker is active.
        animationName: isActiveBlocker ? "pipeline-glow-red" : (colors.glow || undefined),
        animationDuration: isActiveBlocker || colors.glow ? "1.6s" : undefined,
        animationIterationCount: isActiveBlocker || colors.glow ? "infinite" : undefined,
      }}
    >
      {/* "Action needed" banner — full-width at the TOP of the card so the
          parent's overflow-x-auto can't clip it like an externally-positioned
          badge would. Pulses softly so the eye lands on it across the strip. */}
      {isActiveBlocker && (
        <div
          className="absolute top-0 left-0 right-0 z-10 inline-flex items-center justify-center gap-1 py-1 text-[10px] font-bold uppercase tracking-wider bg-red-500 text-white whitespace-nowrap rounded-t-[10px]"
          style={{ animation: "pipeline-pulse-soft-2 1.4s ease-in-out infinite" }}
        >
          <AlertTriangle className="size-3" />
          Action needed
        </div>
      )}
      {/* Cycle indicator (top-right corner) */}
      {step.cycles && (
        <div
          className="absolute top-1.5 right-1.5 text-[9px] font-bold text-indigo-500/80 flex items-center gap-0.5"
          title="Repeats per phase"
        >
          <RotateCcw className="w-2.5 h-2.5" />
        </div>
      )}

      {/* Icon */}
      <div
        className={cn(
          "flex items-center justify-center w-10 h-10 rounded-lg",
          step.status === "done" && "bg-emerald-500/20",
          step.status === "running" && "bg-blue-500/20",
          step.status === "failed" && "bg-red-500/20",
          step.status === "skipped" && "bg-gray-500/10",
          step.status === "waiting" && "bg-muted/30",
        )}
      >
        <Icon className={cn("w-5 h-5", colors.text)} />
      </div>

      {/* Label */}
      <span className="text-xs font-semibold text-foreground leading-tight text-center">
        {step.label}
      </span>

      {/* Status */}
      <StatusIcon status={step.status} />

      {/* Duration */}
      <span className="text-[10px] text-muted-foreground tabular-nums">
        {formatDuration(step.duration)}
      </span>

      {/* Detail snippet — clickable for research step (link to KB) */}
      {step.details && step.status !== "waiting" && (
        step.id === "research" && step.status === "done" ? (
          <Link
            href="/knowledge"
            className="text-[10px] text-primary text-center leading-tight line-clamp-2 px-1 underline decoration-dotted hover:text-primary/80"
            onClick={(e) => e.stopPropagation()}
          >
            {step.details} →
          </Link>
        ) : (
          <span className="text-[10px] text-muted-foreground text-center leading-tight line-clamp-2 px-1">
            {step.details}
          </span>
        )
      )}

      {/* Error snippet */}
      {step.error && (
        <span className="text-[10px] text-red-400 text-center leading-tight line-clamp-2 px-1 mt-1">
          {step.error}
        </span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Step Detail Panel                                                  */
/* ------------------------------------------------------------------ */

function StepDetailPanel({
  step,
  onClose,
  onRetry,
}: {
  step: PipelineStep;
  onClose: () => void;
  onRetry: (stepId: string) => void;
}) {
  const colors = statusColor(step.status);

  return (
    <Card className={cn("border-2", colors.border)}>
      <CardContent className="pt-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <StatusIcon status={step.status} className="w-5 h-5" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">{step.label}</h3>
              <span className={cn("text-xs font-medium capitalize", colors.text)}>
                {step.status}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Timestamps */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-muted-foreground">Started</span>
            <p className="text-foreground font-medium mt-0.5">
              {step.startedAt
                ? new Date(step.startedAt).toLocaleString()
                : "\u2014"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Completed</span>
            <p className="text-foreground font-medium mt-0.5">
              {step.completedAt
                ? new Date(step.completedAt).toLocaleString()
                : "\u2014"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Duration</span>
            <p className="text-foreground font-medium mt-0.5">
              {formatDuration(step.duration)}
            </p>
          </div>
        </div>

        {/* Details */}
        {step.details && (
          <div>
            <span className="text-xs text-muted-foreground">Output</span>
            <p className="text-sm text-foreground mt-1 bg-muted/30 rounded-lg p-3 leading-relaxed">
              {step.details}
            </p>
          </div>
        )}

        {/* Error */}
        {step.error && (
          <div>
            <span className="text-xs text-red-400 font-medium">Error</span>
            <p className="text-sm text-red-300 mt-1 bg-red-500/10 border border-red-500/20 rounded-lg p-3 leading-relaxed font-mono">
              {step.error}
            </p>
          </div>
        )}

        {/* Retry */}
        {step.canRetry && step.status === "failed" && (
          <Button
            onClick={() => onRetry(step.id)}
            className="w-full"
            variant="outline"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Retry this step
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Phase bar                                                          */
/* ------------------------------------------------------------------ */

function PhaseBar({ phases }: { phases: Phase[] }) {
  const sorted = [...phases].sort((a, b) => a.order - b.order);

  function phaseBadge(status: string) {
    switch (status.toLowerCase()) {
      case "completed":
      case "done":
        return (
          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">
            COMPLETED
          </Badge>
        );
      case "active":
      case "running":
        return (
          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]">
            ACTIVE
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-muted-foreground text-[10px] opacity-50">
            PENDING
          </Badge>
        );
    }
  }

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2">
      {sorted.map((phase, i) => {
        const hasCompletion = (phase.artefactsTotal ?? 0) > 0 || (phase.pmTasksTotal ?? 0) > 0 || (phase.deliveryTasksTotal ?? 0) > 0;
        const isBlocked = phase.blockers && phase.blockers.length > 0 && phase.status?.toLowerCase() === "active";
        return (
          <React.Fragment key={phase.name}>
            <div className={`flex flex-col items-center gap-1.5 min-w-[140px] rounded-lg p-2 ${isBlocked ? "bg-amber-500/5 border border-amber-500/20" : ""}`}>
              <span className="text-xs font-medium text-foreground">{phase.name}</span>
              {phaseBadge(phase.status)}
              {hasCompletion && (
                <div className="w-full space-y-1 mt-1">
                  {/* Artefacts */}
                  <div className="flex items-center justify-between text-[9px]">
                    <span className="text-muted-foreground">Artefacts</span>
                    <span className="font-medium" style={{ color: (phase.artefactsDone ?? 0) >= (phase.artefactsTotal ?? 1) ? "#10B981" : "#6366F1" }}>
                      {phase.artefactsDone ?? 0}/{phase.artefactsTotal ?? 0}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-muted/50 overflow-hidden">
                    <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${phase.artefactsTotal ? (phase.artefactsDone! / phase.artefactsTotal) * 100 : 0}%` }} />
                  </div>
                  {/* PM Tasks */}
                  <div className="flex items-center justify-between text-[9px]">
                    <span className="text-muted-foreground">PM Tasks</span>
                    <span className="font-medium" style={{ color: (phase.pmTasksDone ?? 0) >= (phase.pmTasksTotal ?? 1) ? "#10B981" : "#8B5CF6" }}>
                      {phase.pmTasksDone ?? 0}/{phase.pmTasksTotal ?? 0}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-muted/50 overflow-hidden">
                    <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${phase.pmTasksTotal ? (phase.pmTasksDone! / phase.pmTasksTotal) * 100 : 0}%` }} />
                  </div>
                  {/* Delivery Tasks */}
                  <div className="flex items-center justify-between text-[9px]">
                    <span className="text-muted-foreground">Delivery</span>
                    <span className="font-medium" style={{ color: (phase.deliveryTasksDone ?? 0) >= (phase.deliveryTasksTotal ?? 1) ? "#10B981" : "#F59E0B" }}>
                      {phase.deliveryTasksDone ?? 0}/{phase.deliveryTasksTotal ?? 0}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-muted/50 overflow-hidden">
                    <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${phase.deliveryTasksTotal ? (phase.deliveryTasksDone! / phase.deliveryTasksTotal) * 100 : 0}%` }} />
                  </div>
                  {/* Overall */}
                  <div className="text-center mt-1">
                    <span className="text-[10px] font-bold" style={{ color: (phase.overallPct ?? 0) >= 80 ? "#10B981" : (phase.overallPct ?? 0) >= 50 ? "#F59E0B" : "#EF4444" }}>
                      {phase.overallPct ?? 0}%
                    </span>
                  </div>
                </div>
              )}
              {isBlocked && (
                <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 font-medium">BLOCKED</span>
              )}
              {/* Per-phase step indicators */}
              <div className="flex items-center gap-1 mt-1.5">
                {[
                  { label: "Research", done: (phase.artefactsTotal ?? 0) > 0 || phase.status === "COMPLETED" },
                  { label: "Generate", done: (phase.artefactsTotal ?? 0) > 0 },
                  { label: "Review", done: (phase.artefactsDone ?? 0) >= (phase.artefactsTotal ?? 1) && (phase.artefactsTotal ?? 0) > 0 },
                  { label: "Deliver", done: (phase.deliveryTasksDone ?? 0) >= ((phase.deliveryTasksTotal ?? 1) * 0.8) && (phase.deliveryTasksTotal ?? 0) > 0 },
                  { label: "Gate", done: phase.status === "COMPLETED" },
                ].map((step, si) => (
                  <div key={si} className="flex items-center gap-0.5" title={step.label}>
                    <div className={`w-2 h-2 rounded-full ${step.done ? "bg-emerald-500" : "bg-muted-foreground/20"}`} />
                    {si < 4 && <div className={`w-2 h-px ${step.done ? "bg-emerald-500/50" : "bg-muted-foreground/10"}`} />}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1 text-[7px] text-muted-foreground/50">
                <span>Rsch</span><span>Gen</span><span>Rev</span><span>Del</span><span>Gate</span>
              </div>
            </div>
            {i < sorted.length - 1 && (
              <ChevronRight className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                   */
/* ------------------------------------------------------------------ */

function PipelineSkeleton() {
  return (
    <div className="space-y-8 p-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-6 w-24" />
        <div className="ml-auto">
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
      <Skeleton className="h-3 w-full" />
      <div className="flex gap-4 overflow-x-auto">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="w-[140px] h-[180px] rounded-xl flex-shrink-0" />
        ))}
      </div>
      <div className="flex gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-[120px] rounded-lg" />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function AgentPipelinePage() {
  const params = useParams();
  const agentId = params.agentId as string;

  const [data, setData] = useState<PipelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPipeline = useCallback(
    async (showRefreshIndicator = false) => {
      if (showRefreshIndicator) setRefreshing(true);
      try {
        const res = await fetch(`/api/agents/${agentId}/pipeline`);
        if (!res.ok) throw new Error(`Failed to fetch pipeline (${res.status})`);
        const json = await res.json();
        setData(json.data);
        setError(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [agentId],
  );

  // Initial fetch + auto-refresh every 30s
  useEffect(() => {
    fetchPipeline();
    const interval = setInterval(() => fetchPipeline(), 30000);
    return () => clearInterval(interval);
  }, [fetchPipeline]);

  const handleRetry = useCallback(
    async (stepId: string) => {
      try {
        await fetch(`/api/agents/${agentId}/pipeline/retry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stepId }),
        });
        fetchPipeline(true);
      } catch {
        // silently fail, will refresh
      }
    },
    [agentId, fetchPipeline],
  );

  const selectedStep =
    data?.steps.find((s) => s.id === selectedStepId) ?? null;

  /* ---- Render ---- */

  if (loading) return <PipelineSkeleton />;

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <XCircle className="w-12 h-12 text-red-400" />
        <p className="text-sm text-muted-foreground">{error ?? "No pipeline data"}</p>
        <Button variant="outline" onClick={() => fetchPipeline()}>
          <RefreshCw className="w-4 h-4 mr-2" /> Retry
        </Button>
      </div>
    );
  }

  const progressPercent = Math.min(100, Math.max(0, data.overallProgress));

  // Determine the CURRENT step — the first step that isn't done/skipped/waiting
  // Priority: running > failed > first waiting after a done step
  const currentStep = (() => {
    const running = data.steps.find(s => s.status === "running");
    if (running) return running;
    const failed = data.steps.find(s => s.status === "failed");
    if (failed) return failed;
    // First waiting step after a done step
    for (let i = 0; i < data.steps.length; i++) {
      if (data.steps[i].status === "waiting" && i > 0 && data.steps[i - 1].status === "done") {
        return data.steps[i];
      }
    }
    return data.steps.find(s => s.status === "waiting");
  })();

  return (
    <>
      {/* Inject keyframe styles */}
      <style dangerouslySetInnerHTML={{ __html: PIPELINE_STYLES }} />

      <div className="space-y-8 p-4 md:p-6 max-w-[1400px] mx-auto">
        {/* ========== Top Header ========== */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-lg font-semibold text-foreground truncate">
                {data.agentName}
              </h1>
              <span className="text-muted-foreground">/</span>
              <span className="text-sm text-muted-foreground truncate">
                {data.projectName}
              </span>
              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
                {data.currentPhase}
              </Badge>
            </div>

            {/* Last activity */}
            <div className="flex items-center gap-1.5 mt-1.5">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Last activity: {relativeTime(data.lastActivity)}
              </span>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchPipeline(true)}
            disabled={refreshing}
          >
            <RefreshCw
              className={cn("w-4 h-4 mr-2", refreshing && "animate-spin")}
              style={refreshing ? { animation: "pipeline-spin 1s linear infinite" } : undefined}
            />
            Refresh
          </Button>
        </div>

        {/* ========== Currently On — clear "here's what's happening" banner ========== */}
        {currentStep && (() => {
          // Banner glow colour matches the step status so the pulse is visible
          // at a glance (blue=running, amber=waiting, red=failed).
          const bannerColour = currentStep.status === "failed" ? "#EF4444"
            : currentStep.status === "waiting" ? "#F59E0B"
            : "#3B82F6";
          return (
          <div
            className={cn(
              "flex items-center gap-4 px-5 py-4 rounded-xl border-2 relative overflow-hidden",
              currentStep.status === "running" && "border-blue-500/40 bg-blue-500/5",
              currentStep.status === "failed" && "border-red-500/40 bg-red-500/5",
              currentStep.status === "waiting" && "border-amber-500/30 bg-amber-500/5",
            )}
            style={{
              boxShadow: `0 0 0 1.5px ${bannerColour}33, 0 0 24px ${bannerColour}22`,
              animation: "pipeline-pulse 2.2s ease-in-out infinite",
            }}
          >
            {/* Top-edge shimmer to draw the eye */}
            <div
              className="absolute top-0 left-0 right-0 h-0.5 pointer-events-none"
              style={{
                background: `linear-gradient(90deg, transparent, ${bannerColour}, transparent)`,
                backgroundSize: "200% 100%",
                animation: "pipeline-shimmer 2.5s linear infinite",
              }}
            />
            <div className={cn(
              "w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0",
              currentStep.status === "running" && "bg-blue-500/20",
              currentStep.status === "failed" && "bg-red-500/20",
              currentStep.status === "waiting" && "bg-amber-500/20",
            )}
              style={{ animation: "pipeline-pulse 2.2s ease-in-out infinite" }}
            >
              {currentStep.status === "running" && (
                <RefreshCw className="w-6 h-6 text-blue-500" style={{ animation: "pipeline-spin 1.5s linear infinite" }} />
              )}
              {currentStep.status === "failed" && <X className="w-6 h-6 text-red-500" />}
              {currentStep.status === "waiting" && (
                <Clock className="w-6 h-6 text-amber-500" style={{ animation: "pipeline-pulse 1.6s ease-in-out infinite" }} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">
                {currentStep.status === "running" ? "Currently working on" :
                 currentStep.status === "failed" ? "Step failed" :
                 "Waiting for action"}
              </p>
              <p className="text-base font-bold text-foreground">{currentStep.label}</p>
              {currentStep.details && (
                <p className="text-xs text-muted-foreground mt-0.5">{currentStep.details}</p>
              )}
              {currentStep.error && (
                <p className="text-xs text-red-400 mt-0.5">{currentStep.error}</p>
              )}
            </div>
            {/* CTA: jump to the right page for whatever action is needed */}
            {(currentStep.id === "clarify" || currentStep.id === "clarification" || data.phaseStatus === "awaiting_clarification") && (
              <Link href={`/agents/chat?agent=${agentId}`}>
                <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white flex-shrink-0 font-semibold">
                  <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
                  Answer Questions in Chat <ArrowRight className="w-3 h-3 ml-1.5" />
                </Button>
              </Link>
            )}
            {currentStep.status === "waiting" && (currentStep.id === "approve" || currentStep.id === "review") && (
              <Link href={`/agents/${agentId}?tab=artefacts`}>
                <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white flex-shrink-0 font-semibold">
                  <Eye className="w-3.5 h-3.5 mr-1.5" />
                  Review Artefacts <ArrowRight className="w-3 h-3 ml-1.5" />
                </Button>
              </Link>
            )}
            {currentStep.id === "gate" && currentStep.status === "running" && (
              <div className="flex items-center gap-2 flex-shrink-0">
                {data.projectId && (
                  <Link href={`/projects/${data.projectId}/pm-tracker`}>
                    <Button size="sm" variant="outline" className="font-semibold">
                      <Shield className="w-3.5 h-3.5 mr-1.5" />
                      Review Prereqs
                    </Button>
                  </Link>
                )}
                <Link href="/approvals">
                  <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                    Approve Phase Gate <ArrowRight className="w-3 h-3 ml-1.5" />
                  </Button>
                </Link>
              </div>
            )}
            {data.phaseStatus === "blocked_tasks_incomplete" && data.projectId && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <Link href={`/projects/${data.projectId}/pm-tracker`}>
                  <Button size="sm" variant="outline" className="font-semibold">
                    <Shield className="w-3.5 h-3.5 mr-1.5" />
                    Open PM Tracker
                  </Button>
                </Link>
                <Link href={`/projects/${data.projectId}/agile`}>
                  <Button size="sm" className="bg-red-500 hover:bg-red-600 text-white font-semibold">
                    Complete Tasks <ArrowRight className="w-3 h-3 ml-1.5" />
                  </Button>
                </Link>
              </div>
            )}
          </div>
          );
        })()}

        {/* ========== Overall Progress Bar ========== */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Overall Progress
            </span>
            <span className="text-sm font-semibold text-foreground tabular-nums">
              {progressPercent}%
            </span>
          </div>
          <div className="relative h-2.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${progressPercent}%`,
                background:
                  progressPercent === 100
                    ? "linear-gradient(90deg, #10B981, #34D399)"
                    : "linear-gradient(90deg, #6366F1, #818CF8)",
              }}
            />
          </div>
        </div>

        {/* ========== Pipeline Steps (horizontal scroll) ========== */}
        {(() => {
          // Determine if phase is in an ACTIVE state — controls card-level pulse
          const ps = data.phaseStatus;
          // Any state that means "phase needs attention" — used to drive the
          // glow + shimmer on the pipeline card. Includes blocked_* statuses
          // because a blocked phase is the loudest possible "do something".
          const activeStates = [
            "researching",
            "awaiting_clarification",
            "active",
            "pending_approval",
            "waiting_approval",
            "blocked_tasks_incomplete",
            "blocked",
          ];
          const isActivePhase = ps ? activeStates.includes(ps) : false;
          const anyStepRunning = data.steps.some(s => s.status === "running");
          const anyStepWaiting = data.steps.some(s => s.status === "waiting" || s.status === "failed");
          const shouldPulse = isActivePhase || anyStepRunning || anyStepWaiting;
          // Border colour by phase state
          const borderColour = ps === "blocked_tasks_incomplete" ? "#EF4444"
            : ps === "researching" ? "#3B82F6"
            : ps === "awaiting_clarification" ? "#F59E0B"
            : ps === "pending_approval" || ps === "waiting_approval" ? "#F59E0B"
            : ps === "complete" ? "#10B981"
            : "#6366F1";

          return (
        <Card
          className="relative"
          style={{
            boxShadow: shouldPulse ? `0 0 0 1.5px ${borderColour}33, 0 0 28px ${borderColour}22` : undefined,
            animation: shouldPulse ? "pipeline-pulse 2.2s ease-in-out infinite" : undefined,
          }}
        >
          {/* Top-edge active marker bar */}
          {shouldPulse && (
            <div
              className="absolute top-0 left-0 right-0 h-0.5 rounded-t-xl"
              style={{
                background: `linear-gradient(90deg, transparent, ${borderColour}, transparent)`,
                backgroundSize: "200% 100%",
                animation: "pipeline-shimmer 2.5s linear infinite",
              }}
            />
          )}
          <CardContent className="py-6">
            <div className="flex items-center justify-between mb-4 px-1">
              <div>
                <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  {data.currentPhase ? `${data.currentPhase} Phase` : "Current Phase"} — Step by Step
                  {shouldPulse && (
                    <span
                      className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                      style={{ color: borderColour, background: `${borderColour}15` }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{
                          background: borderColour,
                          animation: "pipeline-ping 1.2s ease-out infinite",
                        }}
                      />
                      LIVE
                    </span>
                  )}
                </h2>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                  Steps marked <RotateCcw className="w-2.5 h-2.5 inline text-indigo-500" /> repeat for each phase
                </p>
              </div>
              {data.currentPhase && (() => {
                // phaseStatus is the PRIMARY source of truth — map it to a badge label.
                let displayStatus: string;
                let colorClass: string;
                const pulseClass = shouldPulse ? " animate-pulse" : "";
                if (ps === "blocked_tasks_incomplete") {
                  displayStatus = "⛔ BLOCKED"; colorClass = "bg-red-500/10 text-red-500";
                } else if (ps === "researching") {
                  displayStatus = "RESEARCHING"; colorClass = "bg-blue-500/10 text-blue-500";
                } else if (ps === "awaiting_clarification") {
                  displayStatus = "AWAITING CLARIFICATION"; colorClass = "bg-amber-500/10 text-amber-500";
                } else if (ps === "pending_approval" || ps === "waiting_approval") {
                  displayStatus = "AWAITING APPROVAL"; colorClass = "bg-amber-500/10 text-amber-500";
                } else if (ps === "complete") {
                  displayStatus = "COMPLETE"; colorClass = "bg-emerald-500/10 text-emerald-500";
                } else if (ps === "active") {
                  const generateStep = data.steps.find(s => s.id === "generate");
                  const reviewStep = data.steps.find(s => s.id === "review");
                  if (generateStep?.status === "running") {
                    displayStatus = "GENERATING"; colorClass = "bg-blue-500/10 text-blue-500";
                  } else if (reviewStep?.status === "running" || reviewStep?.status === "waiting") {
                    displayStatus = "REVIEWING"; colorClass = "bg-indigo-500/10 text-indigo-500";
                  } else {
                    displayStatus = "ACTIVE"; colorClass = "bg-primary/10 text-primary";
                  }
                } else {
                  displayStatus = (ps || "UNKNOWN").replace(/_/g, " ").toUpperCase();
                  colorClass = "bg-muted text-muted-foreground";
                }
                return (
                  <span className={cn("text-[10px] px-2 py-1 rounded-full font-semibold", colorClass, pulseClass)}>
                    {displayStatus}
                  </span>
                );
              })()}
            </div>

            {/* ── Active blockers strip — shown when canAdvance is false ── */}
            {(() => {
              const currentPhaseData = data.phases.find((p) => p.name === data.currentPhase);
              const activeBlockers = currentPhaseData?.blockers || [];
              if (activeBlockers.length === 0) return null;
              return (
                <div className="mb-4 mx-1 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-red-500">
                      Why this phase is blocked
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {activeBlockers.map((b, i) => (
                      <li key={i} className="text-[11px] text-foreground/80 leading-snug flex items-start gap-1.5">
                        <span className="text-red-500/60 mt-[1px]">•</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}

            <div className="flex items-start overflow-x-auto pb-4 gap-0">
              {/* Only show cycling steps in the per-phase carousel — one-off
                  steps like "Deploy Agent" belong to project init, not the
                  current phase, so they shouldn't show as the first card in
                  the "Design Phase — Step by Step" strip. */}
              {(() => {
                const cyclingSteps = data.steps.filter((s) => s.cycles);
                const activeBlockerIdx = cyclingSteps.findIndex(
                  (s) => s.status !== "done" && s.status !== "skipped",
                );
                // Steps that run in PARALLEL once Generate is done — these
                // are gate-prerequisites that don't need to happen in any
                // strict order (you can review artefacts while delivery
                // tasks complete and KB risk-check runs). Group them under
                // a single "GATE PREREQUISITES" lane so the visualisation
                // reflects reality, not a fake chain.
                const PARALLEL_IDS = new Set(["review", "delivery", "kb_check"]);
                const groups: Array<
                  | { kind: "single"; step: PipelineStep; idx: number }
                  | { kind: "parallel"; steps: Array<{ step: PipelineStep; idx: number }> }
                > = [];
                let buffer: Array<{ step: PipelineStep; idx: number }> = [];
                cyclingSteps.forEach((step, i) => {
                  if (PARALLEL_IDS.has(step.id)) {
                    buffer.push({ step, idx: i });
                  } else {
                    if (buffer.length > 0) {
                      groups.push({ kind: "parallel", steps: buffer });
                      buffer = [];
                    }
                    groups.push({ kind: "single", step, idx: i });
                  }
                });
                if (buffer.length > 0) groups.push({ kind: "parallel", steps: buffer });

                const renderStep = ({ step, idx }: { step: PipelineStep; idx: number }) => (
                  <StepCard
                    key={step.id}
                    step={step}
                    index={idx}
                    isSelected={selectedStepId === step.id}
                    isActiveBlocker={idx === activeBlockerIdx}
                    onClick={() =>
                      setSelectedStepId(
                        selectedStepId === step.id ? null : step.id,
                      )
                    }
                  />
                );

                return groups.map((g, gi) => {
                  const isLastGroup = gi === groups.length - 1;
                  if (g.kind === "single") {
                    const next = groups[gi + 1];
                    const nextFirstStatus = next
                      ? next.kind === "single"
                        ? next.step.status
                        : next.steps[0].step.status
                      : "waiting";
                    return (
                      <React.Fragment key={`g-${gi}`}>
                        {renderStep(g)}
                        {!isLastGroup && (
                          <Connector
                            fromStatus={g.step.status}
                            toStatus={nextFirstStatus}
                          />
                        )}
                      </React.Fragment>
                    );
                  }
                  // Parallel group — stacked vertically with a lane header
                  const groupHasActive = g.steps.some(s => s.idx === activeBlockerIdx);
                  const next = groups[gi + 1];
                  const nextFirstStatus = next
                    ? next.kind === "single"
                      ? next.step.status
                      : next.steps[0].step.status
                    : "waiting";
                  // Connector after the lane uses the worst-status step
                  const lastStep = g.steps[g.steps.length - 1].step;
                  return (
                    <React.Fragment key={`g-${gi}`}>
                      <div className="flex flex-col items-stretch gap-1.5 self-start">
                        <div
                          className={cn(
                            "text-[8px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md text-center mx-1",
                            groupHasActive
                              ? "bg-red-500/15 text-red-500"
                              : "bg-indigo-500/10 text-indigo-500/80",
                          )}
                          title="These steps run in parallel"
                        >
                          ⇉ Parallel · Gate Prerequisites
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {g.steps.map(renderStep)}
                        </div>
                      </div>
                      {!isLastGroup && (
                        <Connector
                          fromStatus={lastStep.status}
                          toStatus={nextFirstStatus}
                        />
                      )}
                    </React.Fragment>
                  );
                });
              })()}
            </div>
          </CardContent>
        </Card>
          );
        })()}

        {/* ========== Step Detail Panel (expandable below pipeline) ========== */}
        {selectedStep && (
          <div
            className="pipeline-step-enter"
            style={{ animationDelay: "0ms" }}
          >
            <StepDetailPanel
              step={selectedStep}
              onClose={() => setSelectedStepId(null)}
              onRetry={handleRetry}
            />
          </div>
        )}

        {/* ========== Phase Progress ========== */}
        {data.phases.length > 0 && (
          <Card>
            <CardContent className="py-5">
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">
                Project Phases
              </h2>
              <PhaseBar phases={data.phases} />
            </CardContent>
          </Card>
        )}

        {/* ========== Blocked Phase Banner ========== */}
        {data.phaseStatus === "blocked_tasks_incomplete" && (
          <div className="rounded-xl border-2 border-amber-500/30 bg-amber-500/5 px-5 py-4">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-bold text-amber-600">Phase advancement blocked</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  The phase gate has been approved, but outstanding tasks or KB blockers prevent advancement.
                  Complete the remaining items and click re-check.
                </p>
                {/* Show blockers from current phase */}
                {(() => {
                  const currentPhaseData = data.phases.find((p: Phase) => p.status === "ACTIVE");
                  if (!currentPhaseData?.blockers?.length) return null;
                  return (
                    <ul className="mt-2 space-y-1">
                      {currentPhaseData.blockers.map((b: string, i: number) => (
                        <li key={i} className="text-xs text-amber-600 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                          {b}
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {data.projectId && (
                  <Link href={`/projects/${data.projectId}/pm-tracker`}>
                    <button className="px-3 py-2 rounded-lg border border-amber-500/40 bg-card text-amber-600 dark:text-amber-400 text-xs font-semibold hover:bg-amber-500/10 transition-colors flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5" />
                      Open PM Tracker
                    </button>
                  </Link>
                )}
                <button
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/agents/${data.agentId}/phase-completion`, { method: "POST" });
                      const json = await res.json();
                      if (json.data?.advanced) {
                        toast.success(`Advanced to ${json.data.to || "next phase"}`, { duration: 3000 });
                        setTimeout(() => window.location.reload(), 800);
                      } else {
                        // Show the actual blocker list so the user knows what's left.
                        const blockers: string[] = json?.data?.completion?.blockers || [];
                        if (blockers.length > 0) {
                          const top = blockers.slice(0, 3).map((b: string) => `• ${b}`).join("\n");
                          const more = blockers.length > 3 ? `\n…and ${blockers.length - 3} more` : "";
                          toast.error(`Still blocked:\n${top}${more}`, {
                            duration: 8000,
                            description: data.projectId ? "Open the PM Tracker to resolve them." : undefined,
                          });
                        } else {
                          toast.error(json.message || "Still blocked — complete outstanding items first.");
                        }
                      }
                    } catch {
                      toast.error("Failed to re-check. Please try again.");
                    }
                  }}
                  className="px-3 py-2 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 transition-colors flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Re-check & Advance
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========== Stuck Warning ========== */}
        {data.stuckAt && (
          <div className="flex items-center gap-3 rounded-xl border-2 border-amber-500/40 bg-amber-500/5 px-4 py-3">
            <Shield className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <div>
              <span className="text-sm font-medium text-amber-300">
                Pipeline stalled
              </span>
              <p className="text-xs text-amber-400/80 mt-0.5">
                Stuck at: {data.stuckAt}
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
