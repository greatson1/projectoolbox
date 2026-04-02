"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectTasks, useProject } from "@/hooks/use-api";
import { Plus, Calendar, List, BarChart3 } from "lucide-react";

function formatDate(d: string | Date) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = { DONE: "default", IN_PROGRESS: "secondary", TODO: "outline", BLOCKED: "destructive" };

export default function SchedulePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useProject(projectId);
  const { data: tasks, isLoading } = useProjectTasks(projectId);
  const [view, setView] = useState<"gantt" | "list">("list");

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-96 rounded-xl" /></div>;

  const items = tasks || [];
  const completed = items.filter((t: any) => t.status === "DONE").length;
  const inProgress = items.filter((t: any) => t.status === "IN_PROGRESS").length;

  return (
    <div className="space-y-6 max-w-[1600px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Schedule</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {project?.name || "Project"} · {items.length} tasks · {completed} completed · {inProgress} in progress
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(["gantt", "list"] as const).map(v => (
              <button key={v} className={`px-3 py-1.5 text-xs font-semibold capitalize ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                onClick={() => setView(v)}>
                {v === "gantt" ? <><BarChart3 className="w-3 h-3 inline mr-1" />Gantt</> : <><List className="w-3 h-3 inline mr-1" />List</>}
              </button>
            ))}
          </div>
          <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add Task</Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-20">
          <Calendar className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No tasks scheduled</h2>
          <p className="text-sm text-muted-foreground mb-4">Your AI agent will create tasks and schedule them as it analyses the project plan.</p>
          <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add First Task</Button>
        </div>
      ) : view === "list" ? (
        <Card className="p-0">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border">
              {["Task", "Status", "Priority", "Start", "End", "Progress", "Assignee"].map(h => (
                <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {items.map((t: any) => (
                <tr key={t.id} className="border-b border-border/30 hover:bg-muted/30">
                  <td className="py-2.5 px-4">
                    <p className="font-medium">{t.title}</p>
                    {t.phaseId && <p className="text-[10px] text-muted-foreground">{t.phaseId}</p>}
                  </td>
                  <td className="py-2.5 px-4"><Badge variant={STATUS_VARIANT[t.status] || "outline"}>{t.status}</Badge></td>
                  <td className="py-2.5 px-4"><Badge variant={t.priority === "HIGH" ? "destructive" : "outline"}>{t.priority || "—"}</Badge></td>
                  <td className="py-2.5 px-4 text-muted-foreground">{t.startDate ? formatDate(t.startDate) : "—"}</td>
                  <td className="py-2.5 px-4 text-muted-foreground">{t.endDate ? formatDate(t.endDate) : "—"}</td>
                  <td className="py-2.5 px-4 w-[120px]">
                    <div className="flex items-center gap-2">
                      <Progress value={t.progress || 0} className="h-1.5 flex-1" />
                      <span className="text-[10px]">{t.progress || 0}%</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-muted-foreground">{t.assigneeId || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        /* Gantt view — simplified timeline bars */
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Timeline View</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1">
              {items.filter((t: any) => t.startDate && t.endDate).map((t: any) => {
                const start = new Date(t.startDate).getTime();
                const end = new Date(t.endDate).getTime();
                const earliest = Math.min(...items.filter((x: any) => x.startDate).map((x: any) => new Date(x.startDate).getTime()));
                const latest = Math.max(...items.filter((x: any) => x.endDate).map((x: any) => new Date(x.endDate).getTime()));
                const range = latest - earliest || 1;
                const left = ((start - earliest) / range) * 100;
                const width = Math.max(((end - start) / range) * 100, 2);

                return (
                  <div key={t.id} className="flex items-center gap-3 py-1">
                    <span className="text-xs w-[200px] truncate">{t.title}</span>
                    <div className="flex-1 relative h-5 bg-muted/30 rounded">
                      <div className="absolute top-0.5 h-4 rounded"
                        style={{
                          left: `${left}%`, width: `${width}%`,
                          background: t.status === "DONE" ? "#10B981" : t.status === "IN_PROGRESS" ? "var(--primary)" : "var(--muted-foreground)",
                          opacity: t.status === "TODO" ? 0.3 : 0.8,
                        }}>
                        {width > 8 && <span className="text-[8px] text-white font-bold px-1 leading-4">{t.progress || 0}%</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
              {items.filter((t: any) => !t.startDate || !t.endDate).length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">{items.filter((t: any) => !t.startDate).length} tasks without dates (not shown on timeline)</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
