"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { parseArtefactRows, pick } from "@/lib/artefact-rows";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LayoutGrid, AlertCircle, Sparkles, ArrowRight, Milestone, Users } from "lucide-react";

/**
 * SAFe Programme Board.
 *
 * The Programme Board artefact captures the cross-team dependency web
 * established during PI Planning. Each row records a milestone /
 * feature delivery from one team, the team that owns it, the
 * iteration it lands in, and any cross-ART dependencies it has on
 * other teams.
 *
 * This view groups rows by team (swimlanes) and renders milestones
 * left-to-right by iteration. Cross-team dependencies render as text
 * with an arrow under the milestone so the user can see "Team A's
 * Login depends on Team B's Auth Gateway" without staring at the CSV.
 */

interface Milestone {
  milestone: string;
  iteration: string;
  status: string;
  notes: string;
  dependencies: string;
  type: string;
}

export default function ProgrammeBoardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);

  const artefact = useMemo(() => {
    if (!artefacts) return null;
    const matches = artefacts.filter((a: any) => {
      const n = (a.name || "").toLowerCase();
      return (
        a.status === "APPROVED" &&
        (n.includes("programme board") || n.includes("program board") || n.includes("pi programme board") || n.includes("pi program board"))
      );
    });
    if (matches.length === 0) return null;
    return matches.sort(
      (a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0];
  }, [artefacts]);

  const board = useMemo(() => {
    if (!artefact?.content) return null;
    const rows = parseArtefactRows(artefact.content);
    if (rows.length === 0) return null;

    const byTeam = new Map<string, Map<string, Milestone[]>>();
    const teams: string[] = [];
    const iterationsSet = new Set<string>();

    for (const row of rows) {
      const team = pick(row, "Team", "ART", "Owner", "Squad") || "(Unassigned)";
      const iteration = pick(row, "Iteration", "Sprint", "PI Iteration", "When") || "Unscheduled";
      const m: Milestone = {
        milestone: pick(row, "Milestone", "Feature", "Deliverable", "Item", "Name") || "(Untitled)",
        iteration,
        status: pick(row, "Status", "State"),
        notes: pick(row, "Notes", "Detail", "Description"),
        dependencies: pick(row, "Dependencies", "Depends On", "Depends"),
        type: pick(row, "Type", "Category") || "feature",
      };
      iterationsSet.add(iteration);
      if (!byTeam.has(team)) {
        byTeam.set(team, new Map());
        teams.push(team);
      }
      const teamMap = byTeam.get(team)!;
      if (!teamMap.has(iteration)) teamMap.set(iteration, []);
      teamMap.get(iteration)!.push(m);
    }

    // Iteration ordering — numeric first ("Iteration 1", "Iteration 2"),
    // alphabetical fallback. Unscheduled lands at the end.
    const iterations = Array.from(iterationsSet).sort((a, b) => {
      if (a === "Unscheduled") return 1;
      if (b === "Unscheduled") return -1;
      const na = parseInt(a.replace(/\D/g, ""), 10);
      const nb = parseInt(b.replace(/\D/g, ""), 10);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.localeCompare(b);
    });

    return { teams, iterations, byTeam };
  }, [artefact?.content]);

  const totals = useMemo(() => {
    if (!board) return { teams: 0, iterations: 0, milestones: 0, withDeps: 0 };
    let milestones = 0;
    let withDeps = 0;
    for (const team of board.teams) {
      const teamMap = board.byTeam.get(team)!;
      for (const its of teamMap.values()) {
        milestones += its.length;
        withDeps += its.filter((m) => m.dependencies).length;
      }
    }
    return { teams: board.teams.length, iterations: board.iterations.length, milestones, withDeps };
  }, [board]);

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-[1700px]">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1700px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <LayoutGrid className="w-6 h-6 text-primary" />
            Programme Board
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cross-team dependency board for <span className="font-medium text-foreground">{project?.name}</span>.
            Milestones land left to right; teams stack as swimlanes.
          </p>
        </div>
        {board && (
          <div className="flex flex-wrap gap-2 justify-end">
            <Badge variant="outline" className="text-xs">{totals.teams} teams</Badge>
            <Badge variant="outline" className="text-xs">{totals.iterations} iterations</Badge>
            <Badge variant="outline" className="text-xs">{totals.milestones} milestones</Badge>
            {totals.withDeps > 0 && (
              <Badge variant="outline" className="text-xs">{totals.withDeps} with deps</Badge>
            )}
          </div>
        )}
      </div>

      {!artefact && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <h3 className="font-semibold">No approved Programme Board artefact</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              The Programme Board records cross-team dependencies established during PI Planning.
              Generate the <strong>Programme Board</strong> artefact during PI Planning to populate
              this view.
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

      {artefact && !board && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            The approved Programme Board artefact contains no tabular data the page can parse.
          </CardContent>
        </Card>
      )}

      {board && (
        <Card className="overflow-hidden">
          <CardContent className="p-0 overflow-x-auto">
            <div className="min-w-[900px]">
              {/* Column header (iterations) */}
              <div
                className="grid border-b border-border/40 bg-muted/30"
                style={{ gridTemplateColumns: `200px repeat(${board.iterations.length}, minmax(180px, 1fr))` }}
              >
                <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-bold border-r border-border/40">
                  Team
                </div>
                {board.iterations.map((it) => (
                  <div
                    key={it}
                    className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground font-bold border-r border-border/40 last:border-r-0"
                  >
                    {it}
                  </div>
                ))}
              </div>

              {/* Team rows */}
              {board.teams.map((team) => {
                const teamMap = board.byTeam.get(team)!;
                return (
                  <div
                    key={team}
                    className="grid border-b border-border/30 last:border-b-0"
                    style={{ gridTemplateColumns: `200px repeat(${board.iterations.length}, minmax(180px, 1fr))` }}
                  >
                    <div className="px-3 py-3 border-r border-border/40 bg-muted/10 flex items-start gap-2">
                      <Users className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />
                      <p className="text-xs font-semibold leading-tight">{team}</p>
                    </div>
                    {board.iterations.map((it) => {
                      const milestones = teamMap.get(it) || [];
                      return (
                        <div
                          key={`${team}-${it}`}
                          className="px-2 py-2 border-r border-border/30 last:border-r-0 space-y-1.5 min-h-[80px]"
                        >
                          {milestones.length === 0 ? (
                            <div className="h-full" />
                          ) : (
                            milestones.map((m, mi) => (
                              <div
                                key={`${team}-${it}-${mi}`}
                                className="rounded-md border border-border/60 bg-card p-2 space-y-1"
                              >
                                <div className="flex items-start gap-1.5">
                                  <Milestone className="w-3 h-3 text-primary flex-shrink-0 mt-0.5" />
                                  <p className="text-[11px] font-medium leading-tight">{m.milestone}</p>
                                </div>
                                {m.notes && (
                                  <p className="text-[10px] text-muted-foreground leading-snug">{m.notes}</p>
                                )}
                                <div className="flex flex-wrap gap-1">
                                  {m.status && (
                                    <Badge variant="outline" className="text-[9px] uppercase tracking-wider">
                                      {m.status}
                                    </Badge>
                                  )}
                                  {m.type && m.type.toLowerCase() !== "feature" && (
                                    <Badge variant="outline" className="text-[9px]">
                                      {m.type}
                                    </Badge>
                                  )}
                                </div>
                                {m.dependencies && (
                                  <div className="flex items-start gap-1 pt-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                                    <ArrowRight className="w-3 h-3 flex-shrink-0 mt-0.5" />
                                    <span className="leading-snug">{m.dependencies}</span>
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
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
