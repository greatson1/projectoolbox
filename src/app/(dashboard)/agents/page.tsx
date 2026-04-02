"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgents } from "@/hooks/use-api";
import { Bot, Play, Pause, MessageSquare, Settings, Rocket, Plus } from "lucide-react";

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const AUTONOMY_LABEL: Record<number, string> = { 1: "Assistant", 2: "Advisor", 3: "Co-pilot", 4: "Autonomous", 5: "Strategic" };
const METHOD_LABEL: Record<string, string> = { PRINCE2: "PRINCE2", AGILE_SCRUM: "Scrum", AGILE_KANBAN: "Kanban", WATERFALL: "Waterfall", HYBRID: "Hybrid", SAFE: "SAFe" };
const STATUS_CLASS: Record<string, string> = { ACTIVE: "bg-green-400 animate-pulse", PAUSED: "bg-amber-400", IDLE: "bg-muted-foreground", ERROR: "bg-red-400" };
const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", PAUSED: "Paused", IDLE: "Idle", ERROR: "Error" };
const ACTIVITY_COLORS: Record<string, string> = { document: "bg-primary", meeting: "bg-chart-2", approval: "bg-chart-4", risk: "bg-destructive", deployment: "bg-chart-3", chat: "bg-chart-5" };

export default function AgentFleetPage() {
  const { data, isLoading } = useAgents();
  const [activityFilter, setActivityFilter] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1600px]">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
      </div>
    );
  }

  const agents = data?.agents || [];
  const activities = data?.activities || [];
  const alerts = data?.alerts || [];
  const activeCount = agents.filter((a: any) => a.status === "ACTIVE").length;
  const pausedCount = agents.filter((a: any) => a.status === "PAUSED").length;
  const totalCredits = agents.reduce((s: number, a: any) => s + (a.creditsUsed || 0), 0);

  const filteredActivities = activityFilter
    ? activities.filter((a: any) => a.agentName === activityFilter)
    : activities;

  return (
    <div className="space-y-6 max-w-[1600px]">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Agent Fleet</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {agents.length} Agents Deployed · {activeCount} Active · {pausedCount} Paused · {totalCredits} credits used
          </p>
        </div>
        <Link href="/agents/deploy"><Button><Rocket className="w-4 h-4 mr-1" /> Deploy New Agent</Button></Link>
      </div>

      {/* Agent Cards */}
      {agents.length === 0 ? (
        <div className="text-center py-20">
          <Bot className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No agents deployed</h2>
          <p className="text-sm text-muted-foreground mb-4">Deploy your first AI project manager to get started.</p>
          <Link href="/agents/deploy"><Button><Rocket className="w-4 h-4 mr-1" /> Deploy First Agent</Button></Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
          {agents.map((agent: any) => {
            const isActive = agent.status === "ACTIVE";
            return (
              <Card key={agent.id} className={`transition-all hover:-translate-y-0.5 ${isActive ? "border-primary/30 shadow-lg shadow-primary/5" : ""}`}>
                <CardContent className="pt-5">
                  {/* Top: Avatar + Name */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-base font-bold text-white"
                        style={{ background: agent.gradient || "linear-gradient(135deg, #6366F1, #8B5CF6)", boxShadow: isActive ? `0 0 16px ${agent.gradient ? "" : "#6366F1"}44` : "none" }}>
                        {agent.name[0]}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold">{agent.name}</span>
                          <span className={`w-2 h-2 rounded-full ${STATUS_CLASS[agent.status]}`} />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {agent.project ? agent.project.name : "Unassigned"}
                        </span>
                      </div>
                    </div>
                    {agent.project && (
                      <Badge variant="outline" className="text-[9px]">{METHOD_LABEL[agent.project.methodology] || agent.project.methodology}</Badge>
                    )}
                  </div>

                  {/* Autonomy */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map(i => (
                        <div key={i} className="w-2 h-2 rounded-full" style={{ background: i <= agent.autonomyLevel ? (agent.gradient ? "var(--primary)" : "#6366F1") : "var(--border)" }} />
                      ))}
                      <span className="text-[9px] font-semibold text-muted-foreground ml-1">L{agent.autonomyLevel}</span>
                    </div>
                    <span className="text-[10px] font-semibold text-primary">{AUTONOMY_LABEL[agent.autonomyLevel]}</span>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-3">
                    <span>{agent._count?.activities || 0} actions</span>
                    <span>{agent._count?.decisions || 0} decisions</span>
                    <span>{agent.creditsUsed || 0} credits</span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 pt-3 border-t border-border/30">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                      {agent.status === "PAUSED" ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                    </Button>
                    <Link href={`/agents/chat?agent=${agent.id}`}>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><MessageSquare className="w-3.5 h-3.5" /></Button>
                    </Link>
                    <Link href={`/agents/${agent.id}`}>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Settings className="w-3.5 h-3.5" /></Button>
                    </Link>
                    <div className="ml-auto">
                      <Badge variant={agent.status === "ACTIVE" ? "default" : agent.status === "PAUSED" ? "secondary" : "outline"} className="text-[9px]">
                        {STATUS_LABEL[agent.status]}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Activity Timeline */}
      {activities.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-sm">Fleet Activity Timeline</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Recent agent actions</p>
            </div>
            <div className="flex items-center gap-2">
              <button className={`px-2 py-1 rounded-md text-[10px] font-semibold ${!activityFilter ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
                onClick={() => setActivityFilter(null)}>All</button>
              {agents.map((a: any) => (
                <button key={a.id} className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold ${activityFilter === a.name ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
                  onClick={() => setActivityFilter(activityFilter === a.name ? null : a.name)}>
                  <div className="w-3 h-3 rounded-full" style={{ background: a.gradient || "#6366F1" }} />
                  {a.name}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              {filteredActivities.map((evt: any, i: number) => (
                <div key={evt.id} className="flex items-start gap-3 py-2.5" style={{ borderBottom: i < filteredActivities.length - 1 ? "1px solid var(--border)" : "none", opacity: 0.08 }}>
                  <div className="flex flex-col items-center flex-shrink-0" style={{ width: 20 }}>
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: evt.agentGradient || "#6366F1" }} />
                    {i < filteredActivities.length - 1 && <div className="w-px flex-1 mt-1 bg-border" style={{ minHeight: 20 }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-semibold" style={{ color: evt.agentGradient || "var(--primary)" }}>{evt.agentName}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${ACTIVITY_COLORS[evt.type] || "bg-muted"} bg-opacity-10`}>
                        {evt.type}
                      </span>
                      <span className="text-[10px] ml-auto text-muted-foreground">{timeAgo(evt.createdAt)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{evt.summary}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alerts */}
      {alerts.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">Alerts & Escalations</CardTitle>
              <Badge variant="destructive" className="text-[9px]">{alerts.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.map((alert: any) => (
              <div key={alert.id} className="flex items-start gap-3 p-3 rounded-xl bg-destructive/5 border border-destructive/10">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold">{alert.title}</span>
                    <Badge variant="secondary" className="text-[9px]">{alert.type}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{alert.description}</p>
                  <span className="text-[10px] text-muted-foreground">{alert.project} · {timeAgo(alert.createdAt)}</span>
                </div>
                <Link href="/approvals"><Button variant="outline" size="sm">Review</Button></Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
