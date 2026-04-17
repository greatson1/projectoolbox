"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAppStore } from "@/stores/app";
import {
  LayoutDashboard, Bot, CheckSquare, FolderKanban, Calendar,
  Columns3, Timer, Target, DollarSign, Users, UserCog, ShieldAlert,
  AlertTriangle, GitPullRequest, TestTube2, ShieldCheck, TrendingUp,
  Briefcase, FileText, Bell, CreditCard, Settings,
  GitBranch, Dice5, Calculator, Table2, Brain, Video, Package,
  ClipboardList, FileBarChart, Award, MessageSquare, Activity,
  Rocket, Shield, BarChart3, Layers, Plug, Zap, Microscope,
  Search, Star, ArrowRight, FolderOpen,
} from "lucide-react";

// ─── All navigable pages ────────────────────────────────────────────────────

interface PageEntry {
  label: string;
  href: string;
  icon: React.ElementType;
  group: string;
  projectScoped?: boolean;
  keywords?: string; // extra search terms
}

const ALL_PAGES: PageEntry[] = [
  // Top level
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, group: "General" },

  // AI Agents
  { label: "Fleet Overview", href: "/agents", icon: Bot, group: "AI Agents" },
  { label: "Chat with Agent", href: "/agents/chat", icon: MessageSquare, group: "AI Agents" },
  { label: "Activity Log", href: "/activity", icon: Activity, group: "AI Agents" },
  { label: "Deploy Agent", href: "/agents/deploy", icon: Rocket, group: "AI Agents" },

  // Workspace
  { label: "Portfolio", href: "/portfolio", icon: Briefcase, group: "Workspace" },
  { label: "Projects", href: "/projects", icon: FolderKanban, group: "Workspace" },
  { label: "Approvals", href: "/approvals", icon: CheckSquare, group: "Workspace" },
  { label: "Meetings", href: "/meetings", icon: Video, group: "Workspace" },
  { label: "Calendar", href: "/calendar", icon: Calendar, group: "Workspace" },
  { label: "Knowledge Base", href: "/knowledge", icon: Brain, group: "Workspace", keywords: "kb research facts" },
  { label: "Research Audit", href: "/research", icon: Microscope, group: "Workspace" },

  // Plan
  { label: "PM Tracker", href: "/pm-tracker", icon: CheckSquare, group: "Plan", projectScoped: true, keywords: "tasks checklist" },
  { label: "Scope & WBS", href: "/scope", icon: Target, group: "Plan", projectScoped: true, keywords: "work breakdown" },
  { label: "Schedule", href: "/schedule", icon: Calendar, group: "Plan", projectScoped: true, keywords: "gantt timeline" },

  // Execute
  { label: "Agile Board", href: "/agile", icon: Columns3, group: "Execute", projectScoped: true, keywords: "kanban sprint" },
  { label: "Sprint Planning", href: "/sprint-planning", icon: Target, group: "Execute", projectScoped: true },
  { label: "Sprint Tracker", href: "/sprint", icon: Timer, group: "Execute", projectScoped: true },
  { label: "Actions", href: "/actions", icon: ClipboardList, group: "Execute", projectScoped: true },

  // Control
  { label: "Risk Register", href: "/risk", icon: ShieldAlert, group: "Control", projectScoped: true, keywords: "risks" },
  { label: "Issues", href: "/issues", icon: AlertTriangle, group: "Control", projectScoped: true, keywords: "problems bugs" },
  { label: "Change Control", href: "/change-control", icon: GitPullRequest, group: "Control", projectScoped: true, keywords: "change requests" },
  { label: "QA & Testing", href: "/qa-testing", icon: TestTube2, group: "Control", projectScoped: true, keywords: "quality" },
  { label: "Compliance", href: "/compliance", icon: ShieldCheck, group: "Control", projectScoped: true },
  { label: "Procurement", href: "/procurement", icon: Package, group: "Control", projectScoped: true, keywords: "vendors suppliers" },

  // Cost & Value
  { label: "Cost", href: "/cost", icon: DollarSign, group: "Cost & Value", projectScoped: true, keywords: "budget money" },
  { label: "Estimate", href: "/estimate", icon: Calculator, group: "Cost & Value", projectScoped: true },
  { label: "EVM", href: "/evm", icon: TrendingUp, group: "Cost & Value", projectScoped: true, keywords: "earned value" },
  { label: "Scorecard", href: "/scorecard", icon: Award, group: "Cost & Value", projectScoped: true },
  { label: "Benefits", href: "/benefits", icon: BarChart3, group: "Cost & Value", projectScoped: true },

  // Reports
  { label: "Reports", href: "/reports", icon: FileBarChart, group: "Reports", projectScoped: true },
  { label: "Report Composer", href: "/report-composer", icon: Layers, group: "Reports", projectScoped: true },
  { label: "Artefacts", href: "/artefacts", icon: FileText, group: "Reports", projectScoped: true, keywords: "documents deliverables" },
  { label: "Documents", href: "/documents", icon: FolderOpen, group: "Reports", projectScoped: true },

  // Stakeholders
  { label: "Stakeholders", href: "/stakeholders", icon: Users, group: "Stakeholders", projectScoped: true },
  { label: "Resources", href: "/resources", icon: UserCog, group: "Stakeholders", projectScoped: true, keywords: "team people" },

  // Tools
  { label: "Decision Tree", href: "/tools/decision-tree", icon: GitBranch, group: "Tools" },
  { label: "Monte Carlo", href: "/tools/monte-carlo", icon: Dice5, group: "Tools", keywords: "simulation probability" },
  { label: "NPV Calculator", href: "/tools/npv-calculator", icon: Calculator, group: "Tools", keywords: "net present value" },
  { label: "RACI Matrix", href: "/tools/raci-matrix", icon: Table2, group: "Tools" },

  // Account
  { label: "Integrations", href: "/settings/integrations", icon: Plug, group: "Account" },
  { label: "Automations", href: "/settings/automations", icon: Zap, group: "Account" },
  { label: "Notifications", href: "/notifications", icon: Bell, group: "Account" },
  { label: "Billing", href: "/billing", icon: CreditCard, group: "Account" },
  { label: "Settings", href: "/settings", icon: Settings, group: "Account" },
];

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const { commandPaletteOpen, setCommandPaletteOpen, activeProjectId, pinnedPages, togglePin } = useAppStore();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Ctrl+K / Cmd+K handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
      if (e.key === "Escape" && commandPaletteOpen) {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  // Focus input when opened
  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandPaletteOpen]);

  // Filter and sort results
  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    let pages = ALL_PAGES.filter((p) => {
      // Hide project-scoped pages if no project active
      if (p.projectScoped && !activeProjectId) return false;
      if (!q) return true;
      return (
        p.label.toLowerCase().includes(q) ||
        p.group.toLowerCase().includes(q) ||
        (p.keywords || "").toLowerCase().includes(q)
      );
    });
    // Pinned pages first, then sort by label
    pages.sort((a, b) => {
      const aPin = pinnedPages.includes(a.href) ? 0 : 1;
      const bPin = pinnedPages.includes(b.href) ? 0 : 1;
      if (aPin !== bPin) return aPin - bPin;
      return a.label.localeCompare(b.label);
    });
    return pages;
  }, [query, activeProjectId, pinnedPages]);

  // Keyboard navigation
  const navigate = useCallback(
    (page: PageEntry) => {
      const path = page.projectScoped && activeProjectId
        ? `/projects/${activeProjectId}${page.href}`
        : page.href;
      router.push(path);
      setCommandPaletteOpen(false);
    },
    [activeProjectId, router, setCommandPaletteOpen]
  );

  useEffect(() => {
    if (!commandPaletteOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && results[selectedIndex]) {
        e.preventDefault();
        navigate(results[selectedIndex]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [commandPaletteOpen, results, selectedIndex, navigate]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!commandPaletteOpen) return null;

  // Group results
  const grouped: Record<string, PageEntry[]> = {};
  results.forEach((p) => {
    const key = pinnedPages.includes(p.href) ? "Pinned" : p.group;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(p);
  });

  let flatIndex = 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      onClick={() => setCommandPaletteOpen(false)}>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            placeholder="Search pages... type to filter"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground">ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">No pages match &ldquo;{query}&rdquo;</p>
            </div>
          ) : (
            Object.entries(grouped).map(([group, pages]) => (
              <div key={group}>
                <p className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {group}
                </p>
                {pages.map((page) => {
                  const idx = flatIndex++;
                  const isSelected = idx === selectedIndex;
                  const isPinned = pinnedPages.includes(page.href);
                  const Icon = page.icon;
                  return (
                    <div
                      key={page.href}
                      data-index={idx}
                      onClick={() => navigate(page)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`flex items-center gap-3 px-4 py-2 mx-1 rounded-lg cursor-pointer transition-colors ${
                        isSelected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted/50"
                      }`}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                      <span className="text-sm font-medium flex-1">{page.label}</span>
                      {page.projectScoped && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">project</span>
                      )}
                      {isPinned && <Star className="w-3 h-3 text-amber-500 fill-amber-500" />}
                      <button
                        onClick={(e) => { e.stopPropagation(); togglePin(page.href); }}
                        className="opacity-0 group-hover:opacity-100 hover:opacity-100 p-0.5"
                        title={isPinned ? "Unpin" : "Pin to favourites"}
                        style={{ opacity: isSelected ? 1 : undefined }}
                      >
                        <Star className={`w-3 h-3 ${isPinned ? "text-amber-500 fill-amber-500" : "text-muted-foreground"}`} />
                      </button>
                      {isSelected && <ArrowRight className="w-3 h-3 text-primary" />}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-border text-[10px] text-muted-foreground">
          <span><kbd className="px-1 py-0.5 rounded bg-muted font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="px-1 py-0.5 rounded bg-muted font-mono">↵</kbd> open</span>
          <span><kbd className="px-1 py-0.5 rounded bg-muted font-mono">esc</kbd> close</span>
          <span className="ml-auto"><Star className="w-2.5 h-2.5 inline text-amber-500" /> click star to pin</span>
        </div>
      </div>
    </div>
  );
}
