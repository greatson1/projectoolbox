"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { parseArtefactRows, pick } from "@/lib/artefact-rows";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Sparkles, ShieldCheck, UserCircle2, HandHeart, ShieldAlert, HelpCircle } from "lucide-react";

/**
 * SAFe ROAM Risk Board.
 *
 * Reads the approved "ROAM Risk Board" artefact and classifies each
 * risk into one of four buckets:
 *
 *   R — Resolved   (no longer a risk; closed out)
 *   O — Owned      (someone owns it; mitigation plan in flight)
 *   A — Accepted   (sponsor knowingly accepts the residual risk)
 *   M — Mitigated  (action has reduced impact / probability)
 *
 * Classification comes from a `ROAM` (or `Category` / `Status`) column.
 * Anything else falls into the Unclassified bucket so it's visible and
 * actionable rather than hidden.
 */

type RoamBucket = "Resolved" | "Owned" | "Accepted" | "Mitigated" | "Unclassified";

interface RoamRisk {
  title: string;
  description: string;
  owner: string;
  bucket: RoamBucket;
  notes: string;
  raw: string;
}

const BUCKETS: { id: RoamBucket; letter: string; color: string; bg: string; ring: string; icon: typeof ShieldCheck; description: string }[] = [
  {
    id: "Resolved",
    letter: "R",
    color: "#10B981",
    bg: "bg-emerald-500/5",
    ring: "ring-emerald-500/30",
    icon: ShieldCheck,
    description: "Closed out — no longer a risk.",
  },
  {
    id: "Owned",
    letter: "O",
    color: "#6366F1",
    bg: "bg-indigo-500/5",
    ring: "ring-indigo-500/30",
    icon: UserCircle2,
    description: "Owner identified, mitigation plan in flight.",
  },
  {
    id: "Accepted",
    letter: "A",
    color: "#F59E0B",
    bg: "bg-amber-500/5",
    ring: "ring-amber-500/30",
    icon: HandHeart,
    description: "Sponsor knowingly accepts the residual risk.",
  },
  {
    id: "Mitigated",
    letter: "M",
    color: "#22D3EE",
    bg: "bg-cyan-500/5",
    ring: "ring-cyan-500/30",
    icon: ShieldAlert,
    description: "Action has reduced impact / probability.",
  },
];

function classifyRoam(raw: string): RoamBucket {
  const r = raw.toLowerCase();
  if (!r) return "Unclassified";
  // First letter shorthand: "R" / "O" / "A" / "M".
  if (r === "r" || r.startsWith("resolved") || r.startsWith("closed")) return "Resolved";
  if (r === "o" || r.startsWith("owned") || r.startsWith("active")) return "Owned";
  if (r === "a" || r.startsWith("accepted") || r.startsWith("acknowledged")) return "Accepted";
  if (r === "m" || r.startsWith("mitigated") || r.startsWith("controlled")) return "Mitigated";
  return "Unclassified";
}

export default function RoamPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);

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

  const risks = useMemo(() => {
    if (!artefact?.content) return null;
    const rows = parseArtefactRows(artefact.content);
    if (rows.length === 0) return null;
    return rows.map<RoamRisk>((row) => {
      const raw = pick(row, "ROAM", "Status", "Category", "Classification");
      return {
        title: pick(row, "Risk", "Title", "Name", "Description") || "(Untitled risk)",
        description: pick(row, "Description", "Detail", "Notes"),
        owner: pick(row, "Owner", "Responsible", "Assignee"),
        bucket: classifyRoam(raw),
        notes: pick(row, "Mitigation", "Action", "Plan", "Notes"),
        raw,
      };
    });
  }, [artefact?.content]);

  const grouped = useMemo(() => {
    if (!risks) return null;
    const byBucket = new Map<RoamBucket, RoamRisk[]>();
    for (const r of risks) {
      if (!byBucket.has(r.bucket)) byBucket.set(r.bucket, []);
      byBucket.get(r.bucket)!.push(r);
    }
    return byBucket;
  }, [risks]);

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
            No risk should be left untriaged.
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
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {BUCKETS.map((b) => {
              const items = grouped.get(b.id) || [];
              const Icon = b.icon;
              return (
                <Card key={b.id} className={`overflow-hidden ${b.bg} ring-1 ${b.ring}`}>
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
                      <Badge variant="outline" className="text-xs">
                        {items.length}
                      </Badge>
                    </div>
                    <div className="space-y-2">
                      {items.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground italic py-2 text-center">
                          No risks in this bucket.
                        </p>
                      ) : (
                        items.map((risk, ri) => (
                          <div
                            key={`${b.id}-${ri}`}
                            className="rounded-md border border-border/60 bg-card p-2.5 space-y-1"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <Icon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: b.color }} />
                              <p className="text-xs font-semibold flex-1 leading-snug">{risk.title}</p>
                            </div>
                            {risk.description && (
                              <p className="text-[11px] text-muted-foreground leading-snug">{risk.description}</p>
                            )}
                            {(risk.owner || risk.notes) && (
                              <div className="flex flex-wrap gap-1 pt-1">
                                {risk.owner && (
                                  <Badge variant="outline" className="text-[9px]">
                                    {risk.owner}
                                  </Badge>
                                )}
                                {risk.notes && (
                                  <Badge variant="outline" className="text-[9px] max-w-[200px] truncate" title={risk.notes}>
                                    {risk.notes}
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
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
                  The ROAM column on these rows didn't match R / O / A / M. Edit the artefact to
                  assign a classification before commitment.
                </p>
                <ul className="space-y-1 pt-1">
                  {grouped.get("Unclassified")!.map((risk, ri) => (
                    <li key={ri} className="text-xs text-foreground flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      <span>{risk.title}</span>
                      {risk.raw && (
                        <span className="text-[10px] text-muted-foreground/70">
                          (was: &quot;{risk.raw}&quot;)
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
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
