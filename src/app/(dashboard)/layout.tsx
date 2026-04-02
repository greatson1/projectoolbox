"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { useAppStore } from "@/stores/app";
import { useAgentSSE } from "@/hooks/use-sse";
import { cn } from "@/lib/utils";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed } = useAppStore();

  // Connect to real-time SSE for badge updates
  useAgentSSE();

  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className={cn("transition-all duration-200", sidebarCollapsed ? "ml-[60px]" : "ml-[240px]")}>
        <Header />
        <main className="p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
