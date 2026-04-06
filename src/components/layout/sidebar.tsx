"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import {
  LayoutDashboard, Bot, CheckSquare, FolderKanban, Calendar,
  Columns3, Timer, Target, DollarSign, Users, UserCog, ShieldAlert,
  AlertTriangle, GitPullRequest, TestTube2, ShieldCheck, TrendingUp,
  Briefcase, FileText, Bell, CreditCard, Settings,
  GitBranch, Dice5, Calculator, Table2, ChevronLeft, ChevronRight,
  Brain, Video, Package, ClipboardList, FileBarChart, Award,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: number;
  projectScoped?: boolean;
}

interface NavGroup {
  title?: string;
  items: NavItem[];
  projectScoped?: boolean;
}

const NAV: NavGroup[] = [
  {
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    title: "AI AGENTS",
    items: [
      { label: "Fleet Overview", href: "/agents", icon: Bot },
      { label: "Activity Log", href: "/activity", icon: Bot },
      { label: "Chat with Agent", href: "/agents/chat", icon: Bot },
      { label: "Deploy Agent", href: "/agents/deploy", icon: Bot },
    ],
  },
  {
    items: [
      { label: "Approvals", href: "/approvals", icon: CheckSquare },
    ],
  },
  {
    items: [
      { label: "Projects", href: "/projects", icon: FolderKanban },
    ],
  },
  {
    title: "DELIVERY",
    projectScoped: true,
    items: [
      { label: "Scope & WBS", href: "/scope", icon: Target, projectScoped: true },
      { label: "Schedule", href: "/schedule", icon: Calendar, projectScoped: true },
      { label: "Agile Board", href: "/agile", icon: Columns3, projectScoped: true },
      { label: "Sprint Tracker", href: "/sprint", icon: Timer, projectScoped: true },
      { label: "Cost", href: "/cost", icon: DollarSign, projectScoped: true },
      { label: "Actions", href: "/actions", icon: ClipboardList, projectScoped: true },
    ],
  },
  {
    title: "PEOPLE",
    projectScoped: true,
    items: [
      { label: "Stakeholders", href: "/stakeholders", icon: Users, projectScoped: true },
      { label: "Resources", href: "/resources", icon: UserCog, projectScoped: true },
    ],
  },
  {
    title: "GOVERNANCE",
    projectScoped: true,
    items: [
      { label: "Risk Register", href: "/risk", icon: ShieldAlert, projectScoped: true },
      { label: "Issues", href: "/issues", icon: AlertTriangle, projectScoped: true },
      { label: "Change Control", href: "/change-control", icon: GitPullRequest, projectScoped: true },
      { label: "QA & Testing", href: "/qa-testing", icon: TestTube2, projectScoped: true },
      { label: "Compliance", href: "/compliance", icon: ShieldCheck, projectScoped: true },
      { label: "Procurement", href: "/procurement", icon: Package, projectScoped: true },
      { label: "Artefacts", href: "/artefacts", icon: FileText, projectScoped: true },
    ],
  },
  {
    title: "VALUE",
    projectScoped: true,
    items: [
      { label: "EVM Dashboard", href: "/evm", icon: TrendingUp, projectScoped: true },
      { label: "Scorecard", href: "/scorecard", icon: Award, projectScoped: true },
      { label: "Reports", href: "/reports", icon: FileBarChart, projectScoped: true },
      { label: "Report Composer", href: "/report-composer", icon: FileText, projectScoped: true },
      { label: "Benefits", href: "/benefits", icon: TrendingUp, projectScoped: true },
    ],
  },
  {
    title: "KNOWLEDGE",
    items: [
      { label: "Knowledge Base", href: "/knowledge", icon: Brain },
      { label: "Meetings", href: "/meetings", icon: Video },
      { label: "Calendar", href: "/calendar", icon: Calendar },
    ],
  },
  {
    items: [
      { label: "Portfolio", href: "/portfolio", icon: Briefcase },
    ],
  },
  {
    title: "TOOLS",
    items: [
      { label: "Decision Tree", href: "/tools/decision-tree", icon: GitBranch },
      { label: "Monte Carlo", href: "/tools/monte-carlo", icon: Dice5 },
      { label: "NPV Calculator", href: "/tools/npv-calculator", icon: Calculator },
      { label: "RACI Matrix", href: "/tools/raci-matrix", icon: Table2 },
    ],
  },
  {
    items: [
      { label: "Notifications", href: "/notifications", icon: Bell },
      { label: "Billing", href: "/billing", icon: CreditCard },
      { label: "Settings", href: "/settings", icon: Settings },
      { label: "Admin", href: "/admin", icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { activeProjectId, sidebarCollapsed, toggleSidebar, pendingApprovals, unreadNotifications } = useAppStore();

  const resolvePath = (item: NavItem) => {
    if (item.projectScoped && activeProjectId) {
      return `/projects/${activeProjectId}${item.href}`;
    }
    return item.href;
  };

  const isActive = (item: NavItem) => {
    const resolved = resolvePath(item);
    if (resolved === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(resolved);
  };

  const getBadge = (label: string) => {
    if (label === "Approvals" && pendingApprovals > 0) return pendingApprovals;
    if (label === "Notifications" && unreadNotifications > 0) return unreadNotifications;
    return undefined;
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 bottom-0 z-40 flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200",
        sidebarCollapsed ? "w-[60px]" : "w-[240px]"
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 h-16 border-b border-sidebar-border flex-shrink-0">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
          style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>
          PT
        </div>
        {!sidebarCollapsed && (
          <span className="text-[15px] font-bold text-sidebar-foreground">Projectoolbox</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        {NAV.map((group, gi) => {
          // Hide project-scoped groups if no project is selected
          if (group.projectScoped && !activeProjectId) return null;

          return (
            <div key={gi}>
              {group.title && !sidebarCollapsed && (
                <p className="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {group.title}
                </p>
              )}
              {group.items.map((item) => {
                if (item.projectScoped && !activeProjectId) return null;
                const active = isActive(item);
                const badge = getBadge(item.label);
                const Icon = item.icon;

                return (
                  <Link
                    key={item.label}
                    href={resolvePath(item)}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-200",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground sidebar-link-active font-semibold"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground hover:translate-x-0.5"
                    )}
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                    {!sidebarCollapsed && (
                      <>
                        <span className="flex-1 truncate">{item.label}</span>
                        {badge !== undefined && (
                          <Badge variant="destructive" className="h-5 min-w-5 px-1.5 text-[10px]">
                            {badge}
                          </Badge>
                        )}
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className="flex items-center justify-center h-10 border-t border-sidebar-border text-muted-foreground hover:text-foreground transition-colors"
      >
        {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>
    </aside>
  );
}
