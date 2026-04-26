"use client";

import { usePageTitle } from "@/hooks/use-page-title";
import { useProjects } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  FolderKanban, AlertTriangle, CheckCircle2, Clock, TrendingUp,
  ArrowRight, ChevronRight, Calendar, DollarSign, BarChart3,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { PageHeader } from "@/components/layout/page-header";

// ── Helpers ──

const METHOD_LABEL: Record<string, string> = {
  PRINCE2: "Traditional", traditional: "Traditional", TRADITIONAL: "Traditional",
  WATERFALL: "Waterfall", waterfall: "Waterfall", AGILE_SCRUM: "Scrum", scrum: "Scrum",
  AGILE_KANBAN: "Kanban", kanban: "Kanban", HYBRID: "Hybrid", hybrid: "Hybrid",
  SAFE: "SAFe", safe: "SAFe",
};

function healthColor(h: string) {
  return h === "GREEN" ? "text-emerald-500" : h === "AMBER" ? "text-amber-500" : "text-red-500";
}
function healthBg(h: string) {
  return h === "GREEN" ? "bg-emerald-500/10 border-emerald-500/20" : h === "AMBER" ? "bg-amber-500/10 border-amber-500/20" : "bg-red-500/10 border-red-500/20";
}
function healthDot(h: string) {
  return h === "GREEN" ? "bg-emerald-400" : h === "AMBER" ? "bg-amber-400" : "bg-red-400";
}

function daysRemaining(endDate: string | null): string {
  if (!endDate) return "No end date";
  const d = Math.ceil((new Date(endDate).getTime() - Date.now()) / 86_400_000);
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return "Due today";
  return `${d}d remaining`;
}

// ================================================================
// COMPONENT
// ================================================================

export default function PortfolioPage() {
  const { data: apiProjects, isLoading } = useProjects();
  usePageTitle("Portfolio");
  const [showExecReport, setShowExecReport] = useState(false);

  // Normalize projects from API — derive health, progress, counts from actual data
  const projects = useMemo(() => {
    if (!apiProjects || !Array.isArray(apiProjects)) return [];
    return apiProjects.map((p: any) => {
      const taskCount = p._count?.tasks ?? p.taskCount ?? 0;
      const riskCount = p._count?.risks ?? p.riskCount ?? 0;
      const pendingApprovals = p._count?.approvals ?? 0;
      const agentDep = p.agents?.[0]?.agent;
      const deployment = p.agents?.[0];

      // Derive health from deployment or risks
      let health = "GREEN";
      if (deployment?.healthStatus) {
        health = deployment.healthStatus;
      } else if (riskCount > 5) {
        health = "RED";
      } else if (riskCount > 2 || pendingApprovals > 0) {
        health = "AMBER";
      }

      // Derive phase from deployment
      const currentPhase = deployment?.currentPhase || null;

      return {
        id: p.id,
        name: p.name,
        description: p.description,
        methodology: p.methodology,
        budget: p.budget || 0,
        startDate: p.startDate,
        endDate: p.endDate,
        taskCount,
        riskCount,
        pendingApprovals,
        health,
        currentPhase,
        agent: agentDep ? { name: agentDep.name, gradient: agentDep.gradient, status: agentDep.status } : null,
        tier: p.tier,
      };
    });
  }, [apiProjects]);

  // Portfolio-level stats
  const totalBudget = projects.reduce((s, p) => s + p.budget, 0);
  const totalTasks = projects.reduce((s, p) => s + p.taskCount, 0);
  const totalRisks = projects.reduce((s, p) => s + p.riskCount, 0);
  const greenCount = projects.filter(p => p.health === "GREEN").length;
  const amberCount = projects.filter(p => p.health === "AMBER").length;
  const redCount = projects.filter(p => p.health === "RED").length;

  const budgetData = projects.filter(p => p.budget > 0).map(p => ({
    name: p.name.split(" ").slice(0, 3).join(" "),
    budget: Math.round(p.budget / 1000),
  }));

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-20 rounded-2xl" />
        <div className="grid grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Portfolio"
        subtitle="Cross-project health and resource overview"
        actions={projects.length > 0 ? (
          <Button variant="default" size="sm" onClick={() => setShowExecReport(true)}>
            Generate Executive Report
          </Button>
        ) : undefined}
      />

      {/* ── Portfolio KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="hover:border-primary/20 transition-colors">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start justify-between mb-2">
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Projects</span>
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <FolderKanban className="w-4 h-4 text-primary" />
              </div>
            </div>
            <p className="text-2xl font-bold tracking-tight">{projects.length}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{totalTasks} tasks across all</p>
          </CardContent>
        </Card>

        <Card className="hover:border-primary/20 transition-colors">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start justify-between mb-2">
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Health</span>
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </div>
            </div>
            <div className="flex items-baseline gap-3">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-lg font-bold">{greenCount}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="text-lg font-bold text-amber-500">{amberCount}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-lg font-bold text-red-500">{redCount}</span>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              {projects.length > 0 ? `${Math.round((greenCount / projects.length) * 100)}% on track` : "No projects"}
            </p>
          </CardContent>
        </Card>

        <Card className="hover:border-primary/20 transition-colors">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start justify-between mb-2">
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Total Risks</span>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${totalRisks > 5 ? "bg-red-500/10" : "bg-muted/50"}`}>
                <AlertTriangle className={`w-4 h-4 ${totalRisks > 5 ? "text-red-500" : "text-muted-foreground"}`} />
              </div>
            </div>
            <p className="text-2xl font-bold tracking-tight">{totalRisks}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              across {projects.filter(p => p.riskCount > 0).length} project{projects.filter(p => p.riskCount > 0).length !== 1 ? "s" : ""}
            </p>
          </CardContent>
        </Card>

        <Card className="hover:border-primary/20 transition-colors">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start justify-between mb-2">
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Total Budget</span>
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-primary" />
              </div>
            </div>
            <p className="text-2xl font-bold tracking-tight">
              {totalBudget >= 1000 ? `£${(totalBudget / 1000).toFixed(0)}K` : `£${totalBudget.toLocaleString()}`}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{projects.filter(p => p.budget > 0).length} budgeted projects</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Project Cards ── */}
      {projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FolderKanban className="w-10 h-10 text-muted-foreground/20 mb-3" />
            <p className="text-sm font-medium text-muted-foreground mb-1">No projects in your portfolio yet</p>
            <p className="text-xs text-muted-foreground/60 mb-4">Create projects and deploy agents to see your portfolio dashboard.</p>
            <Link href="/agents/deploy"><Button size="sm">Create First Project</Button></Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map(p => (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <Card className="h-full hover:border-primary/30 hover:shadow-md transition-all group cursor-pointer">
                <CardContent className="pt-4 pb-4">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${healthDot(p.health)}`} />
                        <h3 className="text-sm font-semibold truncate">{p.name}</h3>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <Badge variant="outline" className="text-[9px]">{METHOD_LABEL[p.methodology] || p.methodology}</Badge>
                        {p.tier && <Badge variant="secondary" className="text-[9px]">{p.tier}</Badge>}
                      </div>
                    </div>
                    <Badge className={`text-[9px] border ${healthBg(p.health)}`}>
                      <span className={healthColor(p.health)}>
                        {p.health === "GREEN" ? "On Track" : p.health === "AMBER" ? "At Risk" : "Critical"}
                      </span>
                    </Badge>
                  </div>

                  {/* Phase */}
                  {p.currentPhase && (
                    <div className="flex items-center gap-1.5 mb-3 text-[11px] text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <span>Phase: <span className="font-medium text-foreground">{p.currentPhase}</span></span>
                    </div>
                  )}

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="text-center p-2 rounded-lg bg-muted/30">
                      <p className="text-sm font-bold">{p.taskCount}</p>
                      <p className="text-[9px] text-muted-foreground">Tasks</p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-muted/30">
                      <p className={`text-sm font-bold ${p.riskCount > 3 ? "text-red-500" : ""}`}>{p.riskCount}</p>
                      <p className="text-[9px] text-muted-foreground">Risks</p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-muted/30">
                      <p className="text-sm font-bold">{p.budget > 0 ? `£${(p.budget / 1000).toFixed(0)}K` : "—"}</p>
                      <p className="text-[9px] text-muted-foreground">Budget</p>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between">
                    {p.agent ? (
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                          style={{ background: p.agent.gradient || "#6366F1" }}>{p.agent.name[0]}</div>
                        <span className="text-[11px] text-muted-foreground">{p.agent.name}</span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">No agent</span>
                    )}
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      {p.endDate && (
                        <>
                          <Calendar className="w-3 h-3" />
                          <span>{daysRemaining(p.endDate)}</span>
                        </>
                      )}
                      <ChevronRight className="w-3.5 h-3.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* ── Budget Overview Chart ── */}
      {budgetData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Budget Allocation</CardTitle>
              <span className="text-[10px] text-muted-foreground">
                Total: £{totalBudget >= 1000 ? `${(totalBudget / 1000).toFixed(0)}K` : totalBudget.toLocaleString()}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={budgetData} barGap={4}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `£${v}K`} />
                <Tooltip
                  contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any) => [`£${v}K`, "Budget"]}
                />
                <Bar dataKey="budget" name="Budget" fill="var(--primary)" radius={[4, 4, 0, 0]} opacity={0.8} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Risk Distribution ── */}
      {totalRisks > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Risk Distribution by Project</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {projects.filter(p => p.riskCount > 0).sort((a, b) => b.riskCount - a.riskCount).map(p => (
                <div key={p.id} className="flex items-center gap-3">
                  <span className="text-xs font-medium w-32 truncate">{p.name}</span>
                  <div className="flex-1 h-2 rounded-full bg-border/30 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${p.riskCount > 5 ? "bg-red-500" : p.riskCount > 2 ? "bg-amber-500" : "bg-emerald-500"}`}
                      style={{ width: `${Math.min(100, (p.riskCount / Math.max(1, ...projects.map(x => x.riskCount))) * 100)}%` }}
                    />
                  </div>
                  <span className={`text-xs font-bold w-6 text-right ${p.riskCount > 5 ? "text-red-500" : p.riskCount > 2 ? "text-amber-500" : ""}`}>
                    {p.riskCount}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Portfolio Timeline ── */}
      {projects.some(p => p.startDate && p.endDate) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Portfolio Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const dated = projects.filter(p => p.startDate && p.endDate);
              const earliest = Math.min(...dated.map(p => new Date(p.startDate!).getTime()));
              const latest = Math.max(...dated.map(p => new Date(p.endDate!).getTime()));
              const span = latest - earliest || 1;
              const now = Date.now();
              const todayPct = Math.max(0, Math.min(100, ((now - earliest) / span) * 100));

              return (
                <div className="relative pt-2 pb-4">
                  {/* Today marker */}
                  <div className="absolute top-0 bottom-0 border-l-2 border-primary/40 border-dashed z-10" style={{ left: `${todayPct}%` }}>
                    <span className="absolute -top-1 -translate-x-1/2 text-[8px] text-primary font-bold">Today</span>
                  </div>

                  <div className="space-y-3 mt-4">
                    {dated.map(p => {
                      const start = new Date(p.startDate!).getTime();
                      const end = new Date(p.endDate!).getTime();
                      const leftPct = ((start - earliest) / span) * 100;
                      const widthPct = Math.max(2, ((end - start) / span) * 100);

                      return (
                        <div key={p.id} className="flex items-center gap-3">
                          <span className="text-[10px] font-medium w-28 truncate text-right text-muted-foreground">{p.name}</span>
                          <div className="flex-1 relative h-5">
                            <div
                              className={`absolute h-full rounded-md ${p.health === "GREEN" ? "bg-emerald-500/30 border border-emerald-500/40" : p.health === "AMBER" ? "bg-amber-500/30 border border-amber-500/40" : "bg-red-500/30 border border-red-500/40"}`}
                              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                            >
                              <span className="absolute inset-0 flex items-center justify-center text-[8px] font-semibold truncate px-1">
                                {p.currentPhase || ""}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Date axis */}
                  <div className="flex justify-between mt-3 text-[9px] text-muted-foreground/50">
                    <span>{new Date(earliest).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</span>
                    <span>{new Date(latest).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</span>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* ── Exec Report Modal ── */}
      {showExecReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowExecReport(false)}>
          <div onClick={e => e.stopPropagation()} className="w-[600px] max-h-[80vh] overflow-y-auto rounded-2xl p-6 bg-card border border-border shadow-2xl">
            <h3 className="text-lg font-bold mb-4">Executive Portfolio Report</h3>
            <div className="space-y-3 mb-5 text-sm leading-relaxed text-muted-foreground">
              <p>
                <strong className="text-foreground">Portfolio Health:</strong> {projects.length} active project{projects.length !== 1 ? "s" : ""}.
                {" "}{greenCount} on track, {amberCount} at risk, {redCount} critical.
              </p>
              <p>
                <strong className="text-foreground">Budget:</strong> Total portfolio budget
                £{totalBudget >= 1000 ? `${(totalBudget / 1000).toFixed(0)}K` : totalBudget.toLocaleString()}.
              </p>
              <p>
                <strong className="text-foreground">Risks:</strong> {totalRisks} open risk{totalRisks !== 1 ? "s" : ""} across
                {" "}{projects.filter(p => p.riskCount > 0).length} project{projects.filter(p => p.riskCount > 0).length !== 1 ? "s" : ""}.
              </p>
              {projects.map(p => (
                <div key={p.id} className="p-3 rounded-lg bg-muted/30 border border-border/30">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full ${healthDot(p.health)}`} />
                    <strong className="text-foreground text-sm">{p.name}</strong>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {METHOD_LABEL[p.methodology] || p.methodology} · {p.taskCount} tasks · {p.riskCount} risks
                    {p.budget > 0 ? ` · £${p.budget.toLocaleString()}` : ""}
                    {p.currentPhase ? ` · Phase: ${p.currentPhase}` : ""}
                  </p>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <Button variant="ghost" size="sm" onClick={() => setShowExecReport(false)}>Close</Button>
              <Button variant="default" size="sm" onClick={() => { window.print(); toast.success("Print dialog opened"); }}>Export PDF</Button>
              <Button variant="default" size="sm" onClick={async () => {
                const emails = prompt("Enter recipient emails (comma-separated):");
                if (!emails) return;
                try {
                  await fetch("/api/portfolio/email", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ recipients: emails.split(",").map(e => e.trim()), subject: "Portfolio Report" }),
                  });
                  toast.success("Report emailed");
                } catch { toast.error("Email failed"); }
              }}>Email to Stakeholders</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
