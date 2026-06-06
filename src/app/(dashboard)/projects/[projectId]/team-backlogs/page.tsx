"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { parseArtefactRows, pick } from "@/lib/artefact-rows";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, AlertCircle, Sparkles } from "lucide-react";

/**
 * SAFe Team Backlogs view.
 *
 * SAFe enforces per-team backlogs as separate slices of the Program
 * Backlog so each team's PI commitment is auditable. The methodology
 * artefact "Team Backlogs" carries one row per story with a Team column.
 *
 * This page splits the artefact by team, shows total capacity vs.
 * commitment per team, and lets the user filter to a single team via
 * the buttons at the top.
 */
export default function TeamBacklogsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);
  const [teamFilter, setTeamFilter] = useState<string>("all");

  const artefact = useMemo(() => {
    if (!artefacts) return null;
    const matches = artefacts.filter((a: any) => {
      const n = (a.name || "").toLowerCase();
      return a.status === "APPROVED" && (n.includes("team backlog") || n.includes("team backlogs"));
    });
    if (matches.length === 0) return null;
    return matches.sort(
      (a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0];
  }, [artefacts]);

  const stories = useMemo(() => {
    if (!artefact?.content) return null;
    const rows = parseArtefactRows(artefact.content);
    if (rows.length === 0) return null;
    return rows.map((row) => ({
      team: pick(row, "Team", "ART", "Squad") || "(Unassigned)",
      story: pick(row, "Story", "Item", "User Story", "Description") || "(Untitled)",
      feature: pick(row, "Feature", "Parent Feature"),
      epic: pick(row, "Epic", "Parent Epic"),
      points: parseFloat(pick(row, "Points", "Story Points", "Pts")) || 0,
      priority: pick(row, "Priority", "Rank"),
      status: pick(row, "Status", "State"),
    }));
  }, [artefact?.content]);

  const teams = useMemo(() => {
    if (!stories) return null;
    const byTeam = new Map<string, { total: number; stories: typeof stories; capacity: number }>();
    const order: string[] = [];
    for (const s of stories) {
      if (!byTeam.has(s.team)) {
        byTeam.set(s.team, { total: 0, stories: [], capacity: 0 });
        order.push(s.team);
      }
      const entry = byTeam.get(s.team)!;
      entry.stories.push(s);
      entry.total += s.points;
    }
    return order.map((t) => ({ team: t, ...byTeam.get(t)! }));
  }, [stories]);

  const visible = useMemo(() => {
    if (!teams) return null;
    if (teamFilter === "all") return teams;
    return teams.filter((t) => t.team === teamFilter);
  }, [teams, teamFilter]);

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-[1400px]">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1400px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" />
            Team Backlogs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-team slice of the Program Backlog for <span className="font-medium text-foreground">{project?.name}</span>.
          </p>
        </div>
        {teams && (
          <Badge variant="outline" className="text-xs">
            {teams.length} {teams.length === 1 ? "team" : "teams"} ·{" "}
            {teams.reduce((s, t) => s + t.stories.length, 0)} stories
          </Badge>
        )}
      </div>

      {!artefact && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <h3 className="font-semibold">No approved Team Backlogs artefact</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              SAFe expects each team's PI commitment to be audited from its own slice of the
              Program Backlog. Generate the <strong>Team Backlogs</strong> artefact during PI
              Planning to populate this view.
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

      {artefact && !teams && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            The approved Team Backlogs artefact contains no tabular data the page can parse.
          </CardContent>
        </Card>
      )}

      {teams && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Show:</span>
            <button
              onClick={() => setTeamFilter("all")}
              className={`px-2 py-1 rounded-md border transition-colors ${teamFilter === "all" ? "border-primary text-primary" : "border-border hover:border-foreground/40"}`}
            >
              All teams
            </button>
            {teams.map((t) => (
              <button
                key={t.team}
                onClick={() => setTeamFilter(t.team)}
                className={`px-2 py-1 rounded-md border transition-colors ${teamFilter === t.team ? "border-primary text-primary" : "border-border hover:border-foreground/40"}`}
              >
                {t.team} <span className="ml-1 text-muted-foreground">({t.stories.length})</span>
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {visible?.map((t) => (
              <Card key={t.team}>
                <CardContent className="p-0">
                  <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between bg-muted/20">
                    <div>
                      <h2 className="font-semibold text-sm">{t.team}</h2>
                      <p className="text-[11px] text-muted-foreground">
                        {t.stories.length} stor{t.stories.length === 1 ? "y" : "ies"} ·{" "}
                        {t.total} {t.total === 1 ? "point" : "points"} committed
                      </p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/10 text-[11px] uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="text-left px-3 py-2">Story</th>
                          <th className="text-left px-3 py-2">Feature</th>
                          <th className="text-left px-3 py-2">Epic</th>
                          <th className="text-right px-3 py-2">Pts</th>
                          <th className="text-left px-3 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {t.stories.map((s, si) => (
                          <tr key={`${t.team}-${si}`} className="hover:bg-muted/20 transition-colors">
                            <td className="px-3 py-2 font-medium">{s.story}</td>
                            <td className="px-3 py-2 text-muted-foreground">{s.feature || "—"}</td>
                            <td className="px-3 py-2 text-muted-foreground">{s.epic || "—"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{s.points || "—"}</td>
                            <td className="px-3 py-2">
                              {s.status ? (
                                <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                                  {s.status}
                                </Badge>
                              ) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
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
