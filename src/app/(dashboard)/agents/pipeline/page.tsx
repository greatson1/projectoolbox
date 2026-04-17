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
}

export default function AgentPipelineIndex() {
  const [agents, setAgents] = useState<AgentPipelineSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/agents")
      .then(r => r.json())
      .then(json => {
        // API returns { data: { agents: [...] } }
        const raw = json?.data?.agents || json?.agents || json?.data || [];
        const list = raw.map((a: any) => {
          const dep = a.deployments?.[0] || {};
          return {
            id: a.id,
            name: a.name,
            gradient: a.gradient || "#6366F1",
            projectName: a.project?.name || dep.project?.name || "—",
            currentPhase: dep.currentPhase || "—",
            phaseStatus: dep.phaseStatus || "—",
            status: a.status || "ACTIVE",
          };
        });
        setAgents(list);
        setLoading(false);
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

  const statusIcon = (ps: string) => {
    if (ps === "active") return <Clock className="w-4 h-4 text-blue-500" />;
    if (ps === "complete" || ps === "completed") return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    if (ps === "pending_approval" || ps === "waiting_approval") return <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />;
    if (ps === "researching" || ps === "awaiting_clarification") return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    return <AlertCircle className="w-4 h-4 text-muted-foreground" />;
  };

  const statusLabel = (ps: string) => {
    if (ps === "active") return "Active";
    if (ps === "complete" || ps === "completed") return "Complete";
    if (ps === "pending_approval" || ps === "waiting_approval") return "Awaiting Approval";
    if (ps === "researching") return "Researching";
    if (ps === "awaiting_clarification") return "Awaiting Input";
    return ps;
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
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>Phase: <strong className="text-foreground">{agent.currentPhase}</strong></span>
                      <span className="flex items-center gap-1">
                        {statusIcon(agent.phaseStatus)}
                        {statusLabel(agent.phaseStatus)}
                      </span>
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
