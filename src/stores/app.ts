import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AccentTheme = "indigo" | "midnight" | "emerald";

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

  // Accent colour theme
  accentTheme: AccentTheme;
  setAccentTheme: (t: AccentTheme) => void;
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

      accentTheme: "indigo",
      setAccentTheme: (t) => set({ accentTheme: t }),
    }),
    {
      name: "projectoolbox-app",
      // Do NOT persist active project context — it becomes stale after data resets / org switches.
      // The sidebar validates and restores it from the live project list on mount.
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        accentTheme: state.accentTheme,
      }),
    }
  )
);
