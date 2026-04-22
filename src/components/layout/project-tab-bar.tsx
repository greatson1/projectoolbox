"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppStore } from "@/stores/app";
import { cn } from "@/lib/utils";
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
  const { activeProjectId, activeProjectName } = useAppStore();

  if (!activeProjectId) return null;
  if (!pathname.startsWith(`/projects/${activeProjectId}`)) return null;

  const projectBase = `/projects/${activeProjectId}`;

  // Is user on the project overview page (not a sub-page)?
  const isOverview = pathname === projectBase || pathname === `${projectBase}/`;

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

        {/* Tab groups */}
        {PROJECT_TABS.map((group) => (
          <DropdownTab key={group.label} group={group} projectBase={projectBase} pathname={pathname} />
        ))}
      </div>
    </div>
  );
}
