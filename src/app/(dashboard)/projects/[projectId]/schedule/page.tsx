"use client";

import { useState, useRef, useMemo } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectTasks, useProject } from "@/hooks/use-api";
import { Plus, Calendar, List, BarChart3, ChevronDown, ChevronRight } from "lucide-react";

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
    months.push({ label: cur.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }), start: visibleStart, days: diffDays(visibleStart, visibleEnd) + 1 });
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

const STATUS_COLORS: Record<string, string> = { DONE: "#10B981", IN_PROGRESS: "#6366F1", TODO: "#64748B", BLOCKED: "#EF4444" };
const PRIORITY_COLORS: Record<string, string> = { CRITICAL: "#EF4444", HIGH: "#F97316", MEDIUM: "#6366F1", LOW: "#64748B" };

type ZoomLevel = "week" | "month" | "quarter";
type ViewMode = "gantt" | "list";

export default function SchedulePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useProject(projectId);
  const { data: tasks, isLoading } = useProjectTasks(projectId);
  const [view, setView] = useState<ViewMode>("gantt");
  const [zoom, setZoom] = useState<ZoomLevel>("month");
  const [showCriticalPath, setShowCriticalPath] = useState(true);
  const timelineRef = useRef<HTMLDivElement>(null);
  const taskListRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => (tasks || []).filter((t: any) => t.startDate && t.endDate), [tasks]);
  const allTasks = tasks || [];

  // Timeline range
  const { timelineStart, timelineEnd, totalDays, dayWidth } = useMemo(() => {
    if (items.length === 0) return { timelineStart: new Date(), timelineEnd: addDays(new Date(), 90), totalDays: 90, dayWidth: 16 };
    const starts = items.map((t: any) => new Date(t.startDate).getTime());
    const ends = items.map((t: any) => new Date(t.endDate).getTime());
    const ts = addDays(new Date(Math.min(...starts)), -7);
    const te = addDays(new Date(Math.max(...ends)), 14);
    const total = diffDays(ts, te);
    const dw = zoom === "week" ? 32 : zoom === "month" ? 16 : 6;
    return { timelineStart: ts, timelineEnd: te, totalDays: total, dayWidth: dw };
  }, [items, zoom]);

  const months = useMemo(() => getMonths(timelineStart, timelineEnd), [timelineStart, timelineEnd]);
  const today = new Date();
  const todayOffset = diffDays(timelineStart, today);
  const ROW_HEIGHT = 36;

  const completed = allTasks.filter((t: any) => t.status === "DONE").length;
  const inProgress = allTasks.filter((t: any) => t.status === "IN_PROGRESS").length;

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-96 rounded-xl" /></div>;

  // ── List View ──
  if (view === "list") {
    return (
      <div className="space-y-6 max-w-[1600px]">
        <ScheduleHeader project={project} allTasks={allTasks} completed={completed} inProgress={inProgress}
          view={view} setView={setView} zoom={zoom} setZoom={setZoom} showCriticalPath={showCriticalPath} setShowCriticalPath={setShowCriticalPath} />
        <Card className="p-0">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border">
              {["Task", "Status", "Priority", "Start", "End", "Duration", "Progress", "Assignee"].map(h => (
                <th key={h} className="text-left py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {allTasks.map((t: any) => {
                const dur = t.startDate && t.endDate ? diffDays(new Date(t.startDate), new Date(t.endDate)) + 1 : null;
                return (
                  <tr key={t.id} className="border-b border-border/30 hover:bg-muted/30">
                    <td className="py-2 px-3 font-medium max-w-[300px] truncate">{t.title}</td>
                    <td className="py-2 px-3"><Badge variant={t.status === "DONE" ? "default" : t.status === "BLOCKED" ? "destructive" : "outline"}>{t.status}</Badge></td>
                    <td className="py-2 px-3"><Badge variant={t.priority === "CRITICAL" || t.priority === "HIGH" ? "destructive" : "outline"}>{t.priority || "—"}</Badge></td>
                    <td className="py-2 px-3 text-muted-foreground">{t.startDate ? formatDate(new Date(t.startDate)) : "—"}</td>
                    <td className="py-2 px-3 text-muted-foreground">{t.endDate ? formatDate(new Date(t.endDate)) : "—"}</td>
                    <td className="py-2 px-3 text-muted-foreground">{dur ? `${dur}d` : "—"}</td>
                    <td className="py-2 px-3 w-[100px]"><div className="flex items-center gap-2"><Progress value={t.progress || 0} className="h-1.5 flex-1" /><span className="text-[10px]">{t.progress || 0}%</span></div></td>
                    <td className="py-2 px-3 text-muted-foreground">{t.assigneeId || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
    );
  }

  // ── Gantt View ──
  return (
    <div className="space-y-6 max-w-[1600px]">
      <ScheduleHeader project={project} allTasks={allTasks} completed={completed} inProgress={inProgress}
        view={view} setView={setView} zoom={zoom} setZoom={setZoom} showCriticalPath={showCriticalPath} setShowCriticalPath={setShowCriticalPath} />

      {items.length === 0 ? (
        <div className="text-center py-20">
          <Calendar className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No scheduled tasks</h2>
          <p className="text-sm text-muted-foreground mb-4">Add tasks with start/end dates to see the Gantt chart.{allTasks.length > 0 ? ` (${allTasks.length} tasks without dates)` : ""}</p>
          <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add Task</Button>
        </div>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="flex" style={{ height: "calc(100vh - 320px)", minHeight: 400 }}>
            {/* Left: Task list */}
            <div className="flex-shrink-0 overflow-hidden" style={{ width: 280, borderRight: "1px solid var(--border)" }}>
              <div className="px-3 py-2 text-[11px] font-semibold flex items-center text-muted-foreground" style={{ height: 44, borderBottom: "1px solid var(--border)", background: "var(--muted)" }}>
                Task Name
              </div>
              <div ref={taskListRef} className="overflow-y-auto" style={{ height: "calc(100% - 44px)" }}>
                {items.map((t: any) => (
                  <div key={t.id} className="flex items-center gap-2 px-3 text-xs truncate hover:bg-muted/30" style={{ height: ROW_HEIGHT, borderBottom: "1px solid var(--border)", opacity: 0.1 }}>
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: STATUS_COLORS[t.status] || "#64748B" }} />
                    <span className="truncate">{t.title}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Timeline */}
            <div className="flex-1 overflow-x-auto overflow-y-auto" ref={timelineRef}
              onScroll={(e) => { if (taskListRef.current) taskListRef.current.scrollTop = e.currentTarget.scrollTop; }}>
              {/* Month headers */}
              <div className="flex sticky top-0 z-10" style={{ height: 44, background: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                {months.map((m, i) => (
                  <div key={i} className="flex-shrink-0 text-[10px] font-semibold flex items-center justify-center text-muted-foreground"
                    style={{ width: m.days * dayWidth, borderRight: "1px solid var(--border)", opacity: 0.3 }}>{m.label}</div>
                ))}
              </div>

              {/* Task bars */}
              <div className="relative" style={{ width: totalDays * dayWidth, minHeight: items.length * ROW_HEIGHT }}>
                {/* Today marker */}
                {todayOffset >= 0 && todayOffset <= totalDays && (
                  <>
                    <div className="absolute top-0 bottom-0 z-20 pointer-events-none" style={{ left: todayOffset * dayWidth, width: 2, background: "#EF4444" }} />
                    <div className="absolute z-20 text-[8px] font-bold text-white px-1 rounded" style={{ left: todayOffset * dayWidth - 14, top: 2, background: "#EF4444" }}>TODAY</div>
                  </>
                )}

                {/* Grid lines */}
                {months.reduce<{ els: React.ReactElement[]; offset: number }>((acc, m, i) => {
                  acc.els.push(<div key={`grid-${i}`} className="absolute top-0 bottom-0 pointer-events-none" style={{ left: acc.offset * dayWidth, width: 1, background: "var(--border)", opacity: 0.3 }} />);
                  return { els: acc.els, offset: acc.offset + m.days };
                }, { els: [], offset: 0 }).els}

                {/* Task bars */}
                {items.map((t: any, rowIdx: number) => {
                  const tStart = new Date(t.startDate);
                  const tEnd = new Date(t.endDate);
                  const left = diffDays(timelineStart, tStart) * dayWidth;
                  const width = Math.max((diffDays(tStart, tEnd) + 1) * dayWidth, 8);
                  const barColor = STATUS_COLORS[t.status] || "#64748B";
                  const isCritical = t.priority === "CRITICAL" && showCriticalPath;

                  return (
                    <div key={t.id} className="absolute flex items-center group" style={{ top: rowIdx * ROW_HEIGHT, height: ROW_HEIGHT, left }}>
                      <div className="relative rounded overflow-hidden cursor-pointer transition-all hover:-translate-y-px"
                        style={{
                          width, height: 20,
                          background: `${barColor}${t.status === "TODO" ? "33" : "22"}`,
                          border: isCritical ? "1.5px solid #EF4444" : `1px solid ${barColor}44`,
                        }}>
                        <div className="absolute inset-0 rounded" style={{ width: `${t.progress || 0}%`, background: barColor, opacity: 0.7 }} />
                        {width > 60 && (
                          <span className="absolute inset-0 flex items-center px-2 text-[9px] font-medium text-white truncate z-10" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
                            {t.progress > 0 ? `${t.progress}%` : ""}
                          </span>
                        )}
                      </div>
                      {/* Tooltip */}
                      <div className="hidden group-hover:block absolute top-full left-0 z-30 mt-1 p-2 rounded-lg text-[10px] whitespace-nowrap bg-card border border-border shadow-lg">
                        <div className="font-semibold">{t.title}</div>
                        <div className="text-muted-foreground">{formatDate(tStart)} → {formatDate(tEnd)} · {diffDays(tStart, tEnd) + 1}d</div>
                        <div className="text-muted-foreground">Progress: {t.progress || 0}% · {t.status}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Stats */}
      {allTasks.length > 0 && allTasks.length !== items.length && (
        <p className="text-xs text-muted-foreground">{allTasks.length - items.length} tasks without dates (not shown on Gantt). Switch to List view to see all.</p>
      )}
    </div>
  );
}

function ScheduleHeader({ project, allTasks, completed, inProgress, view, setView, zoom, setZoom, showCriticalPath, setShowCriticalPath }: any) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Project Schedule</h1>
          <p className="text-sm text-muted-foreground mt-1">{project?.name || "Project"} — {allTasks.length} tasks · {completed} done · {inProgress} in progress</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(["gantt", "list"] as ViewMode[]).map(v => (
              <button key={v} className={`px-3 py-1.5 text-xs font-semibold capitalize ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                onClick={() => setView(v)}>{v === "gantt" ? "⧫ Gantt" : "☰ List"}</button>
            ))}
          </div>
          {view === "gantt" && (
            <Button variant="ghost" size="sm" onClick={() => setShowCriticalPath(!showCriticalPath)} className="text-xs">
              {showCriticalPath ? "Hide" : "Show"} Critical
            </Button>
          )}
          <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add Task</Button>
        </div>
      </div>

      {/* Summary pills */}
      <div className="flex flex-wrap gap-3">
        <StatPill label="Tasks" value={`${completed}/${allTasks.length}`} color="var(--primary)" />
        <StatPill label="Progress" value={`${allTasks.length > 0 ? Math.round(allTasks.reduce((s: number, t: any) => s + (t.progress || 0), 0) / allTasks.length) : 0}%`} color="#10B981" />
        <StatPill label="In Progress" value={`${inProgress}`} color="#6366F1" />
        <StatPill label="Blocked" value={`${allTasks.filter((t: any) => t.status === "BLOCKED").length}`} color="#EF4444" />
      </div>

      {/* Zoom controls (gantt only) */}
      {view === "gantt" && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Zoom:</span>
          {(["week", "month", "quarter"] as ZoomLevel[]).map(z => (
            <button key={z} className={`px-2.5 py-1 text-[10px] font-semibold rounded capitalize border transition-all ${zoom === z ? "border-primary/40 bg-primary/10 text-primary" : "border-border/30 text-muted-foreground"}`}
              onClick={() => setZoom(z)}>{z}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/30" style={{ background: `${color}08` }}>
      <div className="w-2 h-2 rounded-full" style={{ background: color }} />
      <span className="text-xs font-semibold" style={{ color }}>{value}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}
