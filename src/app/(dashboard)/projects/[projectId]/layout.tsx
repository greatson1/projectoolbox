"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useProject } from "@/hooks/use-api";
import { useAppStore } from "@/stores/app";

/**
 * Project-scoped layout. Wraps every page under /projects/[projectId]/* so
 * the Zustand `activeProjectId` stays in sync with the URL.
 *
 * Before this layout existed only the project HOME page called
 * setActiveProject — sub-pages (PM Tracker, Schedule, Risk, etc.) didn't.
 * A direct navigation or refresh on a sub-page therefore left the store
 * with a stale or null `activeProjectId` and the sidebar's project
 * groups vanished + the header switcher fell back to "Switch project"
 * instead of showing the active project's name.
 *
 * The URL is the source of truth: whichever projectId is in the URL is
 * the project the user is working on. The header's ProjectSwitcher reads
 * activeProjectId/Name from the store, so syncing here is enough to keep
 * the existing switcher chip showing "Atlas / PM Tracker" instead of
 * "Switch project".
 */
export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useProject(projectId);
  const { activeProjectId, activeProjectName, setActiveProject } = useAppStore();

  useEffect(() => {
    if (!projectId) return;
    // Set id immediately so the sidebar shows the project groups even
    // before the project fetch resolves; refine with the name once we
    // have it.
    if (activeProjectId !== projectId) {
      setActiveProject(projectId, project?.name ?? null);
    } else if (project?.name && project.name !== activeProjectName) {
      setActiveProject(projectId, project.name);
    }
  }, [projectId, project?.name, activeProjectId, activeProjectName, setActiveProject]);

  return <>{children}</>;
}
