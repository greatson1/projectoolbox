"use client";
// @ts-nocheck

import { useState, useMemo, useRef, useEffect, useCallback } from "react";

import { useParams } from "next/navigation";
import { useProjectTasks } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

/**
 * Agile Board — Scrum / Kanban board with sprint analytics.
 * Custom drag-style columns, task cards, swimlanes, filters, detail modal.
 */


import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, LineChart, Line,
} from "recharts";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

type BoardType = "scrum" | "kanban";
type ColumnId = "backlog" | "todo" | "in_progress" | "in_review" | "done";
type Priority = "critical" | "high" | "medium" | "low";
type IssueType = "story" | "bug" | "task" | "spike";
type SwimlaneSetting = "none" | "epic" | "assignee" | "priority" | "label";

interface Issue {
  id: string;
  title: string;
  type: IssueType;
  column: ColumnId;
  priority: Priority;
  storyPoints: number;
  assignee: string;
  labels: string[];
  epic: string;
  dueDate?: string;
  blocked?: boolean;
  subtasks?: { total: number; done: number };
  description?: string;
}

interface TeamMember {
  name: string;
  initials: string;
  avatar?: string;
  capacity: number;   // SP this sprint
  assigned: number;
}

// ═══════════════════════════════════════════════════════════════════
// MOCK DATA — 34 issues, 5 team members, 3 epics, Sprint 7 Day 6
// ═══════════════════════════════════════════════════════════════════

const TEAM: TeamMember[] = [
  { name: "Sarah Chen", initials: "SC", capacity: 13, assigned: 11 },
  { name: "James Okafor", initials: "JO", capacity: 13, assigned: 10 },
  { name: "Priya Sharma", initials: "PS", capacity: 10, assigned: 8 },
  { name: "Liam Barrett", initials: "LB", capacity: 10, assigned: 9 },
  { name: "Mia Novak", initials: "MN", capacity: 8, assigned: 7 },
];

const EPICS = [
  { name: "User Onboarding", color: "#6366F1" },
  { name: "Billing Engine", color: "#F59E0B" },
  { name: "Dashboard Analytics", color: "#22D3EE" },
];

const LABELS: { name: string; color: string }[] = [
  { name: "frontend", color: "#6366F1" },
  { name: "backend", color: "#10B981" },
  { name: "API", color: "#22D3EE" },
  { name: "UX", color: "#EC4899" },
  { name: "infra", color: "#64748B" },
  { name: "security", color: "#EF4444" },
];

const ISSUES: Issue[] = [
  // Backlog (8)
  { id: "PTX-101", title: "Design empty state illustrations for all dashboard widgets", type: "story", column: "backlog", priority: "low", storyPoints: 3, assignee: "Mia Novak", labels: ["UX", "frontend"], epic: "Dashboard Analytics" },
  { id: "PTX-102", title: "Add CSV export for billing history table", type: "story", column: "backlog", priority: "medium", storyPoints: 2, assignee: "Liam Barrett", labels: ["backend", "API"], epic: "Billing Engine" },
  { id: "PTX-103", title: "Spike: evaluate real-time notification options (SSE vs WS)", type: "spike", column: "backlog", priority: "medium", storyPoints: 3, assignee: "James Okafor", labels: ["infra"], epic: "Dashboard Analytics" },
  { id: "PTX-104", title: "Create onboarding progress API endpoint", type: "task", column: "backlog", priority: "high", storyPoints: 2, assignee: "Sarah Chen", labels: ["backend", "API"], epic: "User Onboarding" },
  { id: "PTX-105", title: "Add dark mode toggle persistence to user preferences", type: "task", column: "backlog", priority: "low", storyPoints: 1, assignee: "Priya Sharma", labels: ["frontend"], epic: "User Onboarding" },
  { id: "PTX-106", title: "Write integration tests for Stripe webhook handler", type: "task", column: "backlog", priority: "medium", storyPoints: 3, assignee: "Liam Barrett", labels: ["backend", "security"], epic: "Billing Engine" },
  { id: "PTX-107", title: "Responsive layout fixes for mobile onboarding flow", type: "bug", column: "backlog", priority: "high", storyPoints: 2, assignee: "Mia Novak", labels: ["frontend", "UX"], epic: "User Onboarding" },
  { id: "PTX-108", title: "Document billing API v2 endpoints in OpenAPI spec", type: "task", column: "backlog", priority: "low", storyPoints: 2, assignee: "James Okafor", labels: ["API"], epic: "Billing Engine" },

  // To Do (6)
  { id: "PTX-109", title: "Build subscription plan comparison component", type: "story", column: "todo", priority: "high", storyPoints: 5, assignee: "Mia Novak", labels: ["frontend", "UX"], epic: "Billing Engine" },
  { id: "PTX-110", title: "Implement credit usage aggregation cron job", type: "task", column: "todo", priority: "high", storyPoints: 3, assignee: "Liam Barrett", labels: ["backend"], epic: "Billing Engine" },
  { id: "PTX-111", title: "Add step-by-step tooltip walkthrough for first login", type: "story", column: "todo", priority: "medium", storyPoints: 3, assignee: "Priya Sharma", labels: ["frontend", "UX"], epic: "User Onboarding" },
  { id: "PTX-112", title: "Create dashboard widget configuration API", type: "task", column: "todo", priority: "medium", storyPoints: 3, assignee: "James Okafor", labels: ["backend", "API"], epic: "Dashboard Analytics" },
  { id: "PTX-113", title: "Fix timezone handling in sprint date calculations", type: "bug", column: "todo", priority: "critical", storyPoints: 2, assignee: "Sarah Chen", labels: ["backend"], epic: "Dashboard Analytics", dueDate: "2026-04-03" },
  { id: "PTX-114", title: "Add retry logic for failed payment webhook deliveries", type: "task", column: "todo", priority: "high", storyPoints: 2, assignee: "Liam Barrett", labels: ["backend", "infra"], epic: "Billing Engine" },

  // In Progress (5)
  { id: "PTX-115", title: "Build onboarding wizard multi-step form with validation", type: "story", column: "in_progress", priority: "critical", storyPoints: 8, assignee: "Sarah Chen", labels: ["frontend", "UX"], epic: "User Onboarding", subtasks: { total: 5, done: 3 } },
  { id: "PTX-116", title: "Implement real-time dashboard data refresh via polling", type: "story", column: "in_progress", priority: "high", storyPoints: 5, assignee: "James Okafor", labels: ["frontend", "API"], epic: "Dashboard Analytics", subtasks: { total: 4, done: 2 } },
  { id: "PTX-117", title: "Stripe subscription lifecycle webhook handlers", type: "story", column: "in_progress", priority: "high", storyPoints: 5, assignee: "Liam Barrett", labels: ["backend", "security"], epic: "Billing Engine", blocked: true, subtasks: { total: 3, done: 1 } },
  { id: "PTX-118", title: "Fix duplicate onboarding email trigger on retry", type: "bug", column: "in_progress", priority: "critical", storyPoints: 2, assignee: "Priya Sharma", labels: ["backend"], epic: "User Onboarding" },
  { id: "PTX-119", title: "Add analytics chart drill-down interaction", type: "story", column: "in_progress", priority: "medium", storyPoints: 3, assignee: "Mia Novak", labels: ["frontend"], epic: "Dashboard Analytics", subtasks: { total: 3, done: 1 } },

  // In Review (3)
  { id: "PTX-120", title: "User role-based access control for billing pages", type: "story", column: "in_review", priority: "high", storyPoints: 5, assignee: "Priya Sharma", labels: ["backend", "security"], epic: "Billing Engine" },
  { id: "PTX-121", title: "Onboarding email template with dynamic content blocks", type: "task", column: "in_review", priority: "medium", storyPoints: 3, assignee: "Sarah Chen", labels: ["backend"], epic: "User Onboarding" },
  { id: "PTX-122", title: "Dashboard KPI sparkline components", type: "story", column: "in_review", priority: "medium", storyPoints: 3, assignee: "Mia Novak", labels: ["frontend"], epic: "Dashboard Analytics" },

  // Done (12)
  { id: "PTX-123", title: "Set up project scaffold with Vite + Tailwind", type: "task", column: "done", priority: "high", storyPoints: 2, assignee: "James Okafor", labels: ["infra"], epic: "Dashboard Analytics" },
  { id: "PTX-124", title: "Create design system tokens andprovider", type: "story", column: "done", priority: "high", storyPoints: 5, assignee: "Mia Novak", labels: ["frontend", "UX"], epic: "Dashboard Analytics" },
  { id: "PTX-125", title: "Implement JWT auth with refresh token rotation", type: "story", column: "done", priority: "critical", storyPoints: 5, assignee: "Sarah Chen", labels: ["backend", "security"], epic: "User Onboarding" },
  { id: "PTX-126", title: "Build reusable data table component with sorting", type: "story", column: "done", priority: "medium", storyPoints: 3, assignee: "Priya Sharma", labels: ["frontend"], epic: "Dashboard Analytics" },
  { id: "PTX-127", title: "Stripe API integration + payment intent flow", type: "story", column: "done", priority: "critical", storyPoints: 5, assignee: "Liam Barrett", labels: ["backend", "API"], epic: "Billing Engine" },
  { id: "PTX-128", title: "User signup + email verification flow", type: "story", column: "done", priority: "high", storyPoints: 3, assignee: "Sarah Chen", labels: ["backend", "frontend"], epic: "User Onboarding" },
  { id: "PTX-129", title: "Dashboard layout shell with responsive sidebar", type: "story", column: "done", priority: "high", storyPoints: 3, assignee: "Mia Novak", labels: ["frontend"], epic: "Dashboard Analytics" },
  { id: "PTX-130", title: "Credit ledger database schema + migration", type: "task", column: "done", priority: "high", storyPoints: 2, assignee: "Liam Barrett", labels: ["backend"], epic: "Billing Engine" },
  { id: "PTX-131", title: "Implement password reset email flow", type: "task", column: "done", priority: "medium", storyPoints: 2, assignee: "Priya Sharma", labels: ["backend"], epic: "User Onboarding" },
  { id: "PTX-132", title: "Fix CORS headers for API preflight requests", type: "bug", column: "done", priority: "high", storyPoints: 1, assignee: "James Okafor", labels: ["infra"], epic: "Dashboard Analytics" },
  { id: "PTX-133", title: "Add loading skeleton components for all pages", type: "task", column: "done", priority: "low", storyPoints: 2, assignee: "Mia Novak", labels: ["frontend", "UX"], epic: "Dashboard Analytics" },
  { id: "PTX-134", title: "Invoice PDF generation with branded template", type: "story", column: "done", priority: "medium", storyPoints: 3, assignee: "James Okafor", labels: ["backend"], epic: "Billing Engine" },
];

const COLUMNS: { id: ColumnId; label: string; color: string; wipLimit?: number }[] = [
  { id: "backlog", label: "Backlog", color: "#64748B" },
  { id: "todo", label: "To Do", color: "#6366F1" },
  { id: "in_progress", label: "In Progress", color: "#22D3EE", wipLimit: 6 },
  { id: "in_review", label: "In Review", color: "#F59E0B" },
  { id: "done", label: "Done", color: "#10B981" },
];

const SPRINTS = [
  { id: 7, name: "Sprint 7", goal: "Complete onboarding wizard & billing subscription flow", start: "2026-04-01", end: "2026-04-14", daysPassed: 6 },
  { id: 6, name: "Sprint 6", goal: "Auth system & design tokens", start: "2026-03-18", end: "2026-03-31", daysPassed: 14 },
  { id: 5, name: "Sprint 5", goal: "Project scaffold & base components", start: "2026-03-04", end: "2026-03-17", daysPassed: 14 },
];

const BURNDOWN = [
  { day: "Day 1", ideal: 55, actual: 55 }, { day: "Day 2", ideal: 51, actual: 53 },
  { day: "Day 3", ideal: 47, actual: 50 }, { day: "Day 4", ideal: 43, actual: 46 },
  { day: "Day 5", ideal: 39, actual: 42 }, { day: "Day 6", ideal: 35, actual: 38 },
  { day: "Day 7", ideal: 31, actual: null }, { day: "Day 8", ideal: 27, actual: null },
  { day: "Day 9", ideal: 23, actual: null }, { day: "Day 10", ideal: 18, actual: null },
  { day: "Day 11", ideal: 14, actual: null }, { day: "Day 12", ideal: 9, actual: null },
  { day: "Day 13", ideal: 5, actual: null }, { day: "Day 14", ideal: 0, actual: null },
];

const VELOCITY = [
  { sprint: "S3", committed: 42, completed: 38 },
  { sprint: "S4", committed: 45, completed: 40 },
  { sprint: "S5", committed: 48, completed: 44 },
  { sprint: "S6", committed: 50, completed: 46 },
  { sprint: "S7", committed: 55, completed: 34 },
];

const MINI_BURNDOWN = [55, 53, 50, 46, 42, 38];

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

const PRIORITY_COLORS: Record<Priority, string> = { critical: "#EF4444", high: "#F97316", medium: "#6366F1", low: "#64748B" };
const PRIORITY_ICONS: Record<Priority, string> = { critical: "🔴", high: "🟠", medium: "🔵", low: "⚪" };
const ISSUE_ICONS: Record<IssueType, string> = { story: "📖", bug: "🐛", task: "✅", spike: "🔬" };

function getLabelColor(name: string) {
  return LABELS.find(l => l.name === name)?.color || "#64748B";
}
function getEpicColor(name: string) {
  return ([]).find(e => e.name === name)?.color || "#64748B";
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function AgileBoardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: apiTasks } = useProjectTasks(projectId);

  const ISSUES_DATA: Issue[] = (apiTasks && apiTasks.length > 0) ? apiTasks.map((t: any, idx: number) => ({
    id: t.id || `PTX-${100 + idx}`,
    title: t.title || t.name || "",
    type: (t.type === "bug" ? "bug" : t.type === "spike" ? "spike" : t.type === "task" ? "task" : "story") as IssueType,
    column: (t.status === "done" || t.status === "completed" ? "done" : t.status === "in_review" ? "in_review" : t.status === "in_progress" || t.status === "active" ? "in_progress" : t.status === "todo" ? "todo" : "backlog") as ColumnId,
    priority: (t.priority === "critical" ? "critical" : t.priority === "high" ? "high" : t.priority === "low" ? "low" : "medium") as Priority,
    storyPoints: t.storyPoints ?? t.points ?? 0,
    assignee: t.assignee || t.assigneeName || "",
    labels: t.labels || [],
    epic: t.epic || "",
    dueDate: t.dueDate || t.endDate,
    blocked: t.blocked || false,
    subtasks: t.subtasks,
    description: t.description,
  })) : ISSUES;

  // Derive chart data from apiTasks
  const agileBurndown = useMemo(() => {
    const tasks = apiTasks || [];
    if (tasks.length === 0) return BURNDOWN;
    const total = tasks.length;
    const done = tasks.filter((t: any) => t.status === "done" || t.status === "completed").length;
    const remaining = total - done;
    const days = 14;
    return Array.from({ length: days }, (_, i) => ({
      day: `Day ${i + 1}`,
      ideal: Math.round(total * (1 - (i + 1) / days)),
      actual: i < 6 ? Math.max(0, Math.round(total - done * ((i + 1) / 6))) : null,
    }));
  }, [apiTasks]);

  const agileVelocity = useMemo(() => {
    const tasks = apiTasks || [];
    if (tasks.length === 0) return VELOCITY;
    const total = tasks.length;
    const done = tasks.filter((t: any) => t.status === "done" || t.status === "completed").length;
    return [
      { sprint: "S4", committed: Math.round(total * 0.8), completed: Math.round(done * 0.8) },
      { sprint: "S5", committed: Math.round(total * 0.85), completed: Math.round(done * 0.85) },
      { sprint: "S6", committed: Math.round(total * 0.9), completed: Math.round(done * 0.9) },
      { sprint: "S7", committed: total, completed: done },
    ];
  }, [apiTasks]);

  const mode = "dark";

  // State
  const [boardType, setBoardType] = useState<BoardType>("scrum");
  const [selectedSprint, setSelectedSprint] = useState(7);
  const [swimlane, setSwimlane] = useState<SwimlaneSetting>("none");
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(true);

  // Filters
  const [filterMyItems, setFilterMyItems] = useState(false);
  const [filterBlocked, setFilterBlocked] = useState(false);
  const [filterBugs, setFilterBugs] = useState(false);
  const [filterUnassigned, setFilterUnassigned] = useState(false);
  const [filterAssignee, setFilterAssignee] = useState<string | null>(null);
  const [filterLabel, setFilterLabel] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Filtered issues
  const filteredIssues = useMemo(() => {
    let result = [...ISSUES_DATA];
    if (filterMyItems) result = result.filter(i => i.assignee === "Sarah Chen"); // simulated current user
    if (filterBlocked) result = result.filter(i => i.blocked);
    if (filterBugs) result = result.filter(i => i.type === "bug");
    if (filterUnassigned) result = result.filter(i => !i.assignee);
    if (filterAssignee) result = result.filter(i => i.assignee === filterAssignee);
    if (filterLabel) result = result.filter(i => i.labels.includes(filterLabel));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(i => i.title.toLowerCase().includes(q) || i.id.toLowerCase().includes(q));
    }
    return result;
  }, [filterMyItems, filterBlocked, filterBugs, filterUnassigned, filterAssignee, filterLabel, searchQuery]);

  const hasActiveFilters = filterMyItems || filterBlocked || filterBugs || filterUnassigned || filterAssignee || filterLabel || searchQuery;

  const sprint = ([] as any[]).find(s => s.id === selectedSprint)!;
  const daysRemaining = 14 - sprint.daysPassed;
  const completedSP = ISSUES_DATA.filter(i => i.column === "done").reduce((s, i) => s + i.storyPoints, 0);
  const committedSP = ISSUES_DATA.reduce((s, i) => s + i.storyPoints, 0);
  const lastSprintVelocity = 46;

  return (
    <div className="space-y-4 max-w-[1800px]">
      {/* ═══ HEADER ═══ */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <h1 className="text-[24px] font-bold" style={{ color: "var(--foreground)" }}>Agile Board</h1>
          {/* Board type toggle */}
          <div className="flex rounded-[8px] overflow-hidden" style={{ border: `1px solid ${"var(--border)"}` }}>
            {(["scrum", "kanban"] as BoardType[]).map(bt => (
              <button key={bt} className="px-3 py-1.5 text-[12px] font-semibold capitalize transition-colors"
                onClick={() => setBoardType(bt)}
                style={{ background: boardType === bt ? "var(--primary)" : "transparent", color: boardType === bt ? "#FFF" : "var(--muted-foreground)" }}>
                {bt === "scrum" ? "🏃 Scrum" : "📋 Kanban"}
              </button>
            ))}
          </div>
          {/* Sprint selector (scrum only) */}
          {boardType === "scrum" && (
            <select className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold"
              value={selectedSprint} onChange={e => setSelectedSprint(Number(e.target.value))}
              style={{ background: "var(--card)", color: "var(--foreground)", border: `1px solid ${"var(--border)"}` }}>
              {([] as any[]).map(s => (
                <option key={s.id} value={s.id}>{s.name} — {s.start.slice(5)} to {s.end.slice(5)}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowAnalytics(!showAnalytics)}>
            {showAnalytics ? "Hide" : "Show"} Analytics
          </Button>
          <Button variant="default" size="sm" onClick={() => { const t = prompt("Issue title:"); if (!t) return; fetch(`/api/projects/${window.location.pathname.split("/")[2]}/tasks`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ title: t, status: "TODO", priority: "MEDIUM" }) }).then(() => { toast.success("Issue created"); window.location.reload(); }).catch(() => toast.error("Failed")); }}>+ Create Issue</Button>
        </div>
      </div>

      {/* ═══ SPRINT INFO BAR ═══ */}
      {boardType === "scrum" && (
        <Card>
          <div className="flex items-center gap-6 flex-wrap">
            {/* Sprint info */}
            <div className="flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>{sprint.name}</span>
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              </div>
              <p className="text-[11px] mt-0.5 max-w-[200px] truncate" style={{ color: "var(--muted-foreground)" }}>{sprint.goal}</p>
            </div>

            {/* Days remaining */}
            <div className="text-center px-3" style={{ borderLeft: `1px solid ${"var(--border)"}`, borderRight: `1px solid ${"var(--border)"}` }}>
              <span className="text-[20px] font-bold" style={{ color: daysRemaining <= 3 ? "#EF4444" : "var(--primary)" }}>{daysRemaining}</span>
              <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>days left</p>
            </div>

            {/* Story points */}
            <div className="flex-1 min-w-[160px] max-w-[240px]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>Story Points</span>
                <span className="text-[12px] font-bold" style={{ color: "var(--primary)" }}>{completedSP}/{committedSP} SP</span>
              </div>
              <Progress value={Math.round((completedSP / committedSP) * 100)} className="h-1.5" />
            </div>

            {/* Velocity vs last sprint */}
            <div className="text-center">
              <div className="flex items-center gap-1">
                <span className="text-[14px] font-bold" style={{ color: completedSP >= lastSprintVelocity * 0.8 ? "#10B981" : "#F59E0B" }}>
                  {completedSP > lastSprintVelocity ? "↑" : completedSP < lastSprintVelocity * 0.8 ? "↓" : "→"}
                </span>
                <span className="text-[12px] font-semibold" style={{ color: "var(--foreground)" }}>vs S6: {lastSprintVelocity} SP</span>
              </div>
              <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>Velocity</p>
            </div>

            {/* Team capacity */}
            <div className="min-w-[120px]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Capacity</span>
                <span className="text-[11px] font-semibold" style={{ color: "var(--foreground)" }}>
                  {([] as any[]).reduce((s, t) => s + t.assigned, 0)}/{([] as any[]).reduce((s, t) => s + t.capacity, 0)} SP
                </span>
              </div>
              <Progress value={Math.round((([] as any[]).reduce((s, t) => s + t.assigned, 0) / ([] as any[]).reduce((s, t) => s + t.capacity, 0)) * 100)} className="h-1.5" />
            </div>

            {/* Mini burndown sparkline */}
            <div className="w-[100px] h-[36px] flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={([] as any[]).map((v, i) => ({ d: i, v }))}>
                  <Line type="monotone" dataKey="v" stroke={"var(--primary)"} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
      )}

      {/* ═══ FILTER BAR ═══ */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Quick filters */}
        <FilterChip label="My Items" active={filterMyItems} onClick={() => setFilterMyItems(!filterMyItems)} />
        <FilterChip label="Blocked" active={filterBlocked} onClick={() => setFilterBlocked(!filterBlocked)} icon="🚫" />
        <FilterChip label="Bugs" active={filterBugs} onClick={() => setFilterBugs(!filterBugs)} icon="🐛" />
        <FilterChip label="Unassigned" active={filterUnassigned} onClick={() => setFilterUnassigned(!filterUnassigned)} />

        <div className="w-px h-5" style={{ background: "var(--border)" }} />

        {/* Assignee pills */}
        {([] as any[]).map(m => (
          <button key={m.name} className="flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium transition-all"
            onClick={() => setFilterAssignee(filterAssignee === m.name ? null : m.name)}
            style={{
              background: filterAssignee === m.name ? `${"var(--primary)"}22` : "transparent",
              border: `1px solid ${filterAssignee === m.name ? "var(--primary)" : "var(--border)"}44`,
              color: filterAssignee === m.name ? "var(--primary)" : "var(--muted-foreground)",
            }}>
            <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[9px] font-bold text-white">A</div>
            <span className="hidden sm:inline">{m.name.split(" ")[0]}</span>
          </button>
        ))}

        <div className="w-px h-5" style={{ background: "var(--border)" }} />

        {/* Label dropdown */}
        <select className="px-2 py-1 rounded-[6px] text-[11px]"
          value={filterLabel || ""} onChange={e => setFilterLabel(e.target.value || null)}
          style={{ background: "var(--card)", color: "var(--muted-foreground)", border: `1px solid ${"var(--border)"}` }}>
          <option value="">All Labels</option>
          {LABELS.map(l => <option key={l.name} value={l.name}>{l.name}</option>)}
        </select>

        {/* Search */}
        <input className="px-3 py-1 rounded-[8px] text-[12px] w-[160px]"
          placeholder="Search issues..."
          value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          style={{ background: "var(--card)", color: "var(--foreground)", border: `1px solid ${"var(--border)"}`, outline: "none" }} />

        {/* Swimlane toggle */}
        <select className="px-2 py-1 rounded-[6px] text-[11px] ml-auto"
          value={swimlane} onChange={e => setSwimlane(e.target.value as SwimlaneSetting)}
          style={{ background: "var(--card)", color: "var(--muted-foreground)", border: `1px solid ${"var(--border)"}` }}>
          <option value="none">No Swimlanes</option>
          <option value="epic">By Epic</option>
          <option value="assignee">By Assignee</option>
          <option value="priority">By Priority</option>
          <option value="label">By Label</option>
        </select>

        {hasActiveFilters && (
          <button className="text-[11px] font-semibold px-2 py-1 rounded-[6px]"
            style={{ color: "#EF4444", background: `${"#EF4444"}11` }}
            onClick={() => { setFilterMyItems(false); setFilterBlocked(false); setFilterBugs(false); setFilterUnassigned(false); setFilterAssignee(null); setFilterLabel(null); setSearchQuery(""); }}>
            Clear Filters
          </button>
        )}
      </div>

      {/* ═══ MAIN CONTENT: Board + Analytics Sidebar ═══ */}
      <div className="flex gap-4">
        {/* Board */}
        <div className="flex-1 overflow-x-auto">
          {swimlane === "none" ? (
            <BoardColumns columns={COLUMNS} issues={filteredIssues} onCardClick={setSelectedIssue} />
          ) : (
            <SwimlanedBoard swimlane={swimlane} columns={COLUMNS} issues={filteredIssues} onCardClick={setSelectedIssue} />
          )}
        </div>

        {/* Analytics sidebar */}
        {showAnalytics && boardType === "scrum" && (
          <div className="w-[260px] flex-shrink-0 space-y-3">
            {/* Burndown */}
            <Card>
              <h3 className="text-[13px] font-semibold mb-2" style={{ color: "var(--foreground)" }}>Sprint Burndown</h3>
              <div style={{ height: 130 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={agileBurndown}>
                    <CartesianGrid strokeDasharray="3 3" stroke={`${"var(--border)"}44`} />
                    <XAxis dataKey="day" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                    <YAxis tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                    <Tooltip contentStyle={{ background: "var(--card)", border: `1px solid ${"var(--border)"}`, borderRadius: 8, fontSize: 11, color: "var(--foreground)" }} />
                    <Area type="monotone" dataKey="ideal" stroke="#64748B" strokeDasharray="4 4" fill="none" />
                    <Area type="monotone" dataKey="actual" stroke={"var(--primary)"} fill={`${"var(--primary)"}22`} connectNulls={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Velocity */}
            <Card>
              <h3 className="text-[13px] font-semibold mb-2" style={{ color: "var(--foreground)" }}>Velocity (Last 5)</h3>
              <div style={{ height: 110 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={agileVelocity} barGap={2}>
                    <XAxis dataKey="sprint" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                    <YAxis tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                    <Tooltip contentStyle={{ background: "var(--card)", border: `1px solid ${"var(--border)"}`, borderRadius: 8, fontSize: 11, color: "var(--foreground)" }} />
                    <Bar dataKey="committed" fill={`${"var(--primary)"}44`} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="completed" fill={"var(--primary)"} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Sprint Health */}
            <Card>
              <h3 className="text-[13px] font-semibold mb-2" style={{ color: "var(--foreground)" }}>Sprint Health</h3>
              <div className="space-y-2">
                <HealthRow label="Scope Creep" value="+3 items added" color="#F59E0B" />
                <HealthRow label="Blocked Items" value="1 blocked" color="#EF4444" />
                <HealthRow label="Review Bottleneck" value="3 items queued" color="#F97316" />
                <HealthRow label="Bug Ratio" value="3/34 (8.8%)" color="#10B981" />
              </div>
            </Card>

            {/* Team Workload */}
            <Card>
              <h3 className="text-[13px] font-semibold mb-2" style={{ color: "var(--foreground)" }}>Team Workload</h3>
              <div className="space-y-2">
                {([] as any[]).map(m => {
                  const pct = Math.round((m.assigned / m.capacity) * 100);
                  const overloaded = pct > 90;
                  return (
                    <div key={m.name}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>{m.name.split(" ")[0]}</span>
                        <span className="text-[10px] font-semibold" style={{ color: overloaded ? "#EF4444" : "var(--muted-foreground)" }}>{m.assigned}/{m.capacity} SP</span>
                      </div>
                      <div className="w-full h-[6px] rounded-full overflow-hidden" style={{ background: `${"var(--border)"}33` }}>
                        <div className="h-full rounded-full transition-all" style={{
                          width: `${Math.min(pct, 100)}%`,
                          background: overloaded ? "#EF4444" : pct > 75 ? "#F59E0B" : "var(--primary)",
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* AI Insights */}
            <Card>
              <h3 className="text-[13px] font-semibold mb-2" style={{ color: "var(--foreground)" }}>AI Insights</h3>
              <div className="space-y-2 text-[11px]">
                <InsightBox color="#F59E0B">
                  <strong>Velocity Trend:</strong> Current pace projects 40 SP completion. Sprint goal at risk — 15 SP remaining with 8 days left.
                </InsightBox>
                <InsightBox color="#EF4444">
                  <strong>Carry-over Risk:</strong> PTX-115 (8 SP) is 60% done with complex remaining subtasks. Consider splitting for next sprint.
                </InsightBox>
                <InsightBox color="#6366F1">
                  <strong>Pairing Suggestion:</strong> Priya is under capacity (8/10 SP). Pair with Liam on blocked PTX-117 to unblock Stripe webhooks.
                </InsightBox>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* ═══ TASK DETAIL MODAL ═══ */}
      {selectedIssue && (
        <TaskDetailModal issue={selectedIssue} onClose={() => setSelectedIssue(null)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// BOARD COLUMNS (no swimlanes)
// ═══════════════════════════════════════════════════════════════════

function BoardColumns({ columns, issues, onCardClick }: {
  columns: typeof COLUMNS; issues: Issue[]; onCardClick: (i: Issue) => void;
}) {
  return (
    <div className="flex gap-3" style={{ minHeight: 500 }}>
      {columns.map(col => {
        const colIssues = issues.filter(i => i.column === col.id);
        const totalSP = colIssues.reduce((s, i) => s + i.storyPoints, 0);
        const atLimit = col.wipLimit && colIssues.length >= col.wipLimit;
        const overLimit = col.wipLimit && colIssues.length > col.wipLimit;

        return (
          <div key={col.id} className="flex-1 min-w-[220px] max-w-[300px] flex flex-col rounded-[12px]"
            style={{ background: true ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)" }}>
            {/* Column header */}
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: col.color }} />
                <span className="text-[12px] font-semibold" style={{ color: "var(--foreground)" }}>{col.label}</span>
                <span className="text-[11px] px-1.5 py-0.5 rounded-[4px] font-semibold"
                  style={{ background: `${col.color}22`, color: col.color }}>{colIssues.length}</span>
                {col.wipLimit && (
                  <span className="text-[9px] px-1 py-0.5 rounded-[3px] font-bold"
                    style={{
                      background: overLimit ? "rgba(239,68,68,0.15)" : atLimit ? "rgba(245,158,11,0.15)" : "transparent",
                      color: overLimit ? "#EF4444" : atLimit ? "#F59E0B" : "var(--muted-foreground)",
                      border: `1px solid ${overLimit ? "#EF444433" : atLimit ? "#F59E0B33" : "transparent"}`,
                    }}>
                    WIP {col.wipLimit}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium" style={{ color: "var(--muted-foreground)" }}>{totalSP} SP</span>
                <button className="w-5 h-5 rounded-[4px] flex items-center justify-center text-[14px] hover:opacity-80 transition-opacity"
                  style={{ color: "var(--muted-foreground)", background: `${"var(--border)"}33` }}>+</button>
              </div>
            </div>
            {/* Cards */}
            <div className="flex-1 px-2 pb-2 space-y-2 overflow-y-auto" style={{ maxHeight: "calc(100vh - 400px)" }}>
              {colIssues.map(issue => (
                <IssueCard key={issue.id} issue={issue} onClick={() => onCardClick(issue)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SWIMLANED BOARD
// ═══════════════════════════════════════════════════════════════════

function SwimlanedBoard({ swimlane, columns, issues, onCardClick }: {
  swimlane: SwimlaneSetting; columns: typeof COLUMNS; issues: Issue[]; onCardClick: (i: Issue) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const map = new Map<string, Issue[]>();
    for (const issue of issues) {
      let key: string;
      if (swimlane === "epic") key = issue.epic;
      else if (swimlane === "assignee") key = issue.assignee || "Unassigned";
      else if (swimlane === "priority") key = issue.priority;
      else key = issue.labels[0] || "No Label";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(issue);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [issues, swimlane]);

  const toggle = (key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {groups.map(([group, groupIssues]) => {
        const isCollapsed = collapsed.has(group);
        const groupColor = swimlane === "epic" ? getEpicColor(group) : swimlane === "priority" ? PRIORITY_COLORS[group as Priority] || "#64748B" : "var(--primary)";
        return (
          <div key={group} className="rounded-[10px]" style={{ border: `1px solid ${"var(--border)"}33` }}>
            {/* Swimlane header */}
            <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
              onClick={() => toggle(group)}
              style={{ background: `${groupColor}08`, borderBottom: isCollapsed ? "none" : `1px solid ${"var(--border)"}22` }}>
              <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{isCollapsed ? "▶" : "▼"}</span>
              <div className="w-2 h-2 rounded-full" style={{ background: groupColor }} />
              <span className="text-[12px] font-semibold" style={{ color: "var(--foreground)" }}>{group}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-[4px]" style={{ background: `${groupColor}22`, color: groupColor }}>
                {groupIssues.length}
              </span>
              <span className="text-[10px] ml-auto" style={{ color: "var(--muted-foreground)" }}>
                {groupIssues.reduce((s, i) => s + i.storyPoints, 0)} SP
              </span>
            </div>
            {/* Columns within swimlane */}
            {!isCollapsed && (
              <div className="flex gap-2 p-2">
                {columns.map(col => {
                  const colIssues = groupIssues.filter(i => i.column === col.id);
                  return (
                    <div key={col.id} className="flex-1 min-w-[180px]">
                      <div className="text-[10px] font-semibold mb-1 px-1" style={{ color: col.color }}>
                        {col.label} ({colIssues.length})
                      </div>
                      <div className="space-y-1.5">
                        {colIssues.map(issue => (
                          <IssueCard key={issue.id} issue={issue} compact onClick={() => onCardClick(issue)} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ISSUE CARD
// ═══════════════════════════════════════════════════════════════════

function IssueCard({ issue, compact, onClick }: {
  issue: Issue; compact?: boolean; onClick: () => void;
}) {
  const borderColor = PRIORITY_COLORS[issue.priority];
  const isDue = issue.dueDate && new Date(issue.dueDate) <= new Date(Date.now() + 2 * 86400000);

  return (
    <div className="rounded-[10px] p-2.5 cursor-pointer transition-all duration-150 hover:translate-y-[-2px]"
      onClick={onClick}
      style={{
        background: "var(--card)",
        border: `1px solid ${"var(--border)"}`,
        borderLeft: `3px solid ${borderColor}`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      }}>
      {/* Top row: type icon + ID */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px]">{ISSUE_ICONS[issue.type]}</span>
          <span className="text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>{issue.id}</span>
          {issue.blocked && (
            <span className="text-[9px] px-1 py-0.5 rounded-[3px] font-bold" style={{ background: "rgba(239,68,68,0.15)", color: "#EF4444" }}>BLOCKED</span>
          )}
        </div>
        <span className="text-[11px]">{PRIORITY_ICONS[issue.priority]}</span>
      </div>

      {/* Title */}
      <p className={`text-[12px] font-medium leading-[16px] ${compact ? "line-clamp-1" : "line-clamp-2"}`} style={{ color: "var(--foreground)" }}>
        {issue.title}
      </p>

      {/* Labels */}
      {!compact && issue.labels.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {issue.labels.map(l => (
            <span key={l} className="text-[9px] font-semibold px-1.5 py-0.5 rounded-[3px]"
              style={{ background: `${getLabelColor(l)}18`, color: getLabelColor(l) }}>
              {l}
            </span>
          ))}
        </div>
      )}

      {/* Subtasks progress */}
      {!compact && issue.subtasks && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="flex-1 h-[3px] rounded-full overflow-hidden" style={{ background: `${"var(--border)"}33` }}>
            <div className="h-full rounded-full" style={{ width: `${(issue.subtasks.done / issue.subtasks.total) * 100}%`, background: "#10B981" }} />
          </div>
          <span className="text-[9px]" style={{ color: "var(--muted-foreground)" }}>{issue.subtasks.done}/{issue.subtasks.total}</span>
        </div>
      )}

      {/* Bottom row: assignee + SP + due date */}
      <div className="flex items-center justify-between mt-2">
        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[9px] font-bold text-white">A</div>
        <div className="flex items-center gap-2">
          {isDue && <span className="text-[9px] font-semibold" style={{ color: "#EF4444" }}>⚠ {issue.dueDate?.slice(5)}</span>}
          <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
            style={{ background: `${"var(--primary)"}22`, color: "var(--primary)" }}>
            {issue.storyPoints}
          </span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TASK DETAIL MODAL
// ═══════════════════════════════════════════════════════════════════

function TaskDetailModal({ issue, onClose,  }: { issue: Issue; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<"details" | "comments" | "activity">("details");

  const mockComments = [
    { author: "Sarah Chen", time: "2h ago", text: "I've started the form validation — the email step needs a custom regex for corporate domains." },
    { author: "James Okafor", time: "5h ago", text: "Can we add a skip option for the company info step? Some individual users won't have this." },
    { author: "Maya (Agent)", time: "1d ago", text: "Linked this to PTX-128 (signup flow) — the onboarding wizard should launch after first successful login." },
  ];

  const mockActivity = [
    { time: "2h ago", text: "Sarah Chen moved from To Do → In Progress" },
    { time: "5h ago", text: "James Okafor added comment" },
    { time: "1d ago", text: "Maya (Agent) linked to PTX-128" },
    { time: "1d ago", text: "Created by Sarah Chen in Sprint 7" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} />
      {/* Modal */}
      <div className="relative w-full max-w-[720px] max-h-[85vh] overflow-y-auto rounded-[16px]"
        onClick={e => e.stopPropagation()}
        style={{ background: "var(--card)", border: `1px solid ${"var(--border)"}`, boxShadow: "0 24px 48px rgba(0,0,0,0.3)" }}>
        {/* Header */}
        <div className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between"
          style={{ background: "var(--card)", borderBottom: `1px solid ${"var(--border)"}` }}>
          <div className="flex items-center gap-3">
            <span className="text-[16px]">{ISSUE_ICONS[issue.type]}</span>
            <span className="text-[13px] font-bold" style={{ color: "var(--primary)" }}>{issue.id}</span>
            <Badge variant={issue.priority}>{issue.priority}</Badge>
            {issue.blocked && <Badge variant="destructive">Blocked</Badge>}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-[8px] flex items-center justify-center text-[18px] hover:opacity-70 transition-opacity"
            style={{ color: "var(--muted-foreground)", background: `${"var(--border)"}22` }}>×</button>
        </div>

        {/* Title */}
        <div className="px-6 py-3">
          <h2 className="text-[18px] font-bold leading-snug" style={{ color: "var(--foreground)" }}>{issue.title}</h2>
        </div>

        {/* Fields grid */}
        <div className="px-6 pb-4 grid grid-cols-2 gap-x-6 gap-y-3">
          <FieldRow label="Status">
            <Badge variant={issue.column === "done" ? "default" : issue.column === "in_progress" ? "outline" : issue.column === "in_review" ? "secondary" : "outline"}>
              {COLUMNS.find(c => c.id === issue.column)?.label || issue.column}
            </Badge>
          </FieldRow>
          <FieldRow label="Assignee">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[9px] font-bold text-white">A</div>
              <span className="text-[12px]" style={{ color: "var(--foreground)" }}>{issue.assignee}</span>
            </div>
          </FieldRow>
          <FieldRow label="Priority">
            <span className="text-[12px]" style={{ color: PRIORITY_COLORS[issue.priority] }}>{PRIORITY_ICONS[issue.priority]} {issue.priority}</span>
          </FieldRow>
          <FieldRow label="Story Points">
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: `${"var(--primary)"}22`, color: "var(--primary)" }}>
              {issue.storyPoints}
            </span>
          </FieldRow>
          <FieldRow label="Epic">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: getEpicColor(issue.epic) }} />
              <span className="text-[12px]" style={{ color: "var(--foreground)" }}>{issue.epic}</span>
            </div>
          </FieldRow>
          <FieldRow label="Sprint">
            <span className="text-[12px]" style={{ color: "var(--foreground)" }}>Sprint 7</span>
          </FieldRow>
          <FieldRow label="Labels">
            <div className="flex flex-wrap gap-1">
              {issue.labels.map(l => (
                <span key={l} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-[3px]"
                  style={{ background: `${getLabelColor(l)}18`, color: getLabelColor(l) }}>{l}</span>
              ))}
            </div>
          </FieldRow>
          {issue.dueDate && (
            <FieldRow label="Due Date">
              <span className="text-[12px]" style={{ color: new Date(issue.dueDate) <= new Date() ? "#EF4444" : "var(--foreground)" }}>{issue.dueDate}</span>
            </FieldRow>
          )}
        </div>

        {/* Description */}
        <div className="px-6 pb-3">
          <p className="text-[12px] font-semibold mb-1" style={{ color: "var(--muted-foreground)" }}>Description</p>
          <div className="p-3 rounded-[8px] text-[13px] leading-relaxed" style={{ background: true ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", color: "var(--foreground)" }}>
            {issue.description || `Implement ${issue.title.toLowerCase()}. Acceptance criteria and technical approach to be defined during sprint planning refinement. Follow existing design system patterns and ensure full test coverage.`}
          </div>
        </div>

        {/* Subtasks */}
        {issue.subtasks && (
          <div className="px-6 pb-3">
            <p className="text-[12px] font-semibold mb-2" style={{ color: "var(--muted-foreground)" }}>Subtasks ({issue.subtasks.done}/{issue.subtasks.total})</p>
            <div className="space-y-1.5">
              {Array.from({ length: issue.subtasks.total }, (_, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px]" style={{ color: "var(--foreground)" }}>
                  <span className={`w-4 h-4 rounded-[4px] flex items-center justify-center text-[10px] ${i < issue.subtasks!.done ? "bg-green-500/20 text-green-400" : ""}`}
                    style={{ border: `1px solid ${i < issue.subtasks!.done ? "#10B98144" : "var(--border)"}` }}>
                    {i < issue.subtasks!.done ? "✓" : ""}
                  </span>
                  <span style={{ textDecoration: i < issue.subtasks!.done ? "line-through" : "none", opacity: i < issue.subtasks!.done ? 0.6 : 1 }}>
                    {["Set up form scaffold", "Email validation step", "Company info step", "Plan selection step", "Review & confirm"][i] || `Subtask ${i + 1}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabs: Comments / Activity */}
        <div className="px-6 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="flex gap-4 pt-3">
            {(["details", "comments", "activity"] as const).map(tab => (
              <button key={tab} className="pb-2 text-[12px] font-semibold capitalize transition-colors"
                onClick={() => setActiveTab(tab)}
                style={{
                  color: activeTab === tab ? "var(--primary)" : "var(--muted-foreground)",
                  borderBottom: activeTab === tab ? `2px solid ${"var(--primary)"}` : "2px solid transparent",
                }}>
                {tab} {tab === "comments" ? `(${mockComments.length})` : ""}
              </button>
            ))}
            <button className="ml-auto mb-2 px-2.5 py-1 rounded-[6px] text-[11px] font-semibold flex items-center gap-1"
              style={{ background: `${"var(--primary)"}15`, color: "var(--primary)", border: `1px solid ${"var(--primary)"}33` }}>
              ✨ AI Summary
            </button>
          </div>
        </div>

        {/* Tab content */}
        <div className="px-6 py-3 pb-6">
          {activeTab === "comments" && (
            <div className="space-y-3">
              {mockComments.map((c, i) => (
                <div key={i} className="flex gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[9px] font-bold text-white">A</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[12px] font-semibold" style={{ color: "var(--foreground)" }}>{c.author}</span>
                      <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{c.time}</span>
                    </div>
                    <p className="text-[12px] leading-relaxed" style={{ color: "var(--muted-foreground)" }}>{c.text}</p>
                  </div>
                </div>
              ))}
              {/* Reply input */}
              <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${"var(--border)"}33` }}>
                <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[9px] font-bold text-white">SC</div>
                <input className="flex-1 px-3 py-2 rounded-[8px] text-[12px]"
                  placeholder="Add a comment..."
                  style={{ background: "var(--card)", color: "var(--foreground)", border: `1px solid ${"var(--border)"}`, outline: "none" }} />
                <Button variant="default" size="sm" onClick={() => toast.success("Comment posted")}>Post</Button>
              </div>
            </div>
          )}

          {activeTab === "activity" && (
            <div className="space-y-2">
              {mockActivity.map((a, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: "var(--primary)" }} />
                  <div>
                    <p className="text-[12px]" style={{ color: "var(--foreground)" }}>{a.text}</p>
                    <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{a.time}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === "details" && (
            <div className="text-[12px] space-y-2" style={{ color: "var(--muted-foreground)" }}>
              <p>Created in Sprint 7 planning session. This issue was refined during the 1 Apr backlog grooming meeting.</p>
              <p><strong style={{ color: "var(--foreground)" }}>Linked Issues:</strong> PTX-128 (depends on), PTX-104 (related)</p>
              <p><strong style={{ color: "var(--foreground)" }}>Acceptance Criteria:</strong> Form must handle 5 steps, support back navigation, persist state on refresh, and validate each step before proceeding.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SMALL HELPER COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function FilterChip({ label, active, onClick, icon }: {
  label: string; active: boolean; onClick: () => void; icon?: string;
}) {
  return (
    <button className="flex items-center gap-1 px-2.5 py-1 rounded-[6px] text-[11px] font-semibold transition-all"
      onClick={onClick}
      style={{
        background: active ? `${"var(--primary)"}22` : "transparent",
        color: active ? "var(--primary)" : "var(--muted-foreground)",
        border: `1px solid ${active ? "var(--primary)" + "44" : "var(--border)" + "44"}`,
      }}>
      {icon && <span className="text-[10px]">{icon}</span>}
      {label}
    </button>
  );
}

function HealthRow({ label, value, color}: { label: string; value: string; color: string;  }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{label}</span>
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-[4px]" style={{ background: `${color}15`, color }}>{value}</span>
    </div>
  );
}

function InsightBox({ children, color, mode }: { children: React.ReactNode; color: string }) {
  return (
    <div className="p-2 rounded-[6px] leading-relaxed" style={{ background: `${color}${true ? "12" : "08"}`, border: `1px solid ${color}22`, color: `${color}CC` }}>
      {children}
    </div>
  );
}

function FieldRow({ label, children}: { label: string; children: React.ReactNode;  }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--muted-foreground)" }}>{label}</p>
      {children}
    </div>
  );
}
