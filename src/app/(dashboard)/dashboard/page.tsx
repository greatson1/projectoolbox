"use client";

import { usePageTitle } from "@/hooks/use-page-title";
import { useEffect } from "react";
import Link from "next/link";
import { useDashboard } from "@/hooks/use-api";
import { useAppStore } from "@/stores/app";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FolderKanban, CheckCircle2, FileWarning, AlertTriangle,
  TrendingUp, ArrowRight, Bot, Zap,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell,
} from "recharts";

// Charts mock data (will be replaced with real data when tasks/sprints are populated)
const BURNDOWN = [
  { day: "Mon", planned: 42, actual: 42 }, { day: "Tue", planned: 38, actual: 40 },
  { day: "Wed", planned: 34, actual: 37 }, { day: "Thu", planned: 30, actual: 33 },
  { day: "Fri", planned: 26, actual: 30 }, { day: "Sat", planned: 22, actual: 28 },
  { day: "Sun", planned: 18, actual: 25 },
];
const RISK_DIST = [
  { category: "Technical", count: 4, fill: "#6366F1" }, { category: "Schedule", count: 3, fill: "#F59E0B" },
  { category: "Budget", count: 2, fill: "#EF4444" }, { category: "Resource", count: 1, fill: "#22D3EE" },
  { category: "External", count: 1, fill: "#8B5CF6" },
];
const PHASES = [
  { name: "Pre-Project", pct: 100, status: "done" }, { name: "Initiation", pct: 100, status: "done" },
  { name: "Planning", pct: 65, status: "active" }, { name: "Execution", pct: 0, status: "pending" },
  { name: "Closing", pct: 0, status: "pending" },
];
const UPCOMING = [
  { time: "Today 3pm", title: "Sprint Review — Mobile App", badge: "default" as const },
  { time: "Tomorrow 10am", title: "Gate Review: CRM Planning", badge: "secondary" as const },
  { time: "Thu", title: "Risk Register review due", badge: "destructive" as const },
];

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const METHOD_LABEL: Record<string, string> = { PRINCE2: "PRINCE2", AGILE_SCRUM: "Scrum", AGILE_KANBAN: "Kanban", WATERFALL: "Waterfall", HYBRID: "Hybrid", SAFE: "SAFe" };
const ACTIVITY_COLORS: Record<string, string> = { document: "bg-primary", meeting: "bg-chart-2", approval: "bg-chart-4", risk: "bg-destructive", deployment: "bg-chart-3", chat: "bg-chart-5" };

export default function DashboardPage() {
  const { data: dash, isLoading, error } = useDashboard();
  const { setPendingApprovals, setUnreadNotifications, setActiveProject } = useAppStore();

  // Sync badge counts
  useEffect(() => {
    if (dash?.stats) {
      setPendingApprovals(dash.stats.pendingApprovals);
      setUnreadNotifications(dash.stats.unreadNotifications);
    }
  }, [dash, setPendingApprovals, setUnreadNotifications]);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-24 rounded-2xl" />
        <div className="grid grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-destructive mb-4">Failed to load dashboard: {error.message}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>Retry</Button>
      </div>
    );
  }

  const stats = dash?.stats;
  const projects = dash?.projects || [];
  const agents = dash?.agents || [];
  const activities = dash?.activities || [];
  const activeAgent = agents.find((a: any) => a.status === "ACTIVE");
  const latestActivity = activities[0];

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* ── Agent Status Banner ── */}
      <div className="rounded-2xl p-5 flex items-center gap-5 border border-primary/20 bg-gradient-to-r from-primary/10 via-accent/5 to-transparent">
        <div className="relative flex-shrink-0">
          {activeAgent ? (
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-primary/30"
              style={{ background: activeAgent.gradient || "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>
              {activeAgent.name[0]}
            </div>
          ) : (
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center"><Bot className="w-6 h-6 text-muted-foreground" /></div>
          )}
          {activeAgent && <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-400 border-2 border-background animate-pulse" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-muted-foreground">Agent Status</span>
            {activeAgent ? (
              <Badge variant="default" className="bg-green-500/10 text-green-500 border-green-500/20 text-[10px]">Online</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">No agents deployed</Badge>
            )}
          </div>
          <p className="text-[15px] font-semibold truncate">
            {latestActivity ? latestActivity.summary : "Deploy an agent to get started"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {stats?.activeAgents || 0} agents active · {stats?.pendingApprovals || 0} pending approvals · {stats?.creditBalance || 0} credits remaining
          </p>
        </div>
        <Link href={activeAgent ? "/agents/chat" : "/agents/deploy"}>
          <Button size="sm">{activeAgent ? "Open Chat" : "Deploy Agent"}</Button>
        </Link>
      </div>

      {/* ── Stats Row ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Active Projects", value: stats?.activeProjects || 0, icon: FolderKanban, color: "text-primary" },
          { label: "Tasks Completed", value: stats?.completedTasks || 0, icon: CheckCircle2, color: "text-chart-3" },
          { label: "Pending Approvals", value: stats?.pendingApprovals || 0, icon: FileWarning, color: "text-chart-4" },
          { label: "Open Risks", value: stats?.openRisks || 0, icon: AlertTriangle, color: "text-destructive" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{s.label}</span>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-primary/10">
                  <s.icon className={`w-4 h-4 ${s.color}`} />
                </div>
              </div>
              <p className="text-[28px] font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Main Grid ── */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 items-start">
        {/* Left: Projects Table + Charts */}
        <div className="xl:col-span-3 space-y-6">
          <Card className="px-5">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-[15px]">Projects</CardTitle>
              <Link href="/projects">
                <Button variant="ghost" size="sm" className="text-xs gap-1">View All <ArrowRight className="w-3 h-3" /></Button>
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              {projects.length === 0 ? (
                <div className="p-8 text-center">
                  <FolderKanban className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No projects yet.</p>
                  <Link href="/agents/deploy"><Button size="sm" className="mt-3">Create First Project</Button></Link>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-border">
                        {["Project", "Methodology", "Agent", "Tasks", "Risks"].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {projects.map((p: any) => (
                        <tr key={p.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                          onClick={() => setActiveProject(p.id, p.name)}>
                          <td className="px-4 py-3">
                            <Link href={`/projects/${p.id}`} className="font-medium hover:text-primary">{p.name}</Link>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline" className="text-[10px]">{METHOD_LABEL[p.methodology] || p.methodology}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            {p.agent ? (
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                                  style={{ background: p.agent.gradient || "#6366F1" }}>{p.agent.name[0]}</div>
                                <span className="text-xs">{p.agent.name}</span>
                              </div>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{p.taskCount}</td>
                          <td className="px-4 py-3 text-muted-foreground">{p.riskCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Charts Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Task Progress */}
            <Card className="px-5">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Task Progress</CardTitle></CardHeader>
              <CardContent>
                {stats.totalTasks > 0 ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-muted-foreground">{stats.completedTasks} of {stats.totalTasks} completed</span>
                      <span className="text-xs font-bold text-primary">{Math.round((stats.completedTasks / stats.totalTasks) * 100)}%</span>
                    </div>
                    <div className="h-3 rounded-full bg-border/30 overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(stats.completedTasks / stats.totalTasks) * 100}%` }} />
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-4">
                      <div className="text-center p-2 rounded-lg bg-muted/30">
                        <p className="text-lg font-bold text-foreground">{stats.totalTasks - stats.completedTasks}</p>
                        <p className="text-[10px] text-muted-foreground">Open</p>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-muted/30">
                        <p className="text-lg font-bold text-emerald-500">{stats.completedTasks}</p>
                        <p className="text-[10px] text-muted-foreground">Done</p>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-muted/30">
                        <p className="text-lg font-bold text-amber-500">{stats.pendingApprovals}</p>
                        <p className="text-[10px] text-muted-foreground">Blocked</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[140px] text-center">
                    <div>
                      <p className="text-sm text-muted-foreground">No tasks yet</p>
                      <p className="text-xs text-muted-foreground mt-1">Deploy an agent to start generating tasks</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Risk Overview */}
            <Card className="px-5">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Risk Overview</CardTitle></CardHeader>
              <CardContent>
                {stats.openRisks > 0 ? (
                  <div>
                    <div className="flex items-center gap-3 mb-4">
                      <div className="text-center flex-1 p-3 rounded-lg bg-red-500/10">
                        <p className="text-2xl font-bold text-red-500">{stats.openRisks}</p>
                        <p className="text-[10px] text-muted-foreground">Open Risks</p>
                      </div>
                      <div className="text-center flex-1 p-3 rounded-lg bg-muted/30">
                        <p className="text-2xl font-bold text-foreground">{projects.reduce((s: number, p: any) => s + (p.riskCount || 0), 0)}</p>
                        <p className="text-[10px] text-muted-foreground">Total Risks</p>
                      </div>
                    </div>
                    {projects.filter((p: any) => p.riskCount > 0).map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between py-1.5 border-b border-border/10">
                        <span className="text-xs font-medium">{p.name}</span>
                        <span className="text-xs font-bold" style={{ color: p.riskCount > 3 ? "#EF4444" : "#F59E0B" }}>{p.riskCount} risks</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[140px] text-center">
                    <div>
                      <p className="text-sm text-muted-foreground">No risks identified</p>
                      <p className="text-xs text-muted-foreground mt-1">Agents flag risks as they analyse your projects</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Agent Fleet Summary — in left column to balance heights */}
          <Card className="px-5">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm">Agent Fleet</CardTitle>
              <Link href="/agents"><Button variant="ghost" size="sm" className="text-xs">View All</Button></Link>
            </CardHeader>
            <CardContent>
              {agents.length === 0 ? (
                <div className="text-center py-4">
                  <Bot className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No agents deployed yet</p>
                  <Link href="/agents/deploy"><Button size="sm" className="mt-2">Deploy First Agent</Button></Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {agents.map((a: any) => (
                    <Link key={a.id} href={`/agents/${a.id}`} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                        style={{ background: a.gradient || "#6366F1" }}>{a.name[0]}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{a.name}</p>
                        <p className="text-[10px] text-muted-foreground">L{a.autonomyLevel} · {a.status}</p>
                      </div>
                      <span className={`w-2 h-2 rounded-full ${a.status === "ACTIVE" ? "bg-green-400 animate-pulse" : a.status === "PAUSED" ? "bg-amber-400" : "bg-muted-foreground"}`} />
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Phase Gates + Activity + Credits + Upcoming */}
        <div className="xl:col-span-2 space-y-6">
          {/* Pending Approvals */}
          <Card className="px-5">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm">Pending Approvals</CardTitle>
              {stats.pendingApprovals > 0 && (
                <Link href="/approvals"><Badge variant="destructive">{stats.pendingApprovals}</Badge></Link>
              )}
            </CardHeader>
            <CardContent>
              {stats.pendingApprovals === 0 ? (
                <div className="text-center py-4">
                  <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">All clear — no approvals waiting</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{stats.pendingApprovals} approval(s) require your attention</p>
                  <Link href="/approvals"><Button variant="default" size="sm" className="w-full">Review Approvals</Button></Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity Feed */}
          <Card className="px-5">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm">Agent Activity</CardTitle>
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            </CardHeader>
            <CardContent>
              {activities.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No activity yet. Deploy an agent to get started.</p>
              ) : (
                <div className="space-y-3">
                  {activities.map((a: any, i: number) => (
                    <div key={a.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 ${ACTIVITY_COLORS[a.type] || "bg-muted-foreground"}`} />
                        {i < activities.length - 1 && <div className="w-px flex-1 mt-1 bg-border" />}
                      </div>
                      <div className="pb-3">
                        <p className="text-[13px]">
                          <span className="font-semibold text-primary">{a.agentName}</span> — {a.summary}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{timeAgo(a.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Credits */}
          <Card className="px-5">
            <CardContent className="pt-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Credit Balance</span>
                <Zap className="w-4 h-4 text-chart-4" />
              </div>
              <p className="text-2xl font-bold">{stats?.creditBalance?.toLocaleString() || 0}</p>
              <Link href="/billing/credits"><Button variant="ghost" size="sm" className="text-xs mt-2 p-0 h-auto">View Credit Centre →</Button></Link>
            </CardContent>
          </Card>

          {/* Upcoming */}
          <Card className="px-5">
            <CardHeader className="pb-3"><CardTitle className="text-sm">Upcoming</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2.5">
                {([] as any[]).map((u, i) => (
                  <div key={i} className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] font-medium w-[80px] text-muted-foreground">{u.time}</span>
                      <span className="text-[13px] font-medium">{u.title}</span>
                    </div>
                    <Badge variant={u.badge} className="text-[10px] capitalize">{u.badge === "default" ? "meeting" : u.badge === "secondary" ? "approval" : "deadline"}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
