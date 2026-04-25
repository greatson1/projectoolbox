"use client";

import { ThemeProvider } from "next-themes";
import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect, type ReactNode } from "react";
import { AppProgressBar as ProgressBar } from "next-nprogress-bar";
import { useAppStore } from "@/stores/app";

function AccentThemeApplier() {
  const accentTheme = useAppStore((s) => s.accentTheme);
  useEffect(() => {
    const el = document.documentElement;
    el.classList.remove("theme-midnight", "theme-emerald");
    if (accentTheme === "midnight") el.classList.add("theme-midnight");
    if (accentTheme === "emerald") el.classList.add("theme-emerald");
  }, [accentTheme]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 15s stale window — keeps in-page navigation fast (no refetch
            // when popping between sub-pages within seconds) without letting
            // post-mutation state drift across pages. Phase changes,
            // approvals, and task updates land on every surface within 15s
            // of switching to it.
            staleTime: 15 * 1000,
            gcTime: 15 * 60 * 1000,        // 15 min — keep unused data in cache
            // Refetch when the tab regains focus so coming back from another
            // app/tab doesn't show 5-minute-old phase or task counts.
            refetchOnWindowFocus: true,
            // Default (true) — refetch on mount if data is stale. With the
            // 15s staleTime this means hopping between pages refreshes data
            // that's older than 15 seconds.
            refetchOnMount: true,
            // Retry on 403 "session loading" errors (orgId not yet in JWT after refresh)
            retry: (failureCount, error: any) => {
              if (error?.message?.includes("session may still be loading") && failureCount < 3) return true;
              return failureCount < 1; // normal errors retry once
            },
            retryDelay: 1500,
          },
        },
      })
  );

  return (
    <SessionProvider>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem={false}
      >
        <AccentThemeApplier />
        <ProgressBar
          height="3px"
          color="#6366F1"
          options={{ showSpinner: false, speed: 300, minimum: 0.2 }}
          shallowRouting
        />
        {children}
      </ThemeProvider>
    </QueryClientProvider>
    </SessionProvider>
  );
}
