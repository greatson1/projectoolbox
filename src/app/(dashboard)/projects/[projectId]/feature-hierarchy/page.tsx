"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { parseArtefactRows, pick } from "@/lib/artefact-rows";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Layers, ChevronRight, ChevronDown, FileText, AlertCircle, Sparkles } from "lucide-react";

/**
 * SAFe Feature Hierarchy view.
 *
 * The artefact captures Epic → Feature → Story decomposition — SAFe's
 * structural backbone. Reading it as a flat CSV makes the trace harder
 * than necessary, so this page renders it as a collapsible tree and
 * shows row counts at each level.
 *
 * Source artefact is matched fuzzy by name (the methodology defines
 * "Feature Hierarchy" but Sonnet has been known to append " - <project>"
 * or "Epic Decomposition"). We grab the latest APPROVED match.
 */
export default function FeatureHierarchyPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const artefact = useMemo(() => {
    if (!artefacts) return null;
    const matches = artefacts.filter((a: any) => {
      const n = (a.name || "").toLowerCase();
      return (
        a.status === "APPROVED" &&
        (n.includes("feature hierarchy") ||
          n.includes("epic decomposition") ||
          n.includes("feature decomposition"))
      );
    });
    if (matches.length === 0) return null;
    // Latest updated wins.
    return matches.sort(
      (a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0];
  }, [artefacts]);

  const tree = useMemo(() => {
    if (!artefact?.content) return null;
    const rows = parseArtefactRows(artefact.content);
    if (rows.length === 0) return null;

    type Story = { name: string; points: string; status: string };
    type Feature = { name: string; description: string; stories: Story[] };
    type Epic = { name: string; description: string; features: Map<string, Feature> };

    const epics = new Map<string, Epic>();
    for (const row of rows) {
      const epicName = pick(row, "Epic", "Epic Name", "Theme") || "(Unassigned Epic)";
      const featureName = pick(row, "Feature", "Feature Name") || "(Unassigned Feature)";
      const storyName = pick(row, "Story", "User Story", "Item");
      const epicDesc = pick(row, "Epic Description", "Epic Goal");
      const featureDesc = pick(row, "Feature Description", "Feature Goal", "Acceptance");
      const points = pick(row, "Story Points", "Points", "Pts");
      const status = pick(row, "Status", "State");

      let epic = epics.get(epicName);
      if (!epic) {
        epic = { name: epicName, description: epicDesc, features: new Map() };
        epics.set(epicName, epic);
      } else if (epicDesc && !epic.description) {
        epic.description = epicDesc;
      }

      let feature = epic.features.get(featureName);
      if (!feature) {
        feature = { name: featureName, description: featureDesc, stories: [] };
        epic.features.set(featureName, feature);
      } else if (featureDesc && !feature.description) {
        feature.description = featureDesc;
      }

      if (storyName) {
        feature.stories.push({ name: storyName, points, status });
      }
    }
    return Array.from(epics.values()).map((e) => ({
      ...e,
      features: Array.from(e.features.values()),
    }));
  }, [artefact?.content]);

  const totals = useMemo(() => {
    if (!tree) return { epics: 0, features: 0, stories: 0 };
    return tree.reduce(
      (acc, e) => ({
        epics: acc.epics + 1,
        features: acc.features + e.features.length,
        stories: acc.stories + e.features.reduce((s, f) => s + f.stories.length, 0),
      }),
      { epics: 0, features: 0, stories: 0 },
    );
  }, [tree]);

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-[1200px]">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1200px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="w-6 h-6 text-primary" />
            Feature Hierarchy
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Epic → Feature → Story decomposition for <span className="font-medium text-foreground">{project?.name}</span>.
            Every story should trace upward.
          </p>
        </div>
        {tree && (
          <div className="flex gap-2">
            <Badge variant="outline" className="text-xs">
              {totals.epics} {totals.epics === 1 ? "Epic" : "Epics"}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {totals.features} {totals.features === 1 ? "Feature" : "Features"}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {totals.stories} {totals.stories === 1 ? "Story" : "Stories"}
            </Badge>
          </div>
        )}
      </div>

      {!artefact && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <h3 className="font-semibold">No approved Feature Hierarchy artefact</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              SAFe organises work as Epic → Feature → Story. Generate the{" "}
              <strong>Feature Hierarchy</strong> artefact during PI Planning to populate
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

      {artefact && !tree && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            The approved Feature Hierarchy artefact contains no tabular data the page can parse.
            <Link
              href={`/projects/${projectId}/artefacts`}
              className="ml-1 text-primary hover:underline"
            >
              Open it to inspect or regenerate
            </Link>
            .
          </CardContent>
        </Card>
      )}

      {tree && tree.length > 0 && (
        <div className="space-y-3">
          {tree.map((epic, ei) => {
            const epicKey = `epic-${ei}`;
            const epicCollapsed = collapsed[epicKey];
            const epicStoryCount = epic.features.reduce((s, f) => s + f.stories.length, 0);
            return (
              <Card key={epicKey} className="overflow-hidden">
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [epicKey]: !c[epicKey] }))}
                  className="w-full flex items-start gap-3 p-4 hover:bg-muted/40 transition-colors text-left"
                >
                  {epicCollapsed ? (
                    <ChevronRight className="w-4 h-4 text-muted-foreground mt-1 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground mt-1 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">Epic</span>
                      <h2 className="font-semibold text-base truncate">{epic.name}</h2>
                    </div>
                    {epic.description && (
                      <p className="text-xs text-muted-foreground mt-1">{epic.description}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-0.5 text-[10px] text-muted-foreground flex-shrink-0">
                    <span>{epic.features.length} features</span>
                    <span>{epicStoryCount} stories</span>
                  </div>
                </button>
                {!epicCollapsed && (
                  <div className="border-t border-border/40 px-4 py-3 space-y-3 bg-muted/10">
                    {epic.features.map((feature, fi) => {
                      const featureKey = `feature-${ei}-${fi}`;
                      const featureCollapsed = collapsed[featureKey];
                      return (
                        <div key={featureKey} className="border border-border/60 rounded-lg bg-card">
                          <button
                            onClick={() => setCollapsed((c) => ({ ...c, [featureKey]: !c[featureKey] }))}
                            className="w-full flex items-start gap-2 p-3 hover:bg-muted/30 transition-colors text-left"
                          >
                            {featureCollapsed ? (
                              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-600 dark:text-cyan-400">Feature</span>
                                <h3 className="text-sm font-semibold truncate">{feature.name}</h3>
                              </div>
                              {feature.description && (
                                <p className="text-[11px] text-muted-foreground mt-0.5">{feature.description}</p>
                              )}
                            </div>
                            <Badge variant="outline" className="text-[10px] flex-shrink-0">
                              {feature.stories.length} {feature.stories.length === 1 ? "story" : "stories"}
                            </Badge>
                          </button>
                          {!featureCollapsed && feature.stories.length > 0 && (
                            <ul className="border-t border-border/40 px-3 py-2 space-y-1">
                              {feature.stories.map((story, si) => (
                                <li
                                  key={`story-${ei}-${fi}-${si}`}
                                  className="flex items-center gap-2 text-xs py-1"
                                >
                                  <FileText className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                                  <span className="flex-1 truncate">{story.name}</span>
                                  {story.points && (
                                    <Badge variant="outline" className="text-[9px]">
                                      {story.points} pts
                                    </Badge>
                                  )}
                                  {story.status && (
                                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                                      {story.status}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {artefact && (
        <p className="text-[10px] text-muted-foreground/70 text-right">
          Source: <Link href={`/projects/${projectId}/artefacts`} className="underline hover:text-foreground">{artefact.name}</Link>
          {" · "}
          updated {new Date(artefact.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </p>
      )}
    </div>
  );
}
