"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useProject } from "@/hooks/use-api";
import { useAppStore } from "@/stores/app";
import {
  Calendar, Columns3, Timer, Target, DollarSign, Users, ShieldAlert,
  AlertTriangle, GitPullRequest, TestTube2, TrendingUp, FileText, Bot,
} from "lucide-react";

const METHOD_LABEL: Record<string, string> = { PRINCE2: "PRINCE2", AGILE_SCRUM: "Scrum", AGILE_KANBAN: "Kanban", WATERFALL: "Waterfall", HYBRID: "Hybrid", SAFE: "SAFe" };

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
              {project.priority && <Badge variant={project.priority === "high" ? "destructive" : "secondary"}>{project.priority}</Badge>}
            </div>
            {project.description && <p className="text-sm text-muted-foreground mt-2 max-w-lg">{project.description}</p>}
          </div>
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
