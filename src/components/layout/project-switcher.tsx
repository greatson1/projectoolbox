"use client";

/**
 * ProjectSwitcher — always-visible project picker in the top header.
 *
 * Goal: switching from one project to another should be ONE click
 * (down from ~3 in the old flow of sidebar → Projects → click).
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ [Logo] [Family Trip to Lagos ▼ / Risk]   [Search] [☰ □ TB]  │
 *   └──────────────────────────────────────────────────────────────┘
 *           └──── click anywhere here ────┘
 *                              ↓
 *              ┌────────────────────────────────┐
 *              │  🔍 Search projects…            │
 *              │  ───────────────────────────── │
 *              │  RECENT                         │
 *              │   ▸ Family Trip to Lagos       │
 *              │   ▸ Execution Phase Test        │
 *              │   ▸ AI4PMS Site                │
 *              │  ALL                            │
 *              │   ▸ Acme CRM Migration         │
 *              │   ▸ … etc.                     │
 *              │  ───────────────────────────── │
 *              │  + New project                  │
 *              │  ▣ All projects                 │
 *              └────────────────────────────────┘
 *
 * Triggered by click on the breadcrumb OR by Cmd+P / Ctrl+P. The same
 * keyboard shortcut closes it.
 *
 * "Section" segment after the / shows the current sub-page (Risk,
 * Schedule, etc.) when a project is in scope, drawn from the URL.
 * Clicking it jumps back to the project overview.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronDown, Plus, Search, FolderOpen, Folder } from "lucide-react";
import { useAppStore } from "@/stores/app";
import { useProjects } from "@/hooks/use-api";

const PATH_SECTION_LABEL: Record<string, string> = {
  "pm-tracker": "PM Tracker",
  "scope": "Scope & WBS",
  "schedule": "Schedule",
  "agile": "Task Board",
  "sprint-planning": "Sprint Planning",
  "sprint": "Sprint Tracker",
  "actions": "Actions",
  "risk": "Risk Register",
  "issues": "Issues",
  "change-control": "Change Control",
  "qa-testing": "QA & Testing",
  "compliance": "Compliance",
  "procurement": "Procurement",
  "cost": "Cost",
  "estimate": "Estimate",
  "evm": "EVM",
  "scorecard": "Scorecard",
  "benefits": "Benefits",
  "reports": "Reports",
  "report-composer": "Composer",
  "artefacts": "Artefacts",
  "documents": "Documents",
  "stakeholders": "Stakeholders",
  "resources": "Resources",
  "audit": "Audit",
};

/** Pull the section label (e.g. "Risk Register") from a pathname like
 *  /projects/abc123/risk. Returns null on the overview page. */
function getCurrentSection(pathname: string, projectId: string | null): string | null {
  if (!projectId) return null;
  const base = `/projects/${projectId}`;
  if (pathname === base || pathname === `${base}/`) return null;
  const rest = pathname.slice(base.length + 1).split("/")[0];
  return PATH_SECTION_LABEL[rest] ?? rest;
}

export function ProjectSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const { activeProjectId, recentProjectIds } = useAppStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd+P / Ctrl+P opens the switcher. The browser maps Cmd+P to "Print"
  // by default; we preventDefault so the user gets the switcher instead.
  // Cmd+K already opens the global command palette so the two don't
  // collide.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus the search box when opened.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
    else setQuery("");
  }, [open]);

  // Fetch all (non-archived) projects so the dropdown can render both
  // the recent list AND the full list. Cheap — React Query caches it.
  const { data: projects } = useProjects();
  const allProjects = useMemo(() => Array.isArray(projects) ? projects : [], [projects]);
  const projectById = useMemo(() => {
    const m = new Map<string, any>();
    for (const p of allProjects) m.set(p.id, p);
    return m;
  }, [allProjects]);

  const activeProject = activeProjectId ? projectById.get(activeProjectId) : null;
  const section = getCurrentSection(pathname, activeProjectId);

  // Build the visible lists. When searching, collapse to a single
  // result block; otherwise split into Recent + All.
  const { recent, others, isSearching } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      const matches = allProjects.filter((p) =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q),
      );
      return { recent: [], others: matches, isSearching: true };
    }
    const recentMap = new Set(recentProjectIds);
    const recent = recentProjectIds
      .map((id) => projectById.get(id))
      .filter(Boolean);
    const others = allProjects.filter((p) => !recentMap.has(p.id));
    return { recent, others, isSearching: false };
  }, [query, allProjects, recentProjectIds, projectById]);

  const goToProject = useCallback((id: string) => {
    setOpen(false);
    setQuery("");
    router.push(`/projects/${id}`);
  }, [router]);

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      {/* Trigger button — shows current project + section breadcrumb */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-muted/50 transition-colors max-w-[260px] sm:max-w-[320px]"
        aria-label="Switch project"
      >
        <Folder className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        {activeProject ? (
          <span className="text-xs font-semibold truncate">
            {activeProject.name}
            {section && (
              <span className="text-muted-foreground font-normal"> / {section}</span>
            )}
          </span>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">Switch project</span>
        )}
        <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform flex-shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute left-0 top-full mt-1 w-[320px] sm:w-[360px] py-2 rounded-lg border border-border bg-card shadow-xl z-50"
          role="dialog"
        >
          {/* Search */}
          <div className="px-2.5 pb-2 border-b border-border/60">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/40 border border-border/60">
              <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects…"
                className="bg-transparent outline-none text-xs flex-1 placeholder:text-muted-foreground"
              />
              <kbd className="px-1 py-0.5 rounded bg-muted text-[9px] font-mono text-muted-foreground">⌘P</kbd>
            </div>
          </div>

          {/* Results */}
          <div className="max-h-[60vh] overflow-y-auto py-1">
            {isSearching ? (
              others.length === 0 ? (
                <p className="px-3 py-3 text-xs text-muted-foreground italic">No projects match "{query}".</p>
              ) : (
                <ProjectList projects={others} activeId={activeProjectId} onSelect={goToProject} />
              )
            ) : (
              <>
                {recent.length > 0 && (
                  <ProjectGroup title="Recent">
                    <ProjectList projects={recent} activeId={activeProjectId} onSelect={goToProject} />
                  </ProjectGroup>
                )}
                {others.length > 0 && (
                  <ProjectGroup title={recent.length > 0 ? "All projects" : "Projects"}>
                    <ProjectList projects={others} activeId={activeProjectId} onSelect={goToProject} />
                  </ProjectGroup>
                )}
                {recent.length === 0 && others.length === 0 && (
                  <p className="px-3 py-3 text-xs text-muted-foreground italic">No projects yet — deploy an agent to create your first.</p>
                )}
              </>
            )}
          </div>

          {/* Footer actions */}
          <div className="border-t border-border/60 mt-1 pt-1.5 px-1.5 flex items-center gap-1">
            <Link
              href="/projects"
              onClick={() => setOpen(false)}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-muted/60 text-xs flex-1"
            >
              <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
              All projects
            </Link>
            <Link
              href="/agents/deploy"
              onClick={() => setOpen(false)}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-muted/60 text-xs"
            >
              <Plus className="w-3.5 h-3.5 text-primary" />
              <span className="font-medium">New</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <p className="px-3 pb-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">{title}</p>
      {children}
    </div>
  );
}

function ProjectList({
  projects, activeId, onSelect,
}: { projects: any[]; activeId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="flex flex-col">
      {projects.slice(0, 20).map((p) => (
        <button
          key={p.id}
          onClick={() => onSelect(p.id)}
          className={`flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
            p.id === activeId ? "bg-primary/8" : "hover:bg-muted/50"
          }`}
        >
          <Folder className={`w-3.5 h-3.5 flex-shrink-0 ${p.id === activeId ? "text-primary" : "text-muted-foreground"}`} />
          <span className={`text-xs truncate ${p.id === activeId ? "font-semibold text-primary" : ""}`}>
            {p.name}
          </span>
          {p.status && p.status !== "ACTIVE" && (
            <span className="ml-auto text-[9px] uppercase tracking-wider text-muted-foreground flex-shrink-0">
              {p.status.toLowerCase()}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
