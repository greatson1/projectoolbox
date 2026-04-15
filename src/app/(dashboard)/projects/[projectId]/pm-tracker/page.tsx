"use client";

import { useParams } from "next/navigation";
import { usePMTasks, useProject } from "@/hooks/use-api";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PMProgressTracker } from "@/components/agents/PMProgressTracker";
import { ClipboardCheck } from "lucide-react";

/**
 * PM Tracker — dedicated page showing the agent's project management
 * overhead tasks as a visual progress dashboard.
 *
 * Separate from delivery tasks (Agile Board, Schedule, Sprint Planning).
 * Shows: artefact generation progress, governance gates, monitoring tasks.
 */

export default function PMTrackerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: pmTasks, isLoading } = usePMTasks(projectId);
  const { data: project } = useProject(projectId);

  if (isLoading) return (
    <div className="space-y-4 max-w-[800px]">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );

  const agentColor = project?.agents?.[0]?.agent?.gradient?.match(/#[0-9A-Fa-f]{6}/)?.[0] || "#6366F1";

  return (
    <div className="space-y-6 max-w-[800px]">
      <div className="flex items-center gap-3">
        <ClipboardCheck className="w-5 h-5 text-primary" />
        <div>
          <h1 className="text-lg font-bold">PM Tracker</h1>
          <p className="text-xs text-muted-foreground">Agent's project management progress — artefact generation, governance, monitoring</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-5">
          {!pmTasks || pmTasks.length === 0 ? (
            <div className="text-center py-12">
              <ClipboardCheck className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm font-medium text-muted-foreground mb-1">No PM tasks yet</p>
              <p className="text-xs text-muted-foreground/60">PM tasks are created automatically when the agent is deployed and starts generating artefacts.</p>
            </div>
          ) : (
            <PMProgressTracker tasks={pmTasks} agentColor={agentColor} />
          )}
        </CardContent>
      </Card>

      <p className="text-[10px] text-muted-foreground text-center">
        These are the agent's internal project management tasks — artefact generation, phase gates, and monitoring activities.
        Delivery tasks (the actual project work) are on the <a href="schedule" className="text-primary hover:underline">Schedule</a> and <a href="agile" className="text-primary hover:underline">Agile Board</a>.
      </p>
    </div>
  );
}
