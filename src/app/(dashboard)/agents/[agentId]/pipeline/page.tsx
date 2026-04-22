"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
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
  0%, 100% { box-shadow: 0 0 8px 0 rgba(239,68,68,0.3); }
  50% { box-shadow: 0 0 18px 4px rgba(239,68,68,0.2); }
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
  onClick,
}: {
  step: PipelineStep;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const colors = statusColor(step.status);
  const Icon = getStepIcon(step);

  return (
    <button
      onClick={onClick}
      className={cn(
        "pipeline-step-enter relative flex flex-col items-center gap-2 rounded-xl border-2 p-3 w-[140px] min-w-[140px] cursor-pointer transition-all duration-200",
        colors.border,
        colors.bg,
        isSelected && "ring-2 ring-primary/50 scale-[1.03]",
        step.status === "waiting" && "opacity-50",
      )}
      style={{
        animationDelay: `${index * 60}ms`,
        animationName: colors.glow || undefined,
        animationDuration: colors.glow ? "2s" : undefined,
        animationIterationCount: colors.glow ? "infinite" : undefined,
      }}
    >
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

      {/* Detail snippet */}
      {step.details && step.status !== "waiting" && (
        <span className="text-[10px] text-muted-foreground text-center leading-tight line-clamp-2 px-1">
          {step.details}
        </span>
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
        <Card>
          <CardContent className="py-6">
            <div className="flex items-center justify-between mb-4 px-1">
              <div>
                <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {data.currentPhase ? `${data.currentPhase} Phase` : "Current Phase"} — Step by Step
                </h2>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                  Steps marked <RotateCcw className="w-2.5 h-2.5 inline text-indigo-500" /> repeat for each phase
                </p>
              </div>
              {data.currentPhase && (
                <span className="text-[10px] px-2 py-1 rounded-full bg-primary/10 text-primary font-semibold">
                  {data.phaseStatus === "blocked_tasks_incomplete" ? "⛔ BLOCKED" : data.phaseStatus?.replace("_", " ").toUpperCase()}
                </span>
              )}
            </div>
            <div className="flex items-start overflow-x-auto pb-4 gap-0">
              {data.steps.map((step, i) => (
                <React.Fragment key={step.id}>
                  <StepCard
                    step={step}
                    index={i}
                    isSelected={selectedStepId === step.id}
                    onClick={() =>
                      setSelectedStepId(
                        selectedStepId === step.id ? null : step.id,
                      )
                    }
                  />
                  {i < data.steps.length - 1 && (
                    <Connector
                      fromStatus={step.status}
                      toStatus={data.steps[i + 1].status}
                    />
                  )}
                </React.Fragment>
              ))}
            </div>
          </CardContent>
        </Card>

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
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/agents/${data.agentId}/phase-completion`, { method: "POST" });
                    const json = await res.json();
                    if (json.data?.advanced) {
                      window.location.reload();
                    } else {
                      alert(json.message || "Still blocked — complete outstanding items first.");
                    }
                  } catch {
                    alert("Failed to re-check. Please try again.");
                  }
                }}
                className="px-3 py-2 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 transition-colors flex items-center gap-1.5 flex-shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Re-check & Advance
              </button>
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
