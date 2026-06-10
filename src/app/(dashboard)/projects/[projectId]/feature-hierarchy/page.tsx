"use client";

import { useState, useMemo, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectArtefacts, useProject, useUpdateArtefact } from "@/hooks/use-api";
import { parseArtefactTable, serializeArtefactTable, pickHeader, type ArtefactRow, type ArtefactTable } from "@/lib/artefact-rows";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Layers, ChevronRight, ChevronDown, FileText, AlertCircle, Sparkles, Plus, X } from "lucide-react";

function pickValue(row: ArtefactRow, ...candidates: string[]): string {
  for (const c of candidates) {
    const target = c.toLowerCase().replace(/[_\s]/g, "");
    for (const k of Object.keys(row)) {
      if (k.toLowerCase().replace(/[_\s]/g, "") === target) {
        const v = row[k];
        if (v && v.trim()) return v.trim();
      }
    }
  }
  return "";
}

/**
 * SAFe Feature Hierarchy with inline story addition.
 *
 * Reads the approved Feature Hierarchy artefact and renders Epic →
 * Feature → Story as a collapsible tree. Under any feature, the user
 * can click "+ Add Story" to insert a new row in the artefact CSV with
 * the same Epic + Feature values prefilled. The new story round-trips
 * straight to the artefact via PATCH; subsequent renders see it.
 *
 * Optimistic updates: the new row appears immediately in the tree
 * while the PATCH is in flight; failures roll back and toast the error.
 */
export default function FeatureHierarchyPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);
  const updateArtefact = useUpdateArtefact();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newStory, setNewStory] = useState({ name: "", points: "" });

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
    return matches.sort(
      (a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0];
  }, [artefacts]);

  const [table, setTable] = useState<ArtefactTable | null>(null);
  useEffect(() => {
    setTable(artefact ? parseArtefactTable(artefact.content) : null);
  }, [artefact?.id, artefact?.content]);

  // Canonical header names — used for both reading and writing. Pick
  // the actual header name from the table when one exists so the writes
  // hit the same column we're already reading.
  const headers = useMemo(() => {
    if (!table) return null;
    return {
      epic: pickHeader(table.headers, "Epic Name", "Epic", "Theme"),
      feature: pickHeader(table.headers, "Feature Name", "Feature"),
      story: pickHeader(table.headers, "User Story", "Story", "Item"),
      points: pickHeader(table.headers, "Story Points", "Points", "Pts"),
      status: pickHeader(table.headers, "Status", "State"),
    };
  }, [table]);

  const tree = useMemo(() => {
    if (!table) return null;

    type Story = { name: string; points: string; status: string };
    type Feature = { name: string; description: string; stories: Story[] };
    type Epic = { name: string; description: string; features: Map<string, Feature> };

    const epics = new Map<string, Epic>();
    for (const row of table.rows) {
      const epicName = pickValue(row, "Epic", "Epic Name", "Theme") || "(Unassigned Epic)";
      const featureName = pickValue(row, "Feature", "Feature Name") || "(Unassigned Feature)";
      const storyName = pickValue(row, "Story", "User Story", "Item");
      const epicDesc = pickValue(row, "Epic Description", "Epic Goal");
      const featureDesc = pickValue(row, "Feature Description", "Feature Goal", "Acceptance");
      const points = pickValue(row, "Story Points", "Points", "Pts");
      const status = pickValue(row, "Status", "State");

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
  }, [table]);

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

  const openAddForm = (epicName: string, featureName: string) => {
    setAddingTo(`${epicName}|||${featureName}`);
    setNewStory({ name: "", points: "" });
  };
  const closeAddForm = () => {
    setAddingTo(null);
    setNewStory({ name: "", points: "" });
  };

  const addStory = async (epicName: string, featureName: string) => {
    if (!table || !artefact || !headers) return;
    const name = newStory.name.trim();
    if (!name) {
      toast.error("Story name required");
      return;
    }
    const previous = table;
    // Build the new row using the headers we already use for reading.
    // Empty cells for columns we don't fill — serializer keeps header
    // order and writes blanks where the row is missing keys.
    const newRow: ArtefactRow = {
      [headers.epic]: epicName,
      [headers.feature]: featureName,
      [headers.story]: name,
    };
    if (newStory.points.trim()) newRow[headers.points] = newStory.points.trim();

    // Insert right after the last existing row for the same feature so
    // the tree's grouping looks contiguous. If no rows match, append.
    const insertAfter = (() => {
      for (let i = table.rows.length - 1; i >= 0; i--) {
        const r = table.rows[i];
        const matchesEpic = pickValue(r, "Epic", "Epic Name", "Theme") === epicName;
        const matchesFeature = pickValue(r, "Feature", "Feature Name") === featureName;
        if (matchesEpic && matchesFeature) return i;
      }
      return table.rows.length - 1;
    })();
    const nextRows = [
      ...table.rows.slice(0, insertAfter + 1),
      newRow,
      ...table.rows.slice(insertAfter + 1),
    ];
    // Make sure the headers contain every key we just wrote.
    const ensuredHeaders = [...table.headers];
    for (const key of Object.keys(newRow)) {
      if (!ensuredHeaders.includes(key)) ensuredHeaders.push(key);
    }
    const next: ArtefactTable = { ...table, headers: ensuredHeaders, rows: nextRows };
    setTable(next);
    closeAddForm();

    try {
      await updateArtefact.mutateAsync({
        artefactId: artefact.id,
        content: serializeArtefactTable(next),
      });
      toast.success(`Added "${name.slice(0, 40)}${name.length > 40 ? "…" : ""}"`);
    } catch (err) {
      setTable(previous);
      const msg = err instanceof Error ? err.message : "Update failed";
      toast.error(`Couldn't add story: ${msg}`);
    }
  };

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
            Use "+ Add Story" under any feature to extend the hierarchy; changes write back to the source artefact.
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
            <Link href={`/projects/${projectId}/artefacts`} className="ml-1 text-primary hover:underline">
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
                      const addKey = `${epic.name}|||${feature.name}`;
                      const isAdding = addingTo === addKey;
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
                          {!featureCollapsed && (
                            <div className="border-t border-border/40">
                              {feature.stories.length > 0 && (
                                <ul className="px-3 py-2 space-y-1">
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
                              {isAdding ? (
                                <div className="px-3 py-2 border-t border-border/40 bg-muted/10 space-y-2">
                                  <div className="flex gap-2">
                                    <input
                                      autoFocus
                                      type="text"
                                      placeholder="Story title"
                                      value={newStory.name}
                                      onChange={(e) => setNewStory((s) => ({ ...s, name: e.target.value }))}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") addStory(epic.name, feature.name);
                                        if (e.key === "Escape") closeAddForm();
                                      }}
                                      className="flex-1 px-2 py-1 text-xs rounded-md border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                                    />
                                    <input
                                      type="text"
                                      placeholder="Pts"
                                      value={newStory.points}
                                      onChange={(e) => setNewStory((s) => ({ ...s, points: e.target.value }))}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") addStory(epic.name, feature.name);
                                        if (e.key === "Escape") closeAddForm();
                                      }}
                                      className="w-16 px-2 py-1 text-xs rounded-md border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
                                    />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => addStory(epic.name, feature.name)}
                                      disabled={!newStory.name.trim() || updateArtefact.isPending}
                                      className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors"
                                    >
                                      Add
                                    </button>
                                    <button
                                      onClick={closeAddForm}
                                      className="px-2.5 py-1 rounded-md border border-border text-[11px] hover:bg-muted/40 transition-colors flex items-center gap-1"
                                    >
                                      <X className="w-3 h-3" />
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  onClick={() => openAddForm(epic.name, feature.name)}
                                  className="w-full text-left px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors flex items-center gap-1.5 border-t border-border/40"
                                >
                                  <Plus className="w-3 h-3" />
                                  Add story
                                </button>
                              )}
                            </div>
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
