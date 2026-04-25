"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useProject, useProjectTasks } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Target, Layers, GitBranch, Plus, ChevronRight, ChevronDown,
  FolderOpen, CheckCircle2, Circle, Clock, Package,
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

function WBSNode({ node, depth = 0 }: { node: TaskNode; depth?: number }) {
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
          "flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer group",
          depth === 0 && "font-medium"
        )}
        style={{ paddingLeft: `${depth * 24 + 8}px` }}
        onClick={() => hasChildren && setOpen(!open)}
      >
        {hasChildren ? (
          open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        {hasChildren ? (
          <FolderOpen className="w-4 h-4 text-primary/70 shrink-0" />
        ) : (
          <StatusIcon className={cn("w-4 h-4 shrink-0", statusColor)} />
        )}

        <span className="text-sm flex-1 truncate">{node.title}</span>

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
      </div>

      {hasChildren && open && (
        <div>
          {node.children.map((child) => (
            <WBSNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ScopeManagementPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading: projectLoading } = useProject(projectId);
  const { data: tasks, isLoading: tasksLoading } = useProjectTasks(projectId);
  const [view, setView] = useState<"tree" | "flat">("tree");

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

  // Scope completion = weighted average of per-item progress (PMI WBS standard).
  // Weight by estimatedHours when every item has hours so a 40-hour deliverable
  // counts more than a 1-hour checklist item; otherwise fall back to a simple
  // average. Fully DONE items are forced to 100% even if their progress field
  // is stale — completion status trumps numeric progress.
  // (Previously this was `completedTasks / total` which under-reported any
  // project where work had started but nothing was 100% finished.)
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
          <Button variant="outline" size="sm">
            <Layers className="h-4 w-4 mr-2" />Export WBS
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
              <Button variant="outline" size="sm">
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
                <WBSNode key={node.id} node={node} />
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
                  </tr>
                </thead>
                <tbody>
                  {items.map((t: any) => (
                    <tr key={t.id} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-2">{t.title}</td>
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
    </div>
  );
}
