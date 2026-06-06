"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { parseArtefactRows, pick } from "@/lib/artefact-rows";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, AlertCircle, Sparkles, MapPin, AlertTriangle } from "lucide-react";

/**
 * Travel Log view.
 *
 * Renders the Travel Log artefact as one card per dated entry — where the
 * traveller was, what happened, expenses and incidents in context. Most
 * relevant during and after the Travel phase as a daily record.
 */
export default function TravelLogPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);

  const artefact = useMemo(() => {
    if (!artefacts) return null;
    const matches = artefacts.filter((a: any) => {
      const n = (a.name || "").toLowerCase();
      return a.status === "APPROVED" && (n.includes("travel log") || n.includes("trip log") || n.includes("daily log"));
    });
    if (matches.length === 0) return null;
    return matches.sort(
      (a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0];
  }, [artefacts]);

  const entries = useMemo(() => {
    if (!artefact?.content) return null;
    const rows = parseArtefactRows(artefact.content);
    if (rows.length === 0) return null;
    return rows.map((row) => ({
      date: pick(row, "Date", "Day") || "",
      location: pick(row, "Location", "Where", "Place"),
      summary: pick(row, "Summary", "Notes", "Entry", "Description", "Activity") || "(no entry)",
      highlights: pick(row, "Highlights", "Highlight"),
      expenses: pick(row, "Expenses", "Spend", "Cost"),
      incidents: pick(row, "Incidents", "Issues", "Problems"),
      contacts: pick(row, "Contacts", "Check-in"),
    }));
  }, [artefact?.content]);

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-[1000px]">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1000px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-primary" />
            Travel Log
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Daily entries for <span className="font-medium text-foreground">{project?.name}</span>.
          </p>
        </div>
        {entries && (
          <Badge variant="outline" className="text-xs">
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </Badge>
        )}
      </div>

      {!artefact && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <h3 className="font-semibold">No approved Travel Log artefact</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              The Travel Log is updated through the trip — generate or update it during the
              Travel phase to populate this view.
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

      {artefact && !entries && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            The approved Travel Log artefact contains no tabular data the page can parse.
          </CardContent>
        </Card>
      )}

      {entries && (
        <div className="space-y-3">
          {entries.map((e, i) => (
            <Card key={`entry-${i}`} className="overflow-hidden">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {e.date && <span className="font-semibold text-foreground">{e.date}</span>}
                    {e.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {e.location}
                      </span>
                    )}
                  </div>
                  {e.incidents && (
                    <Badge variant="outline" className="text-[10px] flex items-center gap-1 border-amber-500/40 text-amber-600">
                      <AlertTriangle className="w-3 h-3" />
                      Incident
                    </Badge>
                  )}
                </div>
                <p className="text-sm leading-relaxed">{e.summary}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground pt-1">
                  {e.highlights && (
                    <span>
                      <span className="font-medium text-foreground/80">Highlights:</span> {e.highlights}
                    </span>
                  )}
                  {e.expenses && (
                    <span>
                      <span className="font-medium text-foreground/80">Spend:</span> {e.expenses}
                    </span>
                  )}
                  {e.incidents && (
                    <span>
                      <span className="font-medium text-amber-600 dark:text-amber-400">Incidents:</span> {e.incidents}
                    </span>
                  )}
                  {e.contacts && (
                    <span>
                      <span className="font-medium text-foreground/80">Contacts:</span> {e.contacts}
                    </span>
                  )}
                </div>
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
