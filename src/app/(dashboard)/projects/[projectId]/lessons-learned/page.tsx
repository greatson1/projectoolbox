"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { parseArtefactRows, pick } from "@/lib/artefact-rows";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Lightbulb, AlertCircle, Sparkles, ThumbsUp, ThumbsDown, ArrowRight } from "lucide-react";

/**
 * Lessons Learned aggregator.
 *
 * Every methodology now requires Lessons Learned in its closing-equivalent
 * phase, so a project that's been through multiple stages will accumulate
 * several Lessons Learned artefacts — one per phase. This page reads ALL
 * approved Lessons Learned artefacts in the project, parses each, and
 * presents them as a category-grouped feed.
 *
 * Lessons typically come in three flavours: what went well (keep doing),
 * what didn't (stop doing), and recommendations for the future (start doing).
 * The page classifies each row from a Category / Type / Sentiment column.
 */

type LessonCategory = "well" | "issue" | "recommendation" | "other";

function classifyLesson(row: Record<string, string>): LessonCategory {
  const cat = pick(row, "Category", "Type", "Sentiment", "Verdict", "Outcome").toLowerCase();
  const text = pick(row, "Lesson", "Observation", "Description", "Detail").toLowerCase();
  if (cat.includes("went well") || cat.includes("success") || cat.includes("positive") || cat.includes("keep")) {
    return "well";
  }
  if (cat.includes("issue") || cat.includes("problem") || cat.includes("didn") || cat.includes("stop") || cat.includes("negative")) {
    return "issue";
  }
  if (
    cat.includes("recommend") ||
    cat.includes("improvement") ||
    cat.includes("future") ||
    cat.includes("start") ||
    cat.includes("action")
  ) {
    return "recommendation";
  }
  // Light text heuristic if there's no category column at all.
  if (!cat && text) {
    if (text.startsWith("we should") || text.startsWith("next time") || text.includes("recommend")) {
      return "recommendation";
    }
  }
  return "other";
}

const CATEGORY_STYLES: Record<LessonCategory, { label: string; color: string; bg: string; icon: typeof ThumbsUp }> = {
  well: { label: "What went well", color: "#10B981", bg: "bg-emerald-500/5", icon: ThumbsUp },
  issue: { label: "Issues / what didn't work", color: "#EF4444", bg: "bg-red-500/5", icon: ThumbsDown },
  recommendation: { label: "Recommendations", color: "#6366F1", bg: "bg-indigo-500/5", icon: ArrowRight },
  other: { label: "Other observations", color: "#64748B", bg: "bg-slate-500/5", icon: Lightbulb },
};

export default function LessonsLearnedPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const sourceArtefacts = useMemo(() => {
    if (!artefacts) return [];
    return artefacts
      .filter((a: any) => {
        const n = (a.name || "").toLowerCase();
        return a.status === "APPROVED" && (n.includes("lessons learned") || n.includes("lessons log") || n.includes("retrospective"));
      })
      .sort((a: any, b: any) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
  }, [artefacts]);

  type Lesson = {
    id: string;
    sourceName: string;
    sourcePhase: string;
    category: LessonCategory;
    lesson: string;
    rootCause: string;
    action: string;
    owner: string;
    phase: string;
  };

  const lessons = useMemo<Lesson[] | null>(() => {
    if (sourceArtefacts.length === 0) return null;
    const out: Lesson[] = [];
    for (const art of sourceArtefacts) {
      const rows = parseArtefactRows(art.content);
      rows.forEach((row, idx) => {
        out.push({
          id: `${art.id}-${idx}`,
          sourceName: art.name,
          sourcePhase: art.phaseName || "",
          category: classifyLesson(row),
          lesson: pick(row, "Lesson", "Observation", "Description", "Detail", "Note") || "(no lesson text)",
          rootCause: pick(row, "Root Cause", "Cause", "Why"),
          action: pick(row, "Action", "Recommendation", "Next Time", "Mitigation"),
          owner: pick(row, "Owner", "Responsible", "Owner / Action By"),
          phase: pick(row, "Phase", "Stage", "Sprint", "PI") || art.phaseName || "",
        });
      });
    }
    return out.length > 0 ? out : null;
  }, [sourceArtefacts]);

  const sources = useMemo(() => {
    if (!lessons) return [] as string[];
    return Array.from(new Set(lessons.map((l) => l.sourceName))).sort();
  }, [lessons]);

  const filtered = useMemo(() => {
    if (!lessons) return null;
    if (sourceFilter === "all") return lessons;
    return lessons.filter((l) => l.sourceName === sourceFilter);
  }, [lessons, sourceFilter]);

  const grouped = useMemo(() => {
    if (!filtered) return null;
    const byCategory = new Map<LessonCategory, Lesson[]>();
    for (const l of filtered) {
      if (!byCategory.has(l.category)) byCategory.set(l.category, []);
      byCategory.get(l.category)!.push(l);
    }
    return byCategory;
  }, [filtered]);

  const totals = useMemo(() => {
    if (!filtered) return { total: 0, well: 0, issue: 0, recommendation: 0 };
    return filtered.reduce(
      (acc, l) => ({
        total: acc.total + 1,
        well: acc.well + (l.category === "well" ? 1 : 0),
        issue: acc.issue + (l.category === "issue" ? 1 : 0),
        recommendation: acc.recommendation + (l.category === "recommendation" ? 1 : 0),
      }),
      { total: 0, well: 0, issue: 0, recommendation: 0 },
    );
  }, [filtered]);

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-[1200px]">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-[1200px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Lightbulb className="w-6 h-6 text-primary" />
            Lessons Learned
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Captured lessons across every phase of <span className="font-medium text-foreground">{project?.name}</span>.
            Sourced from every approved Lessons Learned / Retrospective artefact in the project.
          </p>
        </div>
        {lessons && (
          <div className="flex flex-wrap gap-2 justify-end">
            <Badge variant="outline" className="text-xs">{totals.total} total</Badge>
            {totals.well > 0 && <Badge variant="outline" className="text-xs">{totals.well} went well</Badge>}
            {totals.issue > 0 && <Badge variant="outline" className="text-xs">{totals.issue} issues</Badge>}
            {totals.recommendation > 0 && <Badge variant="outline" className="text-xs">{totals.recommendation} recommendations</Badge>}
          </div>
        )}
      </div>

      {sourceArtefacts.length === 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
            <h3 className="font-semibold">No approved Lessons Learned artefacts yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Every methodology requires Lessons Learned in its closing phase. Generate the
              first one during a phase's review or retrospective to start populating this view.
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

      {sourceArtefacts.length > 0 && !lessons && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Approved Lessons Learned artefacts exist but contain no tabular data the page can parse.
          </CardContent>
        </Card>
      )}

      {lessons && sources.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Source:</span>
          <button
            onClick={() => setSourceFilter("all")}
            className={`px-2 py-1 rounded-md border transition-colors ${sourceFilter === "all" ? "border-primary text-primary" : "border-border hover:border-foreground/40"}`}
          >
            All ({lessons.length})
          </button>
          {sources.map((s) => (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={`px-2 py-1 rounded-md border transition-colors ${sourceFilter === s ? "border-primary text-primary" : "border-border hover:border-foreground/40"}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {grouped && (
        <div className="space-y-3">
          {(["well", "issue", "recommendation", "other"] as LessonCategory[]).map((cat) => {
            const items = grouped.get(cat);
            if (!items || items.length === 0) return null;
            const style = CATEGORY_STYLES[cat];
            const Icon = style.icon;
            return (
              <Card key={cat} className={`${style.bg} overflow-hidden`}>
                <CardContent className="p-0">
                  <div className="px-4 py-2.5 border-b border-border/40 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4" style={{ color: style.color }} />
                      <h2 className="font-semibold text-sm">{style.label}</h2>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {items.length}
                    </Badge>
                  </div>
                  <ul className="divide-y divide-border/30">
                    {items.map((l) => (
                      <li key={l.id} className="px-4 py-3 space-y-1.5">
                        <p className="text-sm leading-relaxed">{l.lesson}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          {l.rootCause && (
                            <span><span className="font-medium text-foreground/80">Root cause:</span> {l.rootCause}</span>
                          )}
                          {l.action && (
                            <span><span className="font-medium text-foreground/80">Action:</span> {l.action}</span>
                          )}
                          {l.owner && (
                            <Badge variant="outline" className="text-[9px]">{l.owner}</Badge>
                          )}
                          {l.phase && (
                            <Badge variant="outline" className="text-[9px]">{l.phase}</Badge>
                          )}
                          <span className="ml-auto text-[10px] text-muted-foreground/70">{l.sourceName}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {sourceArtefacts.length > 0 && (
        <p className="text-[10px] text-muted-foreground/70 text-right">
          {sourceArtefacts.length} source artefact{sourceArtefacts.length === 1 ? "" : "s"}{" · "}
          <Link href={`/projects/${projectId}/artefacts`} className="underline hover:text-foreground">
            Open Artefacts
          </Link>
        </p>
      )}
    </div>
  );
}
