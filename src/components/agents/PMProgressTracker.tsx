"use client";

/**
 * PM Progress Tracker — lightweight checklist showing the agent's
 * project management overhead tasks (scaffolded tasks).
 *
 * Displayed on the agent detail page as a collapsible sidebar section.
 * Separate from delivery tasks which appear on the Agile Board/Gantt.
 */

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Circle, ChevronDown, ChevronRight, FileText, Shield, BarChart3, Users, Truck } from "lucide-react";

const CATEGORY_ICONS: Record<string, any> = {
  "Document Generation": FileText,
  "Governance & Approvals": Shield,
  "Monitoring & Control": BarChart3,
  "Stakeholder Management": Users,
  "Delivery & Execution": Truck,
};

const CATEGORY_COLORS: Record<string, string> = {
  "Document Generation": "#6366F1",
  "Governance & Approvals": "#F59E0B",
  "Monitoring & Control": "#22D3EE",
  "Stakeholder Management": "#8B5CF6",
  "Delivery & Execution": "#10B981",
};

interface PMProgressTrackerProps {
  tasks: any[];
  agentColor?: string;
}

export function PMProgressTracker({ tasks, agentColor = "#6366F1" }: PMProgressTrackerProps) {
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);

  // Group tasks by phase, then by category (parent tasks)
  const grouped = useMemo(() => {
    const phases: Record<string, {
      name: string;
      categories: Record<string, { parent: any; children: any[] }>;
      totalTasks: number;
      doneTasks: number;
    }> = {};

    // Separate parents and children
    const parents = tasks.filter(t => !t.parentId && t.description?.includes("[scaffolded] Parent"));
    const children = tasks.filter(t => t.parentId);

    for (const parent of parents) {
      const phase = parent.phaseId || "General";
      if (!phases[phase]) {
        phases[phase] = { name: phase, categories: {}, totalTasks: 0, doneTasks: 0 };
      }

      // Extract category from title: "Phase: Category" format
      const categoryMatch = parent.title.match(/:\s*(.+)/);
      const category = categoryMatch?.[1] || parent.title;

      const kids = children.filter(c => c.parentId === parent.id);
      phases[phase].categories[category] = { parent, children: kids };
      phases[phase].totalTasks += kids.length;
      phases[phase].doneTasks += kids.filter(k => k.status === "DONE" || k.progress >= 100).length;
    }

    // Also include orphan scaffolded tasks (no parent)
    const orphans = tasks.filter(t => !t.parentId && !t.description?.includes("[scaffolded] Parent") && t.description?.includes("[scaffolded]"));
    if (orphans.length > 0) {
      const phase = "Other";
      if (!phases[phase]) {
        phases[phase] = { name: phase, categories: {}, totalTasks: 0, doneTasks: 0 };
      }
      phases[phase].categories["Other Tasks"] = {
        parent: null,
        children: orphans,
      };
      phases[phase].totalTasks += orphans.length;
      phases[phase].doneTasks += orphans.filter(o => o.status === "DONE" || o.progress >= 100).length;
    }

    return phases;
  }, [tasks]);

  const totalAll = Object.values(grouped).reduce((s, p) => s + p.totalTasks, 0);
  const doneAll = Object.values(grouped).reduce((s, p) => s + p.doneTasks, 0);
  const overallPct = totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : 0;

  if (totalAll === 0) return null;

  return (
    <div className="space-y-3">
      {/* Overall progress */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">PM Progress</span>
        <span className="text-[10px] font-semibold" style={{ color: agentColor }}>{doneAll}/{totalAll} ({overallPct}%)</span>
      </div>
      <Progress value={overallPct} className="h-1.5" />

      {/* Phase sections */}
      {Object.entries(grouped).map(([phaseKey, phase]) => {
        const isExpanded = expandedPhase === phaseKey;
        const phasePct = phase.totalTasks > 0 ? Math.round((phase.doneTasks / phase.totalTasks) * 100) : 0;

        return (
          <div key={phaseKey} className="rounded-lg border border-border/30 overflow-hidden">
            {/* Phase header */}
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/20 transition-colors"
              onClick={() => setExpandedPhase(isExpanded ? null : phaseKey)}
            >
              {isExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
              <span className="text-xs font-semibold flex-1">{phase.name}</span>
              <span className="text-[9px] text-muted-foreground">{phase.doneTasks}/{phase.totalTasks}</span>
              <div className="w-12 h-1 rounded-full bg-border/30 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${phasePct}%` }} />
              </div>
            </button>

            {/* Expanded: category checklists */}
            {isExpanded && (
              <div className="px-3 pb-2 space-y-2">
                {Object.entries(phase.categories).map(([catName, { parent, children: kids }]) => {
                  const Icon = CATEGORY_ICONS[catName] || FileText;
                  const color = CATEGORY_COLORS[catName] || "#6366F1";
                  const catDone = kids.filter(k => k.status === "DONE" || k.progress >= 100).length;

                  return (
                    <div key={catName}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <Icon className="w-3 h-3" style={{ color }} />
                        <span className="text-[10px] font-semibold text-muted-foreground">{catName}</span>
                        <span className="text-[9px] text-muted-foreground ml-auto">{catDone}/{kids.length}</span>
                      </div>
                      <div className="space-y-0.5 pl-4">
                        {kids.map(task => {
                          const isDone = task.status === "DONE" || task.progress >= 100;
                          return (
                            <div key={task.id} className="flex items-center gap-2 py-0.5">
                              {isDone ? (
                                <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                              ) : (
                                <Circle className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />
                              )}
                              <span className={`text-[10px] flex-1 ${isDone ? "text-muted-foreground line-through" : "text-foreground"}`}>
                                {task.title.replace(/^Generate\s+/, "")}
                              </span>
                              {task.progress > 0 && task.progress < 100 && (
                                <span className="text-[9px] text-primary">{task.progress}%</span>
                              )}
                            </div>
                          );
                        })}
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
