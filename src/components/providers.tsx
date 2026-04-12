"use client";

import { ThemeProvider } from "next-themes";
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
            staleTime: 5 * 60 * 1000,     // 5 min — data stays fresh, no refetch on navigate
            gcTime: 15 * 60 * 1000,        // 15 min — keep unused data in cache
            refetchOnWindowFocus: false,
            refetchOnMount: false,          // don't refetch if data is fresh
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
  );
}
