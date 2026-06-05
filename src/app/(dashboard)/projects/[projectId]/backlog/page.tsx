"use client";

/**
 * Product Backlog — dedicated view of all unassigned-to-sprint Tasks for a
 * project, with MoSCoW prioritisation and bulk operations. Gated by
 * methodology (Scrum / Hybrid / SAFe only).
 *
 * Reuses the existing Task model:
 *   - Product Backlog item = Task with sprintId === null
 *   - Sprint Backlog item  = Task with sprintId set
 * No new model. Pull into a sprint by setting sprintId via the existing
 * /api/projects/:id/tasks/:taskId PATCH route. The Sprint Planning page
 * has the drag-into-sprint affordance; this page has bulk-edit MoSCoW +
 * filter + sort + a "select multiple and move to sprint X" flow.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useProjectTasks, useProjectSprints, useProject, useUpdateTask } from "@/hooks/use-api";
import { methodologyFeatures } from "@/lib/methodology-definitions";
import { MOSCOW_VALUES, MOSCOW_LABELS, MOSCOW_SHORT, MOSCOW_CHIP, MOSCOW_HEX, summariseByMoscow, compareByMoscow, type Moscow } from "@/lib/moscow";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Target, ListChecks, ArrowRight } from "lucide-react";

type FilterValue = "ALL" | "UNSET" | Moscow;

export default function ProductBacklogPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useProject(projectId);
  const { data: apiTasks } = useProjectTasks(projectId);
  const { data: apiSprints } = useProjectSprints(projectId);
  const updateTask = useUpdateTask(projectId);

  const sprintsEnabled = useMemo(() => {
    if (!project?.methodology) return true;
    try { return methodologyFeatures(project.methodology).sprints; }
    catch { return true; }
  }, [project?.methodology]);

  const [moscowFilter, setMoscowFilter] = useState<FilterValue>("ALL");
  const [epicFilter, setEpicFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const backlog = useMemo(() => {
    const all = (apiTasks || []).filter((t: any) => !t.sprintId && t.status !== "DONE" && t.status !== "COMPLETED");
    let filtered = all;
    if (moscowFilter === "UNSET") filtered = all.filter((t: any) => !t.moscow);
    else if (moscowFilter !== "ALL") filtered = all.filter((t: any) => t.moscow === moscowFilter);
    if (epicFilter) filtered = filtered.filter((t: any) => (t.epic ?? null) === epicFilter);
    return [...filtered].sort(compareByMoscow);
  }, [apiTasks, moscowFilter, epicFilter]);

  // Epics list (any non-null epic value present in tasks)
  const epics = useMemo(() => {
    const set = new Set<string>();
    for (const t of apiTasks || []) {
      if (!t.sprintId && t.epic) set.add(t.epic);
    }
    return Array.from(set).sort();
  }, [apiTasks]);

  // Breakdown of the FULL product backlog (before filter) — so the user
  // sees the strategic picture, not the narrowed slice.
  const backlogBreakdown = useMemo(() => {
    const all = (apiTasks || []).filter((t: any) => !t.sprintId && t.status !== "DONE" && t.status !== "COMPLETED");
    return summariseByMoscow(all.map((t: any) => ({ moscow: t.moscow ?? null, status: t.status })));
  }, [apiTasks]);

  if (!sprintsEnabled) {
    return (
      <div className="max-w-[640px] mx-auto py-24 text-center space-y-3">
        <h1 className="text-[20px] font-bold">Product Backlog isn&apos;t part of this methodology</h1>
        <p className="text-[13px] text-muted-foreground">
          This project is running on the <strong>{project?.methodology}</strong> methodology, which uses phase-gated delivery rather than backlogs. Switch the methodology in <Link href={`/projects/${projectId}`} className="text-primary hover:underline">Project Overview</Link> if you want backlog tracking.
        </p>
        <Link href={`/projects/${projectId}/schedule`}>
          <Button variant="default" size="sm" className="mt-2">Go to Schedule</Button>
        </Link>
      </div>
    );
  }

  const totalPoints = backlog.reduce((s: number, t: any) => s + (t.storyPoints || 0), 0);
  const openSprints = (apiSprints || []).filter((s: any) => s.status === "PLANNING" || s.status === "ACTIVE");

  const setMoscow = async (taskId: string, value: Moscow | null) => {
    try {
      await updateTask.mutateAsync({ taskId, moscow: value });
    } catch {
      toast.error("Failed to update priority");
    }
  };

  const bulkSetMoscow = async (value: Moscow) => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    await Promise.all(ids.map((id) => updateTask.mutateAsync({ taskId: id, moscow: value }).catch(() => null)));
    toast.success(`${ids.length} item${ids.length === 1 ? "" : "s"} marked as ${MOSCOW_LABELS[value]}`);
    setSelected(new Set());
  };

  const bulkAssignToSprint = async (sprintId: string) => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    await Promise.all(ids.map((id) => updateTask.mutateAsync({ taskId: id, sprintId }).catch(() => null)));
    toast.success(`${ids.length} item${ids.length === 1 ? "" : "s"} moved into sprint`);
    setSelected(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(backlog.map((t: any) => t.id)));
  const clearAll = () => setSelected(new Set());

  return (
    <div className="space-y-4 max-w-[1400px]">
      <PageHeader
        title="Product Backlog"
        subtitle={project?.name ? `${backlog.length} item${backlog.length === 1 ? "" : "s"} · ${totalPoints} pts` : undefined}
        actions={
          <Link href={`/projects/${projectId}/sprint-planning`}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Target className="w-3.5 h-3.5" /> Sprint Planning
            </Button>
          </Link>
        }
      />

      {/* MoSCoW breakdown row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(["MUST", "SHOULD", "COULD", "WONT"] as Moscow[]).map((m) => {
          const { total } = backlogBreakdown[m];
          const chip = MOSCOW_CHIP[m];
          return (
            <Card key={m} className={`px-3 py-2.5 cursor-pointer transition-colors ${moscowFilter === m ? "ring-2 ring-primary" : "hover:bg-muted/20"}`}
              onClick={() => setMoscowFilter(moscowFilter === m ? "ALL" : m)}>
              <p className={`text-[10px] font-bold uppercase tracking-wider ${chip.text}`}>{MOSCOW_LABELS[m]}</p>
              <p className="text-[22px] font-bold mt-0.5" style={{ color: MOSCOW_HEX[m] }}>{total}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">items in backlog</p>
            </Card>
          );
        })}
        <Card className={`px-3 py-2.5 cursor-pointer transition-colors ${moscowFilter === "UNSET" ? "ring-2 ring-primary" : "hover:bg-muted/20"}`}
          onClick={() => setMoscowFilter(moscowFilter === "UNSET" ? "ALL" : "UNSET")}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Uncategorised</p>
          <p className="text-[22px] font-bold mt-0.5">{backlogBreakdown.UNSET.total}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">need prioritising</p>
        </Card>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-muted-foreground">Show:</span>
        {(["ALL", ...MOSCOW_VALUES, "UNSET"] as const).map((m) => {
          const isActive = moscowFilter === m;
          const chipClass = m === "ALL" || m === "UNSET"
            ? "bg-muted text-foreground"
            : `${MOSCOW_CHIP[m as Moscow].bg} ${MOSCOW_CHIP[m as Moscow].text}`;
          return (
            <button key={m}
              type="button"
              onClick={() => setMoscowFilter(m)}
              className={`px-2 py-0.5 rounded border transition-opacity ${chipClass} ${isActive ? "ring-1 ring-primary" : "opacity-60 hover:opacity-100 border-transparent"}`}
            >
              {m === "ALL" ? "All" : m === "UNSET" ? "Uncategorised" : MOSCOW_SHORT[m as Moscow]}
            </button>
          );
        })}
        {epics.length > 0 && (
          <>
            <span className="text-muted-foreground ml-3">Epic:</span>
            <select className="text-[11px] bg-transparent border border-border rounded px-2 py-0.5"
              value={epicFilter || ""}
              onChange={(e) => setEpicFilter(e.target.value || null)}>
              <option value="">All epics</option>
              {epics.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </>
        )}
      </div>

      {/* Bulk actions bar — appears only when items are selected */}
      {selected.size > 0 && (
        <Card className="bg-primary/5 border-primary/30">
          <CardContent className="py-2 flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold">{selected.size} selected</span>
            <span className="text-muted-foreground text-[11px]">·</span>
            <span className="text-[11px] text-muted-foreground">Mark as:</span>
            {MOSCOW_VALUES.map((m) => (
              <Button key={m} size="sm" variant="outline"
                onClick={() => bulkSetMoscow(m)}
                className={`h-7 text-[11px] ${MOSCOW_CHIP[m].text}`}
              >
                {MOSCOW_SHORT[m]}
              </Button>
            ))}
            {openSprints.length > 0 && (
              <>
                <span className="text-muted-foreground text-[11px] ml-2">·</span>
                <span className="text-[11px] text-muted-foreground">Move to sprint:</span>
                <select className="text-[11px] bg-transparent border border-border rounded px-2 py-0.5"
                  defaultValue=""
                  onChange={(e) => { if (e.target.value) bulkAssignToSprint(e.target.value); }}>
                  <option value="" disabled>Choose…</option>
                  {openSprints.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={clearAll} className="h-7 ml-auto">Clear</Button>
          </CardContent>
        </Card>
      )}

      {/* Backlog table */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <ListChecks className="w-4 h-4" />
            Backlog Items
          </CardTitle>
          <div className="flex items-center gap-2">
            <button onClick={selectAll} className="text-[10px] text-primary hover:underline">Select all</button>
            <span className="text-[10px] text-muted-foreground">·</span>
            <button onClick={clearAll} className="text-[10px] text-muted-foreground hover:underline">Clear</button>
          </div>
        </CardHeader>
        <CardContent>
          {backlog.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-12">
              {moscowFilter !== "ALL" || epicFilter
                ? "No items match the current filter."
                : "Product backlog is empty. New tasks added without a sprint will appear here."}
            </p>
          ) : (
            <div className="space-y-1">
              {backlog.map((task: any) => {
                const moscowKey = task.moscow as Moscow | null;
                const moscowChip = moscowKey ? MOSCOW_CHIP[moscowKey] : null;
                const isSelected = selected.has(task.id);
                return (
                  <div
                    key={task.id}
                    className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${isSelected ? "bg-primary/10" : "hover:bg-muted/30"}`}
                  >
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(task.id)} className="cursor-pointer" />
                    <button
                      type="button"
                      onClick={() => {
                        const order: (Moscow | null)[] = ["MUST", "SHOULD", "COULD", "WONT", null];
                        const idx = order.indexOf((task.moscow ?? null) as Moscow | null);
                        const next = order[(idx + 1) % order.length];
                        setMoscow(task.id, next);
                      }}
                      className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border w-16 text-center ${moscowChip ? `${moscowChip.bg} ${moscowChip.text} ${moscowChip.border}` : "bg-muted text-muted-foreground border-border opacity-50"}`}
                      title={moscowKey ? `MoSCoW: ${moscowKey} (click to cycle)` : "Click to prioritise"}
                    >
                      {moscowKey ? MOSCOW_SHORT[moscowKey] : "—"}
                    </button>
                    <Badge variant="outline" className={`text-[8px] w-12 justify-center ${
                      task.type === "bug" ? "border-red-500/30 text-red-500" :
                      task.type === "story" ? "border-blue-500/30 text-blue-500" :
                      task.type === "spike" ? "border-purple-500/30 text-purple-500" :
                      "border-border"
                    }`}>{task.type || "task"}</Badge>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{task.title}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {(task.storyPoints || 0)} pts
                        {task.epic && <> · Epic: <span className="font-semibold">{task.epic}</span></>}
                        {task.assigneeName && <> · {task.assigneeName}</>}
                      </p>
                    </div>
                    {openSprints.length > 0 && (
                      <select className="text-[10px] bg-transparent border border-border/30 rounded px-1 py-0.5"
                        defaultValue=""
                        onChange={(e) => {
                          if (!e.target.value) return;
                          updateTask.mutate({ taskId: task.id, sprintId: e.target.value });
                        }}>
                        <option value="" disabled>Move to sprint →</option>
                        {openSprints.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground text-center mt-4">
        <ArrowRight className="w-3 h-3 inline-block mr-1" />
        Items moved into a sprint appear on <Link href={`/projects/${projectId}/sprint-planning`} className="text-primary hover:underline">Sprint Planning</Link> and the <Link href={`/projects/${projectId}/sprint`} className="text-primary hover:underline">Sprint Tracker</Link>.
      </p>
    </div>
  );
}
