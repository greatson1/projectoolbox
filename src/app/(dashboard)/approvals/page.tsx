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
import { CheckCircle2, X, MessageSquare, ChevronDown, Shield, Clock, AlertTriangle, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";

const FILTERS = ["All", "High Priority", "Artefacts", "Phase Gates", "Communications"];

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

  const items = (approvals || []).filter((a: any) => a.status === "PENDING" || a.status === "DEFERRED");

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
    if (filter === "Artefacts") return item.type === "RISK_RESPONSE" || item.type === "SCOPE_CHANGE";
    if (filter === "Phase Gates") return item.type === "PHASE_GATE";
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

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/50">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("px-4 py-2 rounded-md text-xs font-semibold transition-all",
              filter === f ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
            {f}
          </button>
        ))}
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

            return (
              <div key={item.id} className="rounded-xl bg-card border border-border overflow-hidden transition-all"
                style={{ borderLeft: isAgentRaised ? `3px solid ${accentColor}` : "3px solid hsl(var(--border))" }}>
                {/* Collapsed row */}
                <div className="flex items-center gap-4 px-5 py-4 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : item.id)}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 bg-muted/50">{icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-sm font-semibold truncate">{item.title}</span>
                      <Badge variant="secondary" className={cn("text-[9px]", tierColors.bg, tierColors.text)}>{riskTier}</Badge>
                      {riskScore > 0 && <span className="text-[10px] text-muted-foreground">Score {riskScore}/16</span>}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                      <span>{item.project?.name || "—"}</span>
                      <span>·</span>
                      {isAgentRaised ? (
                        <span className="flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                            style={{ background: agentGradient }}>{agentInitial}</span>
                          <span style={{ color: accentColor }} className="font-semibold">{agentName}</span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold"
                            style={{ background: `${accentColor}18`, color: accentColor }}>Agent</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <span className="text-muted-foreground">Manual</span>
                        </span>
                      )}
                      <span>·</span>
                      <span>{timeAgo(item.createdAt)}</span>
                      {item.iteration > 1 && <Badge variant="outline" className="text-[9px]">Iteration {item.iteration}</Badge>}
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

                {/* Expanded content */}
                <div className={cn("transition-all duration-300 overflow-hidden", isExpanded ? "max-h-[800px] opacity-100" : "max-h-0 opacity-0")}>
                  <div className="px-5 pb-5 space-y-4 border-t border-border">
                    {/* AI Confidence + Change Summary */}
                    <div className="pt-4 flex items-start gap-4 flex-wrap">
                      {/* Confidence badge */}
                      {(() => {
                        const score = (scores.schedule || 1) + (scores.cost || 1) + (scores.scope || 1) + (scores.stakeholder || 1);
                        const confidence = Math.max(50, Math.round(100 - (score - 4) * 6));
                        const confColor = confidence >= 85 ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/30" : confidence >= 70 ? "text-amber-500 bg-amber-500/10 border-amber-500/30" : "text-red-500 bg-red-500/10 border-red-500/30";
                        return (
                          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold ${confColor}`}>
                            <span>AI Confidence</span>
                            <span className="text-base font-bold">{confidence}%</span>
                          </div>
                        );
                      })()}
                      {/* Proposed change summary */}
                      {item.description && (
                        <div className="flex-1 px-3 py-2 rounded-lg border border-primary/20 bg-primary/5 text-xs text-foreground min-w-[200px]">
                          <span className="font-semibold text-primary block mb-0.5">Proposed Change</span>
                          {item.description}
                        </div>
                      )}
                    </div>

                    {/* Description / Reasoning */}
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Agent Reasoning</p>
                      <p className="text-sm text-foreground leading-relaxed">{item.reasoningChain || item.description}</p>
                    </div>

                    {/* Impact Scores — 4 mini-cards */}
                    {(scores.schedule || scores.cost || scores.scope || scores.stakeholder) && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Impact Analysis</p>
                        <div className="grid grid-cols-4 gap-2">
                          {[
                            { label: "Schedule", value: scores.schedule || 1, desc: ["None", "≤1 week", "1–4 weeks", ">1 month"] },
                            { label: "Cost", value: scores.cost || 1, desc: ["None", "<5%", "5–15%", ">15%"] },
                            { label: "Scope", value: scores.scope || 1, desc: ["None", "Minor", "Moderate", "Major"] },
                            { label: "Stakeholder", value: scores.stakeholder || 1, desc: ["Internal", "Team", "Client", "Board"] },
                          ].map(dim => {
                            const color = dim.value <= 1 ? "text-emerald-500" : dim.value <= 2 ? "text-blue-500" : dim.value <= 3 ? "text-amber-500" : "text-red-500";
                            const bg = dim.value <= 1 ? "bg-emerald-500/10" : dim.value <= 2 ? "bg-blue-500/10" : dim.value <= 3 ? "bg-amber-500/10" : "bg-red-500/10";
                            return (
                              <div key={dim.label} className={cn("rounded-lg p-2.5 text-center", bg)}>
                                <p className="text-[10px] text-muted-foreground uppercase">{dim.label}</p>
                                <p className={cn("text-lg font-bold", color)}>{dim.value}/4</p>
                                <p className="text-[10px] text-muted-foreground">{dim.desc[dim.value - 1]}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Affected Items */}
                    {item.affectedItems && (item.affectedItems as any[]).length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Affected Items</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(item.affectedItems as any[]).map((ai: any, i: number) => (
                            <Badge key={i} variant="outline" className="text-xs">
                              {ai.type === "task" ? "📋" : ai.type === "risk" ? "⚠️" : "📄"} {ai.title}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Suggested Alternatives */}
                    {item.suggestedAlternatives && (item.suggestedAlternatives as any[]).length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Alternatives Considered</p>
                        <div className="space-y-1.5">
                          {(item.suggestedAlternatives as any[]).map((alt: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 text-xs">
                              <span className="text-muted-foreground">{i + 1}.</span>
                              <span className="flex-1">{alt.description}</span>
                              {alt.creditCost && <Badge variant="secondary" className="text-[9px]">{alt.creditCost} credits</Badge>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

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
