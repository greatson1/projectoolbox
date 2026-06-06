"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { parseArtefactRows, pick } from "@/lib/artefact-rows";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Map as MapIcon, AlertCircle, Sparkles, ChevronRight } from "lucide-react";

/**
 * SAFe Roadmap view.
 *
 * Renders the multi-PI horizon as a column-per-PI strip with epics
 * placed under the PI they're scheduled for. Lets a team see beyond the
 * current PI without rereading the document.
 *
 * Accepts a CSV with at minimum: PI, Epic. Optional: Description,
 * Owner / ART, Dependencies, Target Date, Status.
 */
export default function RoadmapPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);

  const artefact = useMemo(() => {
    if (!artefacts) return null;
    const matches = artefacts.filter((a: any) => {
      const n = (a.name || "").toLowerCase();
      return a.status === "APPROVED" && n.includes("roadmap");
    });
    if (matches.length === 0) return null;
    return matches.sort(
      (a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0];
  }, [artefacts]);

  const groups = useMemo(() => {
    if (!artefact?.content) return null;
    const rows = parseArtefactRows(artefact.content);
    if (rows.length === 0) return null;

    type Epic = {
      name: string;
      description: string;
      owner: string;
      targetDate: string;
      status: string;
      dependencies: string;
    };
    const byPi = new Map<string, Epic[]>();
    const piOrder: string[] = [];
    for (const row of rows) {
      const pi = pick(row, "PI", "Programme Increment", "Program Increment", "Quarter", "Q") || "Unscheduled";
      const epic: Epic = {
        name: pick(row, "Epic", "Item", "Initiative", "Theme") || "(Untitled)",
        description: pick(row, "Description", "Goal", "Outcome"),
        owner: pick(row, "Owner", "ART", "Team", "Owner / ART"),
        targetDate: pick(row, "Target Date", "Due", "Delivery"),
        status: pick(row, "Status", "State"),
        dependencies: pick(row, "Dependencies", "Depends On"),
      };
      if (!byPi.has(pi)) {
        byPi.set(pi, []);
        piOrder.push(pi);
      }
      byPi.get(pi)!.push(epic);
    }
    // Stable PI ordering — try "PI 1", "PI 2", "PI 3" sort, fallback to first-seen order.
    piOrder.sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, ""), 10);
      const nb = parseInt(b.replace(/\D/g, ""), 10);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return 0;
    });
    return piOrder.map((pi) => ({ pi, epics: byPi.get(pi)! }));
  }, [artefact?.content]);

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-[1600px]">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1600px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MapIcon className="w-6 h-6 text-primary" />
            Roadmap
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Multi-PI horizon for <span className="font-medium text-foreground">{project?.name}</span>.
            Plan beyond the current PI.
          </p>
        </div>
        {groups && (
          <Badge variant="outline" className="text-xs">
            {groups.length} {groups.length === 1 ? "PI" : "PIs"} planned
          </Badge>
        )}
      </div>

      {!artefact && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <h3 className="font-semibold">No approved Roadmap artefact</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              The Roadmap covers a multi-PI horizon so teams can see what's coming after the
              current PI. Generate the <strong>Roadmap</strong> artefact during PI Planning to
              populate this view.
            </p>
            <Link
              href={`/projects/${projectId}/artefacts`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Open Artefacts
            </Link>
          </CardContent>
        </Card>
      )}

      {artefact && !groups && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            The approved Roadmap artefact contains no tabular data the page can parse.
            <Link href={`/projects/${projectId}/artefacts`} className="ml-1 text-primary hover:underline">
              Open it to inspect or regenerate
            </Link>
            .
          </CardContent>
        </Card>
      )}

      {groups && groups.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {groups.map((group) => (
            <div key={group.pi} className="min-w-[260px] flex-1 max-w-[320px]">
              <div className="rounded-t-xl border border-border bg-card px-3 py-2 flex items-center justify-between">
                <h2 className="text-sm font-bold">{group.pi}</h2>
                <Badge variant="outline" className="text-[10px]">
                  {group.epics.length}
                </Badge>
              </div>
              <div className="rounded-b-xl border-x border-b border-border bg-muted/10 p-2 space-y-2 min-h-[100px]">
                {group.epics.map((epic, ei) => (
                  <div
                    key={`${group.pi}-${ei}`}
                    className="rounded-lg border border-border/60 bg-card p-3 space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-xs font-semibold leading-tight">{epic.name}</h3>
                      {epic.status && (
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground flex-shrink-0">
                          {epic.status}
                        </span>
                      )}
                    </div>
                    {epic.description && (
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        {epic.description}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {epic.owner && (
                        <Badge variant="outline" className="text-[9px]">
                          {epic.owner}
                        </Badge>
                      )}
                      {epic.targetDate && (
                        <Badge variant="outline" className="text-[9px]">
                          {epic.targetDate}
                        </Badge>
                      )}
                    </div>
                    {epic.dependencies && (
                      <div className="flex items-start gap-1 pt-1 text-[10px] text-muted-foreground/80">
                        <ChevronRight className="w-3 h-3 flex-shrink-0 mt-0.5" />
                        <span>Depends on: {epic.dependencies}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {artefact && (
        <p className="text-[10px] text-muted-foreground/70 text-right">
          Source:{" "}
          <Link href={`/projects/${projectId}/artefacts`} className="underline hover:text-foreground">
            {artefact.name}
          </Link>
          {" · "}
          updated {new Date(artefact.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </p>
      )}
    </div>
  );
}
