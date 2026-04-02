"use client";

import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectTasks, useProject } from "@/hooks/use-api";
import { Timer, Target, CheckCircle2, AlertTriangle } from "lucide-react";

export default function SprintTrackerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useProject(projectId);
  const { data: tasks, isLoading } = useProjectTasks(projectId);

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div><Skeleton className="h-64 rounded-xl" /></div>;

  const items = tasks || [];
  const total = items.length;
  const done = items.filter((t: any) => t.status === "DONE").length;
  const inProgress = items.filter((t: any) => t.status === "IN_PROGRESS").length;
  const blocked = items.filter((t: any) => t.status === "BLOCKED").length;
  const totalSP = items.reduce((s: number, t: any) => s + (t.storyPoints || 0), 0);
  const doneSP = items.filter((t: any) => t.status === "DONE").reduce((s: number, t: any) => s + (t.storyPoints || 0), 0);
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <h1 className="text-2xl font-bold">Sprint Tracker</h1>
        <p className="text-sm text-muted-foreground mt-1">{project?.name || "Project"} · {project?.methodology || ""}</p>
      </div>

      {total === 0 ? (
        <div className="text-center py-20">
          <Timer className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No sprint data</h2>
          <p className="text-sm text-muted-foreground mb-4">Sprint tracking begins when tasks are created and sprints are configured by your AI agent.</p>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4"><div className="flex items-center gap-3"><Target className="w-5 h-5 text-primary" /><div><p className="text-[10px] uppercase text-muted-foreground">Total Tasks</p><p className="text-2xl font-bold">{total}</p></div></div></Card>
            <Card className="p-4"><div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-500" /><div><p className="text-[10px] uppercase text-muted-foreground">Completed</p><p className="text-2xl font-bold text-green-500">{done}</p></div></div></Card>
            <Card className="p-4"><div className="flex items-center gap-3"><Timer className="w-5 h-5 text-primary" /><div><p className="text-[10px] uppercase text-muted-foreground">In Progress</p><p className="text-2xl font-bold text-primary">{inProgress}</p></div></div></Card>
            <Card className="p-4"><div className="flex items-center gap-3"><AlertTriangle className="w-5 h-5 text-destructive" /><div><p className="text-[10px] uppercase text-muted-foreground">Blocked</p><p className="text-2xl font-bold text-destructive">{blocked}</p></div></div></Card>
          </div>

          {/* Progress */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Sprint Progress</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Story Points</span>
                <span className="text-sm font-bold">{doneSP} / {totalSP} SP ({progressPct}%)</span>
              </div>
              <Progress value={progressPct} className="h-3" />
            </CardContent>
          </Card>

          {/* Task list */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Sprint Backlog</CardTitle></CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border">
                  {["Task", "Status", "SP", "Progress", "Assignee"].map(h => (
                    <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {items.map((t: any) => (
                    <tr key={t.id} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-2.5 px-4 font-medium max-w-[300px] truncate">{t.title}</td>
                      <td className="py-2.5 px-4"><Badge variant={t.status === "DONE" ? "default" : t.status === "BLOCKED" ? "destructive" : "outline"}>{t.status}</Badge></td>
                      <td className="py-2.5 px-4">{t.storyPoints || "—"}</td>
                      <td className="py-2.5 px-4 w-[100px]"><Progress value={t.progress || 0} className="h-1.5" /></td>
                      <td className="py-2.5 px-4 text-muted-foreground">{t.assigneeId || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
