"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ShieldAlert, AlertCircle, Sparkles, FileText, ChevronRight, ChevronDown } from "lucide-react";

/**
 * Risk Reviews aggregator.
 *
 * Every methodology with an Execution-equivalent phase produces periodic
 * Risk Review artefacts (or includes risk updates inside Status / Highlight
 * Reports). This page walks every approved Risk Review / Risk Update
 * artefact across phases and presents them as a chronological feed —
 * sponsors and PMs can see how the risk landscape shifted over time
 * without opening each artefact individually.
 *
 * Same pattern as /status-reports — chronological cards with expand-to-
 * view markdown body, plus a "phase" filter so the user can pull just
 * Execution-phase reviews when they need them.
 */
export default function RiskReviewsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);
  const [phaseFilter, setPhaseFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const reviews = useMemo(() => {
    if (!artefacts) return null;
    return artefacts
      .filter((a: any) => {
        const n = (a.name || "").toLowerCase();
        return (
          a.status === "APPROVED" &&
          (n.includes("risk review") || n.includes("risk update") || n.includes("risk reviews"))
        );
      })
      .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((a: any) => ({
        id: a.id,
        name: a.name,
        phase: a.phaseName || "",
        updatedAt: a.updatedAt,
        content: a.content || "",
      }));
  }, [artefacts]);

  const phases = useMemo(() => {
    if (!reviews) return [];
    return Array.from(new Set(reviews.map((r) => r.phase).filter(Boolean))).sort();
  }, [reviews]);

  const filtered = useMemo(() => {
    if (!reviews) return null;
    if (phaseFilter === "all") return reviews;
    return reviews.filter((r) => r.phase === phaseFilter);
  }, [reviews, phaseFilter]);

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-[1200px]">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1200px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-primary" />
            Risk Reviews
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Periodic risk updates across every phase of <span className="font-medium text-foreground">{project?.name}</span>.
            Newest first.
          </p>
        </div>
        {reviews && reviews.length > 0 && (
          <Badge variant="outline" className="text-xs">
            {reviews.length} {reviews.length === 1 ? "review" : "reviews"}
          </Badge>
        )}
      </div>

      {(!reviews || reviews.length === 0) && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <div className="p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <h3 className="font-semibold">No approved Risk Reviews yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Risk Reviews are produced during Execution / Build / Delivery phases to track how the
              risk landscape changes over time. Generate the first one to populate this view; for
              point-in-time risk state, see the{" "}
              <Link href={`/projects/${projectId}/risk`} className="text-primary hover:underline">
                Risk Register
              </Link>
              .
            </p>
            <Link
              href={`/projects/${projectId}/artefacts`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Open Artefacts
            </Link>
          </div>
        </Card>
      )}

      {reviews && reviews.length > 0 && phases.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Phase:</span>
          <button
            onClick={() => setPhaseFilter("all")}
            className={`px-2 py-1 rounded-md border transition-colors ${phaseFilter === "all" ? "border-primary text-primary" : "border-border hover:border-foreground/40"}`}
          >
            All ({reviews.length})
          </button>
          {phases.map((p) => {
            const count = reviews.filter((r) => r.phase === p).length;
            return (
              <button
                key={p}
                onClick={() => setPhaseFilter(p)}
                className={`px-2 py-1 rounded-md border transition-colors ${phaseFilter === p ? "border-primary text-primary" : "border-border hover:border-foreground/40"}`}
              >
                {p} ({count})
              </button>
            );
          })}
        </div>
      )}

      {filtered && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((r) => {
            const isExpanded = !!expanded[r.id];
            return (
              <Card key={r.id} className="overflow-hidden">
                <button
                  onClick={() => setExpanded((e) => ({ ...e, [r.id]: !e[r.id] }))}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors text-left"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  )}
                  <FileText className="w-4 h-4 flex-shrink-0 text-amber-500" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{r.name}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                      {r.phase && <Badge variant="outline" className="text-[10px]">{r.phase}</Badge>}
                      <span className="ml-auto">
                        {new Date(r.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    </div>
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t border-border/40 px-6 py-4 prose prose-sm max-w-none dark:prose-invert">
                    {r.content ? (
                      r.content.trimStart().startsWith("<")
                        ? <div dangerouslySetInnerHTML={{ __html: r.content }} />
                        : <ReactMarkdown remarkPlugins={[remarkGfm]}>{r.content}</ReactMarkdown>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">This review has no body text.</p>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {reviews && reviews.length > 0 && (
        <p className="text-[10px] text-muted-foreground/70 text-right">
          For point-in-time risk state, see the{" "}
          <Link href={`/projects/${projectId}/risk`} className="underline hover:text-foreground">Risk Register</Link>
          {" · "}
          <Link href={`/projects/${projectId}/artefacts`} className="underline hover:text-foreground">Open Artefacts</Link>
        </p>
      )}
    </div>
  );
}
