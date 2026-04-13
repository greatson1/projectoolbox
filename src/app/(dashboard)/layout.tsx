"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { AgentStatusBar } from "@/components/layout/agent-status-bar";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { useAppStore } from "@/stores/app";
import { cn } from "@/lib/utils";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed } = useAppStore();

  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className={cn("transition-all duration-200", sidebarCollapsed ? "ml-[60px]" : "ml-[240px]")}>
        <Header />
        {/* pb-14 so page content never hides behind the status bar */}
        <main className="p-6 lg:p-8 pb-16 animate-page-enter">{children}</main>
      </div>
      {/* Global agent co-pilot bar — visible on every page */}
      <ErrorBoundary>
        <AgentStatusBar />
      </ErrorBoundary>
    </div>
  );
}
