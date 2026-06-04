"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { useProject, useProjectTasks, useUpdateTask, useCreateTask, useDeleteTask } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Target, Layers, GitBranch, Plus, ChevronRight, ChevronDown,
  FolderOpen, CheckCircle2, Circle, Clock, Package,
  Pencil, Trash2, X, Save, CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TaskNode {
  id: string;
  title: string;
  status: string;
  progress: number | null;
  parentId: string | null;
  startDate: string | null;
  endDate: string | null;
  priority: string | null;
  storyPoints: number | null;
  estimatedHours: number | null;
  assigneeId: string | null;
  description: string | null;
  children: TaskNode[];
}

function buildTree(tasks: any[]): TaskNode[] {
  const map = new Map<string, TaskNode>();
  const roots: TaskNode[] = [];

  for (const t of tasks) {
    map.set(t.id, { ...t, children: [] });
  }
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

const STATUS_ICON: Record<string, React.ElementType> = {
  DONE: CheckCircle2,
  COMPLETED: CheckCircle2,
  IN_PROGRESS: Clock,
};

const STATUS_OPTIONS = ["TODO", "IN_PROGRESS", "DONE"];
const PRIORITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

// ── Inline Edit Panel ──────────────────────────────────────────────────────

function TaskEditPanel({
  task,
  projectId,
  onClose,
}: {
  task: TaskNode;
  projectId: string;
  onClose: () => void;
}) {
  const updateTask = useUpdateTask(projectId);
  const deleteTask = useDeleteTask(projectId);

  const [title, setTitle] = useState(task.title);
  const [status, setStatus] = useState(task.status);
  const [progress, setProgress] = useState(task.progress ?? 0);
  const [hours, setHours] = useState(task.estimatedHours ?? 0);
  const [priority, setPriority] = useState(task.priority || "MEDIUM");
  const [startDate, setStartDate] = useState(task.startDate?.slice(0, 10) || "");
  const [endDate, setEndDate] = useState(task.endDate?.slice(0, 10) || "");
  const [storyPoints, setStoryPoints] = useState(task.storyPoints ?? 0);

  const handleSave = useCallback(async () => {
    try {
      await updateTask.mutateAsync({
        taskId: task.id,
        title,
        status,
        progress,
        estimatedHours: hours || null,
        priority,
        startDate: startDate || null,
        endDate: endDate || null,
        storyPoints: storyPoints || null,
      });
      toast.success("Task updated");
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Failed to update task");
    }
  }, [task.id, title, status, progress, hours, priority, startDate, endDate, storyPoints, updateTask, onClose]);

  const handleDelete = useCallback(async () => {
    if (!confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
    try {
      await deleteTask.mutateAsync(task.id);
      toast.success("Task deleted");
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Failed to delete task");
    }
  }, [task.id, task.title, deleteTask, onClose]);

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-background border-l border-border shadow-2xl z-50 flex flex-col animate-in slide-in-from-right-5 duration-200">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h3 className="text-sm font-bold">Edit Task</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Title</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} className="text-sm" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <select
              value={status}
              onChange={e => {
                setStatus(e.target.value);
                if (e.target.value === "DONE") setProgress(100);
                if (e.target.value === "TODO") setProgress(0);
              }}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s.replace("_", " ")}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Priority</Label>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {PRIORITY_OPTIONS.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Progress ({progress}%)</Label>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={e => {
              const v = Number(e.target.value);
              setProgress(v);
              if (v === 100) setStatus("DONE");
              else if (v > 0 && status === "TODO") setStatus("IN_PROGRESS");
            }}
            className="w-full accent-primary"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Est. Hours</Label>
            <Input type="number" value={hours} onChange={e => setHours(Number(e.target.value))} className="text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Story Points</Label>
            <Input type="number" value={storyPoints} onChange={e => setStoryPoints(Number(e.target.value))} className="text-sm" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1"><CalendarDays className="w-3 h-3" />Start</Label>
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1"><CalendarDays className="w-3 h-3" />End</Label>
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="text-sm" />
          </div>
        </div>
      </div>

      <div className="px-5 py-4 border-t border-border flex items-center justify-between">
        <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleteTask.isPending}>
          <Trash2 className="w-3.5 h-3.5 mr-1.5" />Delete
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={updateTask.isPending || !title.trim()}>
            <Save className="w-3.5 h-3.5 mr-1.5" />{updateTask.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Add Task Dialog ────────────────────────────────────────────────────────

function AddTaskPanel({
  projectId,
  parentId,
  parentTitle,
  onClose,
}: {
  projectId: string;
  parentId: string | null;
  parentTitle?: string;
  onClose: () => void;
}) {
  const createTask = useCreateTask(projectId);
  const [title, setTitle] = useState("");
  const [hours, setHours] = useState(0);
  const [priority, setPriority] = useState("MEDIUM");

  const handleCreate = useCallback(async () => {
    if (!title.trim()) return;
    try {
      await createTask.mutateAsync({
        title: title.trim(),
        parentId,
        estimatedHours: hours || null,
        priority,
        status: "TODO",
        progress: 0,
      });
      toast.success(`Task "${title}" created`);
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Failed to create task");
    }
  }, [title, parentId, hours, priority, createTask, onClose]);

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-background border-l border-border shadow-2xl z-50 flex flex-col animate-in slide-in-from-right-5 duration-200">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h3 className="text-sm font-bold">Add Task</h3>
          {parentTitle && <p className="text-[10px] text-muted-foreground mt-0.5">Under: {parentTitle}</p>}
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Title *</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Data migration testing" className="text-sm" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Est. Hours</Label>
            <Input type="number" value={hours} onChange={e => setHours(Number(e.target.value))} className="text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Priority</Label>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {PRIORITY_OPTIONS.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={handleCreate} disabled={createTask.isPending || !title.trim()}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />{createTask.isPending ? "Creating…" : "Add Task"}
        </Button>
      </div>
    </div>
  );
}

// ── WBS Tree Node ──────────────────────────────────────────────────────────

function WBSNode({
  node,
  depth = 0,
  onEdit,
  onAdd,
}: {
  node: TaskNode;
  depth?: number;
  onEdit: (task: TaskNode) => void;
  onAdd: (parentId: string, parentTitle: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const StatusIcon = STATUS_ICON[node.status] || Circle;
  const progress = node.progress ?? 0;

  const statusColor = node.status === "DONE" || node.status === "COMPLETED"
    ? "text-emerald-500"
    : node.status === "IN_PROGRESS"
      ? "text-amber-500"
      : "text-muted-foreground/50";

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors group",
          depth === 0 && "font-medium"
        )}
        style={{ paddingLeft: `${depth * 24 + 8}px` }}
      >
        <button
          onClick={() => hasChildren && setOpen(!open)}
          className="shrink-0 w-3.5"
        >
          {hasChildren ? (
            open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <span className="w-3.5" />
          )}
        </button>

        {hasChildren ? (
          <FolderOpen className="w-4 h-4 text-primary/70 shrink-0" />
        ) : (
          <StatusIcon className={cn("w-4 h-4 shrink-0", statusColor)} />
        )}

        <span
          className="text-sm flex-1 truncate cursor-pointer hover:text-primary transition-colors"
          onClick={() => onEdit(node)}
        >
          {node.title}
        </span>

        {node.storyPoints != null && (
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 shrink-0">{node.storyPoints} SP</Badge>
        )}
        {node.estimatedHours != null && (
          <span className="text-[10px] text-muted-foreground shrink-0">{node.estimatedHours}h</span>
        )}

        <div className="w-16 shrink-0">
          <Progress value={progress} className="h-1.5" />
        </div>
        <span className="text-[10px] text-muted-foreground w-8 text-right shrink-0">{progress}%</span>

        {/* Action buttons — visible on hover */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={() => onEdit(node)}
            className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            title="Edit task"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={() => onAdd(node.id, node.title)}
            className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            title="Add sub-task"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
      </div>

      {hasChildren && open && (
        <div>
          {node.children.map((child) => (
            <WBSNode key={child.id} node={child} depth={depth + 1} onEdit={onEdit} onAdd={onAdd} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function ScopeManagementPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading: projectLoading } = useProject(projectId);
  const { data: tasks, isLoading: tasksLoading } = useProjectTasks(projectId);
  const [view, setView] = useState<"tree" | "flat">("tree");
  const [editingTask, setEditingTask] = useState<TaskNode | null>(null);
  const [addingParent, setAddingParent] = useState<{ id: string | null; title?: string } | null>(null);

  const isLoading = projectLoading || tasksLoading;

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  const items = tasks || [];
  const tree = buildTree(items);
  const totalTasks = items.length;
  const completedTasks = items.filter((t: any) => t.status === "DONE" || t.status === "COMPLETED").length;
  const inProgress = items.filter((t: any) => t.status === "IN_PROGRESS").length;
  const workPackages = items.filter((t: any) => items.some((c: any) => c.parentId === t.id)).length;

  const itemProgress = items.map((t: any) => {
    if (t.status === "DONE" || t.status === "COMPLETED") return 100;
    const p = Number(t.progress);
    return Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0;
  });
  const allHaveHours = items.length > 0 && items.every((t: any) => Number(t.estimatedHours) > 0);
  let overallProgress = 0;
  if (totalTasks > 0) {
    if (allHaveHours) {
      const totalHours = items.reduce((s: number, t: any) => s + Number(t.estimatedHours), 0);
      const earnedHours = items.reduce((s: number, t: any, i: number) =>
        s + (Number(t.estimatedHours) * (itemProgress[i] / 100)), 0);
      overallProgress = totalHours > 0 ? Math.round((earnedHours / totalHours) * 100) : 0;
    } else {
      overallProgress = Math.round(itemProgress.reduce((s: number, p: number) => s + p, 0) / totalTasks);
    }
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Scope & WBS</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalTasks} items · {workPackages} work packages · {overallProgress}% complete
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(["tree", "flat"] as const).map((v) => (
              <button
                key={v}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold capitalize",
                  view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                )}
                onClick={() => setView(v)}
              >
                {v}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => setAddingParent({ id: null })}>
            <Plus className="h-4 w-4 mr-2" />Add Task
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Items</p>
              <p className="text-2xl font-bold">{totalTasks}</p>
            </div>
            <Package className="w-5 h-5 text-primary" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Work Packages</p>
              <p className="text-2xl font-bold">{workPackages}</p>
            </div>
            <FolderOpen className="w-5 h-5 text-blue-500" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">In Progress</p>
              <p className="text-2xl font-bold text-amber-500">{inProgress}</p>
            </div>
            <Clock className="w-5 h-5 text-amber-500" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Completed</p>
              <p className="text-2xl font-bold text-emerald-500">{completedTasks}</p>
            </div>
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          </div>
        </Card>
      </div>

      {/* Overall Progress */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium">Scope Completion</p>
          <span className="text-sm font-bold">{overallProgress}%</span>
        </div>
        <Progress value={overallProgress} className="h-2" />
      </Card>

      {/* WBS Tree / Flat View */}
      {totalTasks === 0 ? (
        <Card>
          <CardContent className="py-16">
            <div className="flex flex-col items-center justify-center text-center">
              <Layers className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <h3 className="text-lg font-medium mb-2">No scope data yet</h3>
              <p className="text-sm text-muted-foreground max-w-md mb-6">
                Your AI agent will generate the Work Breakdown Structure when it analyses project requirements and creates tasks.
              </p>
              <Button variant="outline" size="sm" onClick={() => setAddingParent({ id: null })}>
                <Plus className="h-4 w-4 mr-2" />Add Work Package
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : view === "tree" ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <GitBranch className="w-4 h-4" />
              Work Breakdown Structure
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border/30">
              {tree.map((node) => (
                <WBSNode
                  key={node.id}
                  node={node}
                  onEdit={setEditingTask}
                  onAdd={(id, title) => setAddingParent({ id, title })}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">All Scope Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 font-medium text-muted-foreground">Title</th>
                    <th className="py-2 font-medium text-muted-foreground">Status</th>
                    <th className="py-2 font-medium text-muted-foreground">Priority</th>
                    <th className="py-2 font-medium text-muted-foreground">Progress</th>
                    <th className="py-2 font-medium text-muted-foreground">Hours</th>
                    <th className="py-2 font-medium text-muted-foreground w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((t: any) => (
                    <tr key={t.id} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-2 cursor-pointer hover:text-primary" onClick={() => setEditingTask(t as TaskNode)}>
                        {t.title}
                      </td>
                      <td className="py-2">
                        <Badge variant={t.status === "DONE" || t.status === "COMPLETED" ? "default" : t.status === "IN_PROGRESS" ? "secondary" : "outline"}>
                          {t.status}
                        </Badge>
                      </td>
                      <td className="py-2">
                        {t.priority && <Badge variant={t.priority === "HIGH" || t.priority === "CRITICAL" ? "destructive" : "outline"}>{t.priority}</Badge>}
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <Progress value={t.progress ?? 0} className="h-1.5 w-16" />
                          <span className="text-xs text-muted-foreground">{t.progress ?? 0}%</span>
                        </div>
                      </td>
                      <td className="py-2 text-muted-foreground">{t.estimatedHours ?? "—"}</td>
                      <td className="py-2">
                        <button
                          onClick={() => setEditingTask(t as TaskNode)}
                          className="text-muted-foreground hover:text-primary"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Requirements Traceability */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Requirements Traceability</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Target className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground max-w-md">
              Your AI agent will populate requirements traceability as it manages the project.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Slide-out Edit Panel ── */}
      {editingTask && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setEditingTask(null)} />
          <TaskEditPanel
            task={editingTask}
            projectId={projectId}
            onClose={() => setEditingTask(null)}
          />
        </>
      )}

      {/* ── Slide-out Add Panel ── */}
      {addingParent && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setAddingParent(null)} />
          <AddTaskPanel
            projectId={projectId}
            parentId={addingParent.id}
            parentTitle={addingParent.title}
            onClose={() => setAddingParent(null)}
          />
        </>
      )}
    </div>
  );
}
