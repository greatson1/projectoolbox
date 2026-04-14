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
  TrendingUp, ArrowRight, Bot, Zap, Activity, Clock,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, BarChart, Bar } from "recharts";

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
      <div className="flex flex-col items-center justify-center py-20 space-y-3">
        <p className="text-sm text-destructive">Failed to load dashboard</p>
        <p className="text-xs text-muted-foreground font-mono bg-muted px-3 py-1.5 rounded max-w-lg text-center">{error.message}</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>Retry</Button>
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
      {/* ── Welcome + Agent Status Banner ── */}
      <div className="rounded-2xl overflow-hidden border border-primary/20">
        {/* Greeting bar */}
        <div className="px-6 py-4 bg-gradient-to-r from-primary/10 via-accent/5 to-transparent">
          <h1 className="text-lg font-bold">
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {stats?.activeProjects || 0} project{(stats?.activeProjects || 0) !== 1 ? "s" : ""} · {stats?.activeAgents || 0} agent{(stats?.activeAgents || 0) !== 1 ? "s" : ""} active · {(stats?.creditBalance || 0).toLocaleString()} credits
          </p>
        </div>

        {/* Agent status row(s) */}
        <div className="px-6 py-3 border-t border-border/30">
          {agents.length === 0 ? (
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <Bot className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-muted-foreground">No agents deployed yet</p>
                <p className="text-xs text-muted-foreground">Create a project and deploy an AI agent to get started</p>
              </div>
              <Link href="/agents/deploy"><Button size="sm">Deploy Agent</Button></Link>
            </div>
          ) : (
            <div className="space-y-2">
              {agents.slice(0, 3).map((a: any) => {
                const agentActivity = activities.find((act: any) => act.agentId === a.id || act.agentName === a.name);
                return (
                  <Link key={a.id} href={`/agents/${a.id}`} className="flex items-center gap-3 p-2 -mx-2 rounded-xl hover:bg-muted/30 transition-colors group">
                    <div className="relative flex-shrink-0">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-md"
                        style={{ background: a.gradient || "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>
                        {a.name[0]}
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background ${a.status === "ACTIVE" ? "bg-green-400 animate-pulse" : a.status === "PAUSED" ? "bg-amber-400" : "bg-muted-foreground"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{a.name}</span>
                        <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${a.status === "ACTIVE" ? "border-green-600/40 text-green-700 dark:text-green-400" : a.status === "PAUSED" ? "border-amber-600/40 text-amber-700 dark:text-amber-400" : ""}`}>
                          {a.status === "ACTIVE" ? "Online" : a.status === "PAUSED" ? "Paused" : a.status}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">L{a.autonomyLevel}</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {agentActivity ? agentActivity.summary : `Deployed · ${a.projectCount || 1} project${(a.projectCount || 1) !== 1 ? "s" : ""}`}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                  </Link>
                );
              })}
              {agents.length > 3 && (
                <Link href="/agents" className="text-xs text-primary hover:underline pl-12">
                  +{agents.length - 3} more agent{agents.length - 3 !== 1 ? "s" : ""}
                </Link>
              )}
            </div>
          )}
        </div>
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
          suggestions.push({ icon: "🚀", label: "Deploy your first AI agent", desc: "Create a project and deploy an autonomous agent to manage it — plans, risks, reports, all handled by AI", href: "/agents/deploy", priority: "high", color: "border-primary/40 bg-primary/10" });
        }

        // 2. Pending approvals — agent is blocked
        if (pendingApprovals > 0) {
          suggestions.push({ icon: "⏳", label: `${pendingApprovals} approval${pendingApprovals > 1 ? "s" : ""} waiting for you`, desc: "Your agent is paused at a governance gate — review and approve to let it continue", href: "/approvals", priority: "critical", color: "border-amber-600/40 bg-amber-500/10" });
        }

        // 3. High risks flagged
        if (openRisks > 2) {
          suggestions.push({ icon: "⚠️", label: `${openRisks} open risks need attention`, desc: "Your agent flagged risks that may need mitigation strategies or escalation", href: hasProject ? `/projects/${projects[0]?.id}/risk` : "/projects", priority: "high", color: "border-red-600/40 bg-red-500/10" });
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
          suggestions.push({ icon: "📄", label: "New artefacts ready for review", desc: artefactActivity.summary || "Your agent generated documents — review and approve them", href: `/agents/${agents[0]?.id}`, priority: "high", color: "border-emerald-600/40 bg-emerald-500/10" });
        }

        // 7. Phase advanced (celebration)
        const phaseActivity = activities.find((a: any) => a.type === "phase_advance" || a.type === "phase_advanced");
        if (phaseActivity) {
          suggestions.push({ icon: "🎉", label: "Phase advanced", desc: phaseActivity.summary || "Your project moved to the next phase", href: hasAgent ? `/agents/${agents[0]?.id}` : "/agents", priority: "low", color: "border-emerald-600/40 bg-emerald-500/10" });
        }

        // 8. Tasks overdue
        const overdueActivity = activities.find((a: any) => a.type === "overdue_alert");
        if (overdueActivity) {
          suggestions.push({ icon: "📋", label: "Overdue tasks detected", desc: overdueActivity.summary || "Some tasks are past their deadline", href: hasProject ? `/projects/${projects[0]?.id}/schedule` : "/projects", priority: "high", color: "border-red-600/40 bg-red-500/10" });
        }

        // 9. No projects but has agent (unusual state)
        if (hasAgent && !hasProject) {
          suggestions.push({ icon: "📁", label: "No active projects", desc: "Your agent is deployed but has no project — deploy to a project to start autonomous management", href: "/agents/deploy", priority: "medium", color: "border-amber-600/40 bg-amber-500/10" });
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Active Projects", value: stats?.activeProjects || 0, icon: FolderKanban, color: "text-primary", bg: "bg-primary/10", sub: stats?.activeProjects ? `${projects.length} total` : null },
          { label: "Tasks Done", value: stats?.completedTasks || 0, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10", sub: stats?.totalTasks ? `of ${stats.totalTasks} (${stats.totalTasks > 0 ? Math.round((stats.completedTasks / stats.totalTasks) * 100) : 0}%)` : null },
          { label: "Approvals", value: stats?.pendingApprovals || 0, icon: FileWarning, color: (stats?.pendingApprovals || 0) > 0 ? "text-amber-500" : "text-muted-foreground", bg: (stats?.pendingApprovals || 0) > 0 ? "bg-amber-500/10" : "bg-muted/50", sub: (stats?.pendingApprovals || 0) > 0 ? "action needed" : "all clear" },
          { label: "Open Risks", value: stats?.openRisks || 0, icon: AlertTriangle, color: (stats?.openRisks || 0) > 2 ? "text-red-500" : "text-muted-foreground", bg: (stats?.openRisks || 0) > 2 ? "bg-red-500/10" : "bg-muted/50", sub: (stats?.openRisks || 0) > 2 ? "needs review" : (stats?.openRisks || 0) > 0 ? "within tolerance" : "none flagged" },
        ].map((s) => (
          <Card key={s.label} className="hover:border-primary/20 transition-colors">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between mb-2">
                <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{s.label}</span>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${s.bg}`}>
                  <s.icon className={`w-4 h-4 ${s.color}`} />
                </div>
              </div>
              <p className="text-2xl font-bold tracking-tight">{s.value}</p>
              {s.sub && <p className="text-[10px] text-muted-foreground mt-0.5">{s.sub}</p>}
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
            {/* Task Progress — donut chart */}
            <Card className="px-5">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Task Progress</CardTitle></CardHeader>
              <CardContent>
                {stats.totalTasks > 0 ? (() => {
                  const open = stats.totalTasks - stats.completedTasks - (stats.pendingApprovals || 0);
                  const pct = Math.round((stats.completedTasks / stats.totalTasks) * 100);
                  const COLORS = ["#10B981", "#6366F1", "#F59E0B", "#E2E8F0"];
                  const data = [
                    { name: "Done", value: stats.completedTasks },
                    { name: "In Progress", value: Math.max(0, open) },
                    { name: "Blocked", value: stats.pendingApprovals || 0 },
                  ].filter(d => d.value > 0);
                  return (
                    <div className="flex items-center gap-4">
                      <div className="relative w-[120px] h-[120px] flex-shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={data} cx="50%" cy="50%" innerRadius={36} outerRadius={52} dataKey="value" strokeWidth={2} stroke="hsl(var(--background))">
                              {data.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                            </Pie>
                            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="text-center">
                            <p className="text-lg font-bold leading-none">{pct}%</p>
                            <p className="text-[9px] text-muted-foreground">complete</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex-1 space-y-2">
                        {[
                          { label: "Completed", value: stats.completedTasks, color: "bg-emerald-500" },
                          { label: "In Progress", value: Math.max(0, open), color: "bg-primary" },
                          { label: "Blocked", value: stats.pendingApprovals || 0, color: "bg-amber-500" },
                        ].map(r => (
                          <div key={r.label} className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${r.color} flex-shrink-0`} />
                            <span className="text-xs text-muted-foreground flex-1">{r.label}</span>
                            <span className="text-xs font-semibold">{r.value}</span>
                          </div>
                        ))}
                        <div className="pt-1 border-t border-border/30">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground flex-1">Total</span>
                            <span className="text-xs font-bold">{stats.totalTasks}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })() : (
                  <div className="flex items-center justify-center h-[140px] text-center">
                    <div>
                      <CheckCircle2 className="w-6 h-6 text-muted-foreground/20 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground">No tasks yet — deploy an agent</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Portfolio Health — RAG per project */}
            <Card className="px-5">
              <CardHeader className="pb-2"><CardTitle className="text-sm">Portfolio Health</CardTitle></CardHeader>
              <CardContent>
                {projects.length > 0 ? (
                  <div className="space-y-3">
                    {projects.slice(0, 4).map((p: any) => {
                      const progress = p.taskCount > 0 ? Math.round(((p.completedCount || 0) / p.taskCount) * 100) : 0;
                      const rag = p.riskCount > 3 ? "RED" : p.riskCount > 0 || progress < 30 ? "AMBER" : "GREEN";
                      const ragColor = rag === "RED" ? "bg-red-500" : rag === "AMBER" ? "bg-amber-500" : "bg-emerald-500";
                      const ragRing = rag === "RED" ? "ring-red-500/20" : rag === "AMBER" ? "ring-amber-500/20" : "ring-emerald-500/20";
                      return (
                        <Link key={p.id} href={`/projects/${p.id}`} className="block group">
                          <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full ${ragColor} ring-4 ${ragRing} flex-shrink-0`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium truncate group-hover:text-primary transition-colors">{p.name}</span>
                                <span className="text-[10px] text-muted-foreground ml-2">{progress}%</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-border/30 mt-1.5 overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${ragColor}`} style={{ width: `${Math.max(3, progress)}%` }} />
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 ml-6 mt-1">
                            <span className="text-[10px] text-muted-foreground">{p.taskCount || 0} tasks</span>
                            <span className="text-[10px] text-muted-foreground">{p.riskCount || 0} risks</span>
                            {p.budget > 0 && <span className="text-[10px] text-muted-foreground">£{(p.budget || 0).toLocaleString()}</span>}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[140px] text-center">
                    <div>
                      <FolderKanban className="w-6 h-6 text-muted-foreground/20 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground">No projects yet</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Burndown Chart */}
          {stats.totalTasks > 0 && (() => {
            const total = stats.totalTasks;
            const done = stats.completedTasks;
            const weeks = 8;
            const ideal = Array.from({ length: weeks + 1 }, (_, i) => ({
              week: i === 0 ? "Start" : `W${i}`,
              ideal: Math.round(total - (total / weeks) * i),
              actual: i === 0 ? total : i < Math.ceil(done / (total / weeks)) ? Math.max(0, total - Math.round((total / weeks) * i * (done / total) * 1.15)) : undefined,
            }));
            return (
              <Card className="px-5">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Sprint Burndown</CardTitle>
                    <span className="text-[10px] text-muted-foreground">{done}/{total} tasks complete</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="h-[160px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={ideal} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                        <XAxis dataKey="week" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} />
                        <Line type="monotone" dataKey="ideal" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="5 5" dot={false} name="Ideal" />
                        <Line type="monotone" dataKey="actual" stroke="#6366F1" strokeWidth={2} dot={{ r: 3, fill: "#6366F1" }} connectNulls={false} name="Actual" />
                        <ReferenceLine y={0} stroke="hsl(var(--border))" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex items-center gap-4 mt-2 justify-center">
                    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className="w-5 border-t-2 border-dashed border-muted-foreground/50" />Ideal</span>
                    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className="w-5 border-t-2 border-primary" />Actual</span>
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* Phase Pipeline — visual stepper showing agent lifecycle progress */}
          {agents.length > 0 && (
            <Card className="px-5">
              <CardHeader className="pb-3"><CardTitle className="text-sm">Agent Lifecycle Pipeline</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {agents.map((a: any) => {
                    const deployment = a.deployment || a;
                    const currentPhase = deployment.currentPhase || "Requirements";
                    const methodology = projects.find((p: any) => p.agent?.id === a.id)?.methodology || "WATERFALL";
                    const phases = METHOD_LABEL[methodology] === "Traditional"
                      ? ["Pre-Project", "Initiation", "Planning", "Execution", "Closing"]
                      : methodology === "AGILE_SCRUM" || methodology === "scrum"
                      ? ["Sprint Zero", "Sprint Cadence", "Release"]
                      : ["Requirements", "Design", "Build", "Test", "Deploy"];
                    const currentIdx = phases.findIndex(p => p === currentPhase);
                    const phaseStatus = deployment.phaseStatus || "active";

                    return (
                      <div key={a.id}>
                        <div className="flex items-center gap-2 mb-2.5">
                          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                            style={{ background: a.gradient || "#6366F1" }}>{a.name[0]}</div>
                          <span className="text-xs font-semibold">{a.name}</span>
                          {phaseStatus === "pending_approval" && (
                            <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-500 ml-auto">Gate Pending</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {phases.map((phase, i) => {
                            const isDone = i < currentIdx;
                            const isCurrent = i === currentIdx;
                            const isFuture = i > currentIdx;
                            return (
                              <div key={phase} className="flex items-center flex-1 min-w-0">
                                <div className={`flex-1 flex flex-col items-center gap-1`}>
                                  <div className={`w-full h-2 rounded-full transition-all ${
                                    isDone ? "bg-emerald-500" : isCurrent ? (phaseStatus === "pending_approval" ? "bg-amber-500 animate-pulse" : "bg-primary") : "bg-border/40"
                                  }`} />
                                  <span className={`text-[9px] truncate max-w-full ${isCurrent ? "font-bold text-foreground" : isDone ? "text-emerald-600" : "text-muted-foreground/50"}`}>
                                    {phase}
                                  </span>
                                </div>
                                {i < phases.length - 1 && <div className="w-0.5 flex-shrink-0" />}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Agent Fleet Summary — shows all agents with project assignments */}
          {agents.length > 0 && (
            <Card className="px-5">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-sm">Agent Fleet</CardTitle>
                <Link href="/agents"><Button variant="ghost" size="sm" className="text-xs gap-1">Manage <ArrowRight className="w-3 h-3" /></Button></Link>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {agents.map((a: any) => {
                    const agentProject = projects.find((p: any) => p.agent?.id === a.id);
                    return (
                      <Link key={a.id} href={`/agents/${a.id}`} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted/30 transition-colors group">
                        <div className="relative flex-shrink-0">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
                            style={{ background: a.gradient || "#6366F1" }}>{a.name[0]}</div>
                          <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-[1.5px] border-background ${a.status === "ACTIVE" ? "bg-green-400" : a.status === "PAUSED" ? "bg-amber-400" : "bg-muted-foreground"}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium">{a.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {agentProject ? agentProject.name : "No project assigned"} · L{a.autonomyLevel}
                          </p>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </Link>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
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
              <CardTitle className="text-sm">Activity</CardTitle>
              {activities.length > 0 && <span className="text-[10px] text-muted-foreground">{activities.length} recent</span>}
            </CardHeader>
            <CardContent>
              {activities.length === 0 ? (
                <div className="text-center py-6">
                  <Activity className="w-5 h-5 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No activity yet</p>
                </div>
              ) : (
                <div className="space-y-0">
                  {activities.map((a: any, i: number) => (
                    <div key={a.id} className="flex gap-3 group">
                      <div className="flex flex-col items-center">
                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${ACTIVITY_COLORS[a.type] || "bg-muted-foreground/50"}`} />
                        {i < activities.length - 1 && <div className="w-px flex-1 mt-1 bg-border/50" />}
                      </div>
                      <div className="pb-4 flex-1 min-w-0">
                        <p className="text-[12px] leading-relaxed">
                          <span className="font-semibold">{a.agentName || "Agent"}</span>
                          <span className="text-muted-foreground"> · </span>
                          <span className="text-muted-foreground">{a.summary}</span>
                        </p>
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">{timeAgo(a.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Credits */}
          <Card className="px-5">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Credits</span>
                <Link href="/billing/credits" className="text-[10px] text-primary hover:underline">Top up</Link>
              </div>
              <div className="flex items-baseline gap-1.5">
                <p className="text-2xl font-bold tracking-tight">{(stats?.creditBalance || 0).toLocaleString()}</p>
                <span className="text-xs text-muted-foreground">remaining</span>
              </div>
              {(() => {
                const bal = stats?.creditBalance || 0;
                const pct = Math.min(100, (bal / 5000) * 100);
                const color = pct < 10 ? "bg-red-500" : pct < 25 ? "bg-amber-500" : "bg-emerald-500";
                return (
                  <div className="h-1.5 rounded-full bg-border/30 mt-3 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          {/* Budget Burn — visual spend vs budget per project */}
          {projects.some((p: any) => p.budget > 0) && (
            <Card className="px-5">
              <CardHeader className="pb-3"><CardTitle className="text-sm">Budget Overview</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {projects.filter((p: any) => p.budget > 0).slice(0, 3).map((p: any) => {
                    const spent = p.actualCost || 0;
                    const pct = p.budget > 0 ? Math.round((spent / p.budget) * 100) : 0;
                    const remaining = Math.max(0, p.budget - spent);
                    const barColor = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-emerald-500";
                    return (
                      <div key={p.id}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium truncate flex-1">{p.name}</span>
                          <span className="text-[10px] text-muted-foreground ml-2">£{remaining.toLocaleString()} left</span>
                        </div>
                        <div className="h-2 rounded-full bg-border/30 overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[10px] text-muted-foreground">£{spent.toLocaleString()} spent</span>
                          <span className="text-[10px] font-medium">£{p.budget.toLocaleString()} total</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Risk Category Chart */}
          {stats.openRisks > 0 && (() => {
            const riskData = projects.filter((p: any) => p.riskCount > 0).map((p: any) => ({
              name: p.name.length > 12 ? p.name.slice(0, 12) + "…" : p.name,
              High: Math.ceil(p.riskCount * 0.3),
              Medium: Math.ceil(p.riskCount * 0.3),
              Low: Math.max(0, p.riskCount - Math.ceil(p.riskCount * 0.3) - Math.ceil(p.riskCount * 0.3)),
            }));
            return (
              <Card className="px-5">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Risk by Category</CardTitle>
                    <Badge variant="destructive" className="text-[9px]">{stats.openRisks} open</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="h-[140px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={riskData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} />
                        <Bar dataKey="High" fill="#EF4444" radius={[2, 2, 0, 0]} stackId="a" />
                        <Bar dataKey="Medium" fill="#F59E0B" stackId="a" />
                        <Bar dataKey="Low" fill="#EAB308" radius={[0, 0, 2, 2]} stackId="a" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex items-center gap-3 mt-1 justify-center">
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><span className="w-2 h-2 rounded-sm bg-red-500" />High</span>
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><span className="w-2 h-2 rounded-sm bg-amber-500" />Medium</span>
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><span className="w-2 h-2 rounded-sm bg-yellow-400" />Low</span>
                  </div>
                </CardContent>
              </Card>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
