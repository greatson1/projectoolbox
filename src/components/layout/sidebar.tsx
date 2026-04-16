"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app";
import {
  LayoutDashboard, Bot, CheckSquare, FolderKanban, Calendar,
  Columns3, Timer, Target, DollarSign, Users, UserCog, ShieldAlert,
  AlertTriangle, GitPullRequest, TestTube2, ShieldCheck, TrendingUp,
  Briefcase, FileText, Bell, CreditCard, Settings,
  GitBranch, Dice5, Calculator, Table2, ChevronLeft, ChevronRight,
  Brain, Video, Package, ClipboardList, FileBarChart, Award,
  MessageSquare, Activity, Rocket, Shield, BarChart3, Layers,
  ChevronsUpDown, X, FolderOpen, Plug, Zap, Microscope,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ProjectSummary {
  id: string;
  name: string;
  status?: string;
}

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
  // ── Top level ──────────────────────────────────────────────────────
  {
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    ],
  },

  // ── AI Agents — each item gets a distinct icon ──────────────────────
  {
    title: "AI AGENTS",
    items: [
      { label: "Fleet Overview",   href: "/agents",        icon: Bot },
      { label: "Chat with Agent",  href: "/agents/chat",   icon: MessageSquare },
      { label: "Activity Log",     href: "/activity",      icon: Activity },
      { label: "Deploy Agent",     href: "/agents/deploy", icon: Rocket },
    ],
  },

  // ── Workspace — platform-level navigation ──────────────────────────
  {
    title: "WORKSPACE",
    items: [
      { label: "Portfolio",     href: "/portfolio", icon: Briefcase },
      { label: "Projects",      href: "/projects",  icon: FolderKanban },
      { label: "Approvals",     href: "/approvals", icon: CheckSquare },
      { label: "Meetings",      href: "/meetings",  icon: Video },
      { label: "Calendar",      href: "/calendar",  icon: Calendar },
      { label: "Knowledge Base",href: "/knowledge", icon: Brain },
      { label: "Research Audit",href: "/research",  icon: Microscope },
    ],
  },

  // ── Plan — project-scoped ──────────────────────────────────────────
  {
    title: "PLAN",
    projectScoped: true,
    items: [
      { label: "PM Tracker",  href: "/pm-tracker", icon: CheckSquare, projectScoped: true },
      { label: "Scope & WBS", href: "/scope",      icon: Target,      projectScoped: true },
      { label: "Schedule",    href: "/schedule",    icon: Calendar,    projectScoped: true },
    ],
  },

  // ── Execute ────────────────────────────────────────────────────────
  {
    title: "EXECUTE",
    projectScoped: true,
    items: [
      { label: "Agile Board",       href: "/agile",            icon: Columns3,      projectScoped: true },
      { label: "Sprint Planning",   href: "/sprint-planning",  icon: Target,        projectScoped: true },
      { label: "Sprint Tracker",    href: "/sprint",           icon: Timer,         projectScoped: true },
      { label: "Actions",           href: "/actions",          icon: ClipboardList, projectScoped: true },
    ],
  },

  // ── Monitor & Control ─────────────────────────────────────────────
  {
    title: "CONTROL",
    projectScoped: true,
    items: [
      { label: "Risk Register",   href: "/risk",           icon: ShieldAlert,   projectScoped: true },
      { label: "Issues",          href: "/issues",         icon: AlertTriangle, projectScoped: true },
      { label: "Change Control",  href: "/change-control", icon: GitPullRequest,projectScoped: true },
      { label: "QA & Testing",    href: "/qa-testing",     icon: TestTube2,     projectScoped: true },
      { label: "Compliance",      href: "/compliance",     icon: ShieldCheck,   projectScoped: true },
      { label: "Procurement",     href: "/procurement",    icon: Package,       projectScoped: true },
    ],
  },

  // ── Cost & Value ──────────────────────────────────────────────────
  {
    title: "COST & VALUE",
    projectScoped: true,
    items: [
      { label: "Cost",         href: "/cost",      icon: DollarSign, projectScoped: true },
      { label: "Estimate",     href: "/estimate",  icon: Calculator, projectScoped: true },
      { label: "EVM",          href: "/evm",       icon: TrendingUp, projectScoped: true },
      { label: "Scorecard",    href: "/scorecard", icon: Award,      projectScoped: true },
      { label: "Benefits",     href: "/benefits",  icon: BarChart3,  projectScoped: true },
    ],
  },

  // ── Reports ───────────────────────────────────────────────────────
  {
    title: "REPORTS",
    projectScoped: true,
    items: [
      { label: "Reports",          href: "/reports",          icon: FileBarChart, projectScoped: true },
      { label: "Report Composer",  href: "/report-composer",  icon: Layers,       projectScoped: true },
      { label: "Artefacts",        href: "/artefacts",        icon: FileText,     projectScoped: true },
      { label: "Documents",        href: "/documents",        icon: FolderOpen,   projectScoped: true },
    ],
  },

  // ── Stakeholders ──────────────────────────────────────────────────
  {
    title: "STAKEHOLDERS",
    projectScoped: true,
    items: [
      { label: "Stakeholders", href: "/stakeholders", icon: Users,   projectScoped: true },
      { label: "Resources",    href: "/resources",    icon: UserCog, projectScoped: true },
    ],
  },

  // ── Tools ─────────────────────────────────────────────────────────
  {
    title: "TOOLS",
    items: [
      { label: "Decision Tree",   href: "/tools/decision-tree",  icon: GitBranch },
      { label: "Monte Carlo",     href: "/tools/monte-carlo",    icon: Dice5 },
      { label: "NPV Calculator",  href: "/tools/npv-calculator", icon: Calculator },
      { label: "RACI Matrix",     href: "/tools/raci-matrix",    icon: Table2 },
    ],
  },

  // ── Account ───────────────────────────────────────────────────────
  {
    title: "ACCOUNT",
    items: [
      { label: "Integrations",   href: "/settings/integrations",  icon: Plug },
      { label: "Automations",   href: "/settings/automations",   icon: Zap },
      { label: "Notifications", href: "/notifications", icon: Bell },
      { label: "Billing",       href: "/billing",       icon: CreditCard },
      { label: "Settings",      href: "/settings",      icon: Settings },
      { label: "Admin",         href: "/admin",         icon: Shield },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { activeProjectId, activeProjectName, setActiveProject, sidebarCollapsed, toggleSidebar, pendingApprovals, unreadNotifications } = useAppStore();

  // Project switcher state
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const switcherRef = useRef<HTMLDivElement>(null);

  // Fetch project list for switcher — also validates the persisted activeProjectId
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((json) => {
        if (Array.isArray(json?.data)) {
          const fetched = json.data.map((p: any) => ({ id: p.id, name: p.name, status: p.status }));
          setProjects(fetched);
          // Clear stale active project if it no longer exists in the DB
          if (activeProjectId && !fetched.some((p: { id: string }) => p.id === activeProjectId)) {
            setActiveProject(null, null);
          }
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setShowSwitcher(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

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
        <img src="/pt-logo.png" alt="Projectoolbox" className="w-8 h-8 object-contain flex-shrink-0" />
        {!sidebarCollapsed && (
          <span className="text-[15px] font-bold text-sidebar-foreground">Projectoolbox</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">

        {/* ── Active project context strip ─────────────────────────── */}
        {activeProjectId && (
          <div ref={switcherRef} className="relative mb-1">
            {sidebarCollapsed ? (
              /* Collapsed: just a coloured dot with tooltip */
              <button
                onClick={() => setShowSwitcher((v) => !v)}
                title={activeProjectName ?? "Active project"}
                className="w-full flex items-center justify-center py-2"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 ring-2 ring-indigo-500/30" />
              </button>
            ) : (
              /* Expanded: full strip */
              <div className="mx-1 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <FolderOpen className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                  <span className="flex-1 truncate text-[11px] font-semibold text-indigo-300 leading-tight">
                    {activeProjectName ?? "Active project"}
                  </span>
                  {/* Deselect */}
                  <button
                    onClick={() => { setActiveProject(null, null); router.push("/projects"); }}
                    className="text-indigo-400/60 hover:text-indigo-300 transition-colors"
                    title="Exit project"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                {/* Switch button */}
                <button
                  onClick={() => setShowSwitcher((v) => !v)}
                  className="mt-1.5 w-full flex items-center justify-between rounded-md bg-indigo-500/10 hover:bg-indigo-500/20 px-2 py-1 text-[11px] text-indigo-300/80 hover:text-indigo-200 transition-colors"
                >
                  <span>Switch project</span>
                  <ChevronsUpDown className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Switcher dropdown */}
            {showSwitcher && (
              <div className={cn(
                "absolute z-50 bg-popover border border-border rounded-lg shadow-xl py-1 overflow-hidden",
                sidebarCollapsed ? "left-[62px] top-0 w-52" : "left-0 right-0 top-full mt-1"
              )}>
                <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border">
                  Switch project
                </p>
                <div className="max-h-52 overflow-y-auto">
                  {projects.length === 0 ? (
                    <p className="px-3 py-2 text-[12px] text-muted-foreground">No projects found</p>
                  ) : projects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setActiveProject(p.id, p.name);
                        setShowSwitcher(false);
                        router.push(`/projects/${p.id}/agile`);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-[12px] text-left hover:bg-accent transition-colors",
                        p.id === activeProjectId && "bg-accent/50 font-semibold"
                      )}
                    >
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: p.id === activeProjectId ? "#6366F1" : "hsl(var(--muted-foreground))" }}
                      />
                      <span className="flex-1 truncate">{p.name}</span>
                      {p.id === activeProjectId && (
                        <span className="text-[10px] text-indigo-400 font-medium">active</span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="border-t border-border px-3 py-1.5">
                  <Link
                    href="/projects"
                    onClick={() => setShowSwitcher(false)}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    View all projects →
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}

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
