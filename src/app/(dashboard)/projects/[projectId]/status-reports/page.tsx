"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileBarChart, AlertCircle, Sparkles, FileText, ChevronRight, ChevronDown } from "lucide-react";

/**
 * Status Reports + Highlight Reports timeline.
 *
 * Aggregates every approved Status Report, Highlight Report, Exception
 * Report and End Stage Report into a single chronological feed so
 * sponsors and PMs can see how the project has been reported across
 * its lifecycle without opening each artefact individually.
 *
 * Reports come in two flavours that the page distinguishes via badge:
 *   - Status / Highlight — periodic in-progress updates
 *   - Exception / End Stage — event-driven escalations and closures
 *
 * Content renders as markdown rather than parsed-table because these
 * artefacts are document-shaped (RAG sections, milestones hit, risks,
 * forward look), not tabular.
 */

type ReportKind = "status" | "highlight" | "exception" | "end-stage";

function classifyReport(name: string): ReportKind {
  const n = name.toLowerCase();
  if (n.includes("highlight")) return "highlight";
  if (n.includes("exception")) return "exception";
  if (n.includes("end stage") || n.includes("end-stage")) return "end-stage";
  return "status";
}

const KIND_STYLES: Record<ReportKind, { label: string; color: string; bg: string }> = {
  status: { label: "Status Report", color: "#6366F1", bg: "bg-indigo-500/10" },
  highlight: { label: "Highlight Report", color: "#10B981", bg: "bg-emerald-500/10" },
  exception: { label: "Exception Report", color: "#EF4444", bg: "bg-red-500/10" },
  "end-stage": { label: "End Stage Report", color: "#F59E0B", bg: "bg-amber-500/10" },
};

export default function StatusReportsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);
  const [kindFilter, setKindFilter] = useState<ReportKind | "all">("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const reports = useMemo(() => {
    if (!artefacts) return null;
    const matches = artefacts
      .filter((a: any) => {
        const n = (a.name || "").toLowerCase();
        return (
          a.status === "APPROVED" &&
          (n.includes("status report") ||
            n.includes("highlight report") ||
            n.includes("exception report") ||
            n.includes("end stage report") ||
            n.includes("end-stage report"))
        );
      })
      // Newest first.
      .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((a: any) => ({
        id: a.id,
        name: a.name,
        phase: a.phaseName || "",
        updatedAt: a.updatedAt,
        kind: classifyReport(a.name),
        content: a.content || "",
      }));
    return matches;
  }, [artefacts]);

  const filtered = useMemo(() => {
    if (!reports) return null;
    if (kindFilter === "all") return reports;
    return reports.filter((r) => r.kind === kindFilter);
  }, [reports, kindFilter]);

  const counts = useMemo(() => {
    if (!reports) return { status: 0, highlight: 0, exception: 0, "end-stage": 0 };
    return reports.reduce(
      (acc, r) => ({ ...acc, [r.kind]: acc[r.kind] + 1 }),
      { status: 0, highlight: 0, exception: 0, "end-stage": 0 } as Record<ReportKind, number>,
    );
  }, [reports]);

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
            <FileBarChart className="w-6 h-6 text-primary" />
            Status & Highlight Reports
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Reported progress across every phase of <span className="font-medium text-foreground">{project?.name}</span>.
            Newest first.
          </p>
        </div>
        {reports && (
          <div className="flex flex-wrap gap-2 justify-end">
            {counts.status > 0 && <Badge variant="outline" className="text-xs">{counts.status} status</Badge>}
            {counts.highlight > 0 && <Badge variant="outline" className="text-xs">{counts.highlight} highlight</Badge>}
            {counts.exception > 0 && <Badge variant="outline" className="text-xs">{counts.exception} exception</Badge>}
            {counts["end-stage"] > 0 && <Badge variant="outline" className="text-xs">{counts["end-stage"]} end-stage</Badge>}
          </div>
        )}
      </div>

      {(!reports || reports.length === 0) && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <h3 className="font-semibold">No approved status reports yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Status Reports and Highlight Reports are generated during the Execution / Build / Delivery
              phase. As soon as one is approved it appears here.
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

      {reports && reports.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Filter:</span>
            <button
              onClick={() => setKindFilter("all")}
              className={`px-2 py-1 rounded-md border transition-colors ${kindFilter === "all" ? "border-primary text-primary" : "border-border hover:border-foreground/40"}`}
            >
              All ({reports.length})
            </button>
            {(["status", "highlight", "exception", "end-stage"] as ReportKind[]).map((k) => {
              const c = counts[k];
              if (c === 0) return null;
              return (
                <button
                  key={k}
                  onClick={() => setKindFilter(k)}
                  className={`px-2 py-1 rounded-md border transition-colors ${kindFilter === k ? "border-primary text-primary" : "border-border hover:border-foreground/40"}`}
                >
                  {KIND_STYLES[k].label}s ({c})
                </button>
              );
            })}
          </div>

          <div className="space-y-3">
            {filtered?.map((r) => {
              const style = KIND_STYLES[r.kind];
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
                    <FileText className="w-4 h-4 flex-shrink-0" style={{ color: style.color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{r.name}</p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${style.bg}`} style={{ color: style.color }}>
                          {style.label}
                        </span>
                        {r.phase && <span>{r.phase}</span>}
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
                        <p className="text-xs text-muted-foreground italic">This report has no body text.</p>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}

      {reports && reports.length > 0 && (
        <p className="text-[10px] text-muted-foreground/70 text-right">
          <Link href={`/projects/${projectId}/artefacts`} className="underline hover:text-foreground">
            Open Artefacts
          </Link>
        </p>
      )}
    </div>
  );
}
