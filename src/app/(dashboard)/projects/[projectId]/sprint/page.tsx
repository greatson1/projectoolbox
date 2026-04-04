"use client";
// @ts-nocheck

import { useState, useMemo, useRef, useEffect, useCallback } from "react";

import { useParams } from "next/navigation";
import { useProjectTasks } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

/**
 * Sprint Tracker — Sprint progress, burndown/burnup, stand-ups, team performance,
 * risks, blockers, goal tracking. Full design-system page.
 */


import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, ComposedChart,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ReferenceLine, Cell,
} from "recharts";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

type ItemStatus = "done" | "in_review" | "in_progress" | "todo" | "blocked";
type IssueType = "story" | "bug" | "task" | "spike";

interface SprintItem {
  id: string;
  title: string;
  type: IssueType;
  sp: number;
  status: ItemStatus;
  assignee: string;
  timeInStatus: string;   // e.g. "2d", "4h"
  cycleTime?: string;     // e.g. "3.2d" — only for done items
  blocked?: boolean;
  atRisk?: boolean;
}

interface TeamMember {
  name: string;
  initials: string;
  capacity: number;
  done: number;
  inProgress: number;
  todo: number;
  blocked: number;
  velocityHistory: number[];   // last 6 sprints
}

// ═══════════════════════════════════════════════════════════════════
// MOCK DATA — Sprint 7, Apr 1-14, Day 6, 57 SP scope, 34 done
// ═══════════════════════════════════════════════════════════════════

const SPRINTS = [
  { id: 7, name: "Sprint 7", start: "2026-04-01", end: "2026-04-14", days: 10, daysPassed: 6, scope: 57, done: 34 },
  { id: 6, name: "Sprint 6", start: "2026-03-18", end: "2026-03-31", days: 10, daysPassed: 10, scope: 50, done: 46 },
  { id: 5, name: "Sprint 5", start: "2026-03-04", end: "2026-03-17", days: 10, daysPassed: 10, scope: 48, done: 44 },
];

const BURNDOWN_DATA = [
  { day: "D1", ideal: 57, actual: 57, scope: 55 },
  { day: "D2", ideal: 51, actual: 54, scope: 55 },
  { day: "D3", ideal: 45, actual: 48, scope: 57 },  // scope change
  { day: "D4", ideal: 40, actual: 43, scope: 57 },
  { day: "D5", ideal: 34, actual: 38, scope: 57 },
  { day: "D6", ideal: 28, actual: 23, scope: 57 },
  { day: "D7", ideal: 23, projected: 18, scope: 57 },
  { day: "D8", ideal: 17, projected: 13, scope: 57 },
  { day: "D9", ideal: 11, projected: 8, scope: 57 },
  { day: "D10", ideal: 0, projected: 2, scope: 57 },
];

const BURNUP_DATA = [
  { day: "D1", scope: 55, completed: 0, accepted: 0 },
  { day: "D2", scope: 55, completed: 3, accepted: 0 },
  { day: "D3", scope: 57, completed: 9, accepted: 5 },
  { day: "D4", scope: 57, completed: 14, accepted: 10 },
  { day: "D5", scope: 57, completed: 19, accepted: 15 },
  { day: "D6", scope: 57, completed: 34, accepted: 28 },
  { day: "D7", scope: 57, completed: null, accepted: null },
  { day: "D8", scope: 57, completed: null, accepted: null },
  { day: "D9", scope: 57, completed: null, accepted: null },
  { day: "D10", scope: 57, completed: null, accepted: null },
];

const CYCLE_TIME_DATA = [
  { status: "To Do", avg: 1.2 },
  { status: "In Progress", avg: 2.8 },
  { status: "In Review", avg: 1.5 },
  { status: "Done", avg: 0.3 },
];

const VELOCITY_TREND = [
  { sprint: "S2", committed: 40, completed: 36, projected: null },
  { sprint: "S3", committed: 42, completed: 38, projected: null },
  { sprint: "S4", committed: 45, completed: 40, projected: null },
  { sprint: "S5", committed: 48, completed: 44, projected: null },
  { sprint: "S6", committed: 50, completed: 46, projected: null },
  { sprint: "S7", committed: 57, completed: 34, projected: 52 },
];

const CONFIDENCE_RADAR = [
  { axis: "Velocity", value: 82 },
  { axis: "Scope Stability", value: 65 },
  { axis: "Blockers", value: 70 },
  { axis: "Capacity", value: 88 },
  { axis: "Review Throughput", value: 72 },
];

const TEAM: TeamMember[] = [
  { name: "Sarah Chen", initials: "SC", capacity: 13, done: 8, inProgress: 3, todo: 1, blocked: 0, velocityHistory: [10, 11, 12, 11, 13, 8] },
  { name: "James Okafor", initials: "JO", capacity: 13, done: 8, inProgress: 2, todo: 2, blocked: 0, velocityHistory: [9, 10, 10, 11, 12, 8] },
  { name: "Priya Sharma", initials: "PS", capacity: 10, done: 5, inProgress: 2, todo: 1, blocked: 1, velocityHistory: [7, 8, 8, 9, 10, 5] },
  { name: "Liam Barrett", initials: "LB", capacity: 11, done: 8, inProgress: 2, todo: 0, blocked: 1, velocityHistory: [8, 9, 9, 10, 11, 8] },
  { name: "Mia Novak", initials: "MN", capacity: 10, done: 5, inProgress: 3, todo: 2, blocked: 0, velocityHistory: [7, 7, 8, 8, 9, 5] },
];

const STANDUP_DATA = [
  {
    name: "Sarah Chen", initials: "SC", mood: "😊",
    yesterday: ["Completed onboarding form step 3", "Reviewed PTX-121 PR"],
    today: ["Finish form validation logic", "Start step 4 UI"],
    blockers: [],
  },
  {
    name: "James Okafor", initials: "JO", mood: "😐",
    yesterday: ["Dashboard polling — basic interval done", "Fixed CORS issue"],
    today: ["Add WebSocket fallback", "Write polling tests"],
    blockers: [],
  },
  {
    name: "Priya Sharma", initials: "PS", mood: "😟",
    yesterday: ["RBAC endpoint tests — 80% coverage", "Fixed edge case in role check"],
    today: ["Finish RBAC tests", "Start email template bug"],
    blockers: ["Waiting on staging env credentials from DevOps"],
  },
  {
    name: "Liam Barrett", initials: "LB", mood: "😤",
    yesterday: ["Stripe webhook handler — subscription.updated done"],
    today: ["Handle subscription.deleted event", "Fix retry logic"],
    blockers: ["Stripe test mode returning 500 on subscription.deleted — investigating"],
  },
  {
    name: "Mia Novak", initials: "MN", mood: "😊",
    yesterday: ["Chart drill-down interaction prototype", "Updated sparkline styles"],
    today: ["Wire drill-down to API", "Start plan comparison component"],
    blockers: [],
  },
];

const SPRINT_ITEMS: SprintItem[] = [
  { id: "PTX-115", title: "Onboarding wizard multi-step form", type: "story", sp: 8, status: "in_progress", assignee: "Sarah Chen", timeInStatus: "3d", atRisk: true },
  { id: "PTX-116", title: "Real-time dashboard data refresh", type: "story", sp: 5, status: "in_progress", assignee: "James Okafor", timeInStatus: "2d" },
  { id: "PTX-117", title: "Stripe subscription webhooks", type: "story", sp: 5, status: "blocked", assignee: "Liam Barrett", timeInStatus: "1d", blocked: true },
  { id: "PTX-118", title: "Fix duplicate onboarding email", type: "bug", sp: 2, status: "in_progress", assignee: "Priya Sharma", timeInStatus: "1d" },
  { id: "PTX-119", title: "Analytics chart drill-down", type: "story", sp: 3, status: "in_progress", assignee: "Mia Novak", timeInStatus: "2d" },
  { id: "PTX-120", title: "RBAC for billing pages", type: "story", sp: 5, status: "in_review", assignee: "Priya Sharma", timeInStatus: "4h" },
  { id: "PTX-121", title: "Onboarding email template", type: "task", sp: 3, status: "in_review", assignee: "Sarah Chen", timeInStatus: "6h" },
  { id: "PTX-122", title: "Dashboard KPI sparklines", type: "story", sp: 3, status: "in_review", assignee: "Mia Novak", timeInStatus: "3h" },
  { id: "PTX-109", title: "Subscription plan comparison", type: "story", sp: 5, status: "todo", assignee: "Mia Novak", timeInStatus: "6d" },
  { id: "PTX-110", title: "Credit usage cron job", type: "task", sp: 3, status: "todo", assignee: "Liam Barrett", timeInStatus: "6d" },
  { id: "PTX-113", title: "Timezone fix in sprint dates", type: "bug", sp: 2, status: "todo", assignee: "Sarah Chen", timeInStatus: "6d", atRisk: true },
  { id: "PTX-114", title: "Payment webhook retry logic", type: "task", sp: 2, status: "todo", assignee: "Liam Barrett", timeInStatus: "6d", blocked: true },
  { id: "PTX-123", title: "Vite + Tailwind scaffold", type: "task", sp: 2, status: "done", assignee: "James Okafor", timeInStatus: "—", cycleTime: "1.5d" },
  { id: "PTX-124", title: "Design tokens &provider", type: "story", sp: 5, status: "done", assignee: "Mia Novak", timeInStatus: "—", cycleTime: "3.1d" },
  { id: "PTX-125", title: "JWT auth with refresh rotation", type: "story", sp: 5, status: "done", assignee: "Sarah Chen", timeInStatus: "—", cycleTime: "4.0d" },
  { id: "PTX-126", title: "Reusable data table component", type: "story", sp: 3, status: "done", assignee: "Priya Sharma", timeInStatus: "—", cycleTime: "2.8d" },
  { id: "PTX-127", title: "Stripe API + payment intents", type: "story", sp: 5, status: "done", assignee: "Liam Barrett", timeInStatus: "—", cycleTime: "3.5d" },
  { id: "PTX-128", title: "Signup + email verification", type: "story", sp: 3, status: "done", assignee: "Sarah Chen", timeInStatus: "—", cycleTime: "2.2d" },
  { id: "PTX-129", title: "Dashboard layout shell", type: "story", sp: 3, status: "done", assignee: "Mia Novak", timeInStatus: "—", cycleTime: "2.0d" },
  { id: "PTX-130", title: "Credit ledger schema", type: "task", sp: 2, status: "done", assignee: "Liam Barrett", timeInStatus: "—", cycleTime: "1.0d" },
  { id: "PTX-131", title: "Password reset flow", type: "task", sp: 2, status: "done", assignee: "Priya Sharma", timeInStatus: "—", cycleTime: "1.8d" },
  { id: "PTX-132", title: "Fix CORS preflight headers", type: "bug", sp: 1, status: "done", assignee: "James Okafor", timeInStatus: "—", cycleTime: "0.5d" },
  { id: "PTX-133", title: "Loading skeleton components", type: "task", sp: 2, status: "done", assignee: "Mia Novak", timeInStatus: "—", cycleTime: "1.2d" },
  { id: "PTX-134", title: "Invoice PDF generation", type: "story", sp: 3, status: "done", assignee: "James Okafor", timeInStatus: "—", cycleTime: "2.5d" },
];

const BLOCKERS = [
  { id: "PTX-117", title: "Stripe test mode 500 on subscription.deleted", owner: "Liam Barrett", duration: "1d 4h", escalated: false, impact: "Blocks subscription lifecycle completion" },
  { id: "PTX-114", title: "Depends on PTX-117 Stripe webhook completion", owner: "Liam Barrett", duration: "6d", escalated: true, impact: "Payment retry logic cannot be tested" },
];

const SPRINT_GOAL = {
  text: "Complete onboarding wizard end-to-end and launch billing subscription flow with Stripe integration",
  alignedItems: 14,
  doneItems: 9,
  prediction: 78,
};

const ISSUE_ICONS: Record<IssueType, string> = { story: "📖", bug: "🐛", task: "✅", spike: "🔬" };
const STATUS_COLORS: Record<ItemStatus, string> = {
  done: "#10B981", in_review: "#F59E0B", in_progress: "#6366F1", todo: "#64748B", blocked: "#EF4444",
};
const STATUS_LABELS: Record<ItemStatus, string> = {
  done: "Done", in_review: "Review", in_progress: "In Progress", todo: "To Do", blocked: "Blocked",
};
const STATUS_ORDER: ItemStatus[] = ["todo", "in_progress", "in_review", "done"];

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function SprintTrackerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: apiTasks } = useProjectTasks(projectId);

  const SPRINT_ITEMS_DATA: SprintItem[] = (apiTasks && apiTasks.length > 0) ? apiTasks.map((t: any) => ({
    id: t.id,
    title: t.title || t.name || "",
    type: (t.type === "bug" ? "bug" : t.type === "spike" ? "spike" : t.type === "task" ? "task" : "story") as IssueType,
    sp: t.storyPoints ?? t.points ?? 0,
    status: (t.status === "done" || t.status === "completed" ? "done" : t.status === "in_review" ? "in_review" : t.status === "in_progress" || t.status === "active" ? "in_progress" : t.status === "blocked" ? "blocked" : "todo") as ItemStatus,
    assignee: t.assignee || t.assigneeName || "",
    timeInStatus: t.timeInStatus || "—",
    cycleTime: t.cycleTime,
    blocked: t.blocked || false,
    atRisk: t.atRisk || false,
  })) : SPRINT_ITEMS;

  const mode = "dark";
  const [selectedSprint, setSelectedSprint] = useState(7);
  const [standupView, setStandupView] = useState<"today" | "previous">("today");
  const [backlogFilter, setBacklogFilter] = useState<"all" | "in_progress" | "blocked" | "done" | "at_risk">("all");

  const sprint = SPRINTS.find(s => s.id === selectedSprint)!;
  const progressPct = Math.round((sprint.done / sprint.scope) * 100);
  const avgVelocity = Math.round([36, 38, 40, 44, 46].reduce((a, b) => a + b, 0) / 5);
  const paceVsAvg = Math.round(((sprint.done / sprint.daysPassed) / (avgVelocity / 10)) * 100);

  const filteredBacklog = useMemo(() => {
    if (backlogFilter === "all") return SPRINT_ITEMS_DATA;
    if (backlogFilter === "at_risk") return SPRINT_ITEMS_DATA.filter(i => i.atRisk || i.blocked);
    if (backlogFilter === "blocked") return SPRINT_ITEMS_DATA.filter(i => i.blocked || i.status === "blocked");
    return SPRINT_ITEMS_DATA.filter(i => i.status === backlogFilter);
  }, [backlogFilter]);

  return (
    <div className="space-y-6 max-w-[1600px]">
      {/* ═══ 1. HEADER ═══ */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <h1 className="text-[24px] font-bold" style={{ color: "var(--foreground)" }}>Sprint Tracker</h1>
          <select className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold"
            value={selectedSprint} onChange={e => setSelectedSprint(Number(e.target.value))}
            style={{ background: "var(--card)", color: "var(--foreground)", border: `1px solid ${"var(--border)"}` }}>
            {([] as any[]).map(s => <option key={s.id} value={s.id}>{s.name} — {s.start.slice(5)} to {s.end.slice(5)}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-[8px]"
            style={{ background: `${"#10B981"}12`, border: `1px solid ${"#10B981"}33` }}>
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-[12px] font-semibold" style={{ color: "#10B981" }}>Day {sprint.daysPassed} of {sprint.days} — In Progress</span>
          </div>
          <Button variant="default" size="sm" disabled title="Coming soon">Export Report</Button>
        </div>
      </div>

      {/* ═══ 2. SPRINT HEALTH DASHBOARD — 6 cards ═══ */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Progress Ring */}
        <Card>
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Sprint Progress</p>
          <div className="flex items-center justify-center">
            <ProgressRing pct={progressPct} size={80} stroke={6} color={"var(--primary)"} bgColor={`${"var(--border)"}33`}>
              <span className="text-[16px] font-bold" style={{ color: "var(--foreground)" }}>{progressPct}%</span>
              <span className="text-[9px]" style={{ color: "var(--muted-foreground)" }}>{sprint.done}/{sprint.scope} SP</span>
            </ProgressRing>
          </div>
        </Card>

        {/* Burndown Status */}
        <Card>
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--muted-foreground)" }}>Burndown</p>
          <div style={{ height: 50 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={BURNDOWN_DATA.slice(0, 6)}>
                <Line type="monotone" dataKey="ideal" stroke="#64748B" strokeDasharray="3 3" dot={false} strokeWidth={1} />
                <Line type="monotone" dataKey="actual" stroke={"var(--primary)"} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] font-semibold mt-1" style={{ color: "#10B981" }}>5 SP ahead of ideal</p>
        </Card>

        {/* Velocity Pace */}
        <Card>
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Velocity Pace</p>
          <p className="text-[22px] font-bold" style={{ color: paceVsAvg >= 100 ? "#10B981" : "#F59E0B" }}>{paceVsAvg}%</p>
          <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>
            {(sprint.done / sprint.daysPassed).toFixed(1)} SP/day vs avg {(avgVelocity / 10).toFixed(1)}
          </p>
        </Card>

        {/* Days Remaining */}
        <Card>
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Days Remaining</p>
          <p className="text-[28px] font-bold" style={{ color: sprint.days - sprint.daysPassed <= 3 ? "#EF4444" : "var(--foreground)" }}>
            {sprint.days - sprint.daysPassed}
          </p>
          <div className="w-full h-[6px] rounded-full overflow-hidden mt-1" style={{ background: `${"var(--border)"}33` }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${(sprint.daysPassed / sprint.days) * 100}%`, background: "var(--primary)" }} />
          </div>
        </Card>

        {/* Scope Changes */}
        <Card>
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Scope Changes</p>
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-bold" style={{ color: "#F59E0B" }}>+3</span>
            <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>added</span>
            <span className="text-[13px] font-bold" style={{ color: "var(--muted-foreground)" }}>-1</span>
            <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>removed</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1">
            <span className="text-[9px] px-1.5 py-0.5 rounded-[3px] font-bold" style={{ background: "rgba(245,158,11,0.12)", color: "#F59E0B" }}>
              Scope Creep +3.6%
            </span>
          </div>
        </Card>

        {/* Blocked Items */}
        <Card>
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Blocked</p>
          <div className="flex items-center gap-2">
            <span className="text-[28px] font-bold" style={{ color: "#EF4444" }}>2</span>
            <Badge variant="destructive">Active</Badge>
          </div>
          <p className="text-[10px] mt-1" style={{ color: "#EF4444" }}>Longest: 1d 4h</p>
        </Card>
      </div>

      {/* ═══ 3 & 4. BURNDOWN + BURNUP CHARTS ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Burndown */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>Burndown Chart</h3>
            <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Remaining SP over time</span>
          </div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={[] as any[]}>
                <CartesianGrid strokeDasharray="3 3" stroke={`${"var(--border)"}33`} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} domain={[0, 60]} />
                <Tooltip contentStyle={{ background: "var(--card)", border: `1px solid ${"var(--border)"}`, borderRadius: 8, fontSize: 11, color: "var(--foreground)" }} />
                {/* Shaded area between ideal and actual — approximate with area */}
                <Area type="monotone" dataKey="ideal" stroke="none" fill={`${"#10B981"}08`} />
                {/* Scope line */}
                <Line type="stepAfter" dataKey="scope" stroke="#F59E0B" strokeDasharray="4 2" dot={false} strokeWidth={1.5} name="Scope" />
                {/* Ideal line */}
                <Line type="monotone" dataKey="ideal" stroke="#64748B" strokeDasharray="5 5" dot={false} strokeWidth={1.5} name="Ideal" />
                {/* Actual line */}
                <Line type="monotone" dataKey="actual" stroke={"var(--primary)"} dot={{ r: 3, fill: "var(--primary)" }} strokeWidth={2.5} name="Actual" connectNulls={false} />
                {/* AI projection */}
                <Line type="monotone" dataKey="projected" stroke={"var(--primary)"} strokeDasharray="6 3" dot={false} strokeWidth={1.5} name="Projected" connectNulls={false} />
                {/* Today marker */}
                <ReferenceLine x="D6" stroke={"#EF4444"} strokeDasharray="3 3" label={{ value: "Today", position: "top", fontSize: 9, fill: "#EF4444" }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 inline-block" style={{ background: "#64748B", borderTop: "1px dashed #64748B" }} /> Ideal</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 inline-block" style={{ background: "var(--primary)" }} /> Actual</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 inline-block" style={{ background: "var(--primary)", borderTop: "1px dashed " + "var(--primary)" }} /> Projected</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 inline-block" style={{ background: "#F59E0B", borderTop: "1px dotted #F59E0B" }} /> Scope</span>
          </div>
        </Card>

        {/* Burnup */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>Burnup Chart</h3>
            <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Cumulative work completed</span>
          </div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={[] as any[]}>
                <CartesianGrid strokeDasharray="3 3" stroke={`${"var(--border)"}33`} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} domain={[0, 60]} />
                <Tooltip contentStyle={{ background: "var(--card)", border: `1px solid ${"var(--border)"}`, borderRadius: 8, fontSize: 11, color: "var(--foreground)" }} />
                {/* Scope line */}
                <Line type="stepAfter" dataKey="scope" stroke="#F59E0B" strokeWidth={2} dot={false} name="Scope" />
                {/* Completed line */}
                <Area type="monotone" dataKey="completed" stroke={"var(--primary)"} fill={`${"var(--primary)"}15`} strokeWidth={2.5} dot={{ r: 3, fill: "var(--primary)" }} name="Completed" connectNulls={false} />
                {/* Accepted line */}
                <Line type="monotone" dataKey="accepted" stroke="#10B981" strokeWidth={2} dot={{ r: 2, fill: "#10B981" }} name="Accepted" connectNulls={false} />
                <ReferenceLine x="D6" stroke={"#EF4444"} strokeDasharray="3 3" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 inline-block" style={{ background: "#F59E0B" }} /> Scope</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 inline-block" style={{ background: "var(--primary)" }} /> Completed</span>
            <span className="flex items-center gap-1"><span className="w-4 h-0.5 inline-block" style={{ background: "#10B981" }} /> Accepted</span>
            <span className="text-[10px] ml-auto font-medium" style={{ color: "var(--muted-foreground)" }}>Gap = {sprint.scope - sprint.done} SP remaining</span>
          </div>
        </Card>
      </div>

      {/* ═══ 5. DAILY STAND-UP TRACKER ═══ */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>Daily Stand-up</h3>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>Day 6 — Wednesday, 2 Apr 2026</p>
          </div>
          <div className="flex rounded-[8px] overflow-hidden" style={{ border: `1px solid ${"var(--border)"}` }}>
            {(["today", "previous"] as const).map(v => (
              <button key={v} className="px-3 py-1 text-[11px] font-semibold capitalize"
                onClick={() => setStandupView(v)}
                style={{ background: standupView === v ? "var(--primary)" : "transparent", color: standupView === v ? "#FFF" : "var(--muted-foreground)" }}>
                {v === "today" ? "Today" : "Previous Days"}
              </button>
            ))}
          </div>
        </div>

        {/* AI Summary */}
        <div className="p-3 rounded-[10px] mb-4 flex items-start gap-2"
          style={{ background: `${"var(--primary)"}08`, border: `1px solid ${"var(--primary)"}22` }}>
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center text-[9px] font-bold text-white shadow-primary/30">AI</div>
          <div>
            <p className="text-[11px] font-semibold mb-0.5" style={{ color: "var(--primary)" }}>AI Stand-up Summary</p>
            <p className="text-[12px] leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
              Team is on track with 34/57 SP completed. 2 blockers flagged — Stripe webhook issue affecting Liam's work (PTX-117, PTX-114).
              Sarah's onboarding wizard (PTX-115, 8 SP) is the largest in-flight item and may need pair support.
              Review queue has 3 items — recommend prioritising reviews before new work today.
            </p>
          </div>
        </div>

        {/* Team rows */}
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" style={{ color: "var(--foreground)" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${"var(--border)"}` }}>
                <th className="text-left py-2 px-2 text-[10px] font-semibold" style={{ color: "var(--muted-foreground)", width: 140 }}>Team Member</th>
                <th className="text-left py-2 px-2 text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>Yesterday</th>
                <th className="text-left py-2 px-2 text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>Today</th>
                <th className="text-left py-2 px-2 text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>Blockers</th>
                <th className="text-center py-2 px-2 text-[10px] font-semibold" style={{ color: "var(--muted-foreground)", width: 50 }}>Mood</th>
              </tr>
            </thead>
            <tbody>
              {([] as any[]).map(s => (
                <tr key={s.name} style={{ borderBottom: `1px solid ${"var(--border)"}22` }}>
                  <td className="py-2.5 px-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[9px] font-bold text-white">A</div>
                      <span className="font-medium">{s.name.split(" ")[0]}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-2">
                    {s.yesterday.map((y, i) => (
                      <div key={i} className="flex items-start gap-1 mb-0.5">
                        <span style={{ color: "#10B981" }}>✓</span>
                        <span style={{ color: "var(--muted-foreground)" }}>{y}</span>
                      </div>
                    ))}
                  </td>
                  <td className="py-2.5 px-2">
                    {s.today.map((t, i) => (
                      <div key={i} className="flex items-start gap-1 mb-0.5">
                        <span style={{ color: "var(--primary)" }}>→</span>
                        <span style={{ color: "var(--muted-foreground)" }}>{t}</span>
                      </div>
                    ))}
                  </td>
                  <td className="py-2.5 px-2">
                    {s.blockers.length === 0 ? (
                      <span style={{ color: "var(--muted-foreground)" }}>None</span>
                    ) : (
                      s.blockers.map((b, i) => (
                        <div key={i} className="flex items-start gap-1 mb-0.5">
                          <span style={{ color: "#EF4444" }}>●</span>
                          <span style={{ color: "#EF4444" }}>{b}</span>
                        </div>
                      ))
                    )}
                  </td>
                  <td className="py-2.5 px-2 text-center text-[18px]">{s.mood}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ═══ 6. SPRINT BACKLOG PROGRESS ═══ */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>Sprint Backlog</h3>
          <div className="flex gap-1">
            {(["all", "in_progress", "blocked", "done", "at_risk"] as const).map(f => (
              <button key={f} className="px-2.5 py-1 rounded-[6px] text-[10px] font-semibold capitalize transition-colors"
                onClick={() => setBacklogFilter(f)}
                style={{
                  background: backlogFilter === f ? `${"var(--primary)"}22` : "transparent",
                  color: backlogFilter === f ? "var(--primary)" : "var(--muted-foreground)",
                  border: `1px solid ${backlogFilter === f ? "var(--primary)" + "44" : "transparent"}`,
                }}>
                {f === "at_risk" ? "At Risk" : f === "in_progress" ? "In Progress" : f}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" style={{ color: "var(--foreground)" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${"var(--border)"}` }}>
                {["ID", "Title", "Type", "SP", "Status Pipeline", "Assignee", "Time in Status", "Cycle Time", ""].map(h => (
                  <th key={h} className="text-left py-2 px-2 text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredBacklog.map(item => (
                <tr key={item.id} className="hover:opacity-80 transition-opacity" style={{ borderBottom: `1px solid ${"var(--border)"}11` }}>
                  <td className="py-2 px-2 font-semibold" style={{ color: "var(--primary)" }}>{item.id}</td>
                  <td className="py-2 px-2 max-w-[240px] truncate font-medium">{item.title}</td>
                  <td className="py-2 px-2"><span className="text-[13px]">{ISSUE_ICONS[item.type]}</span></td>
                  <td className="py-2 px-2">
                    <span className="w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-bold"
                      style={{ background: `${"var(--primary)"}22`, color: "var(--primary)" }}>{item.sp}</span>
                  </td>
                  <td className="py-2 px-2">
                    <StatusPipeline current={item.status} />
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[9px] font-bold text-white">A</div>
                      <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{item.assignee.split(" ")[0]}</span>
                    </div>
                  </td>
                  <td className="py-2 px-2">
                    <span className="text-[11px] font-medium" style={{ color: item.timeInStatus === "—" ? "var(--muted-foreground)" : "var(--muted-foreground)" }}>{item.timeInStatus}</span>
                  </td>
                  <td className="py-2 px-2">
                    <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{item.cycleTime || "—"}</span>
                  </td>
                  <td className="py-2 px-2">
                    {item.blocked && <span className="text-[9px] px-1 py-0.5 rounded-[3px] font-bold" style={{ background: "rgba(239,68,68,0.12)", color: "#EF4444" }}>BLOCKED</span>}
                    {item.atRisk && !item.blocked && <span className="text-[9px] px-1 py-0.5 rounded-[3px] font-bold" style={{ background: "rgba(245,158,11,0.12)", color: "#F59E0B" }}>AT RISK</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ═══ 7. TEAM PERFORMANCE ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Workload bars */}
        <Card>
          <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>Team Workload</h3>
          <div className="space-y-3">
            {TEAM.map(m => {
              const total = m.done + m.inProgress + m.todo + m.blocked;
              const bar = (val: number, color: string) => ({ width: `${(val / m.capacity) * 100}%`, background: color });
              return (
                <div key={m.name}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[9px] font-bold text-white">A</div>
                      <span className="text-[12px] font-medium" style={{ color: "var(--foreground)" }}>{m.name.split(" ")[0]}</span>
                    </div>
                    <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{total}/{m.capacity} SP</span>
                  </div>
                  <div className="flex h-[8px] rounded-full overflow-hidden" style={{ background: `${"var(--border)"}22` }}>
                    <div className="h-full" style={bar(m.done, "#10B981")} />
                    <div className="h-full" style={bar(m.inProgress, "#6366F1")} />
                    <div className="h-full" style={bar(m.todo, "#64748B")} />
                    {m.blocked > 0 && <div className="h-full" style={bar(m.blocked, "#EF4444")} />}
                  </div>
                  {/* Individual sparkline */}
                  <div className="mt-1 h-[20px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={m.velocityHistory.map((v, i) => ({ s: i, v }))}>
                        <Line type="monotone" dataKey="v" stroke={"var(--primary)"} strokeWidth={1.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 mt-3 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm" style={{ background: "#10B981" }} /> Done</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm" style={{ background: "#6366F1" }} /> In Progress</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm" style={{ background: "#64748B" }} /> To Do</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm" style={{ background: "#EF4444" }} /> Blocked</span>
          </div>
        </Card>

        {/* Cycle Time + Velocity */}
        <div className="space-y-4">
          <Card>
            <h3 className="text-[14px] font-semibold mb-2" style={{ color: "var(--foreground)" }}>Avg Cycle Time by Status</h3>
            <div style={{ height: 130 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[] as any[]} layout="vertical" barSize={14}>
                  <XAxis type="number" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} unit="d" />
                  <YAxis type="category" dataKey="status" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={80} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: `1px solid ${"var(--border)"}`, borderRadius: 8, fontSize: 11, color: "var(--foreground)" }} />
                  <Bar dataKey="avg" radius={[0, 4, 4, 0]}>
                    {([] as any[]).map((_, i) => (
                      <Cell key={i} fill={["var(--muted-foreground)", "var(--primary)", "#F59E0B", "#10B981"][i]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <h3 className="text-[14px] font-semibold mb-2" style={{ color: "var(--foreground)" }}>Velocity Trend</h3>
            <div style={{ height: 130 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[] as any[]} barGap={2}>
                  <XAxis dataKey="sprint" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: `1px solid ${"var(--border)"}`, borderRadius: 8, fontSize: 11, color: "var(--foreground)" }} />
                  <Bar dataKey="committed" fill={`${"var(--primary)"}33`} radius={[3, 3, 0, 0]} name="Committed" />
                  <Bar dataKey="completed" fill={"var(--primary)"} radius={[3, 3, 0, 0]} name="Completed" />
                  <Bar dataKey="projected" fill={`${"var(--primary)"}66`} radius={[3, 3, 0, 0]} name="Projected" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>

      {/* ═══ 8. SPRINT RISKS & BLOCKERS + CONFIDENCE ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Blockers */}
        <Card className="lg:col-span-1">
          <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>Active Blockers</h3>
          <div className="space-y-3">
            {([] as any[]).map(b => (
              <div key={b.id} className="p-2.5 rounded-[8px]" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-bold" style={{ color: "#EF4444" }}>{b.id}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold" style={{ color: "#EF4444" }}>{b.duration}</span>
                    {b.escalated && <Badge variant="destructive">Escalated</Badge>}
                  </div>
                </div>
                <p className="text-[12px] font-medium" style={{ color: "var(--foreground)" }}>{b.title}</p>
                <p className="text-[10px] mt-1" style={{ color: "var(--muted-foreground)" }}>Owner: {b.owner}</p>
                <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>Impact: {b.impact}</p>
              </div>
            ))}
          </div>

          {/* Carry-over predictions */}
          <div className="mt-4">
            <h4 className="text-[12px] font-semibold mb-2" style={{ color: "var(--muted-foreground)" }}>Carry-over Risk</h4>
            <div className="space-y-1.5">
              {[
                { id: "PTX-109", title: "Plan comparison", risk: "High", sp: 5 },
                { id: "PTX-115", title: "Onboarding wizard", risk: "Medium", sp: 8 },
              ].map(c => (
                <div key={c.id} className="flex items-center justify-between text-[11px] py-1 px-2 rounded-[6px]"
                  style={{ background: true ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)" }}>
                  <span style={{ color: "var(--muted-foreground)" }}>{c.id} — {c.title}</span>
                  <Badge variant={c.risk === "High" ? "destructive" : "secondary"}>{c.risk}</Badge>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Confidence Score + Radar */}
        <Card>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>Sprint Confidence</h3>
            <span className="text-[22px] font-bold" style={{ color: "var(--primary)" }}>78%</span>
          </div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={[] as any[]} cx="50%" cy="50%" outerRadius="75%">
                <PolarGrid stroke={`${"var(--border)"}44`} />
                <PolarAngleAxis dataKey="axis" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <PolarRadiusAxis tick={{ fontSize: 8, fill: "var(--muted-foreground)" }} domain={[0, 100]} />
                <Radar dataKey="value" stroke={"var(--primary)"} fill={`${"var(--primary)"}33`} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1 mt-1">
            {CONFIDENCE_RADAR.map(r => (
              <div key={r.axis} className="flex items-center justify-between text-[10px]">
                <span style={{ color: "var(--muted-foreground)" }}>{r.axis}</span>
                <span className="font-semibold" style={{ color: r.value >= 80 ? "#10B981" : r.value >= 65 ? "#F59E0B" : "#EF4444" }}>{r.value}%</span>
              </div>
            ))}
          </div>
        </Card>

        {/* AI Recommended Actions */}
        <Card>
          <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>AI Recommendations</h3>
          <div className="space-y-2.5">
            <ActionCard icon="🚨" priority="high" title="Unblock PTX-117"
              description="Stripe webhook 500 error has blocked 2 items for 1+ day. Escalate to Stripe support or switch to mock mode for testing." />
            <ActionCard icon="👥" priority="medium" title="Pair on PTX-115"
              description="Onboarding wizard (8 SP) is 60% done with complex remaining subtasks. Pair Mia (under capacity) with Sarah to parallelize form steps 4-5." />
            <ActionCard icon="🔍" priority="medium" title="Clear Review Queue"
              description="3 items in review (11 SP). Prioritise morning reviews before new work — unblocking PRs accelerates velocity more than starting new items." />
            <ActionCard icon="📋" priority="low" title="Scope Discussion"
              description="Sprint scope increased +3.6% from 55→57 SP. If more additions are requested, recommend deferral to Sprint 8 to protect the goal." />
          </div>
        </Card>
      </div>

      {/* ═══ 9. SPRINT GOAL TRACKER ═══ */}
      <Card>
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>Sprint Goal</h3>
              <Badge variant={SPRINT_GOAL.prediction >= 80 ? "default" : SPRINT_GOAL.prediction >= 60 ? "secondary" : "destructive"}>
                {SPRINT_GOAL.prediction}% likely
              </Badge>
            </div>
            <p className="text-[13px] leading-relaxed mb-3 italic" style={{ color: "var(--muted-foreground)" }}>
              "{SPRINT_GOAL.text}"
            </p>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-[12px] font-medium" style={{ color: "var(--muted-foreground)" }}>
                Aligned Items: {SPRINT_GOAL.doneItems}/{SPRINT_GOAL.alignedItems} done
              </span>
              <span className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                ({Math.round((SPRINT_GOAL.doneItems / SPRINT_GOAL.alignedItems) * 100)}%)
              </span>
            </div>
            <Progress value={Math.round((SPRINT_GOAL.doneItems / SPRINT_GOAL.alignedItems) * 100)} className="h-1.5" />
          </div>
          <div className="flex-shrink-0">
            <ProgressRing pct={SPRINT_GOAL.prediction} size={90} stroke={7}
              color={SPRINT_GOAL.prediction >= 80 ? "#10B981" : SPRINT_GOAL.prediction >= 60 ? "#F59E0B" : "#EF4444"}
              bgColor={`${"var(--border)"}33`}>
              <span className="text-[18px] font-bold" style={{ color: "var(--foreground)" }}>{SPRINT_GOAL.prediction}%</span>
              <span className="text-[8px]" style={{ color: "var(--muted-foreground)" }}>predicted</span>
            </ProgressRing>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HELPER COMPONENTS
// ═══════════════════════════════════════════════════════════════════

/** Circular progress ring with children centred inside */
function ProgressRing({ pct, size, stroke, color, bgColor, children }: {
  pct: number; size: number; stroke: number; color: string; bgColor: string; children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={bgColor} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.6s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

/** Visual status pipeline dots */
function StatusPipeline({ current}: { current: ItemStatus;  }) {
  const steps: ItemStatus[] = ["todo", "in_progress", "in_review", "done"];
  const currentIdx = current === "blocked" ? 1 : steps.indexOf(current);

  return (
    <div className="flex items-center gap-1">
      {steps.map((s, i) => {
        const isActive = i <= currentIdx;
        const isCurrent = s === current || (current === "blocked" && s === "in_progress");
        const color = current === "blocked" && isCurrent ? "#EF4444" : STATUS_COLORS[s];
        return (
          <div key={s} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full transition-all" style={{
              background: isActive ? color : `${"var(--border)"}44`,
              boxShadow: isCurrent ? `0 0 6px ${color}88` : "none",
            }} />
            {i < steps.length - 1 && (
              <div className="w-3 h-[2px]" style={{ background: i < currentIdx ? color : `${"var(--border)"}33` }} />
            )}
          </div>
        );
      })}
      <span className="text-[9px] font-semibold ml-1" style={{ color: current === "blocked" ? "#EF4444" : STATUS_COLORS[current] }}>
        {STATUS_LABELS[current]}
      </span>
    </div>
  );
}

/** AI action card */
function ActionCard({ icon, priority, title, description, mode }: {
  icon: string; priority: "high" | "medium" | "low"; title: string; description: string;
}) {
  const colors = { high: "#EF4444", medium: "#F59E0B", low: "#6366F1" };
  const color = colors[priority];
  return (
    <div className="p-2.5 rounded-[8px]" style={{ background: `${color}${true ? "0A" : "06"}`, border: `1px solid ${color}22` }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[13px]">{icon}</span>
        <span className="text-[12px] font-semibold" style={{ color }}>{title}</span>
        <Badge variant={priority === "high" ? "destructive" : priority === "medium" ? "secondary" : "outline"}>{priority}</Badge>
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: `${color}BB` }}>{description}</p>
    </div>
  );
}
