"use client";

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { useAppStore } from "@/stores/app";
import { Bell, Moon, Sun, Search, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OrgSwitcher } from "./org-switcher";
import Link from "next/link";

export function Header() {
  const { setTheme, resolvedTheme } = useTheme();
  const { unreadNotifications, sidebarCollapsed } = useAppStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between h-16 px-6 border-b border-border bg-background/80 backdrop-blur-md"
    >
      {/* Org Switcher + Search */}
      <div className="flex items-center gap-3 flex-1 max-w-lg">
        <OrgSwitcher />
      </div>
      <div className="flex items-center gap-2 flex-1 max-w-md">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border w-full">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search projects, agents, tasks... ⌘K"
            className="bg-transparent text-sm outline-none flex-1 placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="rounded-lg"
        >
          {mounted ? (
            resolvedTheme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />
          ) : (
            <span className="w-4 h-4" />
          )}
        </Button>

        {/* Notifications */}
        <Link href="/notifications">
          <Button variant="ghost" size="icon" className="rounded-lg relative">
            <Bell className="w-4 h-4" />
            {unreadNotifications > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-destructive text-[9px] font-bold text-white flex items-center justify-center">
                {unreadNotifications > 9 ? "9+" : unreadNotifications}
              </span>
            )}
          </Button>
        </Link>

        {/* User avatar */}
        <Button variant="ghost" size="icon" className="rounded-lg">
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-[11px] font-bold text-primary-foreground">
            TB
          </div>
        </Button>
      </div>
    </header>
  );
}
