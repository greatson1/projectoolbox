"use client";

import { useMemo, useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  type DragEndEvent,
  type DragStartEvent,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { useProjectArtefacts, useProject, useUpdateArtefact } from "@/hooks/use-api";
import { parseArtefactTable, serializeArtefactTable, pickHeader, type ArtefactRow, type ArtefactTable } from "@/lib/artefact-rows";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AlertCircle, Sparkles, ShieldCheck, UserCircle2, HandHeart, ShieldAlert, HelpCircle, GripVertical } from "lucide-react";

/**
 * SAFe ROAM Risk Board with drag-to-classify.
 *
 * Reads the approved ROAM Risk Board artefact, classifies each row into
 * Resolved / Owned / Accepted / Mitigated, and lets the user drag a
 * card into a different bucket to update the ROAM column.
 *
 * Edits write back to the source artefact via PATCH so the next render
 * (and the artefacts page) see the change. We optimistically update the
 * local table state while the request is in flight, and roll back if
 * the PATCH fails.
 */

type RoamBucket = "Resolved" | "Owned" | "Accepted" | "Mitigated" | "Unclassified";

interface RoamRisk {
  /** Row index in the underlying artefact table — used as the DnD id and to write back. */
  rowIndex: number;
  title: string;
  description: string;
  owner: string;
  bucket: RoamBucket;
  notes: string;
  raw: string;
}

const BUCKETS: { id: RoamBucket; letter: string; color: string; bg: string; ring: string; icon: typeof ShieldCheck; description: string; writeValue: string }[] = [
  { id: "Resolved",   letter: "R", color: "#10B981", bg: "bg-emerald-500/5", ring: "ring-emerald-500/30", icon: ShieldCheck,   description: "Closed out — no longer a risk.",                writeValue: "Resolved" },
  { id: "Owned",      letter: "O", color: "#6366F1", bg: "bg-indigo-500/5",  ring: "ring-indigo-500/30",  icon: UserCircle2,   description: "Owner identified, mitigation plan in flight.",   writeValue: "Owned" },
  { id: "Accepted",   letter: "A", color: "#F59E0B", bg: "bg-amber-500/5",   ring: "ring-amber-500/30",   icon: HandHeart,     description: "Sponsor knowingly accepts the residual risk.",   writeValue: "Accepted" },
  { id: "Mitigated",  letter: "M", color: "#22D3EE", bg: "bg-cyan-500/5",    ring: "ring-cyan-500/30",    icon: ShieldAlert,   description: "Action has reduced impact / probability.",       writeValue: "Mitigated" },
];

function classifyRoam(raw: string): RoamBucket {
  const r = raw.toLowerCase();
  if (!r) return "Unclassified";
  if (r === "r" || r.startsWith("resolved") || r.startsWith("closed")) return "Resolved";
  if (r === "o" || r.startsWith("owned") || r.startsWith("active")) return "Owned";
  if (r === "a" || r.startsWith("accepted") || r.startsWith("acknowledged")) return "Accepted";
  if (r === "m" || r.startsWith("mitigated") || r.startsWith("controlled")) return "Mitigated";
  return "Unclassified";
}

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

export default function RoamPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);
  const updateArtefact = useUpdateArtefact();
  const [activeId, setActiveId] = useState<string | null>(null);

  const artefact = useMemo(() => {
    if (!artefacts) return null;
    const matches = artefacts.filter((a: any) => {
      const n = (a.name || "").toLowerCase();
      return a.status === "APPROVED" && (n.includes("roam") || n.includes("roam risk"));
    });
    if (matches.length === 0) return null;
    return matches.sort(
      (a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0];
  }, [artefacts]);

  // Local mirror of the parsed table so we can apply optimistic updates
  // without waiting for the PATCH round-trip. Re-syncs from the source
  // artefact whenever it changes (e.g. after invalidate).
  const [table, setTable] = useState<ArtefactTable | null>(null);
  useEffect(() => {
    setTable(artefact ? parseArtefactTable(artefact.content) : null);
  }, [artefact?.id, artefact?.content]);

  const roamHeader = useMemo(
    () => (table ? pickHeader(table.headers, "ROAM", "Status", "Category", "Classification") : "ROAM"),
    [table],
  );

  const risks = useMemo(() => {
    if (!table) return null;
    return table.rows.map<RoamRisk>((row, idx) => {
      const raw = pickValue(row, "ROAM", "Status", "Category", "Classification");
      return {
        rowIndex: idx,
        title: pickValue(row, "Risk", "Title", "Name", "Description") || "(Untitled risk)",
        description: pickValue(row, "Description", "Detail", "Notes"),
        owner: pickValue(row, "Owner", "Responsible", "Assignee"),
        bucket: classifyRoam(raw),
        notes: pickValue(row, "Mitigation", "Action", "Plan", "Notes"),
        raw,
      };
    });
  }, [table]);

  const grouped = useMemo(() => {
    if (!risks) return null;
    const byBucket = new Map<RoamBucket, RoamRisk[]>();
    for (const r of risks) {
      if (!byBucket.has(r.bucket)) byBucket.set(r.bucket, []);
      byBucket.get(r.bucket)!.push(r);
    }
    return byBucket;
  }, [risks]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    if (!table || !artefact || !risks) return;
    const dropBucket = e.over?.id;
    if (!dropBucket) return;
    const rowIdx = Number(e.active.id);
    if (!Number.isFinite(rowIdx)) return;
    const currentRisk = risks[rowIdx];
    if (!currentRisk) return;
    // Looking up which bucket value the lane represents — the four
    // canonical buckets carry an explicit writeValue ("Resolved" etc.);
    // dropping in Unclassified is a no-op because the artefact has no
    // canonical word for "unclassified" we'd want to overwrite with.
    const target = BUCKETS.find((b) => b.id === String(dropBucket));
    if (!target) return;
    if (currentRisk.bucket === target.id) return;

    // Optimistic local update — the page reflects the new bucket
    // immediately. We snapshot the previous state so we can roll back if
    // the PATCH fails (network / 5xx).
    const previous = table;
    const nextRows = table.rows.map((row, i) =>
      i === rowIdx ? { ...row, [roamHeader]: target.writeValue } : row,
    );
    // Ensure the ROAM header exists in the table headers — append if
    // missing so writes don't silently get dropped.
    const nextHeaders = table.headers.includes(roamHeader)
      ? table.headers
      : [...table.headers, roamHeader];
    const next: ArtefactTable = { ...table, headers: nextHeaders, rows: nextRows };
    setTable(next);

    try {
      await updateArtefact.mutateAsync({
        artefactId: artefact.id,
        content: serializeArtefactTable(next),
      });
      toast.success(`${currentRisk.title.slice(0, 40)}${currentRisk.title.length > 40 ? "…" : ""} → ${target.id}`);
    } catch (err) {
      setTable(previous);
      const msg = err instanceof Error ? err.message : "Update failed";
      toast.error(`Couldn't update ROAM: ${msg}`);
    }
  };

  const draggedRisk = useMemo(() => {
    if (!activeId || !risks) return null;
    const idx = Number(activeId);
    return risks.find((r) => r.rowIndex === idx) ?? null;
  }, [activeId, risks]);

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-[1400px]">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1400px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-primary" />
            ROAM Risk Board
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Resolved / Owned / Accepted / Mitigated classification for{" "}
            <span className="font-medium text-foreground">{project?.name}</span>.
            Drag a card between buckets to reclassify; changes write back to the source artefact.
          </p>
        </div>
        {risks && (
          <Badge variant="outline" className="text-xs">
            {risks.length} {risks.length === 1 ? "risk" : "risks"} classified
          </Badge>
        )}
      </div>

      {!artefact && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <h3 className="font-semibold">No approved ROAM Risk Board artefact</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              SAFe expects every identified risk to be ROAM-classified at PI commitment.
              Generate the <strong>ROAM Risk Board</strong> artefact during PI Planning to
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

      {artefact && !risks && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            The approved ROAM Risk Board artefact contains no tabular data the page can parse.
            <Link href={`/projects/${projectId}/artefacts`} className="ml-1 text-primary hover:underline">
              Open it to inspect or regenerate
            </Link>
            .
          </CardContent>
        </Card>
      )}

      {grouped && (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {BUCKETS.map((b) => {
              const items = grouped.get(b.id) || [];
              return <RoamLane key={b.id} bucket={b} items={items} />;
            })}
          </div>

          {(grouped.get("Unclassified")?.length ?? 0) > 0 && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <HelpCircle className="w-5 h-5 text-amber-500" />
                  <h2 className="font-semibold text-sm">
                    Unclassified — {grouped.get("Unclassified")!.length} risk
                    {grouped.get("Unclassified")!.length === 1 ? "" : "s"}
                  </h2>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  The ROAM column on these rows didn't match R / O / A / M. Drag them into a
                  bucket below — or edit the source artefact directly.
                </p>
                <div className="space-y-1.5 pt-1">
                  {grouped.get("Unclassified")!.map((risk) => (
                    <UnclassifiedRow key={risk.rowIndex} risk={risk} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <DragOverlay>
            {draggedRisk && (
              <div className="rounded-md border border-border bg-card shadow-xl p-2.5 max-w-[280px] opacity-90">
                <p className="text-xs font-semibold">{draggedRisk.title}</p>
              </div>
            )}
          </DragOverlay>
        </DndContext>
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

function RoamLane({ bucket: b, items }: { bucket: typeof BUCKETS[number]; items: RoamRisk[] }) {
  const Icon = b.icon;
  const { setNodeRef, isOver } = useDroppable({ id: b.id });

  return (
    <Card
      ref={setNodeRef as any}
      className={`overflow-hidden ${b.bg} ring-1 ${b.ring} transition-colors ${isOver ? "ring-2 ring-offset-1" : ""}`}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white text-sm"
              style={{ background: b.color }}
            >
              {b.letter}
            </div>
            <div>
              <h2 className="font-semibold text-sm">{b.id}</h2>
              <p className="text-[10px] text-muted-foreground">{b.description}</p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs">{items.length}</Badge>
        </div>
        <div className={`space-y-2 min-h-[80px] ${items.length === 0 && isOver ? "rounded-md border border-dashed border-border/60" : ""}`}>
          {items.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic py-3 text-center">
              {isOver ? "Drop to classify" : "No risks in this bucket."}
            </p>
          ) : (
            items.map((risk) => <RiskCard key={risk.rowIndex} risk={risk} color={b.color} Icon={Icon} />)
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RiskCard({ risk, color, Icon }: { risk: RoamRisk; color: string; Icon: typeof ShieldCheck }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: String(risk.rowIndex) });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`rounded-md border border-border/60 bg-card p-2.5 space-y-1 cursor-grab active:cursor-grabbing ${isDragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-1.5 min-w-0">
          <Icon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color }} />
          <p className="text-xs font-semibold flex-1 leading-snug">{risk.title}</p>
        </div>
        <GripVertical className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
      </div>
      {risk.description && (
        <p className="text-[11px] text-muted-foreground leading-snug">{risk.description}</p>
      )}
      {(risk.owner || risk.notes) && (
        <div className="flex flex-wrap gap-1 pt-1">
          {risk.owner && (<Badge variant="outline" className="text-[9px]">{risk.owner}</Badge>)}
          {risk.notes && (
            <Badge variant="outline" className="text-[9px] max-w-[200px] truncate" title={risk.notes}>
              {risk.notes}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

function UnclassifiedRow({ risk }: { risk: RoamRisk }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: String(risk.rowIndex) });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-2 text-xs rounded-md bg-amber-500/10 px-2 py-1.5 border border-amber-500/30 cursor-grab active:cursor-grabbing ${isDragging ? "opacity-40" : ""}`}
    >
      <GripVertical className="w-3 h-3 text-amber-600/70 flex-shrink-0" />
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
      <span className="flex-1 truncate">{risk.title}</span>
      {risk.raw && (
        <span className="text-[10px] text-muted-foreground/70 flex-shrink-0">
          (was: &quot;{risk.raw}&quot;)
        </span>
      )}
    </div>
  );
}
