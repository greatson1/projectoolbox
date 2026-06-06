"use client";

import { useState, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import { useProjectTasks, useCreateTask, useUpdateTask, useDeleteTask } from "@/hooks/use-api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  ClipboardList, Plus, AlertTriangle, CheckCircle2, Timer,
  Pencil, Trash2, X, Save, ExternalLink, CalendarDays, FileText,
} from "lucide-react";

export default function ActionsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: allTasks, isLoading } = useProjectTasks(projectId);
  const createTask = useCreateTask(projectId);
  const updateTask = useUpdateTask(projectId);
  const deleteTask = useDeleteTask(projectId);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [newPriority, setNewPriority] = useState("MEDIUM");
  const [newDueDate, setNewDueDate] = useState("");

  // Filter to action items only (from artefacts or manually tagged)
  const actions = useMemo(() => {
    if (!allTasks) return [];
    return allTasks.filter((t: any) => {
      const labels = t.labels as string[] | null;
      const hasActionLabel = labels?.includes("action_item") || labels?.includes("from_artefact");
      const hasSource = !!t.sourceArtefactId;
      const isManualAction = labels?.includes("manual_action");
      return hasActionLabel || hasSource || isManualAction;
    });
  }, [allTasks]);

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);

  const overdue = actions.filter((a: any) =>
    a.endDate && new Date(a.endDate) < now && a.status !== "DONE" && a.status !== "COMPLETED"
  ).length;

  const completedThisWeek = actions.filter((a: any) =>
    (a.status === "DONE" || a.status === "COMPLETED") &&
    a.updatedAt && new Date(a.updatedAt) >= weekAgo
  ).length;

  const closedActions = actions.filter((a: any) => a.status === "DONE" || a.status === "COMPLETED");
  const avgDaysToClose = closedActions.length > 0
    ? closedActions.reduce((sum: number, a: any) => {
        const created = new Date(a.createdAt);
        const updated = new Date(a.updatedAt);
        return sum + Math.max(1, Math.round((updated.getTime() - created.getTime()) / 86400000));
      }, 0) / closedActions.length
    : 0;

  const overdueActions = actions.filter((a: any) =>
    a.endDate && new Date(a.endDate) < now && a.status !== "DONE" && a.status !== "COMPLETED"
  );

  const handleAdd = useCallback(async () => {
    if (!newTitle.trim()) return;
    try {
      await createTask.mutateAsync({
        title: newTitle.trim(),
        assigneeName: newOwner || null,
        priority: newPriority,
        endDate: newDueDate || null,
        status: "TODO",
        progress: 0,
        labels: ["action_item", "manual_action"],
      });
      toast.success("Action added");
      setShowAdd(false);
      setNewTitle("");
      setNewOwner("");
      setNewPriority("MEDIUM");
      setNewDueDate("");
    } catch (e: any) {
      toast.error(e.message || "Failed to add action");
    }
  }, [newTitle, newOwner, newPriority, newDueDate, createTask]);

  const handleStatusChange = useCallback(async (taskId: string, status: string) => {
    try {
      await updateTask.mutateAsync({
        taskId,
        status,
        progress: status === "DONE" ? 100 : status === "IN_PROGRESS" ? 50 : 0,
      });
      toast.success("Status updated");
    } catch (e: any) {
      toast.error(e.message || "Failed to update");
    }
  }, [updateTask]);

  const handleDelete = useCallback(async (taskId: string, title: string) => {
    if (!confirm(`Delete action "${title}"?`)) return;
    try {
      await deleteTask.mutateAsync(taskId);
      toast.success("Action deleted");
    } catch (e: any) {
      toast.error(e.message || "Failed to delete");
    }
  }, [deleteTask]);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  function renderTable(items: any[]) {
    if (items.length === 0) {
      return (
        <div className="text-center py-20">
          <ClipboardList className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No actions logged yet</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Actions are extracted automatically from approved artefacts, or add them manually.
          </p>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4 mr-1" /> Add First Action
          </Button>
        </div>
      );
    }

    return (
      <Card className="p-0 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              {["Action", "Owner", "Source", "Priority", "Due Date", "Status", ""].map(h => (
                <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((a: any) => {
              const isOverdue = a.endDate && new Date(a.endDate) < now && a.status !== "DONE" && a.status !== "COMPLETED";
              const source = a.sourceArtefactId
                ? (a.description?.match(/\[from-artefact:([^\]]+)\]/)?.[1] || "Artefact")
                : (a.labels?.includes("manual_action") ? "Manual" : "—");
              const statusDisplay = a.status === "DONE" || a.status === "COMPLETED" ? "DONE"
                : a.status === "IN_PROGRESS" ? "IN PROGRESS"
                : isOverdue ? "OVERDUE" : "OPEN";
              const statusVariant = statusDisplay === "DONE" ? "default"
                : statusDisplay === "OVERDUE" ? "destructive"
                : statusDisplay === "IN PROGRESS" ? "secondary" : "outline";
              const priorityVariant = a.priority === "HIGH" || a.priority === "CRITICAL" ? "destructive"
                : a.priority === "MEDIUM" ? "secondary" : "outline";

              return (
                <tr key={a.id} className="border-b border-border/30 hover:bg-muted/30 group">
                  <td className="py-2.5 px-4 font-medium max-w-[300px]">
                    <span className="truncate block">{a.title}</span>
                  </td>
                  <td className="py-2.5 px-4 text-muted-foreground">{a.assigneeName || "Unassigned"}</td>
                  <td className="py-2.5 px-4">
                    {a.sourceArtefactId ? (
                      <span className="flex items-center gap-1 text-[10px] text-primary">
                        <FileText className="w-3 h-3" />
                        {source}
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">{source}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4">
                    <Badge variant={priorityVariant}>{a.priority || "MEDIUM"}</Badge>
                  </td>
                  <td className="py-2.5 px-4 text-muted-foreground">
                    {a.endDate ? (
                      <span className={isOverdue ? "text-destructive font-semibold" : ""}>
                        {new Date(a.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="py-2.5 px-4">
                    <select
                      value={a.status === "DONE" || a.status === "COMPLETED" ? "DONE" : a.status || "TODO"}
                      onChange={e => handleStatusChange(a.id, e.target.value)}
                      className="h-7 rounded-md border border-input bg-background px-2 text-[11px] font-medium"
                    >
                      <option value="TODO">Open</option>
                      <option value="IN_PROGRESS">In Progress</option>
                      <option value="DONE">Done</option>
                    </select>
                  </td>
                  <td className="py-2.5 px-4">
                    <button
                      onClick={() => handleDelete(a.id, a.title)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Action Log</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {actions.length} actions · {overdue} overdue · {completedThisWeek} completed this week
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4 mr-1" /> Add Action
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Actions</p>
              <p className="text-2xl font-bold">{actions.length}</p>
            </div>
            <ClipboardList className="w-5 h-5 text-primary" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Overdue</p>
              <p className="text-2xl font-bold text-destructive">{overdue}</p>
            </div>
            <AlertTriangle className="w-5 h-5 text-destructive" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Completed This Week</p>
              <p className="text-2xl font-bold text-green-500">{completedThisWeek}</p>
            </div>
            <CheckCircle2 className="w-5 h-5 text-green-500" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Days to Close</p>
              <p className="text-2xl font-bold">{avgDaysToClose > 0 ? avgDaysToClose.toFixed(1) : "---"}</p>
            </div>
            <Timer className="w-5 h-5 text-amber-500" />
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          <TabsTrigger value="all" className="text-[13px] font-semibold">All Actions</TabsTrigger>
          <TabsTrigger value="overdue" className="text-[13px] font-semibold">Overdue</TabsTrigger>
          <TabsTrigger value="my-actions" className="text-[13px] font-semibold">My Actions</TabsTrigger>
        </TabsList>

        <TabsContent value="all">{renderTable(actions)}</TabsContent>

        <TabsContent value="overdue">
          {overdueActions.length === 0 && actions.length > 0 ? (
            <div className="text-center py-20">
              <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-4" />
              <h2 className="text-lg font-bold mb-2">No overdue actions</h2>
              <p className="text-sm text-muted-foreground">All actions are on track.</p>
            </div>
          ) : (
            renderTable(overdueActions)
          )}
        </TabsContent>

        <TabsContent value="my-actions">{renderTable(actions)}</TabsContent>
      </Tabs>

      {/* Add Action Panel */}
      {showAdd && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setShowAdd(false)} />
          <div className="fixed inset-y-0 right-0 w-96 bg-background border-l border-border shadow-2xl z-50 flex flex-col animate-in slide-in-from-right-5 duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-bold">Add Action</h3>
              <button onClick={() => setShowAdd(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Action *</Label>
                <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="e.g. Confirm vendor contract terms" className="text-sm" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Owner</Label>
                <Input value={newOwner} onChange={e => setNewOwner(e.target.value)} placeholder="e.g. Project Manager" className="text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Priority</Label>
                  <select
                    value={newPriority}
                    onChange={e => setNewPriority(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><CalendarDays className="w-3 h-3" />Due Date</Label>
                  <Input type="date" value={newDueDate} onChange={e => setNewDueDate(e.target.value)} className="text-sm" />
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button size="sm" onClick={handleAdd} disabled={!newTitle.trim() || createTask.isPending}>
                <Plus className="w-3.5 h-3.5 mr-1.5" />{createTask.isPending ? "Adding…" : "Add Action"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
