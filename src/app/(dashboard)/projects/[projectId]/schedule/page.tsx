"use client";
// @ts-nocheck

import { useState, useMemo, useRef, useEffect, useCallback } from "react";

import { useParams } from "next/navigation";
import { useProjectTasks, useProject } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

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
}

// ── Sample data ──
const TASKS: ScheduleTask[] = [
  // Pre-Project
  { id: "t1", name: "Feasibility Study", phase: "Pre-Project", start: "2026-01-06", end: "2026-01-24", progress: 100, status: "done", isCriticalPath: true },
  { id: "t2", name: "Business Case Approval", phase: "Pre-Project", start: "2026-01-27", end: "2026-01-27", progress: 100, status: "done", dependsOn: ["t1"], isMilestone: true },
  // Initiation
  { id: "t3", name: "Project Charter", phase: "Initiation", start: "2026-01-28", end: "2026-02-07", progress: 100, status: "done", dependsOn: ["t2"], isCriticalPath: true, assignee: "Maya" },
  { id: "t4", name: "Stakeholder Register", phase: "Initiation", start: "2026-02-03", end: "2026-02-14", progress: 100, status: "done", assignee: "Maya" },
  { id: "t5", name: "Initial Risk Assessment", phase: "Initiation", start: "2026-02-10", end: "2026-02-21", progress: 100, status: "done", assignee: "Maya" },
  { id: "t6", name: "Initiation Gate", phase: "Initiation", start: "2026-02-24", end: "2026-02-24", progress: 100, status: "done", dependsOn: ["t3", "t4", "t5"], isMilestone: true },
  // Planning
  { id: "t7", name: "Scope Management Plan", phase: "Planning", start: "2026-02-25", end: "2026-03-13", progress: 85, status: "active", dependsOn: ["t6"], isCriticalPath: true, assignee: "Maya" },
  { id: "t8", name: "WBS Development", phase: "Planning", start: "2026-03-02", end: "2026-03-20", progress: 70, status: "active", assignee: "Maya" },
  { id: "t9", name: "Schedule Baseline", phase: "Planning", start: "2026-03-16", end: "2026-04-03", progress: 40, status: "active", dependsOn: ["t8"], isCriticalPath: true, assignee: "Maya" },
  { id: "t10", name: "Cost Baseline", phase: "Planning", start: "2026-03-16", end: "2026-04-03", progress: 35, status: "active", assignee: "Maya" },
  { id: "t11", name: "Risk Management Plan", phase: "Planning", start: "2026-03-23", end: "2026-04-10", progress: 20, status: "active", assignee: "Maya" },
  { id: "t12", name: "Quality Management Plan", phase: "Planning", start: "2026-03-30", end: "2026-04-14", progress: 10, status: "active", assignee: "Maya" },
  { id: "t13", name: "Comms Management Plan", phase: "Planning", start: "2026-04-07", end: "2026-04-18", progress: 0, status: "pending", assignee: "Maya" },
  { id: "t14", name: "Planning Gate", phase: "Planning", start: "2026-04-21", end: "2026-04-21", progress: 0, status: "pending", dependsOn: ["t7", "t9", "t10", "t11", "t12", "t13"], isMilestone: true },
  // Execution
  { id: "t15", name: "Data Migration – Phase 1", phase: "Execution", start: "2026-04-22", end: "2026-05-22", progress: 0, status: "pending", dependsOn: ["t14"], isCriticalPath: true },
  { id: "t16", name: "Salesforce Configuration", phase: "Execution", start: "2026-04-22", end: "2026-06-05", progress: 0, status: "pending", dependsOn: ["t14"] },
  { id: "t17", name: "Custom Development Sprint 1", phase: "Execution", start: "2026-05-04", end: "2026-05-29", progress: 0, status: "pending" },
  { id: "t18", name: "Custom Development Sprint 2", phase: "Execution", start: "2026-06-01", end: "2026-06-26", progress: 0, status: "pending", dependsOn: ["t17"] },
  { id: "t19", name: "Integration Testing", phase: "Execution", start: "2026-06-15", end: "2026-07-10", progress: 0, status: "pending", dependsOn: ["t15", "t16"], isCriticalPath: true },
  { id: "t20", name: "UAT", phase: "Execution", start: "2026-07-06", end: "2026-07-24", progress: 0, status: "pending", dependsOn: ["t19"], isCriticalPath: true },
  { id: "t21", name: "Go-Live Readiness Gate", phase: "Execution", start: "2026-07-27", end: "2026-07-27", progress: 0, status: "pending", dependsOn: ["t20"], isMilestone: true },
  // Closing
  { id: "t22", name: "Hypercare Support (30 days)", phase: "Closing", start: "2026-07-28", end: "2026-08-28", progress: 0, status: "pending", dependsOn: ["t21"] },
  { id: "t23", name: "Lessons Learned Workshop", phase: "Closing", start: "2026-08-25", end: "2026-09-05", progress: 0, status: "pending" },
  { id: "t24", name: "Project Closure Report", phase: "Closing", start: "2026-09-01", end: "2026-09-12", progress: 0, status: "pending", dependsOn: ["t22", "t23"], isCriticalPath: true },
  { id: "t25", name: "Final Sign-Off", phase: "Closing", start: "2026-09-15", end: "2026-09-15", progress: 0, status: "pending", dependsOn: ["t24"], isMilestone: true },
];

const PHASES_SUMMARY = [
  { name: "Pre-Project", status: "done" as const, tasks: 2, complete: 2, gate: "Approved" },
  { name: "Initiation", status: "done" as const, tasks: 4, complete: 4, gate: "Approved" },
  { name: "Planning", status: "active" as const, tasks: 8, complete: 0, gate: "Pending" },
  { name: "Execution", status: "pending" as const, tasks: 7, complete: 0, gate: "Not started" },
  { name: "Closing", status: "pending" as const, tasks: 4, complete: 0, gate: "Not started" },
];

type ZoomLevel = "week" | "month" | "quarter";
type ViewMode = "gantt" | "list";

// ── Helpers ──
function parseDate(s: string) { return new Date(s + "T00:00:00"); }
function diffDays(a: Date, b: Date) { return Math.round((b.getTime() - a.getTime()) / 86400000); }
function formatDate(d: Date) { return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }); }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

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

  const TASKS_DATA: ScheduleTask[] = (apiTasks && apiTasks.length > 0) ? apiTasks.map((t: any) => ({
    id: t.id,
    name: t.title || t.name,
    phase: t.phase || "Execution",
    start: t.startDate || t.start || "2026-01-06",
    end: t.endDate || t.end || "2026-01-20",
    progress: t.progress ?? 0,
    status: t.status === "completed" || t.status === "done" ? "done" : t.status === "in_progress" || t.status === "active" ? "active" : t.status === "at-risk" ? "at-risk" : t.isMilestone ? "milestone" : "pending" as TaskStatus,
    dependsOn: t.dependsOn || t.dependencies || [],
    assignee: t.assignee || t.assigneeName || "",
    isMilestone: t.isMilestone || false,
    isCriticalPath: t.isCriticalPath || false,
  })) : [];

  const mode = "dark";
  const [zoom, setZoom] = useState<ZoomLevel>("month");
  const [view, setView] = useState<ViewMode>("gantt");
  const [showCriticalPath, setShowCriticalPath] = useState(true);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set<string>());
  const timelineRef = useRef<HTMLDivElement>(null);
  const taskListRef = useRef<HTMLDivElement>(null);

  // Compute timeline range
  const { timelineStart, timelineEnd, totalDays, dayWidth } = useMemo(() => {
    const allStarts = TASKS_DATA.map(t => parseDate(t.start));
    const allEnds = TASKS_DATA.map(t => parseDate(t.end));
    const minDate = new Date(Math.min(...allStarts.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...allEnds.map(d => d.getTime())));
    const ts = addDays(minDate, -7);
    const te = addDays(maxDate, 14);
    const total = diffDays(ts, te);
    const dw = zoom === "week" ? 32 : zoom === "month" ? 16 : 6;
    return { timelineStart: ts, timelineEnd: te, totalDays: total, dayWidth: dw };
  }, [zoom]);

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
  }, []);

  // Stats
  const totalTasks = TASKS_DATA.length;
  const completedTasks = TASKS_DATA.filter(t => t.status === "done").length;
  const milestonesHit = TASKS_DATA.filter(t => t.isMilestone && t.status === "done").length;
  const totalMilestones = TASKS_DATA.filter(t => t.isMilestone).length;
  const criticalTasks = TASKS_DATA.filter(t => t.isCriticalPath).length;
  const overallProgress = Math.round(TASKS_DATA.reduce((s, t) => s + t.progress, 0) / totalTasks);

  const ROW_HEIGHT = 36;

  // Build flat visible list
  const visibleTasks = useMemo(() => {
    const result: { type: "phase"; phase: string; expanded: boolean }[] | { type: "task"; task: ScheduleTask }[] = [];
    const flat: Array<{ type: "phase"; phase: string; expanded: boolean } | { type: "task"; task: ScheduleTask }> = [];
    for (const ps of PHASES_SUMMARY) {
      flat.push({ type: "phase", phase: ps.name, expanded: expandedPhases.has(ps.name) });
      if (expandedPhases.has(ps.name)) {
        for (const t of tasksByPhase.get(ps.name) || []) {
          flat.push({ type: "task", task: t });
        }
      }
    }
    return flat;
  }, [expandedPhases, tasksByPhase]);

  // ── List View ──
  if (view === "list") {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Header view={view} setView={setView} zoom={zoom} setZoom={setZoom}
          showCriticalPath={showCriticalPath} setShowCriticalPath={setShowCriticalPath}
          stats={{ totalTasks, completedTasks, milestonesHit, totalMilestones, criticalTasks, overallProgress }} project={project} />

        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" style={{ color: "var(--foreground)" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${"var(--border)"}` }}>
                  {["Task", "Phase", "Start", "End", "Duration", "Progress", "Status", "Assignee", "Dependencies"].map(h => (
                    <th key={h} className="text-left py-2 px-3 font-semibold text-[12px]" style={{ color: "var(--muted-foreground)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TASKS_DATA.map(t => {
                  const dur = diffDays(parseDate(t.start), parseDate(t.end)) + 1;
                  return (
                    <tr key={t.id} className="hover:opacity-80 transition-opacity" style={{ borderBottom: `1px solid ${"var(--border)"}22` }}>
                      <td className="py-2 px-3 font-medium flex items-center gap-2">
                        {t.isMilestone && <span className="text-[#F59E0B]">◆</span>}
                        {t.isCriticalPath && showCriticalPath && <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />}
                        {t.name}
                      </td>
                      <td className="py-2 px-3"><Badge variant={t.phase === "Execution" ? "outline" : t.phase === "Planning" ? "secondary" : "outline"}>{t.phase}</Badge></td>
                      <td className="py-2 px-3" style={{ color: "var(--muted-foreground)" }}>{formatDate(parseDate(t.start))}</td>
                      <td className="py-2 px-3" style={{ color: "var(--muted-foreground)" }}>{formatDate(parseDate(t.end))}</td>
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

        <PhaseGatesSidebar />
      </div>
    );
  }

  // ── Gantt View ──
  return (
    <div className="space-y-6 max-w-[1600px]">
      <Header view={view} setView={setView} zoom={zoom} setZoom={setZoom}
        showCriticalPath={showCriticalPath} setShowCriticalPath={setShowCriticalPath}
        stats={{ totalTasks, completedTasks, milestonesHit, totalMilestones, criticalTasks, overallProgress }} />

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
                    <div key={t.id} className="flex items-center gap-2 px-3 text-[12px] truncate"
                      style={{ height: ROW_HEIGHT, color: "var(--foreground)", borderBottom: `1px solid ${"var(--border)"}11` }}>
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
                    <div key={t.id} className="absolute flex items-center group" style={{ top: rowIdx * ROW_HEIGHT, height: ROW_HEIGHT, left }}>
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
        <PhaseGatesSidebar />
      </div>
    </div>
  );
}

// ── Header with stats + controls ──
function Header({ view, setView, zoom, setZoom, showCriticalPath, setShowCriticalPath, stats, project }: any) {
  return (
    <div className="space-y-4">
      {/* Title row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[24px] font-bold" style={{ color: "var(--foreground)" }}>Project Schedule</h1>
          {project && <p className="text-[13px] mt-1" style={{ color: "var(--muted-foreground)" }}>{project.name}{project.methodology ? ` — ${project.methodology}` : ""}</p>}
        </div>
        <div className="flex items-center gap-2">
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
          <Button variant="default" size="sm" disabled title="Coming soon">Export</Button>
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
function PhaseGatesSidebar({  }: { mode: string }) {
  const gateStatusColor = (s: string) => s === "Approved" ? "#10B981" : s === "Pending" ? "#F59E0B" : "var(--muted-foreground)";

  return (
    <div className="w-[240px] flex-shrink-0 space-y-3">
      <Card>
        <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>Phase Gates</h3>
        <div className="space-y-2">
          {([] as any[]).map(p => (
            <div key={p.name} className="p-2 rounded-[8px]" style={{ background: true ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)" }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[12px] font-semibold" style={{ color: "var(--foreground)" }}>{p.name}</span>
                <span className="text-[10px] font-semibold" style={{ color: gateStatusColor(p.gate) }}>{p.gate}</span>
              </div>
              <Progress value={Math.round((p.complete / p.tasks) * 100)} className="h-1.5" />
              <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{p.complete}/{p.tasks} tasks complete</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>AI Insights</h3>
        <div className="space-y-2 text-[12px]" style={{ color: "var(--muted-foreground)" }}>
          <div className="p-2 rounded-[8px]" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <span className="font-semibold text-red-400">Schedule Risk:</span> Planning phase may slip 5 days based on current velocity. Consider parallel-tracking Comms Plan.
          </div>
          <div className="p-2 rounded-[8px]" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
            <span className="font-semibold text-amber-400">Dependency Alert:</span> Integration Testing depends on both Data Migration and Salesforce Config. Monitor for convergence risk.
          </div>
          <div className="p-2 rounded-[8px]" style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
            <span className="font-semibold text-emerald-400">On Track:</span> Pre-Project and Initiation completed ahead of schedule. Planning gate forecast: 21 Apr.
          </div>
        </div>
      </Card>
    </div>
  );
}
