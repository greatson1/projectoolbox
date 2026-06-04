"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppStore } from "@/stores/app";
import { cn } from "@/lib/utils";
import { useProject } from "@/hooks/use-api";
import { methodologyFeatures, boardPageLabel } from "@/lib/methodology-definitions";
import {
  CheckSquare, Target, Calendar, Columns3, Timer, ClipboardList,
  ShieldAlert, AlertTriangle, GitPullRequest, TestTube2, ShieldCheck,
  Package, DollarSign, Calculator, TrendingUp, Award, BarChart3,
  FileBarChart, Layers, FileText, FolderOpen, Users, UserCog,
  ChevronDown, LayoutDashboard,
} from "lucide-react";

interface TabItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

interface TabGroup {
  label: string;
  color: string;
  items: TabItem[];
}

/**
 * Filter the default tab groups to what makes sense for the project's
 * methodology. Hides Sprint Planning + Sprint Tracker on methodologies
 * that don't have sprints, relabels the board, and prunes EVM /
 * Procurement on agile-only / trip methodologies. The PROJECT_TABS
 * constant below is the full superset; this function carves it.
 *
 * Keeping the routes themselves accessible by direct URL — only the
 * sidebar is filtered — means a Traditional team that genuinely wants
 * to run a sprint can still navigate to /sprint-planning if they
 * paste the URL, without us blanket-blocking the page.
 */
function tabsForMethodology(methodology: string | null | undefined): TabGroup[] {
  const f = methodologyFeatures(methodology);
  const boardLabel = boardPageLabel(methodology);
  return PROJECT_TABS.map(group => ({
    ...group,
    items: group.items
      // Drop sprint links when sprints aren't a concept on this methodology.
      .filter(item => f.sprints || !item.href.startsWith("/sprint"))
      // Drop EVM when methodology doesn't lean on earned value.
      .filter(item => f.evm || item.href !== "/evm")
      // Drop Procurement when not applicable (Travel, Scrum, etc.).
      .filter(item => f.procurement || item.href !== "/procurement")
      // Relabel the board page so a Traditional PM doesn't see
      // "Agile Board" in their sidebar. Page itself is unchanged.
      .map(item => item.href === "/agile" ? { ...item, label: boardLabel } : item),
  })).filter(group => group.items.length > 0);
}

const PROJECT_TABS: TabGroup[] = [
  {
    label: "Plan",
    color: "#6366F1",
    items: [
      { label: "PM Tracker", href: "/pm-tracker", icon: CheckSquare },
      { label: "Scope & WBS", href: "/scope", icon: Target },
      { label: "Schedule", href: "/schedule", icon: Calendar },
    ],
  },
  {
    label: "Execute",
    color: "#10B981",
    items: [
      { label: "Agile Board", href: "/agile", icon: Columns3 },
      { label: "Sprint Planning", href: "/sprint-planning", icon: Target },
      { label: "Sprint Tracker", href: "/sprint", icon: Timer },
      { label: "Actions", href: "/actions", icon: ClipboardList },
    ],
  },
  {
    label: "Control",
    color: "#F59E0B",
    items: [
      { label: "Risk Register", href: "/risk", icon: ShieldAlert },
      { label: "Issues", href: "/issues", icon: AlertTriangle },
      { label: "Change Control", href: "/change-control", icon: GitPullRequest },
      { label: "QA & Testing", href: "/qa-testing", icon: TestTube2 },
      { label: "Compliance", href: "/compliance", icon: ShieldCheck },
      { label: "Procurement", href: "/procurement", icon: Package },
    ],
  },
  {
    label: "Cost",
    color: "#8B5CF6",
    items: [
      { label: "Cost", href: "/cost", icon: DollarSign },
      { label: "Estimate", href: "/estimate", icon: Calculator },
      { label: "EVM", href: "/evm", icon: TrendingUp },
      { label: "Scorecard", href: "/scorecard", icon: Award },
      { label: "Benefits", href: "/benefits", icon: BarChart3 },
    ],
  },
  {
    label: "Reports",
    color: "#EC4899",
    items: [
      { label: "Reports", href: "/reports", icon: FileBarChart },
      { label: "Composer", href: "/report-composer", icon: Layers },
      { label: "Artefacts", href: "/artefacts", icon: FileText },
      { label: "Documents", href: "/documents", icon: FolderOpen },
    ],
  },
  {
    label: "People",
    color: "#22D3EE",
    items: [
      { label: "Stakeholders", href: "/stakeholders", icon: Users },
      { label: "Resources", href: "/resources", icon: UserCog },
    ],
  },
];

function DropdownTab({ group, projectBase, pathname }: { group: TabGroup; projectBase: string; pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const activeItem = group.items.find((item) => pathname.startsWith(`${projectBase}${item.href}`));

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all border",
          activeItem
            ? "text-white border-transparent shadow-sm"
            : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/20 hover:shadow-sm"
        )}
        style={activeItem ? { background: group.color } : undefined}
      >
        {activeItem ? activeItem.label : group.label}
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 py-1.5 rounded-xl border border-border bg-card shadow-2xl min-w-[200px]" style={{ zIndex: 9999 }}>
          <p className="px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border mb-1 pb-1.5">
            {group.label}
          </p>
          {group.items.map((item) => {
            const fullHref = `${projectBase}${item.href}`;
            const isActive = pathname.startsWith(fullHref);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={fullHref}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 mx-1 rounded-lg text-xs font-medium transition-colors",
                  isActive
                    ? "font-semibold"
                    : "text-foreground hover:bg-muted/50"
                )}
                style={isActive ? { background: `${group.color}15`, color: group.color } : undefined}
              >
                <Icon className="w-4 h-4 flex-shrink-0" style={isActive ? { color: group.color } : undefined} />
                {item.label}
                {isActive && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: group.color }} />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ProjectTabBar() {
  const pathname = usePathname();
  const { activeProjectId, activeProjectName, pinnedPages, togglePin, touchRecentProject } = useAppStore();
  // Pull the project's methodology so we can filter the sidebar to
  // tabs that actually make sense (e.g. hide Sprint Planning on
  // Traditional). useProject is short-cache TTL React-Query so the
  // sidebar re-renders if methodology changes mid-session.
  const { data: project } = useProject(activeProjectId);
  const methodologyForTabs = (project as any)?.methodology ?? null;
  const tabs = useMemo(() => tabsForMethodology(methodologyForTabs), [methodologyForTabs]);

  // Touch the recent-projects MRU whenever the active project changes.
  // This is the only place we do so; every other consumer reads from
  // useAppStore.recentProjectIds. Cheap (O(n≤12) splice) and idempotent.
  useEffect(() => {
    if (activeProjectId) touchRecentProject(activeProjectId);
  }, [activeProjectId, touchRecentProject]);

  if (!activeProjectId) return null;
  if (!pathname.startsWith(`/projects/${activeProjectId}`)) return null;

  const projectBase = `/projects/${activeProjectId}`;

  // Is user on the project overview page (not a sub-page)?
  const isOverview = pathname === projectBase || pathname === `${projectBase}/`;

  // Pinned pages strip — render the user's pinned hrefs as a quick-
  // access row. Look up the icon + label from the tab definitions so
  // labels stay in sync with methodology gating (e.g. /agile renders
  // as "Task Board" or "Agile Board" depending on methodology).
  const allItemsFlat = tabs.flatMap((g) => g.items.map((it) => ({ ...it, color: g.color })));
  const itemByHref = new Map(allItemsFlat.map((it) => [it.href, it] as const));
  const pinnedItems = pinnedPages
    .map((href) => itemByHref.get(href))
    .filter((it): it is (typeof allItemsFlat)[number] => Boolean(it));

  // Find the current page's href (e.g. "/risk") so the pin/unpin
  // button on the strip knows what to toggle.
  const currentSubPath = isOverview
    ? null
    : pathname.slice(projectBase.length).split("/")[0]
      ? `/${pathname.slice(projectBase.length).split("/").filter(Boolean)[0]}`
      : null;
  const isCurrentPinned = currentSubPath ? pinnedPages.includes(currentSubPath) : false;
  const canPinCurrent = !!currentSubPath && itemByHref.has(currentSubPath);

  // Find the group whose item is currently active. Used to render a second
  // row of sibling-page pills so navigating within a group is one click
  // instead of two (open dropdown + click item). Pick the deepest match so
  // /sprint-planning beats /sprint when both share a prefix.
  const activeGroup = !isOverview
    ? tabs.find((g) =>
        g.items.some((it) => pathname.startsWith(`${projectBase}${it.href}`)),
      )
    : null;

  return (
    <div className="sticky top-14 lg:top-16 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="flex items-center gap-2 px-3 lg:px-6 py-1.5 lg:py-2 flex-wrap">
        {/* Overview tab */}
        <Link
          href={projectBase}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all border",
            isOverview
              ? "bg-primary text-primary-foreground border-transparent shadow-sm"
              : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/20"
          )}
        >
          <LayoutDashboard className="w-3.5 h-3.5" />
          Overview
        </Link>

        <div className="w-px h-6 bg-border flex-shrink-0" />

        {/* Tab groups — filtered by methodology */}
        {tabs.map((group) => (
          <DropdownTab key={group.label} group={group} projectBase={projectBase} pathname={pathname} />
        ))}

        {/* Pinned pages strip — quick access to the user's favourite
            sub-pages. Capped at 8 so the bar doesn't grow unbounded.
            Click navigates; ✕ on hover unpins. A separate ☆ button
            on the right pins/unpins the CURRENT page so users can
            grow the list without opening any menu. */}
        {(pinnedItems.length > 0 || canPinCurrent) && (
          <>
            <div className="w-px h-6 bg-border flex-shrink-0 hidden lg:block" />
            <div className="flex items-center gap-1 flex-wrap">
              {pinnedItems.slice(0, 8).map((it) => {
                const Icon = it.icon;
                const fullHref = `${projectBase}${it.href}`;
                const isActive = pathname.startsWith(fullHref);
                return (
                  <div key={it.href} className="relative group">
                    <Link
                      href={fullHref}
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] transition-all border",
                        isActive
                          ? "border-primary/30 bg-primary/8 text-primary font-semibold"
                          : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                      title={it.label}
                    >
                      <Icon className="w-3 h-3" />
                      <span className="hidden lg:inline">{it.label}</span>
                    </Link>
                    {/* Unpin button — visible on hover. Stops propagation
                        so clicking it doesn't navigate. */}
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePin(it.href); }}
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-muted text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-white"
                      title={`Unpin ${it.label}`}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              {/* Pin / Unpin current page. Visible whenever the user is
                  on a recognised sub-page, regardless of whether it's
                  already in the strip. Clicking it toggles. */}
              {canPinCurrent && (
                <button
                  onClick={() => togglePin(currentSubPath!)}
                  className={cn(
                    "flex items-center justify-center w-7 h-7 rounded-md transition-colors text-[11px]",
                    isCurrentPinned
                      ? "bg-amber-500/15 text-amber-600 hover:bg-amber-500/25"
                      : "border border-dashed border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                  title={isCurrentPinned ? "Unpin this page" : "Pin this page"}
                >
                  {isCurrentPinned ? "★" : "☆"}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Second row: sibling pages of the active group (one-click siblings) ── */}
      {activeGroup && (
        <div
          className="flex items-center gap-1.5 px-3 lg:px-6 pb-2 pt-0.5 flex-wrap border-t border-border/40"
          style={{ background: `${activeGroup.color}06` }}
        >
          <span
            className="text-[9px] font-bold uppercase tracking-widest opacity-70 mr-1"
            style={{ color: activeGroup.color }}
          >
            {activeGroup.label}
          </span>
          {activeGroup.items.map((item) => {
            const fullHref = `${projectBase}${item.href}`;
            const isActive = pathname.startsWith(fullHref);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={fullHref}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all",
                  isActive
                    ? "shadow-sm"
                    : "text-muted-foreground hover:bg-background hover:text-foreground",
                )}
                style={
                  isActive
                    ? { background: activeGroup.color, color: "#fff" }
                    : undefined
                }
              >
                <Icon className="w-3 h-3 flex-shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
