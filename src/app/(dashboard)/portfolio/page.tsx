"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjects } from "@/hooks/use-api";
import { useAppStore } from "@/stores/app";
import { Briefcase, FolderKanban } from "lucide-react";

const METHOD_LABEL: Record<string, string> = { PRINCE2: "PRINCE2", AGILE_SCRUM: "Scrum", AGILE_KANBAN: "Kanban", WATERFALL: "Waterfall", HYBRID: "Hybrid", SAFE: "SAFe" };

export default function PortfolioPage() {
  const { data: projects, isLoading } = useProjects();
  const { setActiveProject } = useAppStore();

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-64 rounded-xl" /></div>;

  const items = projects || [];
  const active = items.filter((p: any) => p.status === "ACTIVE").length;
  const totalBudget = items.reduce((s: number, p: any) => s + (p.budget || 0), 0);
  const totalTasks = items.reduce((s: number, p: any) => s + (p._count?.tasks || 0), 0);
  const totalRisks = items.reduce((s: number, p: any) => s + (p._count?.risks || 0), 0);

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div><h1 className="text-2xl font-bold">Portfolio Overview</h1><p className="text-sm text-muted-foreground mt-1">{items.length} projects · {active} active · ${(totalBudget/1000).toFixed(0)}K total budget</p></div>

      {items.length === 0 ? (
        <div className="text-center py-20">
          <Briefcase className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No projects in portfolio</h2>
          <p className="text-sm text-muted-foreground mb-4">Deploy agents and create projects to build your portfolio view.</p>
          <Link href="/agents/deploy"><Button>Create First Project</Button></Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4">
            <Card className="p-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Projects</p><p className="text-2xl font-bold">{items.length}</p></Card>
            <Card className="p-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Tasks</p><p className="text-2xl font-bold">{totalTasks}</p></Card>
            <Card className="p-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Open Risks</p><p className="text-2xl font-bold text-destructive">{totalRisks}</p></Card>
            <Card className="p-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Budget</p><p className="text-2xl font-bold text-primary">${(totalBudget/1000).toFixed(0)}K</p></Card>
          </div>

          <Card className="p-0">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border">
                {["Project", "Methodology", "Status", "Budget", "Tasks", "Risks", "Agent"].map(h => (
                  <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {items.map((p: any) => {
                  const agent = p.agents?.[0]?.agent;
                  return (
                    <tr key={p.id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer"
                      onClick={() => setActiveProject(p.id, p.name)}>
                      <td className="py-2.5 px-4"><Link href={`/projects/${p.id}`} className="font-medium hover:text-primary">{p.name}</Link></td>
                      <td className="py-2.5 px-4"><Badge variant="outline" className="text-[9px]">{METHOD_LABEL[p.methodology] || p.methodology}</Badge></td>
                      <td className="py-2.5 px-4"><Badge variant={p.status === "ACTIVE" ? "default" : "secondary"} className="text-[9px]">{p.status}</Badge></td>
                      <td className="py-2.5 px-4">{p.budget ? `$${(p.budget/1000).toFixed(0)}K` : "—"}</td>
                      <td className="py-2.5 px-4">{p._count?.tasks || 0}</td>
                      <td className="py-2.5 px-4">{p._count?.risks || 0}</td>
                      <td className="py-2.5 px-4">
                        {agent ? (
                          <div className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white" style={{ background: agent.gradient || "#6366F1" }}>{agent.name[0]}</div>
                            <span className="text-[10px]">{agent.name}</span>
                          </div>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
