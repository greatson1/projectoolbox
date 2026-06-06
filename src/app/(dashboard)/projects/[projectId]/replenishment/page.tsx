"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { parseArtefactRows, pick } from "@/lib/artefact-rows";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Repeat, AlertCircle, Sparkles, Users, Calendar, AlertTriangle } from "lucide-react";

/**
 * Kanban Replenishment Policy.
 *
 * The artefact answers four questions for each replenishment cadence:
 *   - when does it run? (cadence)
 *   - what triggers an emergency replenishment? (trigger)
 *   - who attends?  (participants)
 *   - how is priority decided? (priority rule)
 *
 * The page renders one card per cadence (often there's just one — weekly
 * — but some teams have a fast lane for Expedite items with a separate
 * cadence). A summary strip at the top shows the cadence count.
 */
export default function ReplenishmentPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);

  const artefact = useMemo(() => {
    if (!artefacts) return null;
    const matches = artefacts.filter((a: any) => {
      const n = (a.name || "").toLowerCase();
      return a.status === "APPROVED" && (n.includes("replenishment") || n.includes("backlog refresh"));
    });
    if (matches.length === 0) return null;
    return matches.sort(
      (a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0];
  }, [artefacts]);

  const cadences = useMemo(() => {
    if (!artefact?.content) return null;
    const rows = parseArtefactRows(artefact.content);
    if (rows.length === 0) return null;
    return rows.map((row) => ({
      name: pick(row, "Cadence", "Name", "Type") || "Replenishment cadence",
      schedule: pick(row, "Schedule", "Frequency", "When", "Day"),
      trigger: pick(row, "Trigger", "Buffer Trigger", "Threshold"),
      participants: pick(row, "Participants", "Attendees", "Who"),
      priorityRule: pick(row, "Priority Rule", "Priority", "Rule", "Decision"),
      duration: pick(row, "Duration", "Length"),
      notes: pick(row, "Notes", "Detail"),
    }));
  }, [artefact?.content]);

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-[1100px]">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1100px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Repeat className="w-6 h-6 text-primary" />
            Replenishment Policy
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            When and how the backlog gets refilled for <span className="font-medium text-foreground">{project?.name}</span>.
          </p>
        </div>
        {cadences && (
          <Badge variant="outline" className="text-xs">
            {cadences.length} {cadences.length === 1 ? "cadence" : "cadences"}
          </Badge>
        )}
      </div>

      {!artefact && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <h3 className="font-semibold">No approved Replenishment Policy artefact</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Without a documented Replenishment Policy, backlog refresh becomes ad-hoc and
              priority decisions become opaque. Generate the <strong>Replenishment Policy</strong>{" "}
              artefact during Setup to document the cadence and trigger.
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

      {artefact && !cadences && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            The approved Replenishment Policy artefact contains no tabular data the page can parse.
          </CardContent>
        </Card>
      )}

      {cadences && (
        <div className="space-y-3">
          {cadences.map((c, ci) => (
            <Card key={`cadence-${ci}`} className="overflow-hidden">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-semibold text-base">{c.name}</h2>
                  {c.duration && (
                    <Badge variant="outline" className="text-[10px] flex-shrink-0">
                      {c.duration}
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-border/40">
                  {c.schedule && (
                    <Field icon={Calendar} label="Schedule" value={c.schedule} />
                  )}
                  {c.trigger && (
                    <Field icon={AlertTriangle} label="Trigger" value={c.trigger} />
                  )}
                  {c.participants && (
                    <Field icon={Users} label="Participants" value={c.participants} />
                  )}
                  {c.priorityRule && (
                    <Field icon={Repeat} label="Priority decision" value={c.priorityRule} />
                  )}
                </div>
                {c.notes && (
                  <p className="text-[12px] text-muted-foreground border-t border-border/40 pt-2">
                    {c.notes}
                  </p>
                )}
              </CardContent>
            </Card>
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

function Field({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-xs mt-0.5">{value}</p>
      </div>
    </div>
  );
}
