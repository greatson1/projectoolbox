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
  ChevronDown,
} from "lucide-react";

interface TabItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

interface TabGroup {
  label: string;
  items: TabItem[];
}

const PROJECT_TABS: TabGroup[] = [
  {
    label: "Plan",
    items: [
      { label: "PM Tracker", href: "/pm-tracker", icon: CheckSquare },
      { label: "Scope & WBS", href: "/scope", icon: Target },
      { label: "Schedule", href: "/schedule", icon: Calendar },
    ],
  },
  {
    label: "Execute",
    items: [
      { label: "Agile Board", href: "/agile", icon: Columns3 },
      { label: "Sprint Planning", href: "/sprint-planning", icon: Target },
      { label: "Sprint Tracker", href: "/sprint", icon: Timer },
      { label: "Actions", href: "/actions", icon: ClipboardList },
    ],
  },
  {
    label: "Control",
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
    items: [
      { label: "Reports", href: "/reports", icon: FileBarChart },
      { label: "Composer", href: "/report-composer", icon: Layers },
      { label: "Artefacts", href: "/artefacts", icon: FileText },
      { label: "Documents", href: "/documents", icon: FolderOpen },
    ],
  },
  {
    label: "People",
    items: [
      { label: "Stakeholders", href: "/stakeholders", icon: Users },
      { label: "Resources", href: "/resources", icon: UserCog },
    ],
  },
];

function DropdownGroup({ group, projectBase, pathname }: { group: TabGroup; projectBase: string; pathname: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Is any item in this group active?
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
          "flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap",
          activeItem
            ? "bg-primary/10 text-primary font-semibold"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        )}
      >
        {activeItem ? activeItem.label : group.label}
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 py-1 rounded-lg border border-border bg-card shadow-xl z-50 min-w-[180px]">
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
                  "flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-muted/50"
                )}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                {item.label}
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

  // Only show when a project is active and we're on a project page
  if (!activeProjectId) return null;
  if (!pathname.startsWith(`/projects/${activeProjectId}`)) return null;

  const projectBase = `/projects/${activeProjectId}`;

  return (
    <div className="sticky top-16 z-20 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="flex items-center gap-1 px-6 py-1.5 overflow-x-auto scrollbar-hide">
        {/* Project name chip */}
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-2 flex-shrink-0">
          {(activeProjectName || "Project").slice(0, 20)}
        </span>
        <div className="w-px h-5 bg-border mr-1 flex-shrink-0" />

        {/* Tab groups */}
        {PROJECT_TABS.map((group) => (
          <DropdownGroup key={group.label} group={group} projectBase={projectBase} pathname={pathname} />
        ))}
      </div>
    </div>
  );
}
