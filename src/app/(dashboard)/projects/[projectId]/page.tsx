"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useProject } from "@/hooks/use-api";
import { useOrgCurrency } from "@/hooks/use-currency";
import { formatMoney } from "@/lib/currency";
import { useAppStore } from "@/stores/app";
import {
  Calendar, Columns3, Timer, Target, DollarSign, Users, ShieldAlert,
  AlertTriangle, GitPullRequest, TestTube2, TrendingUp, FileText, Bot,
  ArrowRight, Sheet, FileCheck2, Download,
} from "lucide-react";
import { isSpreadsheetArtefact } from "@/lib/artefact-types";

const METHOD_LABEL: Record<string, string> = { PRINCE2: "Traditional", prince2: "Traditional", AGILE_SCRUM: "Scrum", scrum: "Scrum", AGILE_KANBAN: "Kanban", kanban: "Kanban", WATERFALL: "Waterfall", waterfall: "Waterfall", HYBRID: "Hybrid", hybrid: "Hybrid", SAFE: "SAFe", safe: "SAFe" };

const MODULES = [
  { label: "Schedule", href: "schedule", icon: Calendar, desc: "Gantt chart and task timeline" },
  { label: "Agile Board", href: "agile", icon: Columns3, desc: "Kanban board and sprints" },
  { label: "Sprint Tracker", href: "sprint", icon: Timer, desc: "Burndown and velocity" },
  { label: "Scope", href: "scope", icon: Target, desc: "WBS and requirements" },
  { label: "Cost", href: "cost", icon: DollarSign, desc: "Budget vs actual" },
  { label: "Stakeholders", href: "stakeholders", icon: Users, desc: "Power/interest grid" },
  { label: "Risk Register", href: "risk", icon: ShieldAlert, desc: "Risk matrix and mitigation" },
  { label: "Issues", href: "issues", icon: AlertTriangle, desc: "Issue tracking and resolution" },
  { label: "Change Control", href: "change-control", icon: GitPullRequest, desc: "Change requests and CCB" },
  { label: "QA & Testing", href: "qa-testing", icon: TestTube2, desc: "Test execution and defects" },
  { label: "EVM Dashboard", href: "evm", icon: TrendingUp, desc: "Earned value metrics" },
  { label: "Reports", href: "reports", icon: FileText, desc: "Status and executive reports" },
  { label: "Scorecard", href: "scorecard", icon: Target, desc: "Project objectives & agent performance" },
  { label: "Artefacts", href: "artefacts", icon: FileText, desc: "Agent-generated documents" },
  { label: "Audit Trail", href: "audit", icon: ShieldAlert, desc: "Agent decision log" },
];

export default function ProjectOverviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading } = useProject(projectId);
  const { setActiveProject } = useAppStore();

  useEffect(() => {
    if (project) setActiveProject(project.id, project.name);
  }, [project, setActiveProject]);

  if (isLoading) {
    return <div className="space-y-6 max-w-[1400px]"><Skeleton className="h-32 rounded-2xl" /><div className="grid grid-cols-3 gap-4">{[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div></div>;
  }

  if (!project) {
    return <div className="text-center py-20"><h2 className="text-lg font-bold">Project not found</h2><Link href="/projects"><Button className="mt-4">Back to Projects</Button></Link></div>;
  }

  const agent = project.agents?.[0]?.agent;
  const counts = project._count || {};

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="rounded-2xl p-5 border border-primary/20 bg-gradient-to-r from-primary/10 via-accent/5 to-transparent">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="outline">{METHOD_LABEL[project.methodology] || project.methodology}</Badge>
              <Badge variant={project.status === "ACTIVE" ? "default" : "secondary"}>{project.status}</Badge>
              {project.tier && <Badge variant="secondary" className="text-[9px]">{project.tier === "TASK" ? "Quick Task" : project.tier === "LIGHTWEIGHT" ? "Lightweight" : project.tier === "STANDARD" ? "Standard" : "Complex"}</Badge>}
              {project.priority && <Badge variant={project.priority === "high" ? "destructive" : "secondary"}>{project.priority}</Badge>}
            </div>
            {project.description && <p className="text-sm text-muted-foreground mt-2 max-w-lg">{project.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.location.href = `/api/projects/${projectId}/export?format=xlsx`;
              }}
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              Export
            </Button>
            {agent && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-base font-bold text-white"
                  style={{ background: agent.gradient || "#6366F1" }}>{agent.name[0]}</div>
                <div>
                  <p className="text-sm font-semibold">Agent {agent.name}</p>
                  <p className="text-xs text-muted-foreground">L{agent.autonomyLevel} · {agent.status}</p>
                </div>
                <span className={`w-2 h-2 rounded-full ${agent.status === "ACTIVE" ? "bg-green-400 animate-pulse" : "bg-amber-400"}`} />
              </div>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-6 mt-4 text-sm text-muted-foreground flex-wrap">
          <span>{counts.tasks || 0} tasks</span>
          <span>{counts.risks || 0} risks</span>
          <span>{counts.issues || 0} issues</span>
          <span>{counts.changeRequests || 0} change requests</span>
          <span>{counts.stakeholders || 0} stakeholders</span>
          <span>{counts.approvals || 0} approvals</span>
          {project.budget && <span className="font-semibold text-foreground">${project.budget.toLocaleString()} budget</span>}
        </div>
      </div>

      {/* Phase Gates + Lifecycle Status */}
      {project.phases && project.phases.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Lifecycle Progress</CardTitle>
              {agent && (
                <Badge variant="outline" className="text-[10px]">
                  Managed by {agent.name} · L{agent.autonomyLevel}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-1">
              {project.phases.map((p: any, i: number) => (
                <div key={p.id} className="flex items-center gap-1 flex-1">
                  <div className="flex flex-col items-center gap-1 flex-1">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold transition-all ${
                      p.status === "COMPLETED" ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/30"
                      : p.status === "ACTIVE" ? "bg-primary text-white shadow-sm shadow-primary/30 ring-2 ring-primary/20"
                      : "bg-muted text-muted-foreground"
                    }`}>
                      {p.status === "COMPLETED" ? "✓" : i + 1}
                    </div>
                    <span className={`text-[10px] font-medium text-center leading-tight ${
                      p.status === "ACTIVE" ? "text-primary font-semibold" : p.status === "COMPLETED" ? "text-emerald-500" : "text-muted-foreground"
                    }`}>{p.name}</span>
                  </div>
                  {i < project.phases.length - 1 && (
                    <div className={`h-0.5 flex-1 rounded-full min-w-[20px] ${
                      p.status === "COMPLETED" ? "bg-emerald-500" : "bg-border"
                    }`} />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* EVM + Health Summary */}
      <ProjectHealthCard projectId={projectId} />

      {/* Similar past projects (ML) */}
      <SimilarProjectsWidget projectId={projectId} />

      {/* Agent Artefacts */}
      <ArtefactSection projectId={projectId} />

      {/* Module cards */}
      <div>
        <h2 className="text-lg font-bold mb-3">Project Modules</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {MODULES.map(m => (
            <Link key={m.href} href={`/projects/${projectId}/${m.href}`}>
              <Card className="hover:-translate-y-0.5 transition-all cursor-pointer h-full">
                <CardContent className="pt-4">
                  <m.icon className="w-5 h-5 text-primary mb-2" />
                  <p className="text-sm font-semibold">{m.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{m.desc}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Similar Past Projects (ML) ───
function SimilarProjectsWidget({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    fetch(`/api/ml/predictions?kind=similar_projects&projectId=${projectId}&k=4`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setItems(d.data || []);
      })
      .catch(() => setError("Could not fetch similar projects"))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return <Skeleton className="h-20 rounded-xl" />;
  if (error || items.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">Similar Past Projects</CardTitle>
            <Badge variant="secondary" className="text-[10px]">ML</Badge>
          </div>
          <span className="text-[10px] text-muted-foreground">Cosine similarity on description, methodology, category</span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {items.map((p: any) => {
            const pct = Math.round(p.similarity * 100);
            const barColour = pct >= 75 ? "bg-emerald-500" : pct >= 50 ? "bg-primary" : "bg-amber-500";
            return (
              <Link key={p.projectId} href={`/projects/${p.projectId}`}
                className="block p-3 rounded-lg border border-border hover:border-primary/40 hover:bg-muted/40 transition-all">
                <p className="text-sm font-semibold truncate">{p.name}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full ${barColour}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] text-primary font-semibold flex-shrink-0">{pct}%</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {p.category && <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">{p.category}</span>}
                  {p.status && <span className="text-[9px] text-muted-foreground">{p.status}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Artefact Section ───
function ArtefactSection({ projectId }: { projectId: string }) {
  const [artefacts, setArtefacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/artefacts`).then(r => r.json()).then(d => {
      setArtefacts(d.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [projectId]);

  if (loading) return <Skeleton className="h-24 rounded-xl" />;
  if (artefacts.length === 0) return null;

  const statusColors: Record<string, string> = {
    DRAFT: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    PENDING_REVIEW: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    APPROVED: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    REJECTED: "bg-red-500/10 text-red-500 border-red-500/20",
  };

  const approved = artefacts.filter(a => a.status === "APPROVED").length;
  const pending = artefacts.filter(a => a.status === "DRAFT" || a.status === "PENDING_REVIEW").length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">Agent-Generated Artefacts</CardTitle>
            <Badge variant="secondary" className="text-[10px]">{artefacts.length}</Badge>
            {pending > 0 && (
              <Badge variant="outline" className="text-[9px] text-amber-500 border-amber-500/30">
                {pending} awaiting review
              </Badge>
            )}
            {approved > 0 && (
              <Badge variant="outline" className="text-[9px] text-emerald-500 border-emerald-500/30">
                {approved} approved
              </Badge>
            )}
          </div>
          <Link href={`/projects/${projectId}/artefacts`}
            className="flex items-center gap-1 text-xs text-primary hover:underline font-medium">
            View all &amp; edit <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-1.5">
          {artefacts.map((a: any) => {
            const isSheet = a.format === "csv" || isSpreadsheetArtefact(a.name);
            return (
              <Link key={a.id} href={`/projects/${projectId}/artefacts`}
                className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/40 transition-colors group cursor-pointer">
                {/* Format icon */}
                <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${
                  isSheet ? "bg-emerald-500/10 text-emerald-600" : "bg-blue-500/10 text-blue-600"
                }`}>
                  {isSheet ? <Sheet className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{a.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                    <span className="uppercase tracking-wide">{isSheet ? "Spreadsheet" : "Document"}</span>
                    <span>·</span>
                    <span>v{a.version}</span>
                    <span>·</span>
                    <span>{new Date(a.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-[9px] px-2 py-0.5 rounded-full border font-medium ${statusColors[a.status] || "bg-muted text-muted-foreground"}`}>
                    {a.status === "PENDING_REVIEW" ? "In Review" : a.status === "DRAFT" ? "Draft" : a.status === "APPROVED" ? "Approved" : a.status}
                  </span>
                  {a.status === "APPROVED" && <FileCheck2 className="w-3.5 h-3.5 text-emerald-500" />}
                  <ArrowRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </Link>
            );
          })}
        </div>

        {/* Footer CTA */}
        <div className="mt-3 pt-3 border-t border-border/40">
          <Link href={`/projects/${projectId}/artefacts`}
            className="flex items-center justify-center gap-2 w-full py-2 rounded-lg border border-dashed border-border/60 text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors">
            <FileText className="w-3.5 h-3.5" />
            Open Document Library — review, edit &amp; approve
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Project Health Card (EVM + RAG) ───
function ProjectHealthCard({ projectId }: { projectId: string }) {
  const [metrics, setMetrics] = useState<any>(null);
  const currency = useOrgCurrency();
  const moneyCompact = (n: number) => formatMoney(n, currency, { compact: true });

  useEffect(() => {
    fetch(`/api/projects/${projectId}/metrics`).then(r => r.json()).then(d => setMetrics(d.data)).catch(() => {});
  }, [projectId]);

  if (!metrics) return null;

  const { evm, health, tasks } = metrics;
  // Always show the health card if we have metrics, but only show EVM gauges
  // when there is real earned-value data (project started + tasks done)

  const ragColors: Record<string, { bg: string; text: string; label: string }> = {
    GREEN: { bg: "bg-emerald-500/10", text: "text-emerald-500", label: "On Track" },
    AMBER: { bg: "bg-amber-500/10", text: "text-amber-500", label: "At Risk" },
    RED: { bg: "bg-red-500/10", text: "text-red-500", label: "Critical" },
  };

  // SPI/CPI gauge — only rendered when the value is a real number (not null)
  const Gauge = ({ value, label }: { value: number | null; label: string }) => {
    if (value === null) {
      return (
        <div className="text-center">
          <div className="relative w-16 h-16 mx-auto flex items-center justify-center rounded-full border-2 border-dashed border-border/40">
            <span className="text-xs text-muted-foreground font-medium">N/A</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">{label}</p>
        </div>
      );
    }
    const pct = Math.min(100, Math.max(0, value * 50)); // 1.0 = 50%, 2.0 = 100%
    const color = value >= 1.0 ? "#10B981" : value >= 0.9 ? "#F59E0B" : "#EF4444";
    return (
      <div className="text-center">
        <div className="relative w-16 h-16 mx-auto">
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <circle cx="18" cy="18" r="15" fill="none" stroke="var(--border)" strokeWidth="3" opacity={0.3} />
            <circle cx="18" cy="18" r="15" fill="none" stroke={color} strokeWidth="3"
              strokeDasharray={`${pct} ${100 - pct}`} strokeLinecap="round" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-sm font-bold" style={{ color }}>{value.toFixed(2)}</span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">{label}</p>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* EVM Gauges */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Performance Indices</CardTitle>
          {!evm?.hasRealEvm && (
            <p className="text-[10px] text-muted-foreground">Available once the project is underway and costs are tracked</p>
          )}
          {evm?.hasRealEvm && evm?.spiInsufficientData && (
            <p className="text-[10px] text-amber-500/80" title="SPI = Earned Value / Planned Value. Early in a project the Planned Value is tiny, so SPI swings wildly. Hidden until 15% of the timeline has elapsed.">
              SPI hidden — project is too early in its timeline for a meaningful schedule index.
            </p>
          )}
        </CardHeader>
        <CardContent>
          {evm?.hasRealEvm ? (
            <>
              <div className="flex items-center justify-around">
                <Gauge value={evm.spi} label="SPI (Schedule)" />
                <Gauge value={evm.cpi} label="CPI (Cost)" />
              </div>
              <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                <div className="p-2 rounded-lg bg-muted/30" title="Total approved project budget.">
                  <p className="text-xs font-bold">{moneyCompact(evm.budget)}</p>
                  <p className="text-[9px] text-muted-foreground">Budget</p>
                </div>
                <div className="p-2 rounded-lg bg-muted/30" title="Earned Value (EV) — the budgeted value of completed work, NOT money spent. EV = budget × (tasks done ÷ total tasks).">
                  <p className="text-xs font-bold">{moneyCompact(evm.ev)}</p>
                  <p className="text-[9px] text-muted-foreground">Earned <span className="opacity-60">ⓘ</span></p>
                </div>
                <div className="p-2 rounded-lg bg-muted/30" title="Estimate at Completion (EAC) — projected total cost based on actual spending so far. Available once actual costs are tracked.">
                  <p className="text-xs font-bold">{evm.eac ? moneyCompact(evm.eac) : "—"}</p>
                  <p className="text-[9px] text-muted-foreground">Forecast</p>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 gap-2 text-muted-foreground">
              <svg className="w-8 h-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
              <p className="text-xs text-center">No EVM data yet.<br />Indices appear once work begins and actual costs are logged.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Health RAG */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Project Health</CardTitle></CardHeader>
        <CardContent>
          {/* Overall RAG */}
          <div className={`flex items-center gap-3 p-3 rounded-xl mb-3 ${ragColors[health.overall]?.bg || "bg-muted/30"}`}>
            <div className={`w-3 h-3 rounded-full ${health.overall === "GREEN" ? "bg-emerald-500" : health.overall === "AMBER" ? "bg-amber-500" : "bg-red-500"}`} />
            <span className={`text-sm font-bold ${ragColors[health.overall]?.text || ""}`}>{ragColors[health.overall]?.label || health.overall}</span>
          </div>
          {/* Dimension breakdown */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Schedule", status: health.schedule },
              { label: "Budget", status: health.budget },
              { label: "Risk", status: health.risk },
            ].map(d => (
              <div key={d.label} className={`p-2 rounded-lg text-center ${ragColors[d.status]?.bg || "bg-muted/30"}`}>
                <div className={`w-2 h-2 rounded-full mx-auto mb-1 ${d.status === "GREEN" ? "bg-emerald-500" : d.status === "AMBER" ? "bg-amber-500" : "bg-red-500"}`} />
                <p className="text-[10px] font-medium">{d.label}</p>
              </div>
            ))}
          </div>
          {/* Task summary */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/20 text-xs text-muted-foreground">
            <span>{tasks.done}/{tasks.total} tasks done</span>
            <span>{tasks.blocked > 0 ? `${tasks.blocked} blocked` : "No blockers"}</span>
            <span>{tasks.overdue > 0 ? `${tasks.overdue} overdue` : "On schedule"}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
