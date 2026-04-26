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
import { Plus, FolderKanban, Search, Trash2, MoreVertical } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const METHOD_LABEL: Record<string, string> = { PRINCE2: "Traditional", prince2: "Traditional", AGILE_SCRUM: "Scrum", scrum: "Scrum", AGILE_KANBAN: "Kanban", kanban: "Kanban", WATERFALL: "Waterfall", waterfall: "Waterfall", HYBRID: "Hybrid", hybrid: "Hybrid", SAFE: "SAFe", safe: "SAFe" };

export default function ProjectsPage() {
  usePageTitle("Projects");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const { setActiveProject, activeProjectId, setActiveProject: clearProject } = useAppStore();
  const { data: projects, isLoading } = useProjects(tab === "archived" ? { include: "only-archived" } : undefined);
  const qc = useQueryClient();

  const deleteProject = async (id: string, name: string) => {
    setDeletingId(id);
    try {
      const r = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed");
      toast.success(`"${name}" deleted`);
      if (activeProjectId === id) setActiveProject(null, null);
      qc.invalidateQueries({ queryKey: ["projects"] });
    } catch {
      toast.error("Delete failed");
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  };

  const filtered = (projects || []).filter((p: any) => p.name.toLowerCase().includes(search.toLowerCase()));

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        title="Projects"
        subtitle={
          tab === "archived"
            ? `${(projects || []).length} archived projects`
            : `${(projects || []).length} projects · ${(projects || []).filter((p: any) => p.status === "ACTIVE").length} active`
        }
        icon={<FolderKanban className="w-5 h-5" />}
        actions={<Link href="/agents/deploy"><Button><Plus className="w-4 h-4 mr-1" /> New Project</Button></Link>}
      />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/40 border border-border">
          <button
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${tab === "active" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTab("active")}
          >
            Active
          </button>
          <button
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${tab === "archived" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTab("archived")}
          >
            Archived
          </button>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border flex-1 sm:max-w-md">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input className="bg-transparent text-sm outline-none flex-1 placeholder:text-muted-foreground"
            placeholder="Search projects..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20">
          <FolderKanban className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">
            {search ? "No matching projects" : tab === "archived" ? "No archived projects" : "No projects yet"}
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            {search
              ? "Try a different search term"
              : tab === "archived"
                ? "Archived projects appear here once you archive them. The audit trail stays accessible."
                : "Deploy an agent to create your first project"}
          </p>
          {!search && tab === "active" && <Link href="/agents/deploy"><Button>Create First Project</Button></Link>}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
          {filtered.map((p: any) => {
            const agent = p.agents?.[0]?.agent;
            return (
              <div key={p.id} className="relative group">
                <Link href={`/projects/${p.id}`} onClick={() => setActiveProject(p.id, p.name)}>
                <Card className="card-interactive h-full">
                  <CardContent className="pt-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-[15px] font-bold truncate">{p.name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-[9px]">{METHOD_LABEL[p.methodology] || p.methodology}</Badge>
                          <Badge variant={p.status === "ACTIVE" ? "default" : p.status === "ARCHIVED" ? "outline" : "secondary"}
                            className={`text-[9px] ${p.status === "ARCHIVED" ? "border-slate-500/40 text-slate-400" : ""}`}>{p.status}</Badge>
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

                {/* Delete button — appears on hover */}
                {confirmId === p.id ? (
                  <div className="absolute top-2 right-2 flex items-center gap-1 bg-destructive/95 rounded-lg px-2 py-1 shadow-lg z-10">
                    <span className="text-[10px] text-white font-medium">Delete?</span>
                    <button className="text-[10px] text-white font-bold hover:text-white/70 px-1"
                      onClick={() => deleteProject(p.id, p.name)}
                      disabled={deletingId === p.id}>
                      {deletingId === p.id ? "…" : "Yes"}
                    </button>
                    <button className="text-[10px] text-white/70 hover:text-white px-1"
                      onClick={() => setConfirmId(null)}>No</button>
                  </div>
                ) : (
                  <button
                    onClick={e => { e.preventDefault(); setConfirmId(p.id); }}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 rounded-lg bg-destructive/10 hover:bg-destructive/20 flex items-center justify-center z-10"
                    title="Delete project">
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
