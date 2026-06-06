"use client";

import { useMemo, useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { parseArtefactRows, pick } from "@/lib/artefact-rows";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileCheck2, AlertCircle, Sparkles, Calendar, RotateCcw } from "lucide-react";

/**
 * Travel Documentation Checklist.
 *
 * Renders the Documentation Checklist + Pre-Travel Health Plan artefacts
 * as a single checklist view — passports, visas, insurance, vaccinations,
 * etc. Each item shows the deadline / validity date and any notes from
 * the artefact. Ticks persist locally per project.
 *
 * Both artefact types are merged so the user sees a complete pre-travel
 * compliance picture in one place rather than two pages of the same shape.
 */
export default function DocumentsChecklistPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const storageKey = `docs-checklist-${projectId}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setTicked(JSON.parse(raw));
    } catch {
      /* corrupt storage just resets */
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(ticked));
    } catch {
      /* full storage / private mode — skip */
    }
  }, [storageKey, ticked]);

  const sourceArtefacts = useMemo(() => {
    if (!artefacts) return [];
    return artefacts.filter((a: any) => {
      const n = (a.name || "").toLowerCase();
      return (
        a.status === "APPROVED" &&
        (n.includes("documentation checklist") ||
          n.includes("documents checklist") ||
          n.includes("pre-travel health") ||
          n.includes("pre travel health") ||
          n.includes("health plan"))
      );
    });
  }, [artefacts]);

  const items = useMemo(() => {
    if (sourceArtefacts.length === 0) return null;
    type Item = {
      id: string;
      sourceName: string;
      item: string;
      category: string;
      deadline: string;
      status: string;
      notes: string;
    };
    const out: Item[] = [];
    for (const art of sourceArtefacts) {
      const rows = parseArtefactRows(art.content);
      rows.forEach((row, idx) => {
        out.push({
          id: `${art.id}-${idx}`,
          sourceName: art.name,
          item: pick(row, "Item", "Document", "Requirement", "Description", "Name") || "(Untitled)",
          category: pick(row, "Category", "Type", "Section") || "General",
          deadline: pick(row, "Deadline", "Due", "Validity", "Expires", "Date"),
          status: pick(row, "Status", "State"),
          notes: pick(row, "Notes", "Detail", "Comment"),
        });
      });
    }
    return out.length > 0 ? out : null;
  }, [sourceArtefacts]);

  const grouped = useMemo(() => {
    if (!items) return null;
    const byCategory = new Map<string, typeof items>();
    const order: string[] = [];
    for (const i of items) {
      if (!byCategory.has(i.category)) {
        byCategory.set(i.category, []);
        order.push(i.category);
      }
      byCategory.get(i.category)!.push(i);
    }
    return order.map((cat) => ({ category: cat, items: byCategory.get(cat)! }));
  }, [items]);

  const totals = useMemo(() => {
    if (!items) return { total: 0, done: 0 };
    let total = 0;
    let done = 0;
    for (const i of items) {
      total++;
      if (ticked[i.id]) done++;
    }
    return { total, done };
  }, [items, ticked]);

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-[1000px]">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1000px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileCheck2 className="w-6 h-6 text-primary" />
            Pre-Travel Checklist
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Documents and health requirements for <span className="font-medium text-foreground">{project?.name}</span>.
            Ticks are saved on this device.
          </p>
        </div>
        {grouped && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {totals.done}/{totals.total} done
            </Badge>
            {totals.done > 0 && (
              <button
                onClick={() => setTicked({})}
                className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            )}
          </div>
        )}
      </div>

      {sourceArtefacts.length === 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <h3 className="font-semibold">No approved checklist artefacts</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Generate the <strong>Documentation Checklist</strong> and{" "}
              <strong>Pre-Travel Health Plan</strong> artefacts during the Book phase to populate
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

      {sourceArtefacts.length > 0 && !items && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            The approved checklist artefacts contain no tabular data the page can parse.
          </CardContent>
        </Card>
      )}

      {grouped && (
        <div className="space-y-3">
          {grouped.map((g, gi) => {
            const catDone = g.items.filter((i) => ticked[i.id]).length;
            return (
              <Card key={`group-${gi}`} className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="px-4 py-2.5 border-b border-border/40 bg-muted/20 flex items-center justify-between">
                    <h2 className="font-semibold text-sm">{g.category}</h2>
                    <Badge variant="outline" className="text-[10px]">
                      {catDone}/{g.items.length}
                    </Badge>
                  </div>
                  <ul className="divide-y divide-border/30">
                    {g.items.map((it) => {
                      const isDone = !!ticked[it.id];
                      return (
                        <li key={it.id}>
                          <label className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isDone}
                              onChange={() => setTicked((t) => ({ ...t, [it.id]: !t[it.id] }))}
                              className="mt-0.5 flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0 space-y-0.5">
                              <p className={`text-sm leading-snug ${isDone ? "line-through text-muted-foreground" : ""}`}>
                                {it.item}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                                {it.deadline && (
                                  <span className="inline-flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    {it.deadline}
                                  </span>
                                )}
                                {it.status && (
                                  <span className="uppercase tracking-wider">{it.status}</span>
                                )}
                              </div>
                              {it.notes && (
                                <p className="text-[11px] text-muted-foreground/90 leading-snug">{it.notes}</p>
                              )}
                            </div>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {sourceArtefacts.length > 0 && (
        <p className="text-[10px] text-muted-foreground/70 text-right">
          Source{sourceArtefacts.length === 1 ? "" : "s"}:{" "}
          {sourceArtefacts.map((a: any, i: number) => (
            <span key={a.id}>
              {i > 0 && " · "}
              <Link href={`/projects/${projectId}/artefacts`} className="underline hover:text-foreground">
                {a.name}
              </Link>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
