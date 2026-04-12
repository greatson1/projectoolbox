"use client";

import { useParams } from "next/navigation";
import { useProjectResources } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, BarChart3, Clock, CheckCircle2, AlertTriangle, Mail, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCSV } from "@/lib/export-csv";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend,
} from "recharts";

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "#10B981",
  neutral: "#6366F1",
  negative: "#EF4444",
  unknown: "#64748B",
};

const SENTIMENT_LABELS: Record<string, string> = {
  positive: "Engaged",
  neutral: "Neutral",
  negative: "At Risk",
  unknown: "Unknown",
};

function InitialsAvatar({ name, color }: { name: string; color: string }) {
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-bold text-white shrink-0"
      style={{ background: color }}>
      {initials || "?"}
    </div>
  );
}

export default function ResourcesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: resourceData, isLoading } = useProjectResources(projectId);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-72" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const members: any[] = resourceData?.members || [];
  const summary = resourceData?.summary || {
    teamSize: 0, avgAllocation: 0,
    totalEstimatedHours: 0, totalActualHours: 0,
    totalTasks: 0, unassignedTasks: 0,
  };

  // Workload chart data — estimated vs actual hours per person
  const workloadChartData = members
    .filter(m => m.hours.estimated > 0 || m.tasks.total > 0)
    .map(m => ({
      name: m.name.split(" ")[0], // first name only for chart
      fullName: m.name,
      estimated: Math.round(m.hours.estimated),
      actual: Math.round(m.hours.actual),
      tasks: m.tasks.total,
    }))
    .sort((a, b) => b.tasks - a.tasks)
    .slice(0, 12);

  const isEmpty = members.length === 0;

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Resources</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Team workload and allocation across the project
          </p>
        </div>
        {members.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const rows: (string | number | null | undefined)[][] = [
                ["Name", "Role", "Email", "Tasks Total", "Tasks Done", "Tasks In Progress", "Tasks Blocked", "Estimated Hours", "Actual Hours", "Allocation %", "Engagement"],
                ...members.map((m: any) => [
                  m.name,
                  m.role,
                  m.email,
                  m.tasks.total,
                  m.tasks.done,
                  m.tasks.inProgress,
                  m.tasks.blocked,
                  Math.round(m.hours.estimated),
                  Math.round(m.hours.actual),
                  m.allocation,
                  m.sentiment,
                ]),
              ];
              downloadCSV(rows, `resources-${projectId}.csv`);
            }}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            Download CSV
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                <Users className="h-4 w-4 text-indigo-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.teamSize}</p>
                <p className="text-xs text-muted-foreground">Team Members</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-cyan-500/10 flex items-center justify-center">
                <BarChart3 className="h-4 w-4 text-cyan-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {summary.avgAllocation > 0 ? `${summary.avgAllocation}%` : "—"}
                </p>
                <p className="text-xs text-muted-foreground">Avg Allocation</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <Clock className="h-4 w-4 text-emerald-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {summary.totalEstimatedHours > 0 ? `${summary.totalEstimatedHours}h` : "—"}
                </p>
                <p className="text-xs text-muted-foreground">Estimated Hours</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.unassignedTasks}</p>
                <p className="text-xs text-muted-foreground">Unassigned Tasks</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Workload Chart */}
      {workloadChartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Workload Distribution</CardTitle>
            <p className="text-xs text-muted-foreground">Estimated vs actual hours per team member</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={workloadChartData} barSize={18} barGap={4}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: any, name: any) => [`${v}h`, name === "estimated" ? "Estimated" : "Actual"]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName || ""}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="estimated" name="Estimated" fill="#6366F1" radius={[3, 3, 0, 0]} opacity={0.7} />
                <Bar dataKey="actual" name="Actual" fill="#10B981" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Team Directory */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Team Directory</CardTitle>
          <p className="text-xs text-muted-foreground">{summary.teamSize} member{summary.teamSize !== 1 ? "s" : ""} · {summary.totalTasks} tasks total</p>
        </CardHeader>
        <CardContent>
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <Users className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium mb-1">No team members yet</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Add stakeholders to the project or assign tasks to team members to see resource data here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {members.map((member: any) => {
                const sentimentColor = SENTIMENT_COLORS[member.sentiment] || SENTIMENT_COLORS.unknown;
                const completionPct = member.tasks.total > 0
                  ? Math.round((member.tasks.done / member.tasks.total) * 100)
                  : 0;
                return (
                  <div key={member.id} className="flex items-center gap-4 p-3 rounded-xl border border-border/20 hover:bg-muted/20 transition-colors">
                    {/* Avatar */}
                    <InitialsAvatar name={member.name} color={sentimentColor} />

                    {/* Name + role */}
                    <div className="min-w-[140px]">
                      <p className="text-sm font-semibold">{member.name}</p>
                      <p className="text-xs text-muted-foreground">{member.role}</p>
                      {member.email && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Mail className="h-2.5 w-2.5 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground">{member.email}</span>
                        </div>
                      )}
                    </div>

                    {/* Task stats */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-muted-foreground">{member.tasks.done}/{member.tasks.total} tasks done</span>
                        <span className="text-xs font-medium">{completionPct}%</span>
                      </div>
                      <Progress value={completionPct} className="h-1.5" />
                      <div className="flex gap-3 mt-1.5">
                        {member.tasks.inProgress > 0 && (
                          <span className="text-[10px] text-indigo-400">{member.tasks.inProgress} in progress</span>
                        )}
                        {member.tasks.blocked > 0 && (
                          <span className="text-[10px] text-red-400">{member.tasks.blocked} blocked</span>
                        )}
                        {member.tasks.todo > 0 && (
                          <span className="text-[10px] text-muted-foreground">{member.tasks.todo} to do</span>
                        )}
                      </div>
                    </div>

                    {/* Hours */}
                    <div className="text-right min-w-[80px]">
                      {member.hours.estimated > 0 ? (
                        <>
                          <p className="text-sm font-bold">{Math.round(member.hours.actual)}h</p>
                          <p className="text-[10px] text-muted-foreground">of {Math.round(member.hours.estimated)}h est.</p>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">No hours logged</p>
                      )}
                    </div>

                    {/* Allocation badge */}
                    <div className="min-w-[60px] text-right">
                      {member.allocation > 0 ? (
                        <Badge variant={member.allocation > 80 ? "destructive" : member.allocation > 50 ? "default" : "secondary"}
                          className="text-[10px]">
                          {member.allocation}%
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">Idle</Badge>
                      )}
                    </div>

                    {/* Engagement */}
                    <div className="min-w-[70px] text-right">
                      <Badge variant="outline" className="text-[10px]"
                        style={{ borderColor: `${sentimentColor}44`, color: sentimentColor }}>
                        {SENTIMENT_LABELS[member.sentiment] || "Unknown"}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Allocation breakdown */}
      {members.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Overloaded */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-red-500">⚠ Overloaded (&gt;80%)</CardTitle>
            </CardHeader>
            <CardContent>
              {members.filter((m: any) => m.allocation > 80).length === 0 ? (
                <p className="text-xs text-muted-foreground">None — team is well balanced</p>
              ) : (
                <div className="space-y-1.5">
                  {members.filter((m: any) => m.allocation > 80).map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between">
                      <span className="text-xs">{m.name}</span>
                      <Badge variant="destructive" className="text-[10px]">{m.allocation}%</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Active */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-emerald-500">✓ Active (20–80%)</CardTitle>
            </CardHeader>
            <CardContent>
              {members.filter((m: any) => m.allocation >= 20 && m.allocation <= 80).length === 0 ? (
                <p className="text-xs text-muted-foreground">No members in this range</p>
              ) : (
                <div className="space-y-1.5">
                  {members.filter((m: any) => m.allocation >= 20 && m.allocation <= 80).map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between">
                      <span className="text-xs">{m.name}</span>
                      <Badge variant="default" className="text-[10px] bg-emerald-500/20 text-emerald-600 hover:bg-emerald-500/20">{m.allocation}%</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Idle */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground">— Idle / Unassigned (&lt;20%)</CardTitle>
            </CardHeader>
            <CardContent>
              {members.filter((m: any) => m.allocation < 20).length === 0 ? (
                <p className="text-xs text-muted-foreground">No idle members</p>
              ) : (
                <div className="space-y-1.5">
                  {members.filter((m: any) => m.allocation < 20).map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between">
                      <span className="text-xs">{m.name}</span>
                      <Badge variant="outline" className="text-[10px]">{m.allocation}%</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tasks with no assignee warning */}
      {summary.unassignedTasks > 0 && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-500">
                  {summary.unassignedTasks} task{summary.unassignedTasks !== 1 ? "s" : ""} without an assignee
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Assign tasks to team members to improve workload tracking and resource allocation visibility.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
