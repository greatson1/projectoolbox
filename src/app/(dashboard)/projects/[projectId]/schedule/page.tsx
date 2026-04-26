"use client";
// @ts-nocheck

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { parseSource, SourceBadge, RowReasoning } from "@/components/artefacts/source-prefix";

import { useParams } from "next/navigation";
import { useProjectTasks, useProject, useUpdateTask } from "@/hooks/use-api";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Download } from "lucide-react";
import { downloadCSV } from "@/lib/export-csv";

/**
 * Schedule — Project Schedule / Gantt Chart page.
 * Custom div-based Gantt with task list, timeline bars, milestones,
 * critical path highlight, today marker, zoom controls, phase gates sidebar.
 */



// ── Types ──
type TaskStatus = "done" | "active" | "pending" | "at-risk" | "milestone";
interface ScheduleTask {
  id: string;
  name: string;
  phase: string;
  start: string; // YYYY-MM-DD
  end: string;
  progress: number; // 0–100
  status: TaskStatus;
  dependsOn?: string[];
  assignee?: string;
  isMilestone?: boolean;
  isCriticalPath?: boolean;
  /** Free-text description from the underlying Task row — carries any
   *  source-prefix the agent embedded ("Research-anchored: …") so we
   *  can render the SourceBadge + RowReasoning in the detail panel. */
  description?: string;
}

// No mock data — everything is derived from API tasks

type ZoomLevel = "week" | "month" | "quarter";
type ViewMode = "gantt" | "list";

// ── Helpers ──
function parseDate(s: string) { return new Date(s + "T00:00:00"); }
function diffDays(a: Date, b: Date) { return Math.round((b.getTime() - a.getTime()) / 86400000); }
function formatDate(d: Date) { return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

/** Format a date as T-minus relative to a target date. T-0 = target. Negative = past target. */
function tMinusLabel(date: Date | string, targetDate: Date): string {
  const d = typeof date === "string" ? parseDate(date) : date;
  const days = diffDays(d, targetDate);
  if (days === 0) return "T-0";
  if (days > 0) return `T-${days}`;
  return `T+${Math.abs(days)}`;
}

function getMonths(start: Date, end: Date) {
  const months: { label: string; start: Date; days: number }[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    const visibleStart = cur < start ? start : cur;
    const visibleEnd = monthEnd > end ? end : monthEnd;
    months.push({
      label: cur.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
      start: visibleStart,
      days: diffDays(visibleStart, visibleEnd) + 1,
    });
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  done: "#10B981",
  active: "#6366F1",
  pending: "#64748B",
  "at-risk": "#EF4444",
  milestone: "#F59E0B",
};

export default function SchedulePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useProject(projectId);
  const { data: apiTasks } = useProjectTasks(projectId);

  // Build a tolerant phase lookup from the project's Phase rows.
  // Task.phaseId is inconsistent across the codebase: sometimes it's the
  // Phase row CUID, sometimes the phase name string (the agent scaffolder
  // stores names so its own self-update queries can match by name later).
  // Accept either format so tasks group under the right phase regardless.
  const phaseLookup = useMemo(() => {
    const phases: any[] = (project as any)?.phases || [];
    const map = new Map<string, string>();
    for (const p of phases) {
      if (p?.id) map.set(p.id, p.name);              // CUID → name
      if (p?.name) map.set(p.name.toLowerCase(), p.name); // name (case-insensitive) → name
    }
    return map;
  }, [project]);
  const resolvePhase = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    return phaseLookup.get(raw) || phaseLookup.get(raw.toLowerCase()) || null;
  };

  const TASKS_DATA: ScheduleTask[] = useMemo(() => {
    if (!apiTasks || apiTasks.length === 0) return [];
    return apiTasks.map((t: any) => {
      // DB stores uppercase: "DONE", "IN_PROGRESS", "AT_RISK", "TODO", "BLOCKED"
      const s = (t.status || "").toUpperCase();
      const status: TaskStatus =
        s === "DONE" || s === "COMPLETED" ? "done"
        : s === "IN_PROGRESS" || s === "ACTIVE" ? "active"
        : s === "AT_RISK" || s === "BLOCKED" ? "at-risk"
        : "pending";

      // phaseId may be a CUID OR a name string — resolvePhase handles both.
      // Don't invent a phase name when nothing matches (was hardcoded to
      // "Execution" which mis-labelled every task on every project).
      const phase = resolvePhase(t.phaseId)
        || resolvePhase(t.phase)
        || "Unassigned";

      return {
        id: t.id,
        name: t.title || t.name,
        phase,
        start: t.startDate ? t.startDate.slice(0, 10) : (t.start || new Date().toISOString().slice(0, 10)),
        end: t.endDate ? t.endDate.slice(0, 10) : (t.end || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)),
        progress: t.progress ?? 0,
        status,
        dependsOn: Array.isArray(t.dependencies) ? t.dependencies : [],
        assignee: t.assigneeName || t.assignee || "",
        isMilestone: false, // no isMilestone field in Task schema
        isCriticalPath: t.isCriticalPath || false,
        description: t.description || "",
      };
    });
  }, [apiTasks, phaseLookup]);

  const mode = "dark";
  const [zoom, setZoom] = useState<ZoomLevel>("month");
  const [view, setView] = useState<ViewMode>("gantt");
  const [showCriticalPath, setShowCriticalPath] = useState(true);
  const [tMinusMode, setTMinusMode] = useState(false);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set<string>());
  const [selectedTask, setSelectedTask] = useState<ScheduleTask | null>(null);
  const [editProgress, setEditProgress] = useState<number | null>(null);
  const [editStatus, setEditStatus] = useState<TaskStatus | null>(null);
  const updateTask = useUpdateTask(projectId);
  const timelineRef = useRef<HTMLDivElement>(null);
  const taskListRef = useRef<HTMLDivElement>(null);

  function handleSelectTask(t: ScheduleTask | null) {
    setSelectedTask(t);
    setEditProgress(t ? t.progress : null);
    setEditStatus(t ? t.status : null);
  }

  function handleSaveTask() {
    if (!selectedTask) return;
    const STATUS_MAP: Record<TaskStatus, string> = {
      done: "DONE",
      active: "IN_PROGRESS",
      "at-risk": "AT_RISK",
      pending: "TODO",
      milestone: "TODO",
    };
    const toastId = toast.loading("Saving…");
    updateTask.mutate(
      {
        taskId: selectedTask.id,
        ...(editProgress !== null && editProgress !== selectedTask.progress ? { progress: editProgress } : {}),
        ...(editStatus !== null && editStatus !== selectedTask.status ? { status: STATUS_MAP[editStatus] } : {}),
      },
      {
        onSuccess: () => {
          toast.success("Task updated", { id: toastId });
          setSelectedTask(prev => prev ? { ...prev, progress: editProgress ?? prev.progress, status: editStatus ?? prev.status } : null);
        },
        onError: () => toast.error("Failed to save", { id: toastId }),
      }
    );
  }

  // Compute timeline range (guard against empty data)
  const { timelineStart, timelineEnd, totalDays, dayWidth } = useMemo(() => {
    if (TASKS_DATA.length === 0) {
      const now = new Date();
      const ts = addDays(now, -7);
      const te = addDays(now, 30);
      const dw = zoom === "week" ? 32 : zoom === "month" ? 16 : 6;
      return { timelineStart: ts, timelineEnd: te, totalDays: diffDays(ts, te), dayWidth: dw };
    }
    const allStarts = TASKS_DATA.map(t => parseDate(t.start));
    const allEnds = TASKS_DATA.map(t => parseDate(t.end));
    const minDate = new Date(Math.min(...allStarts.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...allEnds.map(d => d.getTime())));
    const ts = addDays(minDate, -7);
    const te = addDays(maxDate, 14);
    const total = diffDays(ts, te);
    const dw = zoom === "week" ? 32 : zoom === "month" ? 16 : 6;
    return { timelineStart: ts, timelineEnd: te, totalDays: total, dayWidth: dw };
  }, [zoom, TASKS_DATA]);

  const months = useMemo(() => getMonths(timelineStart, timelineEnd), [timelineStart, timelineEnd]);

  // Today marker
  const today = new Date();
  const todayOffset = diffDays(timelineStart, today);

  // Sync scroll
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (taskListRef.current) taskListRef.current.scrollTop = e.currentTarget.scrollTop;
  };

  const togglePhase = (phase: string) => {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase); else next.add(phase);
      return next;
    });
  };

  // Group tasks by phase
  const tasksByPhase = useMemo(() => {
    const map = new Map<string, ScheduleTask[]>();
    for (const t of TASKS_DATA) {
      if (!map.has(t.phase)) map.set(t.phase, []);
      map.get(t.phase)!.push(t);
    }
    return map;
  }, [TASKS_DATA]);

  // Derive phases summary from actual data. Progress is now the average of
  // per-task progress (matching the Scope & WBS rollup), not a binary
  // "% of tasks fully done" — partial progress shows up instead of being
  // hidden until status flips to DONE.
  const phasesSummary = useMemo(() => {
    const phases: {
      name: string;
      status: "done" | "active" | "pending";
      tasks: number;
      complete: number;
      progress: number;
      gate: string;
    }[] = [];
    for (const [name, tasks] of tasksByPhase) {
      const complete = tasks.filter(t => t.status === "done").length;
      const hasActive = tasks.some(t => t.status === "active");
      const status = complete === tasks.length ? "done" as const : hasActive ? "active" as const : "pending" as const;
      const progress = tasks.length === 0 ? 0 : Math.round(
        tasks.reduce((s, t) => s + (t.status === "done" ? 100 : Math.max(0, Math.min(100, Number(t.progress) || 0))), 0) / tasks.length,
      );
      const gate = status === "done" ? "Approved" : hasActive ? "Pending" : "Not started";
      phases.push({ name, status, tasks: tasks.length, complete, progress, gate });
    }
    return phases;
  }, [tasksByPhase]);

  // T-Minus target date (project end date or latest task end)
  const tMinusTarget = useMemo(() => {
    const projEnd = (project as any)?.endDate;
    if (projEnd) return parseDate(projEnd.slice(0, 10));
    if (TASKS_DATA.length > 0) {
      const latest = new Date(Math.max(...TASKS_DATA.map(t => parseDate(t.end).getTime())));
      return latest;
    }
    return addDays(new Date(), 90);
  }, [project, TASKS_DATA]);

  const daysToTarget = diffDays(new Date(), tMinusTarget);

  // Stats
  const totalTasks = TASKS_DATA.length;
  const completedTasks = TASKS_DATA.filter(t => t.status === "done").length;
  const milestonesHit = TASKS_DATA.filter(t => t.isMilestone && t.status === "done").length;
  const totalMilestones = TASKS_DATA.filter(t => t.isMilestone).length;
  const criticalTasks = TASKS_DATA.filter(t => t.isCriticalPath).length;
  const overallProgress = totalTasks > 0 ? Math.round(TASKS_DATA.reduce((s, t) => s + t.progress, 0) / totalTasks) : 0;

  const ROW_HEIGHT = 36;

  // Build flat visible list
  const visibleTasks = useMemo(() => {
    const result: { type: "phase"; phase: string; expanded: boolean }[] | { type: "task"; task: ScheduleTask }[] = [];
    const flat: Array<{ type: "phase"; phase: string; expanded: boolean } | { type: "task"; task: ScheduleTask }> = [];
    for (const ps of phasesSummary) {
      flat.push({ type: "phase", phase: ps.name, expanded: expandedPhases.has(ps.name) });
      if (expandedPhases.has(ps.name)) {
        for (const t of tasksByPhase.get(ps.name) || []) {
          flat.push({ type: "task", task: t });
        }
      }
    }
    return flat;
  }, [expandedPhases, tasksByPhase, phasesSummary]);

  function handleDownloadScheduleCSV() {
    const rows: (string | number | null | undefined)[][] = [
      ["Title", "Phase", "Status", "Start Date", "End Date", "Assigned To", "Progress %", "Estimated Hours"],
      ...TASKS_DATA.map((t: ScheduleTask) => {
        const apiTask = (apiTasks || []).find((a: any) => a.id === t.id);
        return [
          t.name,
          t.phase,
          t.status,
          t.start,
          t.end,
          t.assignee,
          t.progress,
          apiTask?.estimatedHours ?? null,
        ];
      }),
    ];
    downloadCSV(rows, `schedule-${projectId}.csv`);
  }

  // ── List View ──
  if (view === "list") {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Header view={view} setView={setView} zoom={zoom} setZoom={setZoom}
          showCriticalPath={showCriticalPath} setShowCriticalPath={setShowCriticalPath}
          tMinusMode={tMinusMode} setTMinusMode={setTMinusMode} daysToTarget={daysToTarget} tMinusTarget={tMinusTarget}
          stats={{ totalTasks, completedTasks, milestonesHit, totalMilestones, criticalTasks, overallProgress }} project={project}
          onDownloadCSV={TASKS_DATA.length > 0 ? handleDownloadScheduleCSV : undefined} />

        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" style={{ color: "var(--foreground)" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${"var(--border)"}` }}>
                  {["WBS", "Task", "Phase", "Start", "End", "Duration", "Progress", "Status", "Assignee", "Dependencies"].map(h => (
                    <th key={h} className="text-left py-2 px-3 font-semibold text-[12px]" style={{ color: "var(--muted-foreground)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TASKS_DATA.map((t, idx) => {
                  const dur = diffDays(parseDate(t.start), parseDate(t.end)) + 1;
                  // Derive WBS code: phase index . task index within phase
                  const phaseIdx = Array.from(tasksByPhase.keys()).indexOf(t.phase) + 1;
                  const taskIdx = (tasksByPhase.get(t.phase) || []).indexOf(t) + 1;
                  const wbs = `${phaseIdx}.${taskIdx}`;
                  return (
                    <tr key={t.id} className="hover:opacity-80 transition-opacity cursor-pointer" style={{ borderBottom: `1px solid ${"var(--border)"}22` }}
                      onClick={() => handleSelectTask(selectedTask?.id === t.id ? null : t)}>
                      <td className="py-2 px-3 text-[11px] font-mono" style={{ color: "var(--muted-foreground)" }}>{wbs}</td>
                      <td className="py-2 px-3 font-medium flex items-center gap-2">
                        {t.isMilestone && <span className="text-[#F59E0B]">◆</span>}
                        {t.isCriticalPath && showCriticalPath && <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />}
                        {t.name}
                      </td>
                      <td className="py-2 px-3"><Badge variant={t.phase === "Execution" ? "outline" : t.phase === "Planning" ? "secondary" : "outline"}>{t.phase}</Badge></td>
                      <td className="py-2 px-3" style={{ color: "var(--muted-foreground)" }}>
                        {tMinusMode ? <span className="font-mono text-[11px]">{tMinusLabel(t.start, tMinusTarget)}</span> : formatDate(parseDate(t.start))}
                      </td>
                      <td className="py-2 px-3" style={{ color: "var(--muted-foreground)" }}>
                        {tMinusMode ? <span className="font-mono text-[11px]">{tMinusLabel(t.end, tMinusTarget)}</span> : formatDate(parseDate(t.end))}
                      </td>
                      <td className="py-2 px-3" style={{ color: "var(--muted-foreground)" }}>{t.isMilestone ? "—" : `${dur}d`}</td>
                      <td className="py-2 px-3 w-[120px]">
                        <div className="flex items-center gap-2">
                          <Progress value={t.progress} className="h-1.5" />
                          <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{t.progress}%</span>
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        <Badge variant={t.status === "done" ? "default" : t.status === "active" ? "outline" : t.status === "at-risk" ? "destructive" : "outline"}>
                          {t.status}
                        </Badge>
                      </td>
                      <td className="py-2 px-3" style={{ color: "var(--muted-foreground)" }}>{t.assignee || "—"}</td>
                      <td className="py-2 px-3 text-[11px]" style={{ color: "var(--muted-foreground)" }}>{t.dependsOn?.join(", ") || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <PhaseGatesSidebar phases={phasesSummary} />
      </div>
    );
  }

  // ── Gantt View ──
  return (
    <div className="space-y-6 max-w-[1600px]">
      <Header view={view} setView={setView} zoom={zoom} setZoom={setZoom}
        showCriticalPath={showCriticalPath} setShowCriticalPath={setShowCriticalPath}
        tMinusMode={tMinusMode} setTMinusMode={setTMinusMode} daysToTarget={daysToTarget} tMinusTarget={tMinusTarget}
        stats={{ totalTasks, completedTasks, milestonesHit, totalMilestones, criticalTasks, overallProgress }}
        onDownloadCSV={TASKS_DATA.length > 0 ? handleDownloadScheduleCSV : undefined} />

      <div className="flex gap-4">
        {/* Main Gantt */}
        <Card className="flex-1 overflow-hidden">
          <div className="flex" style={{ height: "calc(100vh - 320px)", minHeight: 400 }}>
            {/* ── Left: Task list ── */}
            <div className="flex-shrink-0 overflow-hidden" style={{ width: 280, borderRight: `1px solid ${"var(--border)"}` }}>
              {/* Header */}
              <div className="px-3 py-2 text-[12px] font-semibold flex items-center"
                style={{ height: 44, color: "var(--muted-foreground)", borderBottom: `1px solid ${"var(--border)"}`, background: true ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)" }}>
                Task Name
              </div>
              {/* Scrollable task rows */}
              <div ref={taskListRef} className="overflow-y-auto" style={{ height: "calc(100% - 44px)" }}>
                {visibleTasks.map((item, i) => {
                  if (item.type === "phase") {
                    return (
                      <div key={`ph-${item.phase}`} className="flex items-center gap-2 px-3 cursor-pointer select-none hover:opacity-80"
                        onClick={() => togglePhase(item.phase)}
                        style={{
                          height: ROW_HEIGHT,
                          background: true ? "rgba(99,102,241,0.06)" : "rgba(99,102,241,0.04)",
                          borderBottom: `1px solid ${"var(--border)"}22`,
                        }}>
                        <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{item.expanded ? "▼" : "▶"}</span>
                        <span className="text-[12px] font-semibold" style={{ color: "var(--primary)" }}>{item.phase}</span>
                        <span className="text-[10px] ml-auto" style={{ color: "var(--muted-foreground)" }}>
                          {(tasksByPhase.get(item.phase) || []).length} tasks
                        </span>
                      </div>
                    );
                  }
                  const t = item.task;
                  return (
                    <div key={t.id} className="flex items-center gap-2 px-3 text-[12px] truncate cursor-pointer"
                      style={{ height: ROW_HEIGHT, color: "var(--foreground)", borderBottom: `1px solid ${"var(--border)"}11`, background: selectedTask?.id === t.id ? "rgba(99,102,241,0.08)" : undefined }}
                      onClick={() => handleSelectTask(selectedTask?.id === t.id ? null : t)}>
                      {t.isCriticalPath && showCriticalPath && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "#EF4444" }} />}
                      {t.isMilestone ? <span className="text-[#F59E0B] flex-shrink-0">◆</span> : <span className="w-3" />}
                      <span className="truncate">{t.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Right: Timeline ── */}
            <div className="flex-1 overflow-x-auto overflow-y-auto" ref={timelineRef} onScroll={handleScroll}>
              {/* Month headers */}
              <div className="flex sticky top-0 z-10" style={{ height: 44, background: true ? "var(--card)" : "#FAFBFC", borderBottom: `1px solid ${"var(--border)"}` }}>
                {months.map((m, i) => (
                  <div key={i} className="flex-shrink-0 text-[11px] font-semibold flex items-center justify-center"
                    style={{ width: m.days * dayWidth, color: "var(--muted-foreground)", borderRight: `1px solid ${"var(--border)"}33` }}>
                    {m.label}
                  </div>
                ))}
              </div>

              {/* Task bars area */}
              <div className="relative" style={{ width: totalDays * dayWidth, minHeight: visibleTasks.length * ROW_HEIGHT }}>
                {/* Today marker */}
                {todayOffset >= 0 && todayOffset <= totalDays && (
                  <>
                    <div className="absolute top-0 bottom-0 z-20 pointer-events-none" style={{ left: todayOffset * dayWidth, width: 2, background: "#EF4444" }} />
                    <div className="absolute z-20 text-[9px] font-bold text-white px-1 rounded"
                      style={{ left: todayOffset * dayWidth - 14, top: 2, background: "#EF4444" }}>
                      TODAY
                    </div>
                  </>
                )}

                {/* Grid lines (per month) */}
                {months.reduce<{ el: React.ReactElement[]; offset: number }>((acc, m, i) => {
                  acc.el.push(
                    <div key={`grid-${i}`} className="absolute top-0 bottom-0 pointer-events-none"
                      style={{ left: acc.offset * dayWidth, width: 1, background: `${"var(--border)"}33` }} />
                  );
                  return { el: acc.el, offset: acc.offset + m.days };
                }, { el: [], offset: 0 }).el}

                {/* Task bars */}
                {visibleTasks.map((item, rowIdx) => {
                  if (item.type === "phase") {
                    // Phase summary bar
                    const tasks = tasksByPhase.get(item.phase) || [];
                    if (tasks.length === 0) return null;
                    const phaseStart = new Date(Math.min(...tasks.map(t => parseDate(t.start).getTime())));
                    const phaseEnd = new Date(Math.max(...tasks.map(t => parseDate(t.end).getTime())));
                    const left = diffDays(timelineStart, phaseStart) * dayWidth;
                    const width = (diffDays(phaseStart, phaseEnd) + 1) * dayWidth;
                    const avgProgress = Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length);
                    return (
                      <div key={`phbar-${item.phase}`} className="absolute flex items-center" style={{ top: rowIdx * ROW_HEIGHT, height: ROW_HEIGHT, left, width }}>
                        <div className="w-full h-[8px] rounded-full relative overflow-hidden" style={{ background: `${"var(--primary)"}22` }}>
                          <div className="h-full rounded-full" style={{ width: `${avgProgress}%`, background: "var(--primary)", opacity: 0.5 }} />
                        </div>
                      </div>
                    );
                  }

                  const t = item.task;
                  const tStart = parseDate(t.start);
                  const tEnd = parseDate(t.end);
                  const left = diffDays(timelineStart, tStart) * dayWidth;
                  const width = Math.max((diffDays(tStart, tEnd) + 1) * dayWidth, 8);
                  const barColor = STATUS_COLORS[t.status];
                  const isCritical = t.isCriticalPath && showCriticalPath;

                  if (t.isMilestone) {
                    return (
                      <div key={t.id} className="absolute flex items-center justify-center" style={{ top: rowIdx * ROW_HEIGHT, height: ROW_HEIGHT, left: left - 8 }}>
                        <div className="w-[16px] h-[16px] rotate-45" style={{
                          background: t.status === "done" ? "#10B981" : "#F59E0B",
                          boxShadow: `0 0 8px ${t.status === "done" ? "#10B98155" : "#F59E0B55"}`,
                          border: isCritical ? "2px solid #EF4444" : "none",
                        }} />
                      </div>
                    );
                  }

                  return (
                    <div key={t.id} className="absolute flex items-center group" style={{ top: rowIdx * ROW_HEIGHT, height: ROW_HEIGHT, left }}
                      onClick={() => handleSelectTask(selectedTask?.id === t.id ? null : t)}>
                      <div className="relative rounded-[4px] overflow-hidden cursor-pointer transition-all"
                        style={{
                          width,
                          height: 20,
                          background: `${barColor}${true ? "33" : "22"}`,
                          border: isCritical ? `1.5px solid #EF4444` : `1px solid ${barColor}44`,
                        }}>
                        {/* Progress fill */}
                        <div className="absolute inset-0 rounded-[3px]" style={{ width: `${t.progress}%`, background: barColor, opacity: 0.7 }} />
                        {/* Label (only if bar wide enough) */}
                        {width > 60 && (
                          <span className="absolute inset-0 flex items-center px-2 text-[10px] font-medium text-white truncate z-10 mix-blend-normal"
                            style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
                            {t.progress > 0 ? `${t.progress}%` : ""}
                          </span>
                        )}
                      </div>
                      {/* Tooltip on*/}
                      <div className="hidden group-hover:block absolute top-full left-0 z-30 mt-1 p-2 rounded-[8px] text-[11px] whitespace-nowrap"
                        style={{ background: true ? "#1E2337" : "#FFF", border: `1px solid ${"var(--border)"}`, boxShadow: "0 4px 6px rgba(0,0,0,0.07)", color: "var(--foreground)" }}>
                        <div className="font-semibold">{t.name}</div>
                        <div style={{ color: "var(--muted-foreground)" }}>{formatDate(tStart)} → {formatDate(tEnd)} · {diffDays(tStart, tEnd) + 1}d</div>
                        {t.assignee && <div style={{ color: "var(--muted-foreground)" }}>Assignee: {t.assignee}</div>}
                        {isCritical && <div className="text-red-400 font-semibold">Critical Path</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>

        {/* ── Phase Gates Sidebar ── */}
        <PhaseGatesSidebar phases={phasesSummary} />
      </div>

      {/* ── Task Detail Panel ── */}
      {selectedTask && (
        <div style={{
          position: "fixed", right: 0, top: 0, bottom: 0, width: 320, zIndex: 40,
          background: "var(--card)", borderLeft: "1px solid var(--border)",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.2)", overflowY: "auto",
          padding: 24, display: "flex", flexDirection: "column", gap: 20,
        }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>Task Detail</p>
              <div className="flex items-center gap-2 flex-wrap mt-1">
                <h2 className="text-[15px] font-bold" style={{ color: "var(--foreground)", lineHeight: 1.3 }}>{selectedTask.name}</h2>
                {(() => {
                  const parsed = parseSource(selectedTask.description);
                  return parsed.kind !== "unknown" ? <SourceBadge kind={parsed.kind} /> : null;
                })()}
              </div>
            </div>
            <button onClick={() => handleSelectTask(null)} className="w-7 h-7 rounded-full flex items-center justify-center hover:opacity-70 flex-shrink-0" style={{ background: "var(--muted)", color: "var(--muted-foreground)", border: "none", cursor: "pointer", fontSize: 16 }}>×</button>
          </div>

          {/* Why this task? — only renders when the description carries a parseable
              source prefix (Research-anchored / User-confirmed / Default-template / etc). */}
          {(() => {
            const parsed = parseSource(selectedTask.description);
            if (parsed.kind === "unknown" || (!parsed.reasoning && parsed.alternatives.length === 0)) return null;
            return (
              <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
                <RowReasoning source={parsed} label="Why this task?" />
              </div>
            );
          })()}

          {/* WBS + Phase */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Phase", value: selectedTask.phase },
              { label: "Status", value: selectedTask.status },
              { label: "Start", value: tMinusMode ? tMinusLabel(selectedTask.start, tMinusTarget) : formatDate(parseDate(selectedTask.start)) },
              { label: "End", value: tMinusMode ? tMinusLabel(selectedTask.end, tMinusTarget) : formatDate(parseDate(selectedTask.end)) },
              { label: "Duration", value: selectedTask.isMilestone ? "Milestone" : `${diffDays(parseDate(selectedTask.start), parseDate(selectedTask.end)) + 1}d` },
              { label: "Assignee", value: selectedTask.assignee || "Unassigned" },
            ].map(f => (
              <div key={f.label} className="rounded-lg p-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--muted-foreground)" }}>{f.label}</p>
                <p className="text-[12px] font-semibold" style={{ color: "var(--foreground)" }}>{f.value}</p>
              </div>
            ))}
          </div>

          {/* Status selector */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Status</p>
            <div className="flex flex-wrap gap-1.5">
              {(["pending", "active", "at-risk", "done"] as TaskStatus[]).map(s => (
                <button key={s} onClick={() => setEditStatus(s)}
                  className="px-2.5 py-1 rounded-[6px] text-[11px] font-semibold capitalize transition-all"
                  style={{
                    background: (editStatus ?? selectedTask.status) === s ? `${STATUS_COLORS[s]}25` : `${STATUS_COLORS[s]}10`,
                    color: STATUS_COLORS[s],
                    border: `1px solid ${(editStatus ?? selectedTask.status) === s ? STATUS_COLORS[s] : `${STATUS_COLORS[s]}44`}`,
                  }}>
                  {s === "pending" ? "To Do" : s === "active" ? "In Progress" : s === "at-risk" ? "At Risk" : "Done"}
                </button>
              ))}
            </div>
          </div>

          {/* Progress */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>Progress</p>
              <span className="text-[13px] font-bold" style={{ color: STATUS_COLORS[editStatus ?? selectedTask.status] }}>{editProgress ?? selectedTask.progress}%</span>
            </div>
            <input type="range" min={0} max={100} step={5}
              value={editProgress ?? selectedTask.progress}
              onChange={e => setEditProgress(Number(e.target.value))}
              style={{ width: "100%", accentColor: STATUS_COLORS[editStatus ?? selectedTask.status] }} />
            <div className="flex justify-between text-[9px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              <span>0%</span><span>50%</span><span>100%</span>
            </div>
          </div>

          {/* Save button */}
          {(editProgress !== selectedTask.progress || editStatus !== selectedTask.status) && (
            <button onClick={handleSaveTask} disabled={updateTask.isPending}
              className="w-full py-2 rounded-[8px] text-[12px] font-semibold transition-all"
              style={{ background: "var(--primary)", color: "#fff", opacity: updateTask.isPending ? 0.6 : 1, cursor: updateTask.isPending ? "default" : "pointer" }}>
              {updateTask.isPending ? "Saving…" : "Save Changes"}
            </button>
          )}

          {/* Flags */}
          <div className="flex flex-wrap gap-2">
            {selectedTask.isMilestone && <span className="px-2 py-1 rounded text-[10px] font-semibold" style={{ background: "rgba(245,158,11,0.15)", color: "#F59E0B" }}>◆ Milestone</span>}
            {selectedTask.isCriticalPath && <span className="px-2 py-1 rounded text-[10px] font-semibold" style={{ background: "rgba(239,68,68,0.15)", color: "#EF4444" }}>Critical Path</span>}
          </div>

          {/* Dependencies */}
          {selectedTask.dependsOn && selectedTask.dependsOn.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Depends On</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedTask.dependsOn.map(dep => (
                  <span key={dep} className="px-2 py-1 rounded text-[10px] font-mono" style={{ background: "rgba(99,102,241,0.1)", color: "var(--primary)", border: "1px solid rgba(99,102,241,0.2)" }}>{dep}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Header with stats + controls ──
function Header({ view, setView, zoom, setZoom, showCriticalPath, setShowCriticalPath, tMinusMode, setTMinusMode, daysToTarget, tMinusTarget, stats, project, onDownloadCSV }: any) {
  return (
    <div className="space-y-4">
      {/* T-Minus countdown banner */}
      {tMinusMode && (
        <div className="flex items-center gap-4 px-5 py-3 rounded-xl" style={{ background: daysToTarget <= 7 ? "rgba(239,68,68,0.1)" : daysToTarget <= 30 ? "rgba(245,158,11,0.1)" : "rgba(99,102,241,0.1)", border: `1px solid ${daysToTarget <= 7 ? "rgba(239,68,68,0.2)" : daysToTarget <= 30 ? "rgba(245,158,11,0.2)" : "rgba(99,102,241,0.2)"}` }}>
          <div className="text-center min-w-[80px]">
            <p className="text-[28px] font-black font-mono" style={{ color: daysToTarget <= 7 ? "#EF4444" : daysToTarget <= 30 ? "#F59E0B" : "var(--primary)" }}>
              T-{Math.max(0, daysToTarget)}
            </p>
            <p className="text-[10px] font-medium" style={{ color: "var(--muted-foreground)" }}>days to go</p>
          </div>
          <div className="flex-1">
            <p className="text-[12px] font-semibold" style={{ color: "var(--foreground)" }}>
              Target: {tMinusTarget.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            </p>
            <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              {daysToTarget <= 0 ? "Target date has passed" : daysToTarget <= 7 ? "Final week — all tasks should be wrapping up" : daysToTarget <= 14 ? "Two weeks remaining — focus on critical path" : daysToTarget <= 30 ? "One month to go — monitor blockers closely" : `${Math.round(daysToTarget / 7)} weeks remaining`}
            </p>
          </div>
          <div className="flex-shrink-0 w-[200px]">
            <div className="flex justify-between text-[9px] mb-1" style={{ color: "var(--muted-foreground)" }}>
              <span>Progress</span>
              <span>{stats.overallProgress}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${stats.overallProgress}%`, background: daysToTarget <= 7 ? "#EF4444" : daysToTarget <= 30 ? "#F59E0B" : "var(--primary)" }} />
            </div>
          </div>
        </div>
      )}

      {/* Title row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[24px] font-bold" style={{ color: "var(--foreground)" }}>Project Schedule</h1>
          {project && <p className="text-[13px] mt-1" style={{ color: "var(--muted-foreground)" }}>{project.name}{project.methodology ? ` — ${project.methodology}` : ""}</p>}
        </div>
        <div className="flex items-center gap-2">
          {/* T-Minus toggle */}
          <div className="flex rounded-[8px] overflow-hidden" style={{ border: `1px solid var(--border)` }}>
            <button className="px-3 py-1.5 text-[12px] font-semibold transition-colors"
              style={{ background: !tMinusMode ? "var(--primary)" : "transparent", color: !tMinusMode ? "#FFF" : "var(--muted-foreground)" }}
              onClick={() => setTMinusMode(false)}>
              Calendar
            </button>
            <button className="px-3 py-1.5 text-[12px] font-semibold transition-colors"
              style={{ background: tMinusMode ? "var(--primary)" : "transparent", color: tMinusMode ? "#FFF" : "var(--muted-foreground)" }}
              onClick={() => setTMinusMode(true)}>
              T-Minus
            </button>
          </div>
          {onDownloadCSV && (
            <Button variant="outline" size="sm" onClick={onDownloadCSV}>
              <Download className="w-3.5 h-3.5 mr-1" />
              Download CSV
            </Button>
          )}
          {/* View toggle */}
          <div className="flex rounded-[8px] overflow-hidden" style={{ border: `1px solid ${"var(--border)"}` }}>
            {(["gantt", "list"] as ViewMode[]).map(v => (
              <button key={v} className="px-3 py-1.5 text-[12px] font-semibold capitalize transition-colors"
                style={{
                  background: view === v ? "var(--primary)" : "transparent",
                  color: view === v ? "#FFF" : "var(--muted-foreground)",
                }}
                onClick={() => setView(v)}>
                {v === "gantt" ? "⧫ Gantt" : "☰ List"}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowCriticalPath(!showCriticalPath)}>
            {showCriticalPath ? "Hide" : "Show"} Critical Path
          </Button>
        </div>
      </div>

      {/* Summary pills */}
      <div className="flex flex-wrap gap-3">
        <StatPill label="Tasks" value={`${stats.completedTasks}/${stats.totalTasks}`} color={"var(--primary)"} />
        <StatPill label="Progress" value={`${stats.overallProgress}%`} color={"#10B981"} />
        <StatPill label="Milestones" value={`${stats.milestonesHit}/${stats.totalMilestones}`} color="#F59E0B" />
        <StatPill label="Critical Path" value={`${stats.criticalTasks} tasks`} color="#EF4444" />
      </div>

      {/* Zoom controls (gantt only) */}
      {view === "gantt" && (
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium" style={{ color: "var(--muted-foreground)" }}>Zoom:</span>
          {(["week", "month", "quarter"] as ZoomLevel[]).map(z => (
            <button key={z} className="px-2.5 py-1 text-[11px] font-semibold rounded-[6px] capitalize transition-colors"
              style={{
                background: zoom === z ? `${"var(--primary)"}22` : "transparent",
                color: zoom === z ? "var(--primary)" : "var(--muted-foreground)",
                border: `1px solid ${zoom === z ? "var(--primary)" + "44" : "var(--border)" + "44"}`,
              }}
              onClick={() => setZoom(z)}>
              {z}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stat pill ──
function StatPill({ label, value, color,  }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-[8px]"
      style={{ background: `${color}${true ? "15" : "10"}`, border: `1px solid ${color}33` }}>
      <div className="w-2 h-2 rounded-full" style={{ background: color }} />
      <span className="text-[12px] font-semibold" style={{ color }}>{value}</span>
      <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{label}</span>
    </div>
  );
}

// ── Phase Gates Sidebar ──
function PhaseGatesSidebar({ phases }: { phases: { name: string; status: string; tasks: number; complete: number; gate: string; progress?: number }[] }) {
  const gateStatusColor = (s: string) => s === "Approved" ? "#10B981" : s === "Pending" ? "#F59E0B" : "var(--muted-foreground)";

  return (
    <div className="w-[240px] flex-shrink-0 space-y-3">
      <Card>
        <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>Phase Gates</h3>
        <div className="space-y-2">
          {phases.map(p => (
            <div key={p.name} className="p-2 rounded-[8px]" style={{ background: true ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)" }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[12px] font-semibold" style={{ color: "var(--foreground)" }}>{p.name}</span>
                <span className="text-[10px] font-semibold" style={{ color: gateStatusColor(p.gate) }}>{p.gate}</span>
              </div>
              <Progress value={p.progress ?? (p.tasks > 0 ? Math.round((p.complete / p.tasks) * 100) : 0)} className="h-1.5" />
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{p.complete}/{p.tasks} done</span>
                <span className="text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>{p.progress ?? 0}%</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>Insights</h3>
        <div className="space-y-2 text-[12px]" style={{ color: "var(--muted-foreground)" }}>
          {phases.length === 0 ? (
            <div className="p-2 rounded-[8px]" style={{ background: "rgba(100,116,139,0.08)", border: "1px solid rgba(100,116,139,0.2)" }}>
              <span className="font-semibold" style={{ color: "var(--muted-foreground)" }}>No tasks yet.</span> Add tasks to this project to see schedule insights.
            </div>
          ) : (() => {
            const totalTasks = phases.reduce((s, p) => s + p.tasks, 0);
            const totalDone = phases.reduce((s, p) => s + p.complete, 0);
            const overall = totalTasks === 0 ? 0 : Math.round(
              phases.reduce((s, p) => s + (p.progress ?? 0) * p.tasks, 0) / totalTasks,
            );
            const activePhase = phases.find(p => p.status === "active");
            return (
              <>
                <div className="p-2 rounded-[8px]" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
                  <span className="font-semibold text-emerald-400">Overall:</span> {overall}% complete · {totalDone}/{totalTasks} tasks done across {phases.length} phase{phases.length !== 1 ? "s" : ""}.
                </div>
                {activePhase && (
                  <div className="p-2 rounded-[8px]" style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)" }}>
                    <span className="font-semibold" style={{ color: "var(--primary)" }}>Active:</span> {activePhase.name} — {activePhase.complete}/{activePhase.tasks} done ({activePhase.progress ?? 0}%).
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </Card>
    </div>
  );
}
