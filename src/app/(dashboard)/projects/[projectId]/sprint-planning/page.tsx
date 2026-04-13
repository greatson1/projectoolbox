"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { useProjectTasks, useProjectSprints, useCreateSprint, useUpdateTask, useUpdateSprint, useDeleteSprint } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, Calendar, Target, Users, TrendingUp, ChevronRight, GripVertical, ArrowRight, Clock, Zap } from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d: string | Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function daysBetween(a: string | Date, b: string | Date) {
  return Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

const STATUS_COLORS: Record<string, string> = {
  PLANNING: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  ACTIVE: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  COMPLETED: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  CANCELLED: "bg-red-500/10 text-red-400 border-red-500/20",
};

const PRIORITY_COLORS: Record<string, string> = {
  HIGH: "text-red-500", MEDIUM: "text-amber-500", LOW: "text-emerald-500",
};

// ─── Main Component ──────────────────────────────────────────────────────────

export default function SprintPlanningPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: tasks, isLoading: tasksLoading } = useProjectTasks(projectId);
  const { data: sprints, isLoading: sprintsLoading } = useProjectSprints(projectId);
  const createSprint = useCreateSprint(projectId);
  const updateTask = useUpdateTask(projectId);
  const updateSprint = useUpdateSprint(projectId);
  const deleteSprint = useDeleteSprint(projectId);

  const [showCreateSprint, setShowCreateSprint] = useState(false);
  const [newSprint, setNewSprint] = useState({ name: "", goal: "", startDate: "", endDate: "" });
  const [expandedSprint, setExpandedSprint] = useState<string | null>(null);

  const allTasks = useMemo(() => (tasks || []).map((t: any) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    storyPoints: t.storyPoints || 0,
    estimatedHours: t.estimatedHours || 0,
    assigneeName: t.assigneeName || t.assigneeId || "Unassigned",
    sprintId: t.sprintId,
    type: t.type || "task",
    progress: t.progress || 0,
    description: t.description || "",
  })), [tasks]);

  const backlogTasks = useMemo(() => allTasks.filter(t => !t.sprintId), [allTasks]);
  const sortedSprints = useMemo(() => [...(sprints || [])].sort((a: any, b: any) =>
    new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  ), [sprints]);

  // ─── Stats ─────────────────────────────────────────────────────────────────

  const totalPoints = allTasks.reduce((s: number, t: any) => s + t.storyPoints, 0);
  const assignedPoints = allTasks.filter((t: any) => t.sprintId).reduce((s: number, t: any) => s + t.storyPoints, 0);
  const backlogPoints = backlogTasks.reduce((s: number, t: any) => s + t.storyPoints, 0);
  const activeSprint = sortedSprints.find((s: any) => s.status === "ACTIVE");
  const avgVelocity = sortedSprints.filter((s: any) => s.status === "COMPLETED").length > 0
    ? Math.round(assignedPoints / Math.max(1, sortedSprints.filter((s: any) => s.status === "COMPLETED").length))
    : 0;

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleCreateSprint = async () => {
    if (!newSprint.name || !newSprint.startDate || !newSprint.endDate) {
      toast.error("Name, start date, and end date are required");
      return;
    }
    try {
      await createSprint.mutateAsync(newSprint);
      toast.success(`Sprint "${newSprint.name}" created`);
      setNewSprint({ name: "", goal: "", startDate: "", endDate: "" });
      setShowCreateSprint(false);
    } catch { toast.error("Failed to create sprint"); }
  };

  const handleAssignToSprint = async (taskId: string, sprintId: string | null) => {
    try {
      await updateTask.mutateAsync({ taskId, sprintId });
      toast.success(sprintId ? "Task assigned to sprint" : "Task moved to backlog");
    } catch { toast.error("Failed to assign task"); }
  };

  const handleStartSprint = async (sprintId: string) => {
    try {
      await updateSprint.mutateAsync({ sprintId, status: "ACTIVE" });
      toast.success("Sprint started");
    } catch { toast.error("Failed to start sprint"); }
  };

  const handleCompleteSprint = async (sprintId: string) => {
    try {
      await updateSprint.mutateAsync({ sprintId, status: "COMPLETED" });
      toast.success("Sprint completed");
    } catch { toast.error("Failed to complete sprint"); }
  };

  // ─── Loading ───────────────────────────────────────────────────────────────

  if (tasksLoading || sprintsLoading) return (
    <div className="space-y-6 max-w-[1400px]">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Sprint Planning</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Plan sprints, assign tasks, track capacity and velocity</p>
        </div>
        <Button size="sm" onClick={() => setShowCreateSprint(true)}>
          <Plus className="w-3.5 h-3.5 mr-1" /> New Sprint
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "Total Sprints", value: sortedSprints.length, icon: Calendar, color: "text-primary" },
          { label: "Active Sprint", value: activeSprint?.name || "None", icon: Zap, color: "text-emerald-500", small: true },
          { label: "Backlog Items", value: backlogTasks.length, icon: Target, color: "text-amber-500", sub: `${backlogPoints} pts` },
          { label: "Assigned Points", value: assignedPoints, icon: TrendingUp, color: "text-primary", sub: `of ${totalPoints} total` },
          { label: "Avg Velocity", value: avgVelocity || "—", icon: TrendingUp, color: "text-emerald-500", sub: "pts/sprint" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between mb-1">
                <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{s.label}</span>
                <s.icon className={`w-4 h-4 ${s.color}`} />
              </div>
              <p className={`${s.small ? "text-sm" : "text-xl"} font-bold tracking-tight`}>{s.value}</p>
              {s.sub && <p className="text-[10px] text-muted-foreground mt-0.5">{s.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Sprint Timeline */}
      {sortedSprints.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Sprint Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const allDates = sortedSprints.flatMap((s: any) => [new Date(s.startDate).getTime(), new Date(s.endDate).getTime()]);
              const earliest = Math.min(...allDates);
              const latest = Math.max(...allDates);
              const span = latest - earliest || 1;
              const now = Date.now();
              const todayPct = Math.max(0, Math.min(100, ((now - earliest) / span) * 100));

              return (
                <div className="relative pt-4 pb-2">
                  {/* Today marker */}
                  <div className="absolute top-0 bottom-0 border-l-2 border-primary/40 border-dashed z-10" style={{ left: `${todayPct}%` }}>
                    <span className="absolute -top-1 -translate-x-1/2 text-[8px] text-primary font-bold">Today</span>
                  </div>
                  <div className="space-y-2">
                    {sortedSprints.map((sprint: any) => {
                      const start = new Date(sprint.startDate).getTime();
                      const end = new Date(sprint.endDate).getTime();
                      const leftPct = ((start - earliest) / span) * 100;
                      const widthPct = Math.max(3, ((end - start) / span) * 100);
                      const sprintTasks = allTasks.filter(t => t.sprintId === sprint.id);
                      const completedPts = sprintTasks.filter(t => t.status === "DONE" || t.progress >= 100).reduce((s: number, t: any) => s + t.storyPoints, 0);
                      const totalPts = sprintTasks.reduce((s: number, t: any) => s + t.storyPoints, 0);
                      const isActive = sprint.status === "ACTIVE";
                      const color = sprint.status === "COMPLETED" ? "bg-gray-400/30 border-gray-400/40"
                        : isActive ? "bg-emerald-500/30 border-emerald-500/50"
                        : "bg-primary/20 border-primary/30";

                      return (
                        <div key={sprint.id} className="flex items-center gap-3">
                          <span className="text-[10px] font-medium w-24 truncate text-right text-muted-foreground">{sprint.name}</span>
                          <div className="flex-1 relative h-7">
                            <div className={`absolute h-full rounded-md border ${color} cursor-pointer hover:opacity-80 transition-opacity`}
                              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                              onClick={() => setExpandedSprint(expandedSprint === sprint.id ? null : sprint.id)}>
                              <div className="absolute inset-0 flex items-center justify-between px-2 text-[9px] font-semibold truncate">
                                <span>{sprintTasks.length} tasks</span>
                                <span>{completedPts}/{totalPts} pts</span>
                              </div>
                            </div>
                          </div>
                          <span className="text-[9px] text-muted-foreground w-16">{formatDate(sprint.startDate)}</span>
                        </div>
                      );
                    })}
                  </div>
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

      {/* Sprint Cards + Backlog */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Sprints column (2/3 width) */}
        <div className="xl:col-span-2 space-y-4">
          {sortedSprints.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Calendar className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm font-medium text-muted-foreground mb-1">No sprints yet</p>
                <p className="text-xs text-muted-foreground/60 mb-4">Create your first sprint to start planning</p>
                <Button size="sm" onClick={() => setShowCreateSprint(true)}><Plus className="w-3.5 h-3.5 mr-1" /> Create Sprint</Button>
              </CardContent>
            </Card>
          ) : (
            sortedSprints.map((sprint: any) => {
              const sprintTasks = allTasks.filter(t => t.sprintId === sprint.id);
              const totalPts = sprintTasks.reduce((s: number, t: any) => s + t.storyPoints, 0);
              const completedPts = sprintTasks.filter(t => t.status === "DONE" || t.progress >= 100).reduce((s: number, t: any) => s + t.storyPoints, 0);
              const totalHours = sprintTasks.reduce((s: number, t: any) => s + t.estimatedHours, 0);
              const isExpanded = expandedSprint === sprint.id;
              const days = daysBetween(sprint.startDate, sprint.endDate);

              return (
                <Card key={sprint.id} className={sprint.status === "ACTIVE" ? "border-emerald-500/30" : ""}>
                  <CardContent className="pt-4 pb-4">
                    {/* Sprint header */}
                    <div className="flex items-start justify-between mb-3 cursor-pointer"
                      onClick={() => setExpandedSprint(isExpanded ? null : sprint.id)}>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-sm font-bold">{sprint.name}</h3>
                          <Badge variant="outline" className={STATUS_COLORS[sprint.status] || ""}>{sprint.status}</Badge>
                          <span className="text-[10px] text-muted-foreground">{days} days</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(sprint.startDate)} — {formatDate(sprint.endDate)}
                          {sprint.goal && <span className="ml-2">· {sprint.goal}</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 text-right">
                        <div>
                          <p className="text-lg font-bold">{totalPts}</p>
                          <p className="text-[9px] text-muted-foreground">story pts</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold">{sprintTasks.length}</p>
                          <p className="text-[9px] text-muted-foreground">tasks</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold">{totalHours.toFixed(0)}h</p>
                          <p className="text-[9px] text-muted-foreground">effort</p>
                        </div>
                        <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex-1 h-1.5 rounded-full bg-border/30 overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${totalPts > 0 ? (completedPts / totalPts) * 100 : 0}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground">{totalPts > 0 ? Math.round((completedPts / totalPts) * 100) : 0}%</span>
                    </div>

                    {/* Expanded: task list */}
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-border/30 space-y-1.5">
                        {sprintTasks.length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-4">No tasks assigned. Drag from backlog or click + to add.</p>
                        ) : (
                          sprintTasks.map(task => (
                            <div key={task.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/30 transition-colors group">
                              <GripVertical className="w-3 h-3 text-muted-foreground/30" />
                              <Badge variant="outline" className={`text-[8px] w-12 justify-center ${
                                task.type === "bug" ? "border-red-500/30 text-red-500" :
                                task.type === "story" ? "border-blue-500/30 text-blue-500" :
                                "border-border"
                              }`}>{task.type}</Badge>
                              <span className="text-xs font-medium flex-1 truncate">{task.title}</span>
                              <span className={`text-[10px] font-semibold ${PRIORITY_COLORS[task.priority] || "text-muted-foreground"}`}>
                                {task.priority || "—"}
                              </span>
                              <span className="text-[10px] text-muted-foreground">{task.storyPoints || 0} pts</span>
                              <span className="text-[10px] text-muted-foreground">{task.estimatedHours || 0}h</span>
                              <span className="text-[10px] text-muted-foreground truncate w-16">{task.assigneeName}</span>
                              <Badge variant="outline" className={`text-[8px] ${
                                task.status === "DONE" ? "border-emerald-500/30 text-emerald-500" :
                                task.status === "IN_PROGRESS" ? "border-blue-500/30 text-blue-500" :
                                "border-border"
                              }`}>{task.status}</Badge>
                              <button className="text-[10px] text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => handleAssignToSprint(task.id, null)}>
                                Remove
                              </button>
                            </div>
                          ))
                        )}

                        {/* Sprint actions */}
                        <div className="flex items-center gap-2 pt-2">
                          {sprint.status === "PLANNING" && (
                            <Button size="sm" variant="default" className="text-xs h-7" onClick={() => handleStartSprint(sprint.id)}>
                              Start Sprint
                            </Button>
                          )}
                          {sprint.status === "ACTIVE" && (
                            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => handleCompleteSprint(sprint.id)}>
                              Complete Sprint
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive"
                            onClick={() => { deleteSprint.mutate(sprint.id); toast.success("Sprint deleted"); }}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Backlog column (1/3 width) */}
        <div>
          <Card className="sticky top-4">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Backlog</CardTitle>
                <Badge variant="secondary" className="text-[10px]">{backlogTasks.length} items · {backlogPoints} pts</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {backlogTasks.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">Backlog is empty. All tasks are assigned to sprints.</p>
              ) : (
                <div className="space-y-1 max-h-[60vh] overflow-y-auto">
                  {backlogTasks.map(task => (
                    <div key={task.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/30 transition-colors group">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{task.title}</p>
                        <p className="text-[10px] text-muted-foreground">{task.storyPoints || 0} pts · {task.estimatedHours || 0}h · {task.assigneeName}</p>
                      </div>
                      {/* Assign to sprint dropdown */}
                      {sortedSprints.length > 0 && (
                        <select className="text-[10px] bg-transparent border border-border/30 rounded px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          defaultValue=""
                          onChange={e => { if (e.target.value) handleAssignToSprint(task.id, e.target.value); }}>
                          <option value="" disabled>Assign →</option>
                          {sortedSprints.filter((s: any) => s.status !== "COMPLETED" && s.status !== "CANCELLED").map((s: any) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Create Sprint Modal */}
      {showCreateSprint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowCreateSprint(false)}>
          <Card className="w-[480px]" onClick={e => e.stopPropagation()}>
            <CardContent className="pt-5 space-y-4">
              <h3 className="text-base font-bold">Create Sprint</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Sprint Name</label>
                  <input className="w-full mt-1 px-3 py-2 rounded-lg text-sm bg-background border border-input"
                    placeholder="e.g., Sprint 1 — Foundation"
                    value={newSprint.name} onChange={e => setNewSprint(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Sprint Goal (optional)</label>
                  <input className="w-full mt-1 px-3 py-2 rounded-lg text-sm bg-background border border-input"
                    placeholder="What should this sprint achieve?"
                    value={newSprint.goal} onChange={e => setNewSprint(p => ({ ...p, goal: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Start Date</label>
                    <input type="date" className="w-full mt-1 px-3 py-2 rounded-lg text-sm bg-background border border-input"
                      value={newSprint.startDate} onChange={e => setNewSprint(p => ({ ...p, startDate: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">End Date</label>
                    <input type="date" className="w-full mt-1 px-3 py-2 rounded-lg text-sm bg-background border border-input"
                      value={newSprint.endDate} onChange={e => setNewSprint(p => ({ ...p, endDate: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" size="sm" onClick={() => setShowCreateSprint(false)}>Cancel</Button>
                <Button size="sm" onClick={handleCreateSprint} disabled={createSprint.isPending}>
                  {createSprint.isPending ? "Creating..." : "Create Sprint"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
