"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { useAppStore } from "@/stores/app";
import { cn } from "@/lib/utils";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed } = useAppStore();

  return (
    <div className="min-h-screen">
      <Sidebar />
      <div className={cn("transition-all duration-200", sidebarCollapsed ? "ml-[60px]" : "ml-[240px]")}>
        <Header />
        <main className="p-6 lg:p-8 animate-page-enter">{children}</main>
      </div>
    </div>
  );
}
