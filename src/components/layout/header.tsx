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
  const { unreadNotifications, sidebarCollapsed, setCommandPaletteOpen } = useAppStore();
  const [mounted, setMounted] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
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
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border w-full text-left hover:bg-muted/70 transition-colors"
        >
          <Search className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground flex-1">Search pages, projects, tools...</span>
          <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground">Ctrl+K</kbd>
        </button>
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

        {/* User avatar + sign out */}
        <div className="relative">
          <Button variant="ghost" size="icon" className="rounded-lg" onClick={() => setUserMenuOpen(!userMenuOpen)}>
            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-[11px] font-bold text-primary-foreground">
              TB
            </div>
          </Button>
          {userMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-40 py-1.5 rounded-lg border border-border bg-card shadow-xl z-50">
                <Link href="/admin" className="block px-4 py-2 text-sm hover:bg-muted transition-colors" onClick={() => setUserMenuOpen(false)}>Settings</Link>
                <div className="h-px bg-border mx-2 my-1" />
                <button onClick={() => { import("next-auth/react").then(m => m.signOut({ callbackUrl: "/login" })); }}
                  className="block w-full text-left px-4 py-2 text-sm text-destructive hover:bg-muted transition-colors">
                  Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
