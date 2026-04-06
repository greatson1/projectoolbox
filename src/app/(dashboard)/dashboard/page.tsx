"use client";

import { usePageTitle } from "@/hooks/use-page-title";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useDashboard } from "@/hooks/use-api";
import { useAppStore } from "@/stores/app";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FolderKanban, CheckCircle2, FileWarning, AlertTriangle, ChevronRight,
  TrendingUp, ArrowRight, Bot, Zap,
} from "lucide-react";
// Recharts removed — dashboard uses real data widgets now

// No mock data — all from API

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const METHOD_LABEL: Record<string, string> = { PRINCE2: "Traditional", prince2: "Traditional", AGILE_SCRUM: "Scrum", scrum: "Scrum", AGILE_KANBAN: "Kanban", kanban: "Kanban", WATERFALL: "Waterfall", waterfall: "Waterfall", HYBRID: "Hybrid", hybrid: "Hybrid", SAFE: "SAFe", safe: "SAFe" };
const ACTIVITY_COLORS: Record<string, string> = { document: "bg-primary", meeting: "bg-chart-2", approval: "bg-chart-4", risk: "bg-destructive", deployment: "bg-chart-3", chat: "bg-chart-5" };

export default function DashboardPage() {
  const router = useRouter();
  const { data: dash, isLoading, error } = useDashboard();
  const { setPendingApprovals, setUnreadNotifications, setActiveProject } = useAppStore();

  // Redirect to onboarding if user has no org (first-time Google sign-in)
  useEffect(() => {
    if (!isLoading && dash === null) {
      router.push("/onboarding");
    }
  }, [isLoading, dash, router]);

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

  const stats = dash?.stats || { activeProjects: 0, completedTasks: 0, totalTasks: 0, pendingApprovals: 0, openRisks: 0, unreadNotifications: 0, creditBalance: 0, activeAgents: 0 };
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

      {/* ── Context-Aware Suggestions ── */}
      {(() => {
        const hasAgent = agents.length > 0;
        const hasProject = projects.length > 0;
        const pendingApprovals = stats?.pendingApprovals || 0;
        const openRisks = stats?.openRisks || 0;
        const creditBalance = stats?.creditBalance || 0;
        const creditPct = creditBalance / 5000 * 100; // rough estimate

        type Suggestion = { icon: string; label: string; desc: string; href: string; priority: "critical" | "high" | "medium" | "low"; color: string };
        const suggestions: Suggestion[] = [];

        // === CONTEXT-AWARE SUGGESTION ENGINE ===

        // 1. No agent — first-time user
        if (!hasAgent) {
          suggestions.push({ icon: "🚀", label: "Deploy your first AI agent", desc: "Create a project and deploy an autonomous agent to manage it — plans, risks, reports, all handled by AI", href: "/agents/deploy", priority: "high", color: "border-primary/30 bg-primary/5" });
        }

        // 2. Pending approvals — agent is blocked
        if (pendingApprovals > 0) {
          suggestions.push({ icon: "⏳", label: `${pendingApprovals} approval${pendingApprovals > 1 ? "s" : ""} waiting for you`, desc: "Your agent is paused at a governance gate — review and approve to let it continue", href: "/approvals", priority: "critical", color: "border-amber-500/30 bg-amber-500/5" });
        }

        // 3. High risks flagged
        if (openRisks > 2) {
          suggestions.push({ icon: "⚠️", label: `${openRisks} open risks need attention`, desc: "Your agent flagged risks that may need mitigation strategies or escalation", href: hasProject ? `/projects/${projects[0]?.id}/risk` : "/projects", priority: "high", color: "border-red-500/30 bg-red-500/5" });
        }

        // 4. Credits running low
        if (creditPct < 20 && creditPct > 0) {
          suggestions.push({ icon: "💰", label: `Credits at ${Math.floor(creditPct)}% — top up soon`, desc: `${creditBalance.toLocaleString()} credits remaining. Agents stop working when credits run out`, href: "/billing/credits", priority: creditPct < 5 ? "critical" : "medium", color: "border-orange-500/30 bg-orange-500/5" });
        }

        // 5. Agent active but no recent activity (might be stale)
        if (hasAgent && activities.length === 0) {
          suggestions.push({ icon: "🔍", label: "Check agent status", desc: "Your agent hasn't recorded any activity yet — it may still be initialising or needs attention", href: "/agents", priority: "medium", color: "border-blue-500/30 bg-blue-500/5" });
        }

        // 6. Recent artefact generation (from activity feed)
        const artefactActivity = activities.find((a: any) => a.type === "artefact_generated");
        if (artefactActivity && hasAgent) {
          suggestions.push({ icon: "📄", label: "New artefacts ready for review", desc: artefactActivity.summary || "Your agent generated documents — review and approve them", href: `/agents/${agents[0]?.id}`, priority: "high", color: "border-emerald-500/30 bg-emerald-500/5" });
        }

        // 7. Phase advanced (celebration)
        const phaseActivity = activities.find((a: any) => a.type === "phase_advance" || a.type === "phase_advanced");
        if (phaseActivity) {
          suggestions.push({ icon: "🎉", label: "Phase advanced", desc: phaseActivity.summary || "Your project moved to the next phase", href: hasAgent ? `/agents/${agents[0]?.id}` : "/agents", priority: "low", color: "border-emerald-500/30 bg-emerald-500/5" });
        }

        // 8. Tasks overdue
        const overdueActivity = activities.find((a: any) => a.type === "overdue_alert");
        if (overdueActivity) {
          suggestions.push({ icon: "📋", label: "Overdue tasks detected", desc: overdueActivity.summary || "Some tasks are past their deadline", href: hasProject ? `/projects/${projects[0]?.id}/schedule` : "/projects", priority: "high", color: "border-red-500/30 bg-red-500/5" });
        }

        // 9. No projects but has agent (unusual state)
        if (hasAgent && !hasProject) {
          suggestions.push({ icon: "📁", label: "No active projects", desc: "Your agent is deployed but has no project — deploy to a project to start autonomous management", href: "/agents/deploy", priority: "medium", color: "border-amber-500/30 bg-amber-500/5" });
        }

        // Sort by priority
        const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

        if (suggestions.length === 0) return null;

        return (
          <Card>
            <CardContent className="pt-5 pb-4">
              <h3 className="text-sm font-bold mb-3">{!hasAgent ? "Get Started" : "Needs Your Attention"}</h3>
              <div className="space-y-2">
                {suggestions.slice(0, 4).map((s, i) => (
                  <Link key={i} href={s.href}>
                    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all hover:translate-x-0.5 cursor-pointer ${s.color}`}>
                      <span className="text-xl flex-shrink-0">{s.icon}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold">{s.label}</span>
                        <p className="text-xs text-muted-foreground">{s.desc}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })()}

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

          {/* EVM Health (if projects have budget) */}
          {projects.some((p: any) => p.budget > 0) && (
            <Card className="px-5">
              <CardHeader className="pb-3"><CardTitle className="text-sm">Project Health</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {projects.filter((p: any) => p.budget > 0).slice(0, 3).map((p: any) => {
                    const progress = p.taskCount > 0 ? Math.round(((p.completedCount || 0) / p.taskCount) * 100) : 0;
                    return (
                      <div key={p.id} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium truncate flex-1">{p.name}</span>
                          <span className="text-xs font-bold text-primary ml-2">{progress}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-border/30 overflow-hidden">
                          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
