"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useProject } from "@/hooks/use-api";
import { useAppStore } from "@/stores/app";
import { Briefcase, ArrowLeft } from "lucide-react";

/**
 * Project-scoped layout. Wraps every page under /projects/[projectId]/* so:
 *
 *   1. The Zustand `activeProjectId` stays in sync with the URL. Without
 *      this, only the project HOME page set the active project — sub-pages
 *      (PM Tracker, Schedule, Risk, etc.) didn't, so a direct navigation
 *      or refresh on a sub-page left the sidebar with a stale or null
 *      `activeProjectId` and the entire project section disappeared from
 *      the left nav. Users had to navigate back to the project home just
 *      to get Schedule / Risk / etc. visible again.
 *
 *   2. Every project sub-page renders a small context strip showing which
 *      project they're in, with a one-click "back to project" link. PM
 *      Tracker, Risk, etc. used to render with no indication of the
 *      parent project at all.
 */
export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const pathname = usePathname();
  const { data: project } = useProject(projectId);
  const { activeProjectId, setActiveProject } = useAppStore();

  // Show the project-context strip on every sub-page, but skip it on the
  // project home page — it already has its own hero header showing the
  // project name + status.
  const isProjectHome = pathname === `/projects/${projectId}` || pathname === `/projects/${projectId}/`;

  // Sync URL → store. Runs on every project sub-page so the sidebar's
  // project section never disappears just because the user clicked
  // straight into PM Tracker from a bookmark.
  useEffect(() => {
    if (!projectId) return;
    // Use the URL's projectId as the source of truth. Name follows once
    // the React-Query fetch resolves; until then we set id-only so the
    // sidebar can already show the project-scoped items.
    if (activeProjectId !== projectId) {
      setActiveProject(projectId, project?.name ?? null);
    } else if (project?.name && project.name !== useAppStore.getState().activeProjectName) {
      setActiveProject(projectId, project.name);
    }
  }, [projectId, project?.name, activeProjectId, setActiveProject]);

  return (
    <div className="space-y-3">
      {/* Project context strip — visible on every project sub-page so the
          user always knows which project they're in. Suppressed on the
          project home page itself (it has its own hero header). */}
      {project && !isProjectHome && (
        <div className="flex items-center justify-between gap-3 px-3 py-2 -mt-2 -mx-3 sm:-mx-6 lg:-mx-8 border-b border-border/40 bg-muted/20">
          <Link
            href={`/projects/${projectId}`}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors min-w-0"
            title="Back to project overview"
          >
            <ArrowLeft className="w-3.5 h-3.5 flex-shrink-0" />
            <Briefcase className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="font-medium text-foreground truncate">{project.name}</span>
            {(project as any)?.code && (
              <span className="text-[11px] text-muted-foreground/80 flex-shrink-0">· {(project as any).code}</span>
            )}
          </Link>
        </div>
      )}
      {children}
    </div>
  );
}
