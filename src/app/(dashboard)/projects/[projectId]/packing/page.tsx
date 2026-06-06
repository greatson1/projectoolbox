"use client";

import { useMemo, useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { parseArtefactRows, pick } from "@/lib/artefact-rows";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Backpack, AlertCircle, Sparkles, RotateCcw } from "lucide-react";

/**
 * Travel Packing List.
 *
 * Reads the approved Packing List artefact and renders it as a category-
 * grouped checklist. Ticks are persisted to localStorage keyed by the
 * project id, so the user's progress survives reloads without hitting
 * the DB — packing is a personal, transient state.
 */
export default function PackingPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const storageKey = `packing-${projectId}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setTicked(JSON.parse(raw));
    } catch {
      /* ignore — corrupt localStorage just starts fresh */
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(ticked));
    } catch {
      /* full storage / private mode — silently skip */
    }
  }, [storageKey, ticked]);

  const artefact = useMemo(() => {
    if (!artefacts) return null;
    const matches = artefacts.filter((a: any) => {
      const n = (a.name || "").toLowerCase();
      return a.status === "APPROVED" && (n.includes("packing list") || n.includes("packing"));
    });
    if (matches.length === 0) return null;
    return matches.sort(
      (a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0];
  }, [artefacts]);

  const categories = useMemo(() => {
    if (!artefact?.content) return null;
    const rows = parseArtefactRows(artefact.content);
    if (rows.length === 0) return null;

    type Item = { id: string; name: string; quantity: string; notes: string };
    const byCategory = new Map<string, Item[]>();
    const order: string[] = [];
    rows.forEach((row, idx) => {
      const category = pick(row, "Category", "Section", "Group") || "Other";
      const item: Item = {
        id: `${idx}-${pick(row, "Item", "Name") || idx}`,
        name: pick(row, "Item", "Name", "Description") || "(Untitled)",
        quantity: pick(row, "Quantity", "Qty", "Count"),
        notes: pick(row, "Notes", "Detail", "Comment"),
      };
      if (!byCategory.has(category)) {
        byCategory.set(category, []);
        order.push(category);
      }
      byCategory.get(category)!.push(item);
    });
    return order.map((cat) => ({ category: cat, items: byCategory.get(cat)! }));
  }, [artefact?.content]);

  const totals = useMemo(() => {
    if (!categories) return { total: 0, done: 0 };
    let total = 0;
    let done = 0;
    for (const c of categories) {
      for (const i of c.items) {
        total++;
        if (ticked[i.id]) done++;
      }
    }
    return { total, done };
  }, [categories, ticked]);

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-[900px]">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[900px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Backpack className="w-6 h-6 text-primary" />
            Packing List
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Items to pack for <span className="font-medium text-foreground">{project?.name}</span>.
            Ticks are saved on this device.
          </p>
        </div>
        {categories && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {totals.done}/{totals.total} packed
            </Badge>
            {totals.done > 0 && (
              <button
                onClick={() => setTicked({})}
                className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                title="Clear all ticks"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            )}
          </div>
        )}
      </div>

      {!artefact && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <h3 className="font-semibold">No approved Packing List artefact</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Generate the <strong>Packing List</strong> artefact during the Book phase to populate
              this view — it's tailored to the destination, activities, and trip duration.
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

      {artefact && !categories && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            The approved Packing List artefact contains no tabular data the page can parse.
          </CardContent>
        </Card>
      )}

      {categories && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {categories.map((c, ci) => {
            const catDone = c.items.filter((i) => ticked[i.id]).length;
            return (
              <Card key={`cat-${ci}`} className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="px-4 py-2.5 border-b border-border/40 bg-muted/20 flex items-center justify-between">
                    <h2 className="font-semibold text-sm">{c.category}</h2>
                    <Badge variant="outline" className="text-[10px]">
                      {catDone}/{c.items.length}
                    </Badge>
                  </div>
                  <ul className="divide-y divide-border/30">
                    {c.items.map((item) => {
                      const isDone = !!ticked[item.id];
                      return (
                        <li key={item.id}>
                          <label className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isDone}
                              onChange={() => setTicked((t) => ({ ...t, [item.id]: !t[item.id] }))}
                              className="mt-0.5 flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm leading-snug ${isDone ? "line-through text-muted-foreground" : ""}`}>
                                {item.name}
                                {item.quantity && <span className="ml-1.5 text-[11px] text-muted-foreground">× {item.quantity}</span>}
                              </p>
                              {item.notes && (
                                <p className="text-[11px] text-muted-foreground/90 mt-0.5 leading-snug">{item.notes}</p>
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
