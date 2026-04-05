"use client";

import { usePageTitle } from "@/hooks/use-page-title";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppStore } from "@/stores/app";
import { useProjects } from "@/hooks/use-api";
import { Plus, FolderKanban, Search } from "lucide-react";

const METHOD_LABEL: Record<string, string> = { PRINCE2: "PRINCE2", AGILE_SCRUM: "Scrum", AGILE_KANBAN: "Kanban", WATERFALL: "Waterfall", HYBRID: "Hybrid", SAFE: "SAFe" };

export default function ProjectsPage() {
  usePageTitle("Projects");
  const [search, setSearch] = useState("");
  const { setActiveProject } = useAppStore();
  const { data: projects, isLoading } = useProjects();

  const filtered = (projects || []).filter((p: any) => p.name.toLowerCase().includes(search.toLowerCase()));

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {(projects || []).length} projects · {(projects || []).filter((p: any) => p.status === "ACTIVE").length} active
          </p>
        </div>
        <Link href="/agents/deploy"><Button><Plus className="w-4 h-4 mr-1" /> New Project</Button></Link>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border max-w-md">
        <Search className="w-4 h-4 text-muted-foreground" />
        <input className="bg-transparent text-sm outline-none flex-1 placeholder:text-muted-foreground"
          placeholder="Search projects..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20">
          <FolderKanban className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">{search ? "No matching projects" : "No projects yet"}</h2>
          <p className="text-sm text-muted-foreground mb-4">{search ? "Try a different search term" : "Deploy an agent to create your first project"}</p>
          {!search && <Link href="/agents/deploy"><Button>Create First Project</Button></Link>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((p: any) => {
            const agent = p.agents?.[0]?.agent;
            return (
              <Link key={p.id} href={`/projects/${p.id}`} onClick={() => setActiveProject(p.id, p.name)}>
                <Card className="hover:-translate-y-0.5 transition-all cursor-pointer h-full">
                  <CardContent className="pt-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-[15px] font-bold truncate">{p.name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-[9px]">{METHOD_LABEL[p.methodology] || p.methodology}</Badge>
                          <Badge variant={p.status === "ACTIVE" ? "default" : "secondary"} className="text-[9px]">{p.status}</Badge>
                        </div>
                      </div>
                    </div>

                    {p.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{p.description}</p>
                    )}

                    <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-3">
                      <span>{p._count?.tasks || 0} tasks</span>
                      <span>{p._count?.risks || 0} risks</span>
                      {p.budget && <span>${(p.budget / 1000).toFixed(0)}K budget</span>}
                    </div>

                    {agent && (
                      <div className="flex items-center gap-2 pt-3 border-t border-border/30">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                          style={{ background: agent.gradient || "#6366F1" }}>{agent.name[0]}</div>
                        <span className="text-xs font-medium">Agent {agent.name}</span>
                        <span className={`w-1.5 h-1.5 rounded-full ml-auto ${agent.status === "ACTIVE" ? "bg-green-400 animate-pulse" : "bg-amber-400"}`} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
