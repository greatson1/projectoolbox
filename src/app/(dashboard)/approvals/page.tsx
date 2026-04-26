// @ts-nocheck
"use client";

import { usePageTitle } from "@/hooks/use-page-title";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useApprovals } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, X, MessageSquare, ChevronDown, Shield, Clock, AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { MLProbabilityBadge, useMLPrediction } from "@/components/ml/MLInsightBadge";
import { SentimentFeedback } from "@/components/ml/SentimentFeedback";

function ApprovalLikelihoodRow({ type, urgency, projectId }: { type: string; urgency?: string | null; projectId?: string }) {
  const { data } = useMLPrediction<any>("approval_likelihood", { type, urgency: urgency || undefined, projectId }, !!type);
  if (!data) return null;
  return (
    <MLProbabilityBadge
      label="P(approve)"
      probability={data.probability ?? 0}
      confidence={data.confidence ?? 0}
      reasoning={data.reasoning}
    />
  );
}

/**
 * Embedded prereq summary on PHASE_GATE approval cards. Reaches into the
 * phase-tracker API and shows whether every gate prerequisite is satisfied.
 * Stops the user from approving a gate when state still has open blockers
 * — the previous static recommendation copy claimed "all criteria met"
 * regardless of reality.
 */
function GatePrereqSummary({ projectId, phase }: { projectId?: string; phase?: string }) {
  const [prereqs, setPrereqs] = useState<any[] | null>(null);
  const [phaseObj, setPhaseObj] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) { setLoading(false); return; }
    fetch(`/api/projects/${projectId}/phase-tracker`)
      .then(r => r.json())
      .then(j => {
        const phases = j?.data?.phases || [];
        const target = phase
          ? phases.find((p: any) => p.name === phase) || phases.find((p: any) => p.isCurrent)
          : phases.find((p: any) => p.isCurrent);
        if (target) {
          setPhaseObj(target);
          setPrereqs(target.gate?.prerequisites || []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId, phase]);

  if (!projectId) return null;
  if (loading) return <p className="text-[11px] text-muted-foreground">Loading gate prerequisites…</p>;
  if (!prereqs || prereqs.length === 0) return null;

  const summary = phaseObj?.gate?.summary;
  const allMet = !!summary?.canAdvance;

  return (
    <div className={`mt-2 px-3 py-2 rounded-lg border ${allMet ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {phaseObj?.name} gate prerequisites
        </span>
        <span className={`text-[10px] font-semibold ${allMet ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
          {summary?.met}/{summary?.total} met
        </span>
      </div>
      <ul className="space-y-1">
        {prereqs.map((p: any, i: number) => {
          const tone =
            p.state === "met" ? "text-foreground/70 line-through"
            : p.state === "rejected" ? "text-red-600 dark:text-red-400"
            : p.state === "draft" ? "text-amber-600 dark:text-amber-400"
            : p.state === "manual" ? "text-blue-600 dark:text-blue-400"
            : "text-foreground";
          const icon =
            p.state === "met" ? "✓"
            : p.state === "rejected" ? "✗"
            : p.state === "draft" ? "!"
            : p.state === "manual" ? "○"
            : "·";
          return (
            <li key={i} className={`text-[11px] flex items-start gap-1.5 ${tone}`}>
              <span className="font-bold w-3 text-center flex-shrink-0">{icon}</span>
              <span className="flex-1">
                {p.description}
                {p.isMandatory && <span className="ml-1 text-red-500/70">*</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <a
        href={`/projects/${projectId}/pm-tracker`}
        className="inline-flex items-center gap-1 mt-2 text-[10px] font-semibold text-primary hover:underline"
      >
        Open PM Tracker → tick manual prereqs
      </a>
    </div>
  );
}

function ImpactCalibrationHint({ type }: { type: string }) {
  const { data } = useMLPrediction<any>("impact_calibration", { type }, !!type);
  if (!data || !data.sampleSize || data.sampleSize < 3) return null;
  const nonZero = Object.entries(data.deltas || {}).filter(([, v]) => Math.abs(Number(v)) >= 0.3) as [string, number][];
  if (nonZero.length === 0) return null;
  const hint = nonZero
    .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)} ${v > 0 ? "+" : ""}${v.toFixed(1)}`)
    .join(", ");
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/5 border border-primary/15 text-[10px] text-primary" title={`Based on ${data.sampleSize} past edits, your team typically adjusts these scores`}>
      <Sparkles className="w-3 h-3" />
      <span className="font-medium">Team tends to rate: {hint}</span>
    </span>
  );
}

const FILTERS = ["All", "High Priority", "Phase Gates", "Change Requests", "Scope & Risk", "Communications"];

const RISK_TIER_COLORS: Record<string, { bg: string; text: string }> = {
  LOW: { bg: "bg-emerald-500/10", text: "text-emerald-500" },
  MEDIUM: { bg: "bg-amber-500/10", text: "text-amber-500" },
  HIGH: { bg: "bg-orange-500/10", text: "text-orange-500" },
  CRITICAL: { bg: "bg-red-500/10", text: "text-red-500" },
};

const TYPE_ICONS: Record<string, string> = {
  PHASE_GATE: "🏁", BUDGET: "💰", RISK_RESPONSE: "⚠️", SCOPE_CHANGE: "📐",
  RESOURCE: "👥", COMMUNICATION: "📧", CHANGE_REQUEST: "📋", PROCUREMENT: "🛒",
};

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function parseDescription(raw: string): { summary: string; reason: string; changes: string[] } {
  // Strip markdown formatting
  const clean = raw
    .replace(/\*\*([^*]+)\*\*/g, "$1")  // bold
    .replace(/`([^`]+)`/g, "$1")         // code
    .replace(/^[-*]\s+/gm, "")           // bullet points
    .replace(/\n{2,}/g, "\n")
    .trim();

  // Extract trigger/reason
  const triggerMatch = clean.match(/Trigger:\s*(.+?)(?:\n|Confidence)/i);
  const reason = triggerMatch?.[1]?.trim() || "";

  // Extract proposed changes as array
  const changes: string[] = [];
  const changeMatches = clean.matchAll(/→\s*(.+?)(?:\n|$)/g);
  for (const m of changeMatches) {
    changes.push(m[1].replace(/^\s*_|_\s*$/g, "").trim());
  }

  // Build a clean summary — first meaningful sentence, or the title minus technical noise
  const lines = clean.split("\n").filter(l => l.trim() && !l.startsWith("Trigger:") && !l.startsWith("Confidence:"));
  const summaryLine = lines.find(l => l.includes("→") || l.length > 20) || lines[0] || raw.substring(0, 200);
  const summary = changes.length > 0
    ? `Update ${changes.length} item(s): ${changes.slice(0, 3).map(c => c.split("→")[0]?.trim() || c).join(", ")}${changes.length > 3 ? "..." : ""}`
    : summaryLine;

  return { summary, reason, changes };
}

export default function ApprovalsPage() {
  const { data: approvals, isLoading, refetch } = useApprovals();
  usePageTitle("Approvals");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState("All");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [selectedBatch, setSelectedBatch] = useState<Set<string>>(new Set());

  if (isLoading) return (
    <div className="max-w-[1000px] space-y-4">
      <Skeleton className="h-8 w-48" /><Skeleton className="h-12 w-full rounded-xl" />
      {[1,2,3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
    </div>
  );

  const rawPending = (approvals || []).filter((a: any) => a.status === "PENDING" || a.status === "DEFERRED");

  // Filter out premature phase gates — gates where the project has 0 artefacts
  // in any state, which means the agent is requesting advancement before it has
  // produced anything to review. These are bugs, not legitimate approvals.
  const items = rawPending.filter((a: any) => {
    if (a.type !== "PHASE_GATE") return true;
    const desc = (a.description || "").toLowerCase();
    const summary = (a.reasoningChain || "").toLowerCase();
    const text = desc + " " + summary;
    // If description/summary says "0 artefact" or "generated 0", it's premature
    if (/generated\s+0\s+artefact/i.test(text) || /0\s+artefact\(s\)/i.test(text)) return false;
    return true;
  });

  // Extract unique agents from approvals (use requestedByAgent or decision.agent)
  const agentList: { id: string; name: string; gradient: string | null }[] = [];
  const seenIds = new Set<string>();
  items.forEach((item: any) => {
    const ag = item.requestedByAgent || item.decision?.agent;
    if (ag && !seenIds.has(ag.id)) { seenIds.add(ag.id); agentList.push(ag); }
  });

  const filtered = items.filter((item: any) => {
    // Agent filter
    const ag = item.requestedByAgent || item.decision?.agent;
    if (agentFilter && ag?.id !== agentFilter) return false;
    // Type filter
    if (filter === "All") return true;
    if (filter === "High Priority") return item.urgency === "HIGH" || item.urgency === "CRITICAL";
    if (filter === "Scope & Risk") return item.type === "SCOPE_CHANGE" || item.type === "RISK_RESPONSE" || item.type === "RESOURCE";
    if (filter === "Phase Gates") return item.type === "PHASE_GATE";
    if (filter === "Change Requests") return item.type === "CHANGE_REQUEST" || item.type === "BUDGET";
    if (filter === "Communications") return item.type === "COMMUNICATION";
    return true;
  });

  const highCount = items.filter((i: any) => i.urgency === "HIGH" || i.urgency === "CRITICAL").length;
  const lowRiskItems = items.filter((i: any) => {
    const scores = i.impactScores as any;
    if (!scores) return false;
    const total = (scores.schedule || 1) + (scores.cost || 1) + (scores.scope || 1) + (scores.stakeholder || 1);
    return total <= 8; // LOW tier
  });

  async function handleAction(id: string, action: string, comment?: string) {
    setActionInProgress(id);
    try {
      await fetch(`/api/approvals/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment }),
      });
      refetch();
    } catch {}
    setActionInProgress(null);
    setFeedbackId(null);
    setFeedbackText("");
  }

  async function handleBatchApprove() {
    for (const id of lowRiskItems.map((i: any) => i.id)) {
      await handleAction(id, "approve");
    }
  }

  return (
    <div className="max-w-[1000px] space-y-5 animate-page-enter">
      <PageHeader
        title="Approval Queue"
        subtitle="Human-in-the-Loop Governance"
        icon={<Shield className="w-5 h-5" />}
        actions={
          <div className="flex items-center gap-3">
            {highCount > 0 && <Badge variant="destructive">{highCount} high priority</Badge>}
            {lowRiskItems.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleBatchApprove}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve All Low Risk ({lowRiskItems.length})
              </Button>
            )}
          </div>
        }
      />

      {/* Governance banner */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-primary/10 border border-primary/15">
        <Shield className="h-5 w-5 text-primary flex-shrink-0" />
        <div>
          <span className="text-sm font-semibold text-primary">Governance Mode Active</span>
          <span className="text-xs text-muted-foreground ml-2">Agent actions above autonomy threshold require your approval</span>
        </div>
      </div>

      {/* Filter tabs with counts */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/50">
        {FILTERS.map(f => {
          const count = f === "All" ? items.length
            : f === "High Priority" ? items.filter((i: any) => i.urgency === "HIGH" || i.urgency === "CRITICAL").length
            : f === "Phase Gates" ? items.filter((i: any) => i.type === "PHASE_GATE").length
            : f === "Change Requests" ? items.filter((i: any) => i.type === "CHANGE_REQUEST" || i.type === "BUDGET").length
            : f === "Scope & Risk" ? items.filter((i: any) => i.type === "SCOPE_CHANGE" || i.type === "RISK_RESPONSE" || i.type === "RESOURCE").length
            : f === "Communications" ? items.filter((i: any) => i.type === "COMMUNICATION").length
            : 0;
          return (
            <button key={f} onClick={() => setFilter(f)}
              className={cn("px-3 py-2 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5",
                filter === f ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
              {f}
              {count > 0 && (
                <span className={cn("text-[9px] min-w-[16px] h-4 rounded-full flex items-center justify-center",
                  filter === f ? "bg-primary text-primary-foreground" : "bg-muted-foreground/20 text-muted-foreground")}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Agent filter */}
      {agentList.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Agent:</span>
          <button onClick={() => setAgentFilter(null)}
            className={cn("px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all",
              !agentFilter ? "bg-primary/10 text-primary" : "text-muted-foreground")}>
            All
          </button>
          {agentList.map(ag => {
            const accentCol = (ag.gradient?.match(/#[0-9A-Fa-f]{6}/) || ["#6366F1"])[0];
            const isActive = agentFilter === ag.id;
            return (
              <button key={ag.id} onClick={() => setAgentFilter(isActive ? null : ag.id)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all"
                style={{
                  background: isActive ? `${accentCol}18` : "transparent",
                  color: isActive ? accentCol : "var(--muted-foreground)",
                  border: `1px solid ${isActive ? accentCol + "44" : "transparent"}`,
                }}>
                <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold text-white flex-shrink-0"
                  style={{ background: ag.gradient || accentCol }}>
                  {ag.name.charAt(0)}
                </span>
                {ag.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Approval cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-3xl bg-emerald-500/10">✓</div>
          <p className="text-lg font-semibold">All clear</p>
          <p className="text-sm text-muted-foreground mt-1">No pending approvals — your agents are running smoothly</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item: any) => {
            const isExpanded = expanded === item.id;
            const isProcessing = actionInProgress === item.id;
            const scores = (item.impactScores as any) || {};
            const riskScore = (scores.schedule || 1) + (scores.cost || 1) + (scores.scope || 1) + (scores.stakeholder || 1);
            const riskTier = item.urgency || (riskScore <= 8 ? "LOW" : riskScore <= 12 ? "MEDIUM" : riskScore <= 14 ? "HIGH" : "CRITICAL");
            const tierColors = RISK_TIER_COLORS[riskTier] || RISK_TIER_COLORS.MEDIUM;
            const icon = TYPE_ICONS[item.type] || "📋";

            // Agent attribution — prefer requestedByAgent (resolved in API), fall back to decision.agent
            const agent = item.requestedByAgent || item.decision?.agent;
            const agentName = agent?.name || null;
            const agentGradient = agent?.gradient || "linear-gradient(135deg, #6366F1, #8B5CF6)";
            const isAgentRaised = !!agentName;
            const agentInitial = agentName ? agentName.charAt(0).toUpperCase() : null;
            // Extract first colour from gradient for left border accent
            const accentColor = (agentGradient.match(/#[0-9A-Fa-f]{6}/) || ["#6366F1"])[0];
            const parsed = parseDescription(item.description || "");

            return (
              <div key={item.id} className="rounded-xl bg-card border border-border overflow-hidden transition-all"
                style={{ borderLeft: isAgentRaised ? `3px solid ${accentColor}` : "3px solid hsl(var(--border))" }}>
                {/* Collapsed row */}
                <div className="flex items-center gap-4 px-5 py-4 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : item.id)}>
                  {/* Agent avatar — prominent */}
                  {isAgentRaised ? (
                    <div className="relative flex-shrink-0">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-md"
                        style={{ background: agentGradient }}>
                        {agentInitial}
                      </div>
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-amber-400 border-2 border-card flex items-center justify-center text-[6px]">!</span>
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 bg-muted/50">{icon}</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      {isAgentRaised && (
                        <span className="text-xs font-bold" style={{ color: accentColor }}>{agentName}</span>
                      )}
                      <span className="text-sm font-semibold truncate">{item.title}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                      <span>{item.project?.name || "—"}</span>
                      <span>·</span>
                      <span>{timeAgo(item.createdAt)}</span>
                      {item.iteration > 1 && <Badge variant="outline" className="text-[9px]">Iteration {item.iteration}</Badge>}
                      <ApprovalLikelihoodRow type={item.type} urgency={item.urgency} projectId={item.projectId || item.project?.id} />
                      {item.sentiment && item.comment && (
                        <SentimentFeedback
                          sourceType="approval"
                          sourceId={item.id}
                          sentiment={item.sentiment}
                          confidence={item.sentimentConfidence}
                          compact
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    <Button variant="default" size="sm" disabled={isProcessing}
                      onClick={() => handleAction(item.id, "approve")}
                      className="bg-emerald-500 hover:bg-emerald-600">
                      {isProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Approve"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => {
                        const closing = feedbackId === item.id;
                        setFeedbackId(closing ? null : item.id);
                        if (!closing) setExpanded(item.id);
                      }}>Changes</Button>
                  </div>
                  <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform flex-shrink-0", isExpanded && "rotate-180")} />
                </div>

                {/* Feedback input (Request Changes) */}
                {feedbackId === item.id && (
                  <div className="px-5 pb-4 border-t border-border pt-3">
                    <textarea value={feedbackText} onChange={e => setFeedbackText(e.target.value)}
                      placeholder="Describe what changes you'd like the agent to make..."
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none resize-y h-20" />
                    <div className="flex justify-between items-center mt-2">
                      <Button variant="ghost" size="sm" onClick={() => handleAction(item.id, "reject")}>
                        <X className="h-3.5 w-3.5 mr-1" /> Reject
                      </Button>
                      <Button size="sm" disabled={!feedbackText.trim()} onClick={() => handleAction(item.id, "request_changes", feedbackText)}>
                        <MessageSquare className="h-3.5 w-3.5 mr-1" /> Send Feedback
                      </Button>
                    </div>
                  </div>
                )}

                {/* Expanded governance deck */}
                <div className={cn("transition-all duration-300 overflow-hidden", isExpanded ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0")}>
                  <div className="px-5 pb-5 space-y-4 border-t border-border">

                    {/* ── 1. EXECUTIVE SUMMARY ── */}
                    <div className="pt-4">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-primary mb-2">1. Executive Summary</p>
                      <div className="px-4 py-3 rounded-lg border border-primary/20 bg-primary/5 text-sm text-foreground leading-relaxed whitespace-pre-line">
                        {item.description || parsed.summary}
                      </div>
                    </div>

                    {/* ── 2. AGENT RATIONALE ── */}
                    {(item.reasoningChain || parsed.reason) && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">2. Agent Rationale</p>
                        <div className="px-4 py-3 rounded-lg border border-border bg-muted/20 text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                          {item.reasoningChain || parsed.reason}
                        </div>
                      </div>
                    )}

                    {/* ── 3. WHAT WILL CHANGE ── */}
                    {Array.isArray(item.affectedItems) && (item.affectedItems as any[]).length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">3. Affected Items</p>
                        <div className="rounded-lg border border-border overflow-hidden">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-muted/50">
                                <th className="text-left px-3 py-2 font-semibold text-muted-foreground w-8">Type</th>
                                <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Item</th>
                                <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Change</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(item.affectedItems as any[]).map((ai: any, idx: number) => (
                                <tr key={idx} className="border-t border-border/50">
                                  <td className="px-3 py-2 text-center">{ai.type === "task" ? "📋" : ai.type === "risk" ? "⚠️" : ai.type === "phase" ? "🔄" : "📄"}</td>
                                  <td className="px-3 py-2 font-medium">{ai.title}</td>
                                  <td className="px-3 py-2">
                                    {ai.from && ai.to ? (
                                      <span>
                                        <span className="text-muted-foreground">{ai.field}: </span>
                                        <span className="text-red-400 line-through">{ai.from}</span>
                                        <span className="text-muted-foreground mx-1">→</span>
                                        <span className="text-emerald-500 font-semibold">{ai.to}</span>
                                      </span>
                                    ) : <span className="text-muted-foreground">—</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* ── 4. IMPACT ASSESSMENT ── */}
                    {(scores.schedule || scores.cost || scores.scope || scores.stakeholder) && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">4. Impact Assessment</p>
                          <ImpactCalibrationHint type={item.type} />
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          {[
                            { label: "Schedule", value: scores.schedule || 1, desc: ["No delay expected", "Minor delay (up to 1 week)", "Significant delay (1-4 weeks)", "Major delay (over 1 month)"] },
                            { label: "Cost", value: scores.cost || 1, desc: ["No cost impact", "Minor cost (under 5% of budget)", "Moderate cost (5-15% of budget)", "Major cost (over 15% of budget)"] },
                            { label: "Scope", value: scores.scope || 1, desc: ["No scope change", "Minor scope refinement", "Deliverable change required", "Major scope change"] },
                            { label: "Stakeholder", value: scores.stakeholder || 1, desc: ["No external impact", "Project team needs to be informed", "Client/sponsor needs to be informed", "Board/programme level escalation needed"] },
                          ].map(dim => {
                            const color = dim.value <= 1 ? "text-emerald-500" : dim.value <= 2 ? "text-blue-500" : dim.value <= 3 ? "text-amber-500" : "text-red-500";
                            const bg = dim.value <= 1 ? "bg-emerald-500/10" : dim.value <= 2 ? "bg-blue-500/10" : dim.value <= 3 ? "bg-amber-500/10" : "bg-red-500/10";
                            return (
                              <div key={dim.label} className={cn("rounded-lg p-2.5 text-center", bg)}>
                                <p className="text-[10px] text-muted-foreground uppercase">{dim.label}</p>
                                <p className={cn("text-xs font-semibold mt-0.5", color)}>{dim.desc[dim.value - 1]}</p>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge variant="secondary" className={cn("text-[10px]", tierColors.bg, tierColors.text)}>{riskTier} Risk</Badge>
                          <span className="text-[10px] text-muted-foreground">Overall score: {riskScore}/16</span>
                        </div>
                      </div>
                    )}

                    {/* ── 5. AGENT RECOMMENDATION ── */}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">5. Recommendation</p>
                      <div className="px-4 py-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-sm">
                        <p className="font-semibold text-emerald-600 dark:text-emerald-400 text-xs mb-1">Agent recommends: Approve</p>
                        <p className="text-xs text-muted-foreground">
                          {item.type === "PHASE_GATE"
                            ? `All gate criteria for this phase have been met. Approving advances the project to the next phase. Use "Request Changes" if any artefacts need revision first.`
                            : item.type === "CHANGE_REQUEST"
                            ? `The proposed change has been assessed as ${riskTier.toLowerCase()} risk (score ${riskScore}/16). Approving applies the change to the project baseline. Rejecting leaves the baseline unchanged.`
                            : item.type === "RISK_RESPONSE"
                            ? `A risk has been identified that requires a response decision. Approving instructs the agent to implement the recommended mitigation. The risk will be logged to the register regardless.`
                            : item.type === "BUDGET"
                            ? `This budget action has been assessed as ${riskTier.toLowerCase()} risk. Approving authorises the agent to proceed. No financial commitment is made without this approval.`
                            : `Approving allows the agent to proceed with: "${item.title}". The output will be created as a DRAFT for your review — nothing is finalised without a second approval from you. If the result isn't right, use "Request Changes" with specific feedback.`}
                        </p>
                      </div>
                    </div>

                    {/* ── 6. IF REJECTED ── */}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">6. If Rejected</p>
                      <div className="px-4 py-3 rounded-lg border border-red-500/20 bg-red-500/5 text-xs text-muted-foreground leading-relaxed">
                        {item.type === "PHASE_GATE" ? (
                          <ul className="space-y-1 list-disc list-inside">
                            <li>The project will remain in the current phase — no advancement</li>
                            <li>Please use "Request Changes" with specific feedback on what needs fixing</li>
                            <li>The agent will revise the affected artefacts based on your feedback and resubmit</li>
                            <li>This is iteration {item.iteration || 1} of 3 — if rejected 3 times, the agent will notify the organisation owner and pause autonomous actions until the issue is resolved manually</li>
                          </ul>
                        ) : item.type === "CHANGE_REQUEST" ? (
                          <ul className="space-y-1 list-disc list-inside">
                            <li>The proposed changes will NOT be applied</li>
                            <li>Current schedule/budget/scope will remain as-is</li>
                            <li>The agent will log the rejection and continue monitoring</li>
                            <li>You can provide specific feedback for the agent to consider alternative approaches</li>
                          </ul>
                        ) : (
                          <ul className="space-y-1 list-disc list-inside">
                            <li>The agent will not proceed with this action</li>
                            <li>Please provide feedback so the agent can adjust its approach</li>
                            <li>The agent will present a revised proposal based on your feedback</li>
                          </ul>
                        )}
                      </div>
                    </div>

                    {/* ── 7. ALTERNATIVES ── */}
                    {item.suggestedAlternatives && (item.suggestedAlternatives as any[]).length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">7. Alternatives Considered</p>
                        <div className="space-y-1.5">
                          {(item.suggestedAlternatives as any[]).map((alt: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 text-xs">
                              <span className="text-muted-foreground font-bold">{i + 1}.</span>
                              <span className="flex-1">{alt.description}</span>
                              {alt.creditCost && <Badge variant="secondary" className="text-[9px]">{alt.creditCost} credits</Badge>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── DECISION ACTIONS ── */}
                    <div className="pt-3 border-t border-border">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Your Decision</p>
                      <div className="flex gap-2">
                        <Button className="flex-1 bg-emerald-500 hover:bg-emerald-600" disabled={isProcessing}
                          onClick={() => handleAction(item.id, "approve")}>
                          {isProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                          Approve & Proceed
                        </Button>
                        <Button variant="outline" className="flex-1" onClick={() => {
                          setFeedbackId(feedbackId === item.id ? null : item.id);
                        }}>
                          <MessageSquare className="h-4 w-4 mr-1" /> Request Changes
                        </Button>
                        <Button variant="ghost" className="text-destructive" onClick={() => {
                          if (confirm("Reject this request? The agent will be notified and may revise its approach.")) {
                            handleAction(item.id, "reject");
                          }
                        }}>
                          Reject
                        </Button>
                      </div>
                    </div>

                    {/* Expiry timer */}
                    {item.expiresAt && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        <span>Expires: {new Date(item.expiresAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                        {new Date(item.expiresAt) < new Date() && <Badge variant="destructive" className="text-[9px]">OVERDUE</Badge>}
                      </div>
                    )}

                    {/* Credit cost */}
                    {(item.impact as any)?.creditCost && (
                      <div className="text-xs text-muted-foreground">
                        Credit cost if approved: <strong>{(item.impact as any).creditCost} credits</strong>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
