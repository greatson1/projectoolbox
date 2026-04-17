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

  // Collapsible sidebar groups (persisted)
  collapsedGroups: string[];
  toggleGroup: (group: string) => void;

  // Pinned / favourite pages (persisted)
  pinnedPages: string[]; // href values e.g. "/risk", "/schedule"
  togglePin: (href: string) => void;

  // Command palette
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

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

      collapsedGroups: [],
      toggleGroup: (group) =>
        set((s) => ({
          collapsedGroups: s.collapsedGroups.includes(group)
            ? s.collapsedGroups.filter((g) => g !== group)
            : [...s.collapsedGroups, group],
        })),

      pinnedPages: [],
      togglePin: (href) =>
        set((s) => ({
          pinnedPages: s.pinnedPages.includes(href)
            ? s.pinnedPages.filter((p) => p !== href)
            : [...s.pinnedPages, href],
        })),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

      pendingApprovals: 0,
      unreadNotifications: 0,
      setPendingApprovals: (n) => set({ pendingApprovals: n }),
      setUnreadNotifications: (n) => set({ unreadNotifications: n }),

      accentTheme: "indigo",
      setAccentTheme: (t) => set({ accentTheme: t }),
    }),
    {
      name: "projectoolbox-app",
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        accentTheme: state.accentTheme,
        collapsedGroups: state.collapsedGroups,
        pinnedPages: state.pinnedPages,
      }),
    }
  )
);
