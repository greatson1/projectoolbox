import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppState {
  // Active project context (for sidebar project-scoped routes)
  activeProjectId: string | null;
  activeProjectName: string | null;
  setActiveProject: (id: string | null, name?: string | null) => void;

  // Sidebar
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Counts for badges
  pendingApprovals: number;
  unreadNotifications: number;
  setPendingApprovals: (n: number) => void;
  setUnreadNotifications: (n: number) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeProjectId: null,
      activeProjectName: null,
      setActiveProject: (id, name = null) => set({ activeProjectId: id, activeProjectName: name }),

      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      pendingApprovals: 0,
      unreadNotifications: 0,
      setPendingApprovals: (n) => set({ pendingApprovals: n }),
      setUnreadNotifications: (n) => set({ unreadNotifications: n }),
    }),
    { name: "projectoolbox-app" }
  )
);
