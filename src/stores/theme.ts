import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ThemeTokens {
  bg: string;
  surface: string;
  card: string;
  border: string;
  text: string;
  textMuted: string;
  textDim: string;
  primary: string;
  primaryLight: string;
  primaryBg: string;
  accent: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  danger: string;
  dangerBg: string;
  gradient1: string;
}

export const darkTokens: ThemeTokens = {
  bg: "#0B0F1A",
  surface: "#111827",
  card: "#151D2E",
  border: "#1E293B",
  text: "#F1F5F9",
  textMuted: "#94A3B8",
  textDim: "#64748B",
  primary: "#6366F1",
  primaryLight: "#818CF8",
  primaryBg: "rgba(99,102,241,0.12)",
  accent: "#22D3EE",
  success: "#34D399",
  successBg: "rgba(52,211,153,0.12)",
  warning: "#FBBF24",
  warningBg: "rgba(251,191,36,0.12)",
  danger: "#F87171",
  dangerBg: "rgba(248,113,113,0.12)",
  gradient1: "linear-gradient(135deg, #6366F1, #8B5CF6, #A855F7)",
};

export const lightTokens: ThemeTokens = {
  bg: "#F8FAFC",
  surface: "#FFFFFF",
  card: "#FFFFFF",
  border: "#E2E8F0",
  text: "#0F172A",
  textMuted: "#475569",
  textDim: "#94A3B8",
  primary: "#6366F1",
  primaryLight: "#818CF8",
  primaryBg: "#EEF2FF",
  accent: "#0EA5E9",
  success: "#10B981",
  successBg: "#D1FAE5",
  warning: "#F59E0B",
  warningBg: "#FEF3C7",
  danger: "#EF4444",
  dangerBg: "#FEE2E2",
  gradient1: "linear-gradient(135deg, #6366F1, #8B5CF6, #A855F7)",
};

interface ThemeState {
  isDark: boolean;
  tokens: ThemeTokens;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      isDark: true,
      tokens: darkTokens,
      toggle: () =>
        set((state) => ({
          isDark: !state.isDark,
          tokens: state.isDark ? lightTokens : darkTokens,
        })),
    }),
    { name: "projectoolbox-theme" }
  )
);
