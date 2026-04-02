"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectTasks, useProject } from "@/hooks/use-api";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import { Timer, Target, CheckCircle2, AlertTriangle, TrendingUp } from "lucide-react";

export default function SprintTrackerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useProject(projectId);
  const { data: tasks, isLoading } = useProjectTasks(projectId);

  const items = tasks || [];
  const total = items.length;
  const done = items.filter((t: any) => t.status === "DONE").length;
  const inProgress = items.filter((t: any) => t.status === "IN_PROGRESS").length;
  const blocked = items.filter((t: any) => t.status === "BLOCKED").length;
  const todo = items.filter((t: any) => t.status === "TODO" || t.status === "BACKLOG").length;
  const totalSP = items.reduce((s: number, t: any) => s + (t.storyPoints || 0), 0);
  const doneSP = items.filter((t: any) => t.status === "DONE").reduce((s: number, t: any) => s + (t.storyPoints || 0), 0);
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;

  // Generate burndown data from tasks
  const burndownData = useMemo(() => {
    if (totalSP === 0) return [];
    const days = 10;
    const idealPerDay = totalSP / days;
    return Array.from({ length: days + 1 }, (_, i) => ({
      day: `D${i}`,
      ideal: Math.round(totalSP - idealPerDay * i),
      actual: i <= 6 ? Math.round(totalSP - (doneSP / 6) * i) : null,
    }));
  }, [totalSP, doneSP]);

  // Status distribution for chart
  const statusData = [
    { status: "Done", count: done, fill: "#10B981" },
    { status: "In Progress", count: inProgress, fill: "#6366F1" },
    { status: "To Do", count: todo, fill: "#64748B" },
    { status: "Blocked", count: blocked, fill: "#EF4444" },
  ].filter(s => s.count > 0);

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div><Skeleton className="h-64 rounded-xl" /></div>;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sprint Tracker</h1>
          <p className="text-sm text-muted-foreground mt-1">{project?.name || "Project"} · {project?.methodology || ""}</p>
        </div>
        {totalSP > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/5 border border-primary/20">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs font-semibold text-primary">Sprint Active · {doneSP}/{totalSP} SP</span>
          </div>
        )}
      </div>

      {total === 0 ? (
        <div className="text-center py-20">
          <Timer className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No sprint data</h2>
          <p className="text-sm text-muted-foreground mb-4">Sprint tracking begins when tasks are created.</p>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card className="p-4"><div className="flex items-center gap-3"><Target className="w-5 h-5 text-primary" /><div><p className="text-[10px] uppercase text-muted-foreground">Total</p><p className="text-2xl font-bold">{total}</p></div></div></Card>
            <Card className="p-4"><div className="flex items-center gap-3"><CheckCircle2 className="w-5 h-5 text-green-500" /><div><p className="text-[10px] uppercase text-muted-foreground">Done</p><p className="text-2xl font-bold text-green-500">{done}</p></div></div></Card>
            <Card className="p-4"><div className="flex items-center gap-3"><Timer className="w-5 h-5 text-primary" /><div><p className="text-[10px] uppercase text-muted-foreground">In Progress</p><p className="text-2xl font-bold text-primary">{inProgress}</p></div></div></Card>
            <Card className="p-4"><div className="flex items-center gap-3"><AlertTriangle className="w-5 h-5 text-destructive" /><div><p className="text-[10px] uppercase text-muted-foreground">Blocked</p><p className="text-2xl font-bold text-destructive">{blocked}</p></div></div></Card>
            <Card className="p-4"><div className="flex items-center gap-3"><TrendingUp className="w-5 h-5 text-primary" /><div><p className="text-[10px] uppercase text-muted-foreground">SP Done</p><p className="text-2xl font-bold">{doneSP}/{totalSP}</p></div></div></Card>
          </div>

          {/* Progress */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Sprint Progress</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Overall</span>
                <span className="text-sm font-bold">{progressPct}%</span>
              </div>
              <Progress value={progressPct} className="h-3" />
              <div className="flex items-center gap-4 mt-2">
                <span className="flex items-center gap-1 text-[10px]"><span className="w-2 h-2 rounded-full bg-green-500" /> Done {done}</span>
                <span className="flex items-center gap-1 text-[10px]"><span className="w-2 h-2 rounded-full bg-primary" /> In Progress {inProgress}</span>
                <span className="flex items-center gap-1 text-[10px]"><span className="w-2 h-2 rounded-full bg-muted-foreground" /> To Do {todo}</span>
                {blocked > 0 && <span className="flex items-center gap-1 text-[10px]"><span className="w-2 h-2 rounded-full bg-destructive" /> Blocked {blocked}</span>}
              </div>
            </CardContent>
          </Card>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Burndown */}
            {burndownData.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Burndown Chart</CardTitle></CardHeader>
                <CardContent>
                  <div style={{ height: 220 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={burndownData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                        <XAxis dataKey="day" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
                        <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
                        <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11, color: "var(--foreground)" }} />
                        <Area type="monotone" dataKey="ideal" stroke="#64748B" strokeDasharray="5 5" fill="none" strokeWidth={1.5} name="Ideal" />
                        <Area type="monotone" dataKey="actual" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.15} strokeWidth={2.5} name="Actual" connectNulls={false} />
                        <ReferenceLine x="D6" stroke="var(--destructive)" strokeDasharray="3 3" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Status distribution */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Task Distribution</CardTitle></CardHeader>
              <CardContent>
                <div style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={statusData} layout="vertical" barSize={20}>
                      <XAxis type="number" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
                      <YAxis type="category" dataKey="status" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} width={80} />
                      <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11, color: "var(--foreground)" }} />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                        {statusData.map((s, i) => <rect key={i} fill={s.fill} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Backlog */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Sprint Backlog</CardTitle></CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border">
                  {["Task", "Status", "SP", "Priority", "Progress"].map(h => (
                    <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {items.map((t: any) => (
                    <tr key={t.id} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-2.5 px-4 font-medium max-w-[300px] truncate">{t.title}</td>
                      <td className="py-2.5 px-4"><Badge variant={t.status === "DONE" ? "default" : t.status === "BLOCKED" ? "destructive" : t.status === "IN_PROGRESS" ? "secondary" : "outline"}>{t.status}</Badge></td>
                      <td className="py-2.5 px-4">{t.storyPoints || "—"}</td>
                      <td className="py-2.5 px-4"><Badge variant={t.priority === "CRITICAL" || t.priority === "HIGH" ? "destructive" : "outline"}>{t.priority || "—"}</Badge></td>
                      <td className="py-2.5 px-4 w-[100px]"><Progress value={t.progress || 0} className="h-1.5" /></td>
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
