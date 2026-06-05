"use client";

/**
 * Delivery Plan — stakeholder-facing roadmap view that flattens every
 * sprint into a horizontal swimlane and stacks the items by MoSCoW
 * priority. Designed for screenshots into status reports rather than
 * day-to-day management; the editing surface stays in Sprint Planning.
 *
 * Gated by methodology (Scrum / Hybrid / SAFe). On non-sprint
 * methodologies it shows a friendly empty state.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useProjectTasks, useProjectSprints, useProject } from "@/hooks/use-api";
import { methodologyFeatures } from "@/lib/methodology-definitions";
import { MOSCOW_VALUES, MOSCOW_LABELS, MOSCOW_HEX, MOSCOW_CHIP, type Moscow } from "@/lib/moscow";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { CalendarDays, Target, ArrowRight } from "lucide-react";

interface PlanTask {
  id: string;
  title: string;
  moscow: Moscow | null;
  status: string;
  storyPoints: number;
  type: string;
}

interface PlanSprint {
  id: string;
  name: string;
  goal: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  tasks: PlanTask[];
  totalPoints: number;
  donePoints: number;
  byMoscow: Record<Moscow | "UNSET", PlanTask[]>;
}

export default function DeliveryPlanPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useProject(projectId);
  const { data: apiTasks } = useProjectTasks(projectId);
  const { data: apiSprints } = useProjectSprints(projectId);

  const sprintsEnabled = useMemo(() => {
    if (!project?.methodology) return true;
    try { return methodologyFeatures(project.methodology).sprints; }
    catch { return true; }
  }, [project?.methodology]);

  const plan = useMemo<PlanSprint[]>(() => {
    const sprints = apiSprints || [];
    const tasksBySprint = new Map<string, PlanTask[]>();
    for (const t of apiTasks || []) {
      if (!t.sprintId) continue;
      const arr = tasksBySprint.get(t.sprintId) ?? [];
      arr.push({
        id: t.id,
        title: t.title || "",
        moscow: (MOSCOW_VALUES as readonly string[]).includes(t.moscow) ? (t.moscow as Moscow) : null,
        status: t.status || "TODO",
        storyPoints: t.storyPoints || 0,
        type: t.type || "task",
      });
      tasksBySprint.set(t.sprintId, arr);
    }

    return sprints
      .map((s: any) => {
        const tasks = tasksBySprint.get(s.id) ?? [];
        const totalPoints = tasks.reduce((sum, t) => sum + t.storyPoints, 0);
        const donePoints = tasks
          .filter((t) => t.status === "DONE" || t.status === "COMPLETED")
          .reduce((sum, t) => sum + t.storyPoints, 0);
        const byMoscow: Record<Moscow | "UNSET", PlanTask[]> = {
          MUST: [], SHOULD: [], COULD: [], WONT: [], UNSET: [],
        };
        for (const t of tasks) {
          const key: Moscow | "UNSET" = t.moscow ?? "UNSET";
          byMoscow[key].push(t);
        }
        return {
          id: s.id,
          name: s.name || "Sprint",
          goal: s.goal ?? null,
          status: s.status || "PLANNING",
          startDate: s.startDate ?? null,
          endDate: s.endDate ?? null,
          tasks,
          totalPoints,
          donePoints,
          byMoscow,
        } satisfies PlanSprint;
      })
      .sort((a, b) => {
        const ad = a.startDate ? new Date(a.startDate).getTime() : Number.POSITIVE_INFINITY;
        const bd = b.startDate ? new Date(b.startDate).getTime() : Number.POSITIVE_INFINITY;
        return ad - bd;
      });
  }, [apiTasks, apiSprints]);

  if (!sprintsEnabled) {
    return (
      <div className="max-w-[640px] mx-auto py-24 text-center space-y-3">
        <h1 className="text-[20px] font-bold">Delivery Plan isn&apos;t part of this methodology</h1>
        <p className="text-[13px] text-muted-foreground">
          This project is running on the <strong>{project?.methodology}</strong> methodology, which uses phase-gated delivery rather than sprint-based delivery plans. The phase-tracker view in <Link href={`/projects/${projectId}`} className="text-primary hover:underline">Project Overview</Link> is the equivalent.
        </p>
        <Link href={`/projects/${projectId}/schedule`}>
          <Button variant="default" size="sm" className="mt-2">Go to Schedule</Button>
        </Link>
      </div>
    );
  }

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
  };

  const statusColour = (s: string) => {
    if (s === "ACTIVE") return "#10B981";
    if (s === "COMPLETED") return "#64748B";
    if (s === "CANCELLED") return "#EF4444";
    return "#6366F1";
  };

  return (
    <div className="space-y-4 max-w-[1600px]">
      <PageHeader
        title="Delivery Plan"
        subtitle={`${plan.length} sprint${plan.length === 1 ? "" : "s"} planned`}
        actions={
          <Link href={`/projects/${projectId}/sprint-planning`}>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Target className="w-3.5 h-3.5" /> Edit in Sprint Planning
            </Button>
          </Link>
        }
      />

      <p className="text-[12px] text-muted-foreground">
        Stakeholder-facing roadmap. Each row is a sprint; items are stacked by MoSCoW priority so Must-haves sit at the top. Edits live in Sprint Planning + Product Backlog.
      </p>

      {plan.length === 0 ? (
        <Card>
          <CardContent className="py-24 text-center space-y-2">
            <p className="text-sm font-semibold">No sprints planned yet.</p>
            <p className="text-xs text-muted-foreground">Create a sprint and pull items from the Product Backlog to populate the delivery plan.</p>
            <div className="flex justify-center gap-2 pt-2">
              <Link href={`/projects/${projectId}/backlog`}>
                <Button variant="outline" size="sm" className="gap-1.5"><ArrowRight className="w-3.5 h-3.5" /> Product Backlog</Button>
              </Link>
              <Link href={`/projects/${projectId}/sprint-planning`}>
                <Button variant="default" size="sm" className="gap-1.5"><Target className="w-3.5 h-3.5" /> Sprint Planning</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {plan.map((sprint) => {
            const pct = sprint.totalPoints > 0 ? Math.round((sprint.donePoints / sprint.totalPoints) * 100) : 0;
            const mustCovered = sprint.byMoscow.MUST.length > 0
              ? Math.round((sprint.byMoscow.MUST.filter((t) => t.status === "DONE" || t.status === "COMPLETED").length / sprint.byMoscow.MUST.length) * 100)
              : null;
            return (
              <Card key={sprint.id}>
                <CardContent className="p-4">
                  {/* Sprint header */}
                  <div className="flex flex-wrap items-start gap-3 mb-3">
                    <div className="flex-1 min-w-[200px]">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-[14px] font-bold">{sprint.name}</h3>
                        <Badge variant="outline" className="text-[9px] uppercase tracking-wider" style={{ borderColor: `${statusColour(sprint.status)}66`, color: statusColour(sprint.status) }}>
                          {sprint.status}
                        </Badge>
                      </div>
                      {sprint.goal && <p className="text-[11px] text-muted-foreground italic">{sprint.goal}</p>}
                      <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                        <CalendarDays className="w-3 h-3" />
                        {formatDate(sprint.startDate)} → {formatDate(sprint.endDate)}
                      </p>
                    </div>
                    {/* Totals strip */}
                    <div className="flex items-center gap-4">
                      <div className="text-center">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Points</p>
                        <p className="text-[16px] font-bold">{sprint.donePoints}/{sprint.totalPoints}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Progress</p>
                        <p className="text-[16px] font-bold" style={{ color: pct >= 100 ? "#10B981" : pct >= 80 ? "#F59E0B" : "var(--foreground)" }}>{pct}%</p>
                      </div>
                      {mustCovered !== null && (
                        <div className="text-center">
                          <p className="text-[10px] uppercase tracking-wider" style={{ color: MOSCOW_HEX.MUST }}>Must coverage</p>
                          <p className="text-[16px] font-bold" style={{ color: mustCovered >= 80 ? MOSCOW_HEX.MUST : "#F59E0B" }}>{mustCovered}%</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Swimlanes by MoSCoW */}
                  {sprint.tasks.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground italic">No items committed yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {(["MUST", "SHOULD", "COULD", "WONT", "UNSET"] as (Moscow | "UNSET")[]).map((bucket) => {
                        const items = sprint.byMoscow[bucket];
                        if (items.length === 0) return null;
                        const labelColour = bucket === "UNSET" ? "#64748B" : MOSCOW_HEX[bucket as Moscow];
                        const labelText = bucket === "UNSET" ? "Uncategorised" : MOSCOW_LABELS[bucket as Moscow];
                        const chip = bucket === "UNSET" ? { bg: "bg-muted", text: "text-muted-foreground" } : MOSCOW_CHIP[bucket as Moscow];
                        return (
                          <div key={bucket} className="flex items-start gap-2">
                            <div className="w-24 flex-shrink-0 flex items-center gap-1.5 pt-0.5">
                              <div className="w-1 h-3 rounded-full" style={{ background: labelColour }} />
                              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: labelColour }}>
                                {labelText}
                              </span>
                            </div>
                            <div className="flex-1 flex flex-wrap gap-1.5">
                              {items.map((t) => {
                                const isDone = t.status === "DONE" || t.status === "COMPLETED";
                                return (
                                  <div
                                    key={t.id}
                                    className={`text-[10.5px] px-2 py-1 rounded border flex items-center gap-1.5 ${chip.bg} ${chip.text}`}
                                    title={`${t.title} (${t.storyPoints || 0} pts · ${t.status})`}
                                  >
                                    <span className={isDone ? "line-through opacity-60" : ""}>{t.title}</span>
                                    {t.storyPoints > 0 && (
                                      <span className="text-[9.5px] opacity-70">{t.storyPoints}</span>
                                    )}
                                    {isDone && <span className="text-[9px]">✓</span>}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
