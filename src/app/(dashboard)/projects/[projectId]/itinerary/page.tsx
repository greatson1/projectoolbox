"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { parseArtefactRows, pick } from "@/lib/artefact-rows";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, AlertCircle, Sparkles, MapPin, Clock, CheckCircle2 } from "lucide-react";

/**
 * Travel Itinerary view.
 *
 * Renders the trip's "Itinerary" artefact as a stack of day cards with
 * one row per scheduled activity / booking. Falls back to listing rows
 * in order when the artefact doesn't carry a Day / Date column.
 *
 * Accepts a CSV with at minimum: Day or Date, Activity (or Item / Event).
 * Optional: Time, Location, Confirmation, Notes, Status.
 */
export default function ItineraryPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);

  const artefact = useMemo(() => {
    if (!artefacts) return null;
    const matches = artefacts.filter((a: any) => {
      const n = (a.name || "").toLowerCase();
      return (
        a.status === "APPROVED" &&
        (n.includes("itinerary") || n.includes("trip schedule") || n.includes("trip itinerary"))
      );
    });
    if (matches.length === 0) return null;
    return matches.sort(
      (a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0];
  }, [artefacts]);

  const days = useMemo(() => {
    if (!artefact?.content) return null;
    const rows = parseArtefactRows(artefact.content);
    if (rows.length === 0) return null;

    type Entry = {
      time: string;
      activity: string;
      location: string;
      confirmation: string;
      notes: string;
      status: string;
    };
    const byDay = new Map<string, Entry[]>();
    const dayOrder: string[] = [];
    let unlabelledCounter = 0;
    for (const row of rows) {
      let day = pick(row, "Day", "Date") || pick(row, "Day Number");
      if (!day) {
        unlabelledCounter++;
        day = `Day ${unlabelledCounter}`;
      }
      const entry: Entry = {
        time: pick(row, "Time", "When"),
        activity: pick(row, "Activity", "Event", "Item", "Description") || "(Untitled)",
        location: pick(row, "Location", "Where", "Place"),
        confirmation: pick(row, "Confirmation", "Booking Ref", "Reference"),
        notes: pick(row, "Notes", "Detail", "Comment"),
        status: pick(row, "Status", "State"),
      };
      if (!byDay.has(day)) {
        byDay.set(day, []);
        dayOrder.push(day);
      }
      byDay.get(day)!.push(entry);
    }
    return dayOrder.map((day) => ({ day, entries: byDay.get(day)! }));
  }, [artefact?.content]);

  const totalEntries = useMemo(() => {
    if (!days) return 0;
    return days.reduce((s, d) => s + d.entries.length, 0);
  }, [days]);

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-[1100px]">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1100px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-primary" />
            Itinerary
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Day-by-day plan for <span className="font-medium text-foreground">{project?.name}</span>.
          </p>
        </div>
        {days && (
          <div className="flex gap-2">
            <Badge variant="outline" className="text-xs">
              {days.length} {days.length === 1 ? "day" : "days"}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {totalEntries} {totalEntries === 1 ? "entry" : "entries"}
            </Badge>
          </div>
        )}
      </div>

      {!artefact && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <h3 className="font-semibold">No approved Itinerary artefact</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              The trip Itinerary lays out the day-by-day plan. Generate it during the Plan or
              Book phase to populate this view.
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

      {artefact && !days && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            The approved Itinerary artefact contains no tabular data the page can parse.
            <Link href={`/projects/${projectId}/artefacts`} className="ml-1 text-primary hover:underline">
              Open it to inspect or regenerate
            </Link>
            .
          </CardContent>
        </Card>
      )}

      {days && days.length > 0 && (
        <div className="space-y-3">
          {days.map((d, di) => (
            <Card key={`day-${di}`} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="px-4 py-2.5 border-b border-border/40 bg-muted/20 flex items-center justify-between">
                  <h2 className="font-semibold text-sm">{d.day}</h2>
                  <Badge variant="outline" className="text-[10px]">
                    {d.entries.length} {d.entries.length === 1 ? "entry" : "entries"}
                  </Badge>
                </div>
                <ul className="divide-y divide-border/30">
                  {d.entries.map((entry, ei) => (
                    <li key={`entry-${di}-${ei}`} className="px-4 py-3 flex gap-3">
                      <div className="flex flex-col items-end min-w-[60px] text-[11px] text-muted-foreground flex-shrink-0">
                        {entry.time ? (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {entry.time}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="text-sm font-medium leading-snug">{entry.activity}</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          {entry.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {entry.location}
                            </span>
                          )}
                          {entry.confirmation && (
                            <span className="flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              {entry.confirmation}
                            </span>
                          )}
                          {entry.status && (
                            <Badge variant="outline" className="text-[9px] uppercase tracking-wider">
                              {entry.status}
                            </Badge>
                          )}
                        </div>
                        {entry.notes && (
                          <p className="text-[11px] text-muted-foreground/90 leading-snug">{entry.notes}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
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
