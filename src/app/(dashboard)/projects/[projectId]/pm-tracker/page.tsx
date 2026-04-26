"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { PhasePlanTracker } from "@/components/agents/PhasePlanTracker";
import { ClipboardCheck, AlertCircle } from "lucide-react";

/**
 * PM Tracker — per-phase plan view.
 *
 * Each methodology phase is shown expanded with its required artefacts,
 * scaffolded PM tasks, gate criteria, and per-prerequisite evaluation
 * (✓ met / ✗ unmet / draft / manual). Replaces the legacy collapsible
 * task tracker so users can see at a glance what every phase needs and
 * what's blocking advancement.
 *
 * Delivery tasks (the actual project work) live on the Agile Board /
 * Schedule pages — this page is for PM overhead only.
 */

export default function PMTrackerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    fetch(`/api/projects/${projectId}/phase-tracker`)
      .then(r => r.json())
      .then(j => {
        if (j.error) setError(j.error);
        else setData(j.data);
      })
      .catch(() => setError("Could not load phase tracker"))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return (
    <div className="space-y-4 max-w-[1000px]">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );

  if (error) return (
    <div className="max-w-[1000px] flex items-start gap-3 p-4 rounded-xl border border-red-500/30 bg-red-500/5">
      <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-red-600 dark:text-red-400">Could not load phase tracker</p>
        <p className="text-xs text-muted-foreground mt-1">{error}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-5 max-w-[1000px]">
      <div className="flex items-center gap-3">
        <ClipboardCheck className="w-5 h-5 text-primary" />
        <div>
          <h1 className="text-lg font-bold">PM Tracker</h1>
          <p className="text-xs text-muted-foreground">Per-phase plan — artefacts, PM tasks, gate criteria, and prerequisites for advancement.</p>
        </div>
      </div>

      {data && data.phases?.length > 0 ? (
        <PhasePlanTracker data={data} projectId={projectId} />
      ) : (
        <div className="text-center py-12 rounded-xl border border-border/40 bg-card">
          <ClipboardCheck className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground mb-1">No phases yet</p>
          <p className="text-xs text-muted-foreground/60">Phases are created when the agent is deployed.</p>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground text-center">
        Delivery tasks (the actual project work) are on the <a href="schedule" className="text-primary hover:underline">Schedule</a> and <a href="agile" className="text-primary hover:underline">Agile Board</a>.
      </p>
    </div>
  );
}
