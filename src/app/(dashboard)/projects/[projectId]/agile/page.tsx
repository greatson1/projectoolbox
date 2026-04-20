"use client";
// @ts-nocheck

import { useState, useMemo, useCallback, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  useDroppable,
  useDraggable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { useParams } from "next/navigation";
import {
  useProjectTasks, useUpdateTask, useCreateTask,
  useProjectSprints, useCreateSprint, useUpdateSprint, useDeleteSprint,
} from "@/hooks/use-api";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, LineChart, Line,
} from "recharts";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

type BoardType = "scrum" | "kanban";
type ColumnId = "backlog" | "todo" | "in_progress" | "in_review" | "done";
type Priority = "critical" | "high" | "medium" | "low";
type IssueType = "story" | "bug" | "task" | "spike";
type SwimlaneSetting = "none" | "epic" | "assignee" | "priority" | "label";

interface Issue {
  id: string;
  title: string;
  type: IssueType;
  column: ColumnId;
  priority: Priority;
  storyPoints: number;
  assignee: string;
  assigneeName?: string;
  labels: string[];
  epic: string;
  dueDate?: string;
  blocked?: boolean;
  subtasks?: { total: number; done: number };
  description?: string;
  sprintId?: string | null;
}

interface SprintData {
  id: string;
  name: string;
  goal?: string;
  startDate: string;
  endDate: string;
  status: string;
  committedPoints?: number;
  completedPoints?: number;
  _count?: { tasks: number };
}

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

const COLUMNS: { id: ColumnId; label: string; color: string; wipLimit?: number }[] = [
  { id: "backlog",     label: "Backlog",     color: "#64748B" },
  { id: "todo",        label: "To Do",       color: "#6366F1" },
  { id: "in_progress", label: "In Progress", color: "#22D3EE", wipLimit: 6 },
  { id: "in_review",   label: "In Review",   color: "#F59E0B" },
  { id: "done",        label: "Done",        color: "#10B981" },
];

const COLUMN_STATUS_MAP: Record<ColumnId, string> = {
  backlog: "BACKLOG", todo: "TODO", in_progress: "IN_PROGRESS",
  in_review: "IN_REVIEW", done: "DONE",
};

const STATUS_COLUMN_MAP: Record<string, ColumnId> = {
  BACKLOG: "backlog", TODO: "todo", IN_PROGRESS: "in_progress",
  IN_REVIEW: "in_review", DONE: "done", COMPLETED: "done",
  in_progress: "in_progress", active: "in_progress", done: "done",
  completed: "done", in_review: "in_review", todo: "todo", backlog: "backlog",
};

const PRIORITY_COLORS: Record<Priority, string> = {
  critical: "#EF4444", high: "#F97316", medium: "#6366F1", low: "#64748B",
};
const PRIORITY_ICONS: Record<Priority, string> = {
  critical: "🔴", high: "🟠", medium: "🔵", low: "⚪",
};
const ISSUE_ICONS: Record<IssueType, string> = {
  story: "📖", bug: "🐛", task: "✅", spike: "🔬",
};

const LABEL_COLORS = ["#6366F1", "#10B981", "#22D3EE", "#EC4899", "#64748B", "#EF4444", "#F59E0B", "#8B5CF6"];

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT — all hooks called unconditionally before any return
// ═══════════════════════════════════════════════════════════════════

export default function AgileBoardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();

  // ── Data hooks (unconditional) ────────────────────────────────────
  const { data: apiTasks, isLoading: tasksLoading, error: tasksError } = useProjectTasks(projectId);
  const { data: apiSprints, isLoading: sprintsLoading } = useProjectSprints(projectId);
  const updateTask  = useUpdateTask(projectId);
  const createTask  = useCreateTask(projectId);
  const createSprint = useCreateSprint(projectId);
  const updateSprint = useUpdateSprint(projectId);
  const deleteSprint = useDeleteSprint(projectId);

  // ── Board state (unconditional) ───────────────────────────────────
  const [boardType, setBoardType]           = useState<BoardType>("scrum");
  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(null);
  const [swimlane, setSwimlane]             = useState<SwimlaneSetting>("none");
  const [selectedIssue, setSelectedIssue]   = useState<Issue | null>(null);
  const [showAnalytics, setShowAnalytics]   = useState(true);

  // ── Drag-and-drop state ───────────────────────────────────────────
  const [activeId, setActiveId]       = useState<string | null>(null);
  const [overColumnId, setOverColumnId] = useState<ColumnId | null>(null);
  // Optimistic column overrides: issueId → ColumnId
  const [optimisticColumns, setOptimisticColumns] = useState<Record<string, ColumnId>>({});

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragOver(event: DragOverEvent) {
    const overId = event.over?.id as ColumnId | null;
    setOverColumnId(overId || null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    setOverColumnId(null);

    if (!over) return;

    const taskId     = active.id as string;
    const newColId   = over.id as ColumnId;
    const issue      = filteredIssues.find(i => i.id === taskId);
    const currentCol = (optimisticColumns[taskId] ?? issue?.column) as ColumnId | undefined;

    if (!issue || !newColId || currentCol === newColId) return;

    // Optimistic update
    setOptimisticColumns(prev => ({ ...prev, [taskId]: newColId }));

    const newStatus = COLUMN_STATUS_MAP[newColId];
    const colLabel  = COLUMNS.find(c => c.id === newColId)?.label ?? newColId;
    const toastId   = toast.loading(`Moving to ${colLabel}…`);

    updateTask.mutate(
      { taskId, status: newStatus },
      {
        onSuccess: () => toast.success(`Moved to ${colLabel}`, { id: toastId }),
        onError: () => {
          // Roll back optimistic update
          setOptimisticColumns(prev => {
            const next = { ...prev };
            delete next[taskId];
            return next;
          });
          toast.error("Failed to move card", { id: toastId });
        },
      }
    );
  }

  // Filters
  const [filterBlocked, setFilterBlocked]     = useState(false);
  const [filterBugs, setFilterBugs]           = useState(false);
  const [filterUnassigned, setFilterUnassigned] = useState(false);
  const [filterAssignee, setFilterAssignee]   = useState<string | null>(null);
  const [filterLabel, setFilterLabel]         = useState<string | null>(null);
  const [searchQuery, setSearchQuery]         = useState("");

  // Create issue modal state
  const [showCreateIssue, setShowCreateIssue] = useState(false);
  const [issueForm, setIssueForm] = useState({
    title: "", type: "task", priority: "MEDIUM",
    storyPoints: "", assigneeName: "", epic: "",
    description: "", sprintId: "",
  });

  // Create sprint modal state
  const [showCreateSprint, setShowCreateSprint] = useState(false);
  const [editingSprint, setEditingSprint]       = useState<SprintData | null>(null);
  const [sprintForm, setSprintForm] = useState({
    name: "", goal: "", startDate: "", endDate: "", status: "PLANNING",
  });

  // ── Derived data ──────────────────────────────────────────────────

  const sprints: SprintData[] = useMemo(() => apiSprints || [], [apiSprints]);

  // Auto-select active sprint on first load
  const activeSprint = useMemo(
    () => sprints.find(s => s.status === "ACTIVE") || sprints[0] || null,
    [sprints]
  );
  const currentSprintId = selectedSprintId ?? activeSprint?.id ?? null;
  const currentSprint   = sprints.find(s => s.id === currentSprintId) || null;

  // Strip internal seeder tags from description for clean display
  function cleanDescription(raw: string | null | undefined): string {
    if (!raw) return "";
    return raw
      .replace(/\[source:\w+\]\s*/g, "")
      .replace(/Sprint:\s*Sprint\s*\d+\s*\|?\s*/g, "")
      .replace(/Owner:\s*/g, "Assigned to: ")
      .replace(/^\s*\|\s*/, "")
      .replace(/\s*\|\s*$/, "")
      .trim();
  }

  // Strip internal goal prefixes from sprint names/goals
  function cleanSprintGoal(raw: string | null | undefined): string {
    if (!raw) return "";
    return raw
      .replace(/^\[source:artefact\]\s*/i, "")
      .replace(/^\[auto-planned\]\s*/i, "")
      .trim();
  }

  const allIssues: Issue[] = useMemo(() => {
    if (!apiTasks) return [];
    return apiTasks.map((t: any, idx: number) => ({
      id: t.id || `PTX-${100 + idx}`,
      title: t.title || t.name || "",
      type: (["bug","spike","task","story"].includes(t.type) ? t.type : "task") as IssueType,
      column: (STATUS_COLUMN_MAP[t.status] || "backlog") as ColumnId,
      priority: (["critical","high","medium","low"].includes(t.priority?.toLowerCase()) ? t.priority.toLowerCase() : "medium") as Priority,
      storyPoints: t.storyPoints ?? 0,
      assignee: t.assigneeName || t.assignee || "",
      labels: Array.isArray(t.labels) ? t.labels : [],
      epic: t.epic || "",
      dueDate: t.dueDate || t.endDate,
      blocked: t.blocked || false,
      subtasks: t.subtasks,
      description: cleanDescription(t.description),
      sprintId: t.sprintId || null,
    }));
  }, [apiTasks]);

  // For scrum mode, only show issues in the selected sprint
  const boardIssues = useMemo(() => {
    if (boardType === "kanban") return allIssues;
    if (!currentSprintId) return allIssues;
    return allIssues.filter(i => i.sprintId === currentSprintId);
  }, [allIssues, boardType, currentSprintId]);

  const filteredIssues = useMemo(() => {
    let result = [...boardIssues];
    if (filterBlocked)    result = result.filter(i => i.blocked);
    if (filterBugs)       result = result.filter(i => i.type === "bug");
    if (filterUnassigned) result = result.filter(i => !i.assignee);
    if (filterAssignee)   result = result.filter(i => i.assignee === filterAssignee);
    if (filterLabel)      result = result.filter(i => i.labels.includes(filterLabel));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(i => i.title.toLowerCase().includes(q) || i.id.toLowerCase().includes(q));
    }
    return result;
  }, [boardIssues, filterBlocked, filterBugs, filterUnassigned, filterAssignee, filterLabel, searchQuery]);

  const derivedTeam = useMemo(() => {
    const map = new Map<string, number>();
    for (const issue of boardIssues) {
      if (issue.assignee) map.set(issue.assignee, (map.get(issue.assignee) || 0) + issue.storyPoints);
    }
    return Array.from(map.entries()).map(([name, assigned]) => ({
      name,
      initials: name.split(" ").map((w: string) => w[0] || "").join("").toUpperCase().slice(0, 2),
      capacity: assigned,
      assigned,
    }));
  }, [boardIssues]);

  const derivedLabels = useMemo(() => {
    const set = new Set<string>();
    for (const issue of allIssues) for (const l of issue.labels) set.add(l);
    return Array.from(set).map((name, i) => ({ name, color: LABEL_COLORS[i % LABEL_COLORS.length] }));
  }, [allIssues]);

  function getLabelColor(name: string) {
    return derivedLabels.find(l => l.name === name)?.color || "#64748B";
  }

  const completedSP = boardIssues.filter(i => i.column === "done").reduce((s, i) => s + i.storyPoints, 0);
  const committedSP = boardIssues.reduce((s, i) => s + i.storyPoints, 0);

  const daysRemaining = useMemo(() => {
    if (!currentSprint) return 0;
    const end = new Date(currentSprint.endDate);
    const now = new Date();
    return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400000));
  }, [currentSprint]);

  const agileBurndown = useMemo(() => {
    if (boardIssues.length === 0) return [];
    const total = boardIssues.length;
    const done  = boardIssues.filter(i => i.column === "done").length;
    return Array.from({ length: 14 }, (_, i) => ({
      day: `D${i + 1}`,
      ideal: Math.round(total * (1 - (i + 1) / 14)),
      actual: i < 6 ? Math.max(0, Math.round(total - done * ((i + 1) / 6))) : null,
    }));
  }, [boardIssues]);

  const agileVelocity = useMemo(() => {
    const completed = sprints
      .filter(s => s.status === "COMPLETED")
      .slice(-4)
      .map(s => ({
        sprint: s.name,
        committed: s.committedPoints ?? 0,
        completed: s.completedPoints ?? 0,
      }));
    // Append current sprint as live last entry
    if (currentSprint) {
      return [...completed, { sprint: currentSprint.name, committed: committedSP, completed: completedSP }];
    }
    return completed;
  }, [sprints, currentSprint, committedSP, completedSP]);

  // Apply optimistic column overrides to the board for instant feedback
  const displayIssues = useMemo(
    () => filteredIssues.map(i =>
      optimisticColumns[i.id] ? { ...i, column: optimisticColumns[i.id] } : i
    ),
    [filteredIssues, optimisticColumns]
  );

  const activeDragIssue = useMemo(
    () => activeId ? displayIssues.find(i => i.id === activeId) ?? null : null,
    [activeId, displayIssues]
  );

  const hasActiveFilters = filterBlocked || filterBugs || filterUnassigned || filterAssignee || filterLabel || searchQuery;

  // ── Handlers ─────────────────────────────────────────────────────

  const handleStatusChange = useCallback((newCol: ColumnId) => {
    setSelectedIssue(prev => prev ? { ...prev, column: newCol } : null);
  }, []);

  function openCreateSprint(existing?: SprintData) {
    if (existing) {
      setEditingSprint(existing);
      setSprintForm({
        name: existing.name,
        goal: existing.goal || "",
        startDate: existing.startDate.slice(0, 10),
        endDate: existing.endDate.slice(0, 10),
        status: existing.status,
      });
    } else {
      setEditingSprint(null);
      setSprintForm({ name: `Sprint ${sprints.length + 1}`, goal: "", startDate: "", endDate: "", status: "PLANNING" });
    }
    setShowCreateSprint(true);
  }

  async function saveSprint() {
    if (!sprintForm.name || !sprintForm.startDate || !sprintForm.endDate) {
      toast.error("Name, start date and end date are required");
      return;
    }
    try {
      if (editingSprint) {
        await updateSprint.mutateAsync({ sprintId: editingSprint.id, ...sprintForm });
        toast.success("Sprint updated");
      } else {
        const result = await createSprint.mutateAsync(sprintForm) as any;
        setSelectedSprintId(result?.id || null);
        toast.success("Sprint created");
      }
      setShowCreateSprint(false);
    } catch {
      toast.error("Failed to save sprint");
    }
  }

  async function handleDeleteSprint(sprintId: string) {
    if (!confirm("Delete this sprint? Tasks will be moved back to backlog.")) return;
    try {
      await deleteSprint.mutateAsync(sprintId);
      if (currentSprintId === sprintId) setSelectedSprintId(null);
      toast.success("Sprint deleted");
    } catch {
      toast.error("Failed to delete sprint");
    }
  }

  async function handleStartSprint(sprintId: string) {
    // Set any ACTIVE sprint to COMPLETED first
    const active = sprints.find(s => s.status === "ACTIVE");
    if (active && active.id !== sprintId) {
      await updateSprint.mutateAsync({ sprintId: active.id, status: "COMPLETED" });
    }
    await updateSprint.mutateAsync({ sprintId, status: "ACTIVE" });
    setSelectedSprintId(sprintId);
    toast.success("Sprint started");
  }

  async function handleCompleteSprint(sprintId: string) {
    await updateSprint.mutateAsync({ sprintId, status: "COMPLETED" });
    toast.success("Sprint completed");
  }

  async function saveIssue() {
    if (!issueForm.title.trim()) { toast.error("Title required"); return; }
    try {
      await createTask.mutateAsync({
        title: issueForm.title.trim(),
        type: issueForm.type,
        priority: issueForm.priority,
        storyPoints: issueForm.storyPoints ? Number(issueForm.storyPoints) : null,
        assigneeName: issueForm.assigneeName.trim() || null,
        epic: issueForm.epic.trim() || null,
        description: issueForm.description.trim() || null,
        sprintId: issueForm.sprintId || currentSprintId || null,
        status: issueForm.sprintId || currentSprintId ? "TODO" : "BACKLOG",
      });
      toast.success("Issue created");
      setShowCreateIssue(false);
      setIssueForm({ title: "", type: "task", priority: "MEDIUM", storyPoints: "", assigneeName: "", epic: "", description: "", sprintId: "" });
    } catch {
      toast.error("Failed to create issue");
    }
  }

  // ── Loading / error guards (AFTER all hooks) ──────────────────────

  const isLoading = tasksLoading || sprintsLoading;
  if (isLoading) {
    return (
      <div className="space-y-4 max-w-[1800px]">
        <div className="h-10 w-48 rounded-lg bg-muted animate-pulse" />
        <div className="h-24 rounded-xl bg-muted animate-pulse" />
        <div className="flex gap-3">
          {[1,2,3,4,5].map(i => <div key={i} className="flex-1 h-64 rounded-xl bg-muted animate-pulse" />)}
        </div>
      </div>
    );
  }
  if (tasksError) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Failed to load board: {(tasksError as any)?.message || "Unknown error"}.{" "}
        <button onClick={() => qc.invalidateQueries({ queryKey: ["tasks", projectId] })} className="text-primary underline ml-1">Retry</button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 max-w-[1800px]">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Agile Board</h1>
          {/* Board type toggle */}
          <div className="flex rounded-lg overflow-hidden border border-border">
            {(["scrum", "kanban"] as BoardType[]).map(bt => (
              <button key={bt}
                className={`px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${boardType === bt ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                onClick={() => setBoardType(bt)}>
                {bt === "scrum" ? "🏃 Scrum" : "📋 Kanban"}
              </button>
            ))}
          </div>
          {/* Sprint selector */}
          {boardType === "scrum" && (
            <select
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-card text-foreground"
              value={currentSprintId || ""}
              onChange={e => setSelectedSprintId(e.target.value || null)}>
              <option value="">All issues (no sprint filter)</option>
              {sprints.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} · {new Date(s.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – {new Date(s.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} [{s.status}]{cleanSprintGoal(s.goal) ? ` — ${cleanSprintGoal(s.goal).slice(0, 40)}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowAnalytics(!showAnalytics)}>
            {showAnalytics ? "Hide" : "Show"} Analytics
          </Button>
          {boardType === "scrum" && (
            <Button variant="outline" size="sm" onClick={() => openCreateSprint()}>
              + New Sprint
            </Button>
          )}
          {boardType === "scrum" && currentSprint && currentSprint.status === "PLANNING" && (
            <Button variant="outline" size="sm" className="text-green-600 border-green-500/40 hover:bg-green-500/10"
              onClick={() => handleStartSprint(currentSprint.id)}>
              ▶ Start Sprint
            </Button>
          )}
          {boardType === "scrum" && currentSprint && currentSprint.status === "ACTIVE" && (
            <Button variant="outline" size="sm" className="text-amber-600 border-amber-500/40 hover:bg-amber-500/10"
              onClick={() => handleCompleteSprint(currentSprint.id)}>
              ✓ Complete Sprint
            </Button>
          )}
          <Button size="sm" onClick={() => setShowCreateIssue(true)}>+ Create Issue</Button>
        </div>
      </div>

      {/* ── Sprints List (when no sprint selected, scrum mode) ── */}
      {boardType === "scrum" && sprints.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center">
            <p className="text-2xl mb-2">🏃</p>
            <p className="text-sm font-semibold mb-1">No sprints yet</p>
            <p className="text-xs text-muted-foreground mb-4">Create your first sprint to plan and track work in time-boxed iterations.</p>
            <Button size="sm" onClick={() => openCreateSprint()}>+ Create First Sprint</Button>
          </CardContent>
        </Card>
      )}

      {/* ── Sprint Info Bar ── */}
      {boardType === "scrum" && currentSprint && (
        <div className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-6 flex-wrap">
          <div className="flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{currentSprint.name}</span>
              {currentSprint.status === "ACTIVE" && <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />}
              <Badge variant={currentSprint.status === "ACTIVE" ? "default" : currentSprint.status === "COMPLETED" ? "secondary" : "outline"} className="text-[9px]">
                {currentSprint.status}
              </Badge>
            </div>
            {currentSprint.goal && cleanSprintGoal(currentSprint.goal) && (
              <p className="text-[11px] mt-0.5 max-w-[220px] truncate text-muted-foreground">{cleanSprintGoal(currentSprint.goal)}</p>
            )}
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {new Date(currentSprint.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} –{" "}
              {new Date(currentSprint.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>

          <div className="text-center px-4 border-x border-border">
            <span className={`text-xl font-bold ${daysRemaining <= 3 ? "text-destructive" : "text-primary"}`}>{daysRemaining}</span>
            <p className="text-[10px] text-muted-foreground">days left</p>
          </div>

          <div className="flex-1 min-w-[160px] max-w-[220px]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground">Story Points</span>
              <span className="text-xs font-bold text-primary">{completedSP}/{committedSP} SP</span>
            </div>
            <Progress value={committedSP > 0 ? Math.round((completedSP / committedSP) * 100) : 0} className="h-1.5" />
          </div>

          <div className="text-center">
            <span className="text-sm font-bold">{committedSP > 0 ? Math.round((completedSP / committedSP) * 100) : 0}%</span>
            <p className="text-[10px] text-muted-foreground">Complete</p>
          </div>

          <div className="min-w-[120px]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-muted-foreground">Team</span>
              <span className="text-[11px] font-semibold">{derivedTeam.length} members</span>
            </div>
            <Progress value={100} className="h-1.5" />
          </div>

          {/* Mini burndown sparkline */}
          <div className="w-[90px] h-[36px] flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={agileBurndown.filter(d => d.actual != null).map((d, i) => ({ d: i, v: d.actual }))}>
                <Line type="monotone" dataKey="v" stroke="var(--primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Sprint actions */}
          <div className="flex gap-1 ml-auto">
            <button onClick={() => openCreateSprint(currentSprint)}
              className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors">
              ✏️ Edit
            </button>
            <button onClick={() => handleDeleteSprint(currentSprint.id)}
              className="text-[10px] text-muted-foreground hover:text-destructive px-2 py-1 rounded hover:bg-destructive/10 transition-colors">
              🗑 Delete
            </button>
          </div>
        </div>
      )}

      {/* ── Filter Bar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <FilterChip label="Blocked" active={filterBlocked} onClick={() => setFilterBlocked(!filterBlocked)} icon="🚫" />
        <FilterChip label="Bugs" active={filterBugs} onClick={() => setFilterBugs(!filterBugs)} icon="🐛" />
        <FilterChip label="Unassigned" active={filterUnassigned} onClick={() => setFilterUnassigned(!filterUnassigned)} />

        <div className="w-px h-5 bg-border" />

        {/* Assignee pills */}
        {derivedTeam.map(m => (
          <button key={m.name}
            className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium transition-all border ${filterAssignee === m.name ? "bg-primary/10 border-primary text-primary" : "border-border/40 text-muted-foreground"}`}
            onClick={() => setFilterAssignee(filterAssignee === m.name ? null : m.name)}>
            <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center text-[8px] font-bold text-white">
              {m.initials}
            </div>
            <span className="hidden sm:inline">{m.name.split(" ")[0]}</span>
          </button>
        ))}

        <div className="w-px h-5 bg-border" />

        <select className="px-2 py-1 rounded-md text-[11px] border border-border bg-card text-muted-foreground"
          value={filterLabel || ""} onChange={e => setFilterLabel(e.target.value || null)}>
          <option value="">All Labels</option>
          {derivedLabels.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
        </select>

        <input className="px-3 py-1 rounded-lg text-xs w-40 border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          placeholder="Search issues…"
          value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />

        <select className="px-2 py-1 rounded-md text-[11px] ml-auto border border-border bg-card text-muted-foreground"
          value={swimlane} onChange={e => setSwimlane(e.target.value as SwimlaneSetting)}>
          <option value="none">No Swimlanes</option>
          <option value="epic">By Epic</option>
          <option value="assignee">By Assignee</option>
          <option value="priority">By Priority</option>
          <option value="label">By Label</option>
        </select>

        {hasActiveFilters && (
          <button className="text-[11px] font-semibold px-2 py-1 rounded text-destructive bg-destructive/10"
            onClick={() => { setFilterBlocked(false); setFilterBugs(false); setFilterUnassigned(false); setFilterAssignee(null); setFilterLabel(null); setSearchQuery(""); }}>
            Clear Filters
          </button>
        )}
      </div>

      {/* ── Board + Analytics ── */}
      <div className="flex gap-4">
        <div className="flex-1 overflow-x-auto">
          {swimlane === "none"
            ? (
              <DndContext
                sensors={dndSensors}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
              >
                <BoardColumns
                  columns={COLUMNS}
                  issues={displayIssues}
                  onCardClick={setSelectedIssue}
                  getLabelColor={getLabelColor}
                  activeId={activeId}
                  overColumnId={overColumnId}
                />
                <DragOverlay dropAnimation={{ duration: 150, easing: "ease" }}>
                  {activeDragIssue ? (
                    <div style={{ transform: "rotate(2deg)", opacity: 0.95 }}>
                      <IssueCard
                        issue={activeDragIssue}
                        onClick={() => {}}
                        getLabelColor={getLabelColor}
                      />
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            )
            : <SwimlanedBoard swimlane={swimlane} columns={COLUMNS} issues={filteredIssues} onCardClick={setSelectedIssue} getLabelColor={getLabelColor} />
          }
        </div>

        {/* Analytics sidebar */}
        {showAnalytics && boardType === "scrum" && (
          <div className="w-[250px] flex-shrink-0 space-y-3">
            <Card className="p-3">
              <h3 className="text-xs font-semibold mb-2">Sprint Burndown</h3>
              {agileBurndown.length === 0 ? (
                <div className="flex items-center justify-center h-[120px] text-center">
                  <p className="text-[10px] text-muted-foreground">No tasks in this sprint yet.<br/>Approve the Sprint Plans artefact to populate.</p>
                </div>
              ) : (
                <div style={{ height: 120 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={agileBurndown}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                      <XAxis dataKey="day" tick={{ fontSize: 8, fill: "var(--muted-foreground)" }} />
                      <YAxis tick={{ fontSize: 8, fill: "var(--muted-foreground)" }} />
                      <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }} />
                      <Area type="monotone" dataKey="ideal" stroke="#64748B" strokeDasharray="4 4" fill="none" isAnimationActive={false} />
                      <Area type="monotone" dataKey="actual" stroke="var(--primary)" fill="var(--primary)" fillOpacity={0.1} connectNulls={false} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card className="p-3">
              <h3 className="text-xs font-semibold mb-2">Velocity</h3>
              <div style={{ height: 100 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={agileVelocity} barGap={2}>
                    <XAxis dataKey="sprint" tick={{ fontSize: 8, fill: "var(--muted-foreground)" }} />
                    <YAxis tick={{ fontSize: 8, fill: "var(--muted-foreground)" }} />
                    <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }} />
                    <Bar dataKey="committed" fill="var(--primary)" fillOpacity={0.3} radius={[3,3,0,0]} isAnimationActive={false} />
                    <Bar dataKey="completed" fill="var(--primary)" radius={[3,3,0,0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-3 space-y-2">
              <h3 className="text-xs font-semibold">Sprint Health</h3>
              <HealthRow label="Blocked" value={`${filteredIssues.filter(i => i.blocked).length}`} color={filteredIssues.some(i => i.blocked) ? "#EF4444" : "#10B981"} />
              <HealthRow label="In Review" value={`${filteredIssues.filter(i => i.column === "in_review").length}`} color={filteredIssues.filter(i => i.column === "in_review").length > 3 ? "#F97316" : "#10B981"} />
              <HealthRow label="Bugs" value={`${filteredIssues.filter(i => i.type === "bug").length}/${filteredIssues.length}`} color="#10B981" />
              <HealthRow label="Done" value={`${Math.round(committedSP > 0 ? (completedSP / committedSP) * 100 : 0)}%`} color="#6366F1" />
            </Card>

            <Card className="p-3 space-y-2">
              <h3 className="text-xs font-semibold">Team Workload</h3>
              {derivedTeam.length === 0
                ? <p className="text-[11px] text-muted-foreground">No assignees yet. Team members appear here when tasks are assigned via the Resource Plan artefact.</p>
                : derivedTeam.map(m => {
                  const pct = m.capacity > 0 ? Math.round((m.assigned / m.capacity) * 100) : 100;
                  return (
                    <div key={m.name}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[11px] font-medium text-muted-foreground">{m.name.split(" ")[0]}</span>
                        <span className="text-[10px] font-semibold" style={{ color: pct > 90 ? "#EF4444" : "var(--muted-foreground)" }}>{m.assigned} SP</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-border/30 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: pct > 90 ? "#EF4444" : pct > 75 ? "#F59E0B" : "var(--primary)" }} />
                      </div>
                    </div>
                  );
                })
              }
            </Card>

            <Card className="p-3 space-y-2">
              <h3 className="text-xs font-semibold">AI Insights</h3>
              <div className="space-y-2 text-[11px]">
                {boardIssues.length > 0 ? (
                  <>
                    <InsightBox color="#6366F1">
                      <strong>Progress:</strong> {completedSP}/{committedSP} SP ({committedSP > 0 ? Math.round((completedSP / committedSP) * 100) : 0}%). {committedSP - completedSP} SP remaining.
                    </InsightBox>
                    {boardIssues.some(i => i.blocked) && (
                      <InsightBox color="#EF4444">
                        <strong>Blocked:</strong> {boardIssues.filter(i => i.blocked).length} item(s) need attention.
                      </InsightBox>
                    )}
                    {daysRemaining <= 3 && daysRemaining > 0 && (
                      <InsightBox color="#F97316">
                        <strong>Sprint ending:</strong> {daysRemaining} day(s) left. {committedSP - completedSP} SP incomplete.
                      </InsightBox>
                    )}
                  </>
                ) : (
                  <InsightBox color="#64748B">
                    <strong>No issues in this sprint.</strong> Create issues or assign backlog items to this sprint.
                  </InsightBox>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* ── Task Detail Modal ── */}
      {selectedIssue && (
        <TaskDetailModal
          issue={selectedIssue}
          onClose={() => setSelectedIssue(null)}
          sprintName={currentSprint?.name}
          projectId={projectId}
          sprints={sprints}
          currentSprintId={currentSprintId}
          onStatusChange={handleStatusChange}
          updateTask={updateTask}
          getLabelColor={getLabelColor}
        />
      )}

      {/* ── Create/Edit Sprint Modal ── */}
      {showCreateSprint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowCreateSprint(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative w-full max-w-md rounded-xl bg-card border border-border shadow-2xl p-6 space-y-4"
            onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold">{editingSprint ? "Edit Sprint" : "New Sprint"}</h2>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Sprint Name *</label>
                <input className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  value={sprintForm.name} onChange={e => setSprintForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Sprint 1" />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Sprint Goal</label>
                <textarea rows={2} className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                  value={sprintForm.goal} onChange={e => setSprintForm(f => ({ ...f, goal: e.target.value }))} placeholder="What do you want to achieve this sprint?" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Start Date *</label>
                  <input type="date" className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    value={sprintForm.startDate} onChange={e => setSprintForm(f => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">End Date *</label>
                  <input type="date" className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    value={sprintForm.endDate} onChange={e => setSprintForm(f => ({ ...f, endDate: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Status</label>
                <select className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  value={sprintForm.status} onChange={e => setSprintForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="PLANNING">Planning</option>
                  <option value="ACTIVE">Active</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button className="flex-1" onClick={saveSprint} disabled={createSprint.isPending || updateSprint.isPending}>
                {(createSprint.isPending || updateSprint.isPending) ? "Saving…" : editingSprint ? "Update Sprint" : "Create Sprint"}
              </Button>
              <Button variant="outline" onClick={() => setShowCreateSprint(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Issue Modal ── */}
      {showCreateIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowCreateIssue(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative w-full max-w-lg rounded-xl bg-card border border-border shadow-2xl p-6 space-y-4"
            onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold">Create Issue</h2>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Title *</label>
                <input className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  value={issueForm.title} onChange={e => setIssueForm(f => ({ ...f, title: e.target.value }))} placeholder="What needs to be done?" autoFocus />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Type</label>
                  <select className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                    value={issueForm.type} onChange={e => setIssueForm(f => ({ ...f, type: e.target.value }))}>
                    <option value="task">✅ Task</option>
                    <option value="story">📖 Story</option>
                    <option value="bug">🐛 Bug</option>
                    <option value="spike">🔬 Spike</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Priority</label>
                  <select className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                    value={issueForm.priority} onChange={e => setIssueForm(f => ({ ...f, priority: e.target.value }))}>
                    <option value="CRITICAL">🔴 Critical</option>
                    <option value="HIGH">🟠 High</option>
                    <option value="MEDIUM">🔵 Medium</option>
                    <option value="LOW">⚪ Low</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Story Points</label>
                  <input type="number" min={0} max={100}
                    className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                    value={issueForm.storyPoints} onChange={e => setIssueForm(f => ({ ...f, storyPoints: e.target.value }))} placeholder="0" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Assignee</label>
                  <input className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                    value={issueForm.assigneeName} onChange={e => setIssueForm(f => ({ ...f, assigneeName: e.target.value }))} placeholder="Name" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Epic</label>
                  <input className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                    value={issueForm.epic} onChange={e => setIssueForm(f => ({ ...f, epic: e.target.value }))} placeholder="Epic name" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Sprint</label>
                  <select className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                    value={issueForm.sprintId || currentSprintId || ""}
                    onChange={e => setIssueForm(f => ({ ...f, sprintId: e.target.value }))}>
                    <option value="">Backlog (no sprint)</option>
                    {sprints.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1">Description</label>
                <textarea rows={3} className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
                  value={issueForm.description} onChange={e => setIssueForm(f => ({ ...f, description: e.target.value }))} placeholder="Acceptance criteria, context, technical notes…" />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button className="flex-1" onClick={saveIssue} disabled={createTask.isPending}>
                {createTask.isPending ? "Creating…" : "Create Issue"}
              </Button>
              <Button variant="outline" onClick={() => setShowCreateIssue(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// BOARD COLUMNS
// ═══════════════════════════════════════════════════════════════════

function BoardColumn({ col, colIssues, onCardClick, getLabelColor, isOver, activeId }: {
  col: typeof COLUMNS[number];
  colIssues: Issue[];
  onCardClick: (i: Issue) => void;
  getLabelColor: (l: string) => string;
  isOver: boolean;
  activeId: string | null;
}) {
  const { setNodeRef } = useDroppable({ id: col.id });

  const totalSP   = colIssues.reduce((s, i) => s + i.storyPoints, 0);
  const overLimit = col.wipLimit && colIssues.length > col.wipLimit;
  const atLimit   = col.wipLimit && colIssues.length >= col.wipLimit;

  return (
    <div
      ref={setNodeRef}
      className="flex-1 min-w-[200px] max-w-[280px] flex flex-col rounded-xl transition-all duration-150"
      style={{
        background: isOver ? `${col.color}18` : "var(--muted, rgba(0,0,0,0.04))",
        boxShadow: isOver ? `0 0 0 2px ${col.color}` : undefined,
      }}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: col.color }} />
          <span className="text-xs font-semibold">{col.label}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
            style={{ background: `${col.color}22`, color: col.color }}>{colIssues.length}</span>
          {col.wipLimit && (
            <span className="text-[9px] px-1 py-0.5 rounded font-bold"
              style={{ background: overLimit ? "rgba(239,68,68,0.15)" : atLimit ? "rgba(245,158,11,0.15)" : "transparent", color: overLimit ? "#EF4444" : atLimit ? "#F59E0B" : "var(--muted-foreground)" }}>
              WIP {col.wipLimit}
            </span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">{totalSP} SP</span>
      </div>
      <div className="flex-1 px-2 pb-2 space-y-2 overflow-y-auto" style={{ maxHeight: "calc(100vh - 420px)" }}>
        {colIssues.map(issue => (
          <DraggableIssueCard
            key={issue.id}
            issue={issue}
            onClick={() => onCardClick(issue)}
            getLabelColor={getLabelColor}
            isDragging={activeId === issue.id}
          />
        ))}
        {colIssues.length === 0 && (
          <div className="flex items-center justify-center h-16 rounded-lg border border-dashed border-border/40">
            <span className="text-[10px] text-muted-foreground">{isOver ? "Drop here" : "No issues"}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function BoardColumns({ columns, issues, onCardClick, getLabelColor, activeId, overColumnId }: {
  columns: typeof COLUMNS;
  issues: Issue[];
  onCardClick: (i: Issue) => void;
  getLabelColor: (l: string) => string;
  activeId?: string | null;
  overColumnId?: ColumnId | null;
}) {
  return (
    <div className="flex gap-3" style={{ minHeight: 500 }}>
      {columns.map(col => {
        const colIssues = issues.filter(i => i.column === col.id);
        const isOver    = overColumnId === col.id;
        return (
          <BoardColumn
            key={col.id}
            col={col}
            colIssues={colIssues}
            onCardClick={onCardClick}
            getLabelColor={getLabelColor}
            isOver={isOver}
            activeId={activeId ?? null}
          />
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SWIMLANED BOARD
// ═══════════════════════════════════════════════════════════════════

function SwimlanedBoard({ swimlane, columns, issues, onCardClick, getLabelColor }: {
  swimlane: SwimlaneSetting; columns: typeof COLUMNS; issues: Issue[];
  onCardClick: (i: Issue) => void; getLabelColor: (l: string) => string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of issues) {
      const key = swimlane === "epic" ? (issue.epic || "No Epic")
        : swimlane === "assignee" ? (issue.assignee || "Unassigned")
        : swimlane === "priority" ? issue.priority
        : (issue.labels[0] || "No Label");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(issue);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [issues, swimlane]);

  const toggle = (key: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className="space-y-3">
      {groups.map(([group, groupIssues]) => {
        const isCollapsed  = collapsed.has(group);
        const groupColor   = swimlane === "priority" ? PRIORITY_COLORS[group as Priority] || "#64748B" : "var(--primary)";
        return (
          <div key={group} className="rounded-xl border border-border/30">
            <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none rounded-xl"
              onClick={() => toggle(group)}>
              <span className="text-[10px] text-muted-foreground">{isCollapsed ? "▶" : "▼"}</span>
              <div className="w-2 h-2 rounded-full" style={{ background: groupColor }} />
              <span className="text-xs font-semibold">{group}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: `${groupColor}22`, color: groupColor }}>
                {groupIssues.length}
              </span>
              <span className="text-[10px] ml-auto text-muted-foreground">
                {groupIssues.reduce((s, i) => s + i.storyPoints, 0)} SP
              </span>
            </div>
            {!isCollapsed && (
              <div className="flex gap-2 p-2 border-t border-border/20">
                {columns.map(col => {
                  const colIssues = groupIssues.filter(i => i.column === col.id);
                  return (
                    <div key={col.id} className="flex-1 min-w-[160px]">
                      <div className="text-[10px] font-semibold mb-1 px-1" style={{ color: col.color }}>
                        {col.label} ({colIssues.length})
                      </div>
                      <div className="space-y-1.5">
                        {colIssues.map(issue => (
                          <IssueCard key={issue.id} issue={issue} compact onClick={() => onCardClick(issue)} getLabelColor={getLabelColor} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DRAGGABLE ISSUE CARD WRAPPER
// ═══════════════════════════════════════════════════════════════════

function DraggableIssueCard({ issue, onClick, getLabelColor, isDragging }: {
  issue: Issue; onClick: () => void; getLabelColor: (l: string) => string; isDragging?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging: activelydragging } = useDraggable({ id: issue.id });
  const didDragRef = useRef(false);

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  // Track whether a real drag movement occurred so we can suppress the click
  const handlePointerDown = () => { didDragRef.current = false; };
  const handlePointerMove = () => { if (transform) didDragRef.current = true; };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onClick={() => {
        // PointerSensor requires distance: 5 before it activates — if a drag
        // was activated the overlay takes over and this element's click is
        // suppressed by dnd-kit automatically. Safe to forward unconditionally.
        if (!didDragRef.current) onClick();
      }}
    >
      <IssueCard
        issue={issue}
        onClick={() => {}}
        getLabelColor={getLabelColor}
        isDragging={isDragging}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ISSUE CARD
// ═══════════════════════════════════════════════════════════════════

function IssueCard({ issue, compact, onClick, getLabelColor, isDragging }: {
  issue: Issue; compact?: boolean; onClick: () => void; getLabelColor: (l: string) => string; isDragging?: boolean;
}) {
  const isDue = issue.dueDate && new Date(issue.dueDate) <= new Date(Date.now() + 2 * 86400000);
  return (
    <div className="rounded-xl p-2.5 cursor-grab transition-all hover:-translate-y-0.5 hover:shadow-md"
      onClick={onClick}
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${PRIORITY_COLORS[issue.priority]}`,
        opacity: isDragging ? 0.35 : 1,
      }}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">{ISSUE_ICONS[issue.type]}</span>
          <span className="text-[10px] font-semibold text-muted-foreground truncate max-w-[80px]">{issue.id.slice(-6)}</span>
          {issue.blocked && <span className="text-[9px] px-1 py-0.5 rounded font-bold bg-destructive/15 text-destructive">BLOCKED</span>}
        </div>
        <span className="text-[11px]">{PRIORITY_ICONS[issue.priority]}</span>
      </div>
      <p className={`text-xs font-medium leading-snug ${compact ? "line-clamp-1" : "line-clamp-2"}`}>{issue.title}</p>
      {!compact && issue.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {issue.labels.slice(0, 3).map(l => (
            <span key={l} className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
              style={{ background: `${getLabelColor(l)}18`, color: getLabelColor(l) }}>{l}</span>
          ))}
        </div>
      )}
      {!compact && issue.subtasks && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="flex-1 h-[3px] rounded-full overflow-hidden bg-border/30">
            <div className="h-full rounded-full bg-green-500" style={{ width: `${(issue.subtasks.done / issue.subtasks.total) * 100}%` }} />
          </div>
          <span className="text-[9px] text-muted-foreground">{issue.subtasks.done}/{issue.subtasks.total}</span>
        </div>
      )}
      <div className="flex items-center justify-between mt-2">
        <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center text-[8px] font-bold text-white">
          {issue.assignee ? issue.assignee.split(" ").map((w: string) => w[0] || "").join("").toUpperCase().slice(0, 2) : "?"}
        </div>
        <div className="flex items-center gap-2">
          {isDue && <span className="text-[9px] font-semibold text-destructive">⚠ {issue.dueDate ? new Date(issue.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}</span>}
          {issue.storyPoints > 0 && (
            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold bg-primary/10 text-primary">
              {issue.storyPoints}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TASK DETAIL MODAL — onStatusChange deferred to avoid setState-during-render
// ═══════════════════════════════════════════════════════════════════

function TaskDetailModal({ issue, onClose, sprintName, projectId, sprints, currentSprintId, onStatusChange, updateTask, getLabelColor }: {
  issue: Issue; onClose: () => void; sprintName?: string; projectId: string;
  sprints: SprintData[]; currentSprintId: string | null;
  onStatusChange: (col: ColumnId) => void;
  updateTask: ReturnType<typeof useUpdateTask>;
  getLabelColor: (l: string) => string;
}) {
  const [activeTab, setActiveTab] = useState<"details" | "activity">("details");
  const [editingField, setEditingField] = useState<string | null>(null);
  const [fieldValue, setFieldValue] = useState("");

  function handleMoveToColumn(colId: ColumnId) {
    const status = COLUMN_STATUS_MAP[colId];
    const toastId = toast.loading(`Moving to ${COLUMNS.find(c => c.id === colId)?.label}…`);
    updateTask.mutate(
      { taskId: issue.id, status },
      {
        onSuccess: () => {
          toast.success("Status updated", { id: toastId });
          // Defer setState call to avoid "update during render" error
          setTimeout(() => onStatusChange(colId), 0);
        },
        onError: () => toast.error("Failed to update status", { id: toastId }),
      }
    );
  }

  function handleAssignToSprint(sprintId: string | null) {
    const toastId = toast.loading(sprintId ? "Assigning to sprint…" : "Moving to backlog…");
    updateTask.mutate(
      { taskId: issue.id, sprintId, status: sprintId ? "TODO" : "BACKLOG" },
      {
        onSuccess: () => toast.success(sprintId ? "Assigned to sprint" : "Moved to backlog", { id: toastId }),
        onError: () => toast.error("Failed", { id: toastId }),
      }
    );
  }

  function startEditField(field: string, value: string) {
    setEditingField(field);
    setFieldValue(value);
  }

  function saveField(field: string) {
    if (!fieldValue.trim()) { setEditingField(null); return; }
    updateTask.mutate(
      { taskId: issue.id, [field]: field === "storyPoints" ? Number(fieldValue) : fieldValue },
      {
        onSuccess: () => toast.success("Updated"),
        onError:   () => toast.error("Failed to update"),
      }
    );
    setEditingField(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl bg-card border border-border shadow-2xl"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between bg-card border-b border-border">
          <div className="flex items-center gap-3">
            <span className="text-base">{ISSUE_ICONS[issue.type]}</span>
            <span className="text-xs font-bold text-primary font-mono">{issue.id.slice(-8)}</span>
            <Badge variant={(issue.priority === "critical" || issue.priority === "high") ? "destructive" : "secondary"} className="text-[9px]">
              {issue.priority}
            </Badge>
            {issue.blocked && <Badge variant="destructive" className="text-[9px]">Blocked</Badge>}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-lg text-muted-foreground hover:bg-muted transition-colors">×</button>
        </div>

        {/* Title */}
        <div className="px-6 py-3">
          <h2 className="text-lg font-bold leading-snug">{issue.title}</h2>
        </div>

        {/* Move to column */}
        <div className="px-6 pb-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Move to Column</p>
          <div className="flex flex-wrap gap-1.5">
            {COLUMNS.map(col => (
              <button key={col.id}
                disabled={issue.column === col.id || updateTask.isPending}
                onClick={() => handleMoveToColumn(col.id)}
                className="px-2.5 py-1 rounded text-[11px] font-semibold transition-all"
                style={{
                  background: issue.column === col.id ? `${col.color}25` : `${col.color}10`,
                  color: col.color,
                  border: `1px solid ${issue.column === col.id ? col.color : `${col.color}44`}`,
                  opacity: issue.column === col.id ? 1 : 0.8,
                }}>
                {issue.column === col.id ? "✓ " : ""}{col.label}
              </button>
            ))}
          </div>
        </div>

        {/* Sprint assignment */}
        <div className="px-6 pb-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Sprint Assignment</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => handleAssignToSprint(null)}
              disabled={!issue.sprintId}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-all ${!issue.sprintId ? "bg-muted text-foreground border-border" : "border-border/40 text-muted-foreground hover:bg-muted"}`}>
              📦 Backlog
            </button>
            {sprints.filter(s => s.status !== "COMPLETED").map(s => (
              <button key={s.id}
                onClick={() => handleAssignToSprint(s.id)}
                disabled={issue.sprintId === s.id}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-all ${issue.sprintId === s.id ? "bg-primary/20 text-primary border-primary/40" : "border-border/40 text-muted-foreground hover:bg-muted"}`}>
                {issue.sprintId === s.id ? "✓ " : ""}{s.name}
              </button>
            ))}
          </div>
        </div>

        {/* Fields grid */}
        <div className="px-6 pb-4 grid grid-cols-2 gap-x-6 gap-y-3">
          <FieldRow label="Status">
            <Badge variant="outline" className="text-[10px]">
              {COLUMNS.find(c => c.id === issue.column)?.label || issue.column}
            </Badge>
          </FieldRow>
          <FieldRow label="Assignee">
            {editingField === "assigneeName"
              ? <input autoFocus className="px-2 py-0.5 rounded border border-border bg-background text-xs w-32 focus:outline-none focus:ring-1 focus:ring-primary"
                  value={fieldValue} onChange={e => setFieldValue(e.target.value)}
                  onBlur={() => saveField("assigneeName")} onKeyDown={e => e.key === "Enter" && saveField("assigneeName")} />
              : <button onClick={() => startEditField("assigneeName", issue.assignee)} className="text-xs hover:text-primary transition-colors">
                  {issue.assignee || <span className="text-muted-foreground">Unassigned ✏</span>}
                </button>
            }
          </FieldRow>
          <FieldRow label="Priority">
            <span className="text-xs" style={{ color: PRIORITY_COLORS[issue.priority] }}>
              {PRIORITY_ICONS[issue.priority]} {issue.priority}
            </span>
          </FieldRow>
          <FieldRow label="Story Points">
            {editingField === "storyPoints"
              ? <input autoFocus type="number" min={0} max={100} className="px-2 py-0.5 rounded border border-border bg-background text-xs w-16 focus:outline-none focus:ring-1 focus:ring-primary"
                  value={fieldValue} onChange={e => setFieldValue(e.target.value)}
                  onBlur={() => saveField("storyPoints")} onKeyDown={e => e.key === "Enter" && saveField("storyPoints")} />
              : <button onClick={() => startEditField("storyPoints", String(issue.storyPoints))}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                  {issue.storyPoints || "?"}
                </button>
            }
          </FieldRow>
          <FieldRow label="Epic">
            {editingField === "epic"
              ? <input autoFocus className="px-2 py-0.5 rounded border border-border bg-background text-xs w-32 focus:outline-none focus:ring-1 focus:ring-primary"
                  value={fieldValue} onChange={e => setFieldValue(e.target.value)}
                  onBlur={() => saveField("epic")} onKeyDown={e => e.key === "Enter" && saveField("epic")} />
              : <button onClick={() => startEditField("epic", issue.epic || "")} className="text-xs hover:text-primary transition-colors">
                  {issue.epic || <span className="text-muted-foreground">None ✏</span>}
                </button>
            }
          </FieldRow>
          <FieldRow label="Sprint">
            <span className="text-xs">{issue.sprintId ? (sprints.find(s => s.id === issue.sprintId)?.name || "Unknown") : "Backlog"}</span>
          </FieldRow>
          <FieldRow label="Labels">
            <div className="flex flex-wrap gap-1">
              {issue.labels.map(l => (
                <span key={l} className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ background: `${getLabelColor(l)}18`, color: getLabelColor(l) }}>{l}</span>
              ))}
              {issue.labels.length === 0 && <span className="text-[10px] text-muted-foreground">None</span>}
            </div>
          </FieldRow>
          {issue.dueDate && (
            <FieldRow label="Due Date">
              <span className="text-xs" style={{ color: new Date(issue.dueDate) <= new Date() ? "#EF4444" : "var(--foreground)" }}>
                {new Date(issue.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            </FieldRow>
          )}
        </div>

        {/* Description */}
        <div className="px-6 pb-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Description</p>
          <div className="p-3 rounded-lg text-sm leading-relaxed bg-muted/30">
            {issue.description || <span className="text-muted-foreground italic">No description provided.</span>}
          </div>
        </div>

        {/* Tabs */}
        <div className="px-6 border-t border-border">
          <div className="flex gap-4 pt-3">
            {(["details", "activity"] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`pb-2 text-xs font-semibold capitalize transition-colors border-b-2 ${activeTab === tab ? "text-primary border-primary" : "text-muted-foreground border-transparent"}`}>
                {tab}
              </button>
            ))}
          </div>
        </div>
        <div className="px-6 py-4">
          {activeTab === "activity" && (
            <p className="text-xs text-muted-foreground">Activity log will appear here as changes are made to this issue.</p>
          )}
          {activeTab === "details" && (
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Click any field above (Assignee, Story Points, Epic) to edit inline.</p>
              <p>Use the column buttons to move this issue between workflow stages.</p>
              <p>Use the sprint buttons to assign or reassign this issue to a sprint.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SMALL HELPERS
// ═══════════════════════════════════════════════════════════════════

function FilterChip({ label, active, onClick, icon }: { label: string; active: boolean; onClick: () => void; icon?: string }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${active ? "bg-primary/10 border-primary text-primary" : "border-border/40 text-muted-foreground hover:border-border"}`}>
      {icon && <span>{icon}</span>}{label}
    </button>
  );
}

function HealthRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-[11px] font-semibold" style={{ color }}>{value}</span>
    </div>
  );
}

function InsightBox({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div className="p-2 rounded-lg text-[11px] leading-relaxed" style={{ background: `${color}10`, borderLeft: `2px solid ${color}` }}>
      {children}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">{label}</p>
      {children}
    </div>
  );
}
