// @ts-nocheck
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, ArrowRight, CheckCircle2, AlertCircle, Clock, Loader2 } from "lucide-react";

interface AgentPipelineSummary {
  id: string;
  name: string;
  gradient: string;
  projectName: string;
  currentPhase: string;
  phaseStatus: string;
  status: string;
  derivedStatus?: string; // truthful status from pipeline API
  overallProgress?: number;
  currentStepLabel?: string;
}

export default function AgentPipelineIndex() {
  const [agents, setAgents] = useState<AgentPipelineSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/agents")
      .then(r => r.json())
      .then(async (json) => {
        const raw = json?.data?.agents || json?.agents || json?.data || [];
        const baseList = raw.map((a: any) => {
          const dep = a.deployments?.[0] || {};
          return {
            id: a.id,
            name: a.name,
            gradient: a.gradient || "#6366F1",
            projectName: a.project?.name || dep.project?.name || "—",
            currentPhase: dep.currentPhase || "—",
            phaseStatus: dep.phaseStatus || "—",
            status: a.status || "ACTIVE",
          } as AgentPipelineSummary;
        });
        setAgents(baseList);
        setLoading(false);

        // Enrich with truthful pipeline status from each agent's pipeline API
        const enriched = await Promise.all(baseList.map(async (agent: AgentPipelineSummary) => {
          try {
            const res = await fetch(`/api/agents/${agent.id}/pipeline`);
            if (!res.ok) return agent;
            const payload = await res.json();
            const d = payload?.data;
            if (!d) return agent;

            // Derive truthful status from actual step states
            const steps = d.steps || [];
            const researchStep = steps.find((s: any) => s.id === "research");
            const clarifyStep = steps.find((s: any) => s.id === "clarify" || s.id === "clarification");
            // Generation & Review is now one merged step. Old "generate" /
            // "review" / "approve" ids are kept as fallbacks for backward
            // compat with any older payloads still in flight.
            const grStep = steps.find((s: any) => s.id === "generation_review");
            const generateStep = grStep || steps.find((s: any) => s.id === "generate");
            const reviewStep = grStep || steps.find((s: any) => s.id === "review" || s.id === "approve");
            const running = steps.find((s: any) => s.status === "running");
            const failed = steps.find((s: any) => s.status === "failed");

            let derivedStatus: string;
            let currentStepLabel: string | undefined;

            if (failed) {
              derivedStatus = "Failed";
              currentStepLabel = failed.label;
            } else if (running) {
              derivedStatus = running.label;
              currentStepLabel = running.label;
            } else if (grStep?.progress) {
              // Use the merged card's two-axis progress when available so the
              // fleet view can distinguish "still drafting" from "drafted but
              // unapproved" — both are "running" but mean different things.
              const p = grStep.progress;
              if (p.generated.done < p.generated.total) {
                derivedStatus = "Generating";
              } else if (p.approved.done < p.approved.total) {
                derivedStatus = "Awaiting Review";
              } else if (grStep.status !== "done") {
                derivedStatus = grStep.status === "failed" ? "Failed" : "Active";
              } else {
                derivedStatus = d.phaseStatus?.replace(/_/g, " ") || "Active";
              }
            } else if (generateStep?.status === "running") {
              derivedStatus = "Generating";
            } else if (reviewStep?.status === "waiting" || reviewStep?.status === "running") {
              derivedStatus = "Awaiting Review";
            } else if (clarifyStep?.status === "waiting" && researchStep?.status === "done") {
              derivedStatus = "Awaiting Input";
              currentStepLabel = "Clarification";
            } else if (researchStep?.status === "running") {
              derivedStatus = "Researching";
            } else if (d.phaseStatus === "completed" || d.phaseStatus === "complete") {
              derivedStatus = "Complete";
            } else {
              derivedStatus = d.phaseStatus?.replace(/_/g, " ") || "Active";
            }

            return { ...agent, derivedStatus, overallProgress: d.overallProgress, currentStepLabel };
          } catch { return agent; }
        }));
        setAgents(enriched);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4 max-w-[900px]">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-3">
          {[1, 2].map(i => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      </div>
    );
  }

  const statusIcon = (label: string) => {
    const lower = (label || "").toLowerCase();
    if (lower.includes("complete")) return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    if (lower.includes("failed")) return <AlertCircle className="w-4 h-4 text-red-500" />;
    if (lower.includes("awaiting") || lower.includes("input") || lower.includes("review") || lower.includes("approval")) {
      return <Clock className="w-4 h-4 text-amber-500" />;
    }
    if (lower.includes("research") || lower.includes("generat") || lower.includes("working") || lower.includes("ing")) {
      return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    }
    return <AlertCircle className="w-4 h-4 text-muted-foreground" />;
  };

  const statusColor = (label: string) => {
    const lower = (label || "").toLowerCase();
    if (lower.includes("complete")) return "text-emerald-500";
    if (lower.includes("failed")) return "text-red-500";
    if (lower.includes("awaiting") || lower.includes("input") || lower.includes("review") || lower.includes("approval")) return "text-amber-500";
    if (lower.includes("research") || lower.includes("generat") || lower.includes("working")) return "text-blue-500";
    return "text-muted-foreground";
  };

  return (
    <div className="space-y-6 max-w-[900px]">
      <div>
        <h1 className="text-2xl font-bold">Agent Pipelines</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track each agent's lifecycle progress — research, generation, review, and deployment phases
        </p>
      </div>

      {agents.length === 0 ? (
        <Card className="p-8 text-center">
          <Bot className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No agents deployed yet</p>
          <Link href="/agents/deploy" className="text-xs text-primary hover:underline mt-2 inline-block">Deploy your first agent</Link>
        </Card>
      ) : (
        <div className="grid gap-3">
          {agents.map(agent => (
            <Link key={agent.id} href={`/agents/${agent.id}/pipeline`}>
              <Card className="p-5 hover:border-primary/30 hover:bg-muted/30 transition-all cursor-pointer group">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold text-white flex-shrink-0"
                    style={{ background: agent.gradient }}>
                    {agent.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-bold truncate">{agent.name}</h3>
                      <Badge variant="secondary" className="text-[9px]">{agent.projectName}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span>Phase: <strong className="text-foreground">{agent.currentPhase}</strong></span>
                      <span className={`flex items-center gap-1 ${statusColor(agent.derivedStatus || agent.phaseStatus)}`}>
                        {statusIcon(agent.derivedStatus || agent.phaseStatus)}
                        <strong>{agent.derivedStatus || agent.phaseStatus?.replace(/_/g, " ")}</strong>
                      </span>
                      {typeof agent.overallProgress === "number" && (
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                            <span className="block h-full bg-primary rounded-full" style={{ width: `${agent.overallProgress}%` }} />
                          </span>
                          <span className="tabular-nums text-[10px]">{agent.overallProgress}%</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
