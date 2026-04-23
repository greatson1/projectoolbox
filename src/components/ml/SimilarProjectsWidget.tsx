"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { GitBranch, ArrowRight, Info, Sparkles } from "lucide-react";

interface SimilarProject {
  projectId: string;
  name: string;
  similarity: number;
  category?: string | null;
  methodology?: string | null;
  status?: string | null;
}

/** Widget showing similar past projects based on embedding similarity. */
export function SimilarProjectsWidget({ projectId }: { projectId: string }) {
  const [projects, setProjects] = useState<SimilarProject[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    fetch(`/api/ml/predictions?kind=similar_projects&projectId=${projectId}&k=5`)
      .then((r) => r.json())
      .then((json) => {
        if (Array.isArray(json.data)) setProjects(json.data);
        else setError(json.error || "No similar projects found");
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [projectId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-bold">Similar Projects</h3>
            <span className="text-[9px] text-muted-foreground">ML</span>
          </div>
          <Skeleton className="h-16 w-full mb-2" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !projects || projects.length === 0) {
    return (
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-bold">Similar Projects</h3>
            <span className="text-[9px] text-muted-foreground">ML</span>
          </div>
          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/30 text-xs text-muted-foreground">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <p>
              {error || "No comparable projects yet. Similarity search activates once you have 2+ projects with embeddings. New embeddings are generated overnight."}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold">Similar Projects</h3>
          <span className="text-[9px] text-muted-foreground">ML-based similarity</span>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Past projects with the most similar description, category, and methodology.
        </p>
        <div className="space-y-2">
          {projects.map((p) => {
            const pct = Math.round(p.similarity * 100);
            const bar = pct >= 85 ? "bg-emerald-500" : pct >= 70 ? "bg-primary" : "bg-amber-500";
            return (
              <Link key={p.projectId} href={`/projects/${p.projectId}`}
                className="block p-3 rounded-lg border border-border/60 hover:border-primary/40 hover:bg-muted/30 transition-all group">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold truncate">{p.name}</span>
                      {p.status && <Badge variant="outline" className="text-[9px]">{p.status}</Badge>}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-1.5">
                      {p.category && <span>{p.category}</span>}
                      {p.methodology && <><span>·</span><span>{p.methodology}</span></>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-20 h-1 rounded-full bg-muted overflow-hidden">
                        <span className={`block h-full ${bar} rounded-full`} style={{ width: `${pct}%` }} />
                      </span>
                      <span className="text-[10px] font-mono tabular-nums text-muted-foreground">{pct}% similar</span>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary flex-shrink-0" />
                </div>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
