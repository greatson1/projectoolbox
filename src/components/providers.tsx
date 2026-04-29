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
            // 60s stale window — perf tuning. The earlier 15s value combined
            // with refetchOnWindowFocus + refetchOnMount produced a refetch
            // storm on every alt-tab back into the app: every cached query
            // older than 15s would re-run, and at any one time the dashboard
            // has 6–10 active queries. 60s is still tight enough that
            // post-mutation drift surfaces within a minute on any view, but
            // far enough out to absorb normal page hopping.
            staleTime: 60 * 1000,
            gcTime: 15 * 60 * 1000,        // 15 min — keep unused data in cache
            // Disabled — focus refetch was the single biggest source of
            // perceived slowness when returning from another tab. Hooks that
            // genuinely need fresh data on focus opt in at the call site
            // (e.g. agent-status-bar polls explicitly via setInterval).
            refetchOnWindowFocus: false,
            // Default (true) — refetch on mount if data is stale. Combined
            // with the 60s staleTime, hopping between pages within a minute
            // serves cache; longer than that triggers a single refetch.
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
