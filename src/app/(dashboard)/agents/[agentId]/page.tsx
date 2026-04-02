"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Pause, RefreshCw, MessageSquare, Settings, TrendingUp,
  Activity, Brain, Sliders, ChevronRight,
} from "lucide-react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// ═══════════════════════════════════════════════════════════════════
// MOCK DATA — Agent Alpha, Project Atlas, PRINCE2, 78 days, L3, 92%
// ═══════════════════════════════════════════════════════════════════

const AGENT = {
  name: "Alpha", initials: "A",
  gradient: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "#6366F1",
  project: "Project Atlas", methodology: "PRINCE2" as const,
  status: "active" as const, autonomyLevel: 3, autonomyLabel: "Co-pilot",
  performanceScore: 92, deployedDate: "2026-01-15", uptimeDays: 78,
  currentTask: "Generating Risk Register v3 for Execution phase gate review — analysing 12 identified risks against tolerance thresholds and drafting mitigation strategies.",
};

const STATS = [
  { label: "Tasks Completed", value: "342", icon: "✅", color: "#6366F1" },
  { label: "Documents Generated", value: "89", icon: "📄", color: "#22D3EE" },
  { label: "Approvals Processed", value: "156", sub: "94% approval rate", icon: "✓", color: "#10B981" },
  { label: "Meetings Attended", value: "34", icon: "🎙️", color: "#F59E0B" },
  { label: "Risks Identified", value: "28", sub: "19 mitigated", icon: "⚠️", color: "#EF4444" },
  { label: "Credits Consumed", value: "12,450", icon: "⚡", color: "#8B5CF6" },
];

// Overview tab
const ACTIVE_QUEUE = [
  { id: "T-347", title: "Risk Register v3 — Execution gate", sp: 5, status: "in_progress", eta: "~2h" },
  { id: "T-348", title: "Weekly status report generation", sp: 2, status: "queued", eta: "~3h" },
  { id: "T-349", title: "Stakeholder update email draft", sp: 1, status: "queued", eta: "~4h" },
  { id: "T-350", title: "Budget EVM snapshot for April", sp: 3, status: "queued", eta: "~5h" },
];

const RECENT_ARTEFACTS = [
  { name: "Risk Register v2", type: "Document", status: "approved", date: "31 Mar" },
  { name: "Phase Gate Checklist — Execution", type: "Checklist", status: "approved", date: "29 Mar" },
  { name: "Change Request CR-008", type: "Document", status: "pending", date: "28 Mar" },
  { name: "Weekly Report W13", type: "Report", status: "approved", date: "27 Mar" },
  { name: "Stakeholder Comms Plan v2", type: "Plan", status: "approved", date: "25 Mar" },
];

const MODEL_USAGE = [
  { name: "Sonnet", value: 62, color: "#6366F1" },
  { name: "Haiku", value: 28, color: "#22D3EE" },
  { name: "Opus", value: 10, color: "#8B5CF6" },
];

// Activity tab
const ACTIVITY_EVENTS = [
  { date: "Today", items: [
    { time: "10:24", type: "Document", msg: "Started generating Risk Register v3" },
    { time: "09:45", type: "Meeting", msg: "Processed daily stand-up transcript — 3 actions extracted" },
    { time: "09:00", type: "System", msg: "Morning health check completed — all systems nominal" },
  ]},
  { date: "Yesterday", items: [
    { time: "17:30", type: "Report", msg: "Generated end-of-day summary for stakeholders" },
    { time: "15:12", type: "Risk", msg: "Identified new risk: vendor API deprecation in Q3" },
    { time: "14:00", type: "Approval", msg: "Submitted Phase Gate Checklist for review" },
    { time: "11:30", type: "Document", msg: "Completed Risk Register v2 final draft" },
    { time: "09:15", type: "Meeting", msg: "Attended project board meeting — 6 decisions logged" },
  ]},
  { date: "30 Mar", items: [
    { time: "16:45", type: "Approval", msg: "Budget reforecast approved by sponsor" },
    { time: "14:20", type: "Document", msg: "Generated change impact assessment for CR-008" },
    { time: "10:00", type: "System", msg: "Autonomy level reviewed — maintaining L3" },
  ]},
];

const HEATMAP_DATA: number[][] = Array.from({ length: 13 }, (_, i) =>
  Array.from({ length: 7 }, (_, j) => ((i * 3 + j * 7) % 5))
);

const HOURLY_DIST = Array.from({ length: 24 }, (_, h) => ({
  hour: `${h}:00`,
  actions: h >= 8 && h <= 18 ? 5 + ((h * 3) % 12) : h % 2,
}));

// Decisions tab
const DECISIONS = [
  { id: "D-089", desc: "Escalated vendor risk to executive sponsor", rationale: "Risk probability exceeded 70% threshold with £45K potential impact", confidence: 94, outcome: "Accepted" },
  { id: "D-088", desc: "Recommended 2-week schedule buffer for Phase 4", rationale: "Historical velocity data shows 85% chance of overrun without buffer", confidence: 88, outcome: "Approved" },
  { id: "D-087", desc: "Auto-approved minor scope change CR-009", rationale: "Within L3 autonomy bounds: <£5K, no schedule impact, aligned with project objectives", confidence: 96, outcome: "Implemented" },
  { id: "D-086", desc: "Deferred non-critical training to Phase 5", rationale: "Resource conflict with critical path task T-312; training has 3-week float", confidence: 91, outcome: "Approved" },
  { id: "D-085", desc: "Flagged budget variance for review", rationale: "CPI dropped below 0.95 threshold — PRINCE2 exception process triggered", confidence: 97, outcome: "Reviewed" },
];

const DECISION_QUALITY = [
  { week: "W8", score: 88 }, { week: "W9", score: 91 }, { week: "W10", score: 89 },
  { week: "W11", score: 93 }, { week: "W12", score: 95 }, { week: "W13", score: 96 },
];

const ESCALATION_HISTORY = [
  { date: "31 Mar", issue: "Vendor API deprecation risk", escalatedTo: "Sponsor", resolution: "Mitigation plan approved", daysToResolve: 1 },
  { date: "25 Mar", issue: "Budget CPI below 0.95", escalatedTo: "PMO", resolution: "Exception report filed", daysToResolve: 2 },
  { date: "18 Mar", issue: "Resource conflict — 2 critical path tasks", escalatedTo: "Programme Manager", resolution: "Additional resource allocated", daysToResolve: 3 },
];

// Performance tab
const PERF_RADAR = [
  { axis: "Speed", value: 88, fleet: 82 },
  { axis: "Quality", value: 95, fleet: 85 },
  { axis: "Risk Detection", value: 92, fleet: 78 },
  { axis: "Communication", value: 87, fleet: 80 },
  { axis: "Stakeholder", value: 90, fleet: 83 },
  { axis: "Budget", value: 85, fleet: 79 },
  { axis: "Schedule", value: 91, fleet: 81 },
  { axis: "HITL", value: 97, fleet: 92 },
];

const EFFICIENCY_TREND = Array.from({ length: 12 }, (_, i) => ({
  week: `W${i + 1}`,
  tasksPerDay: 3.2 + (i * 0.15) + ((i % 3) * 0.1),
  fleetAvg: 3.0 + (i * 0.08),
}));

const CREDIT_EFFICIENCY = Array.from({ length: 12 }, (_, i) => ({
  week: `W${i + 1}`,
  creditsPerTask: 42 - (i * 1.5) + ((i % 3) - 1),
  fleetAvg: 45 - (i * 0.8),
}));

// Config tab
const AUTONOMY_LEVELS = [
  { level: 1, name: "Assistant", desc: "Suggests actions, human executes everything" },
  { level: 2, name: "Advisor", desc: "Drafts artefacts, human reviews before any action" },
  { level: 3, name: "Co-pilot", desc: "Executes routine tasks, escalates decisions above threshold" },
  { level: 4, name: "Autonomous", desc: "Handles most decisions independently, human reviews exceptions" },
  { level: 5, name: "Strategic", desc: "Full autonomy within governance bounds, self-correcting" },
];

const NOTIFICATION_PREFS = [
  { label: "Phase gate approvals", enabled: true },
  { label: "Risk escalations", enabled: true },
  { label: "Budget threshold alerts", enabled: true },
  { label: "Daily summary reports", enabled: true },
  { label: "Document generation complete", enabled: false },
  { label: "Meeting transcript processed", enabled: false },
];

const INTEGRATIONS = [
  { name: "Jira", status: "connected", icon: "🔗" },
  { name: "Slack", status: "connected", icon: "💬" },
  { name: "MS Teams", status: "disconnected", icon: "📺" },
  { name: "Confluence", status: "connected", icon: "📝" },
  { name: "GitHub", status: "connected", icon: "🐙" },
];

// ═══════════════════════════════════════════════════════════════════
// HELPER COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function ConfidenceBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-[60px] overflow-hidden rounded-full bg-border/30">
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: pct >= 90 ? "#10B981" : pct >= 80 ? color : "#F59E0B",
          }}
        />
      </div>
      <span
        className="text-[10px] font-bold"
        style={{ color: pct >= 90 ? "#10B981" : color }}
      >
        {pct}%
      </span>
    </div>
  );
}

function LimitRow({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/10 py-1.5">
      <span className="text-xs text-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] font-bold text-primary">{value}</span>
        <span className="text-[10px] text-muted-foreground/60">{unit}</span>
      </div>
    </div>
  );
}

function ChatBubble({ from, text, agentColor }: { from: "agent" | "user"; text: string; agentColor: string }) {
  const isAgent = from === "agent";
  return (
    <div className={cn("flex", isAgent ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[85%] rounded-[10px] px-3 py-2 text-xs leading-relaxed",
          isAgent ? "rounded-bl-sm" : "rounded-br-sm"
        )}
        style={{
          background: isAgent ? agentColor + "12" : "var(--primary)",
          color: isAgent ? "var(--foreground)" : "#FFF",
        }}
      >
        {text}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function AgentProfilePage() {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [configAutonomy, setConfigAutonomy] = useState(AGENT.autonomyLevel);
  const [personality, setPersonality] = useState(40);
  const [notifs, setNotifs] = useState(NOTIFICATION_PREFS.map((n) => n.enabled));
  const [activityFilter, setActivityFilter] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      {/* ═══ BREADCRUMB ═══ */}
      <div className="flex items-center gap-1.5 text-xs">
        <Link href="/agents" className="cursor-pointer text-primary hover:underline">
          Agent Fleet
        </Link>
        <ChevronRight className="size-3 text-muted-foreground" />
        <span className="font-semibold text-foreground">{AGENT.name}</span>
      </div>

      {/* ═══ 1. AGENT HEADER BANNER ═══ */}
      <div
        className="overflow-hidden rounded-[14px] border"
        style={{ borderColor: AGENT.color + "33" }}
      >
        {/* Gradient banner */}
        <div className="relative h-20" style={{ background: AGENT.gradient }}>
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.4))" }}
          />
        </div>
        {/* Content */}
        <div className="relative z-10 -mt-8 bg-card px-6 pb-5">
          <div className="mb-4 flex items-end gap-4">
            {/* Avatar */}
            <div
              className="flex size-16 flex-shrink-0 items-center justify-center rounded-full text-2xl font-bold text-white ring-4 ring-card"
              style={{
                background: AGENT.gradient,
                boxShadow: `0 0 20px ${AGENT.color}44`,
              }}
            >
              {AGENT.initials}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex items-center gap-2">
                <h1 className="text-[22px] font-bold text-foreground">
                  Agent {AGENT.name}
                </h1>
                <span className="size-2.5 animate-pulse rounded-full bg-emerald-500" />
                <Badge variant="secondary" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
                  Active
                </Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{AGENT.project}</span>
                <Badge variant="secondary" className="border-blue-500/30 bg-blue-500/10 text-blue-600">
                  {AGENT.methodology}
                </Badge>
                <span>Deployed {AGENT.deployedDate}</span>
                <span>·</span>
                <span>{AGENT.uptimeDays} days uptime</span>
                <span>·</span>
                <span>Level {AGENT.autonomyLevel} — {AGENT.autonomyLabel}</span>
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <Button variant="ghost" size="sm">
                <Pause className="mr-1 size-3.5" /> Pause
              </Button>
              <Button variant="ghost" size="sm">
                <MessageSquare className="mr-1 size-3.5" /> Chat
              </Button>
              <Button variant="ghost" size="sm">
                <RefreshCw className="mr-1 size-3.5" /> Reassign
              </Button>
              <Button variant="default" size="sm">
                <Settings className="mr-1 size-3.5" /> Configure
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ 2. STATS ROW ═══ */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {STATS.map((s) => (
          <Card key={s.label} className="p-3">
            <div className="mb-1 flex items-start justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {s.label}
              </span>
              <span className="text-sm">{s.icon}</span>
            </div>
            <p className="text-[22px] font-bold" style={{ color: s.color }}>
              {s.value}
            </p>
            {s.sub && (
              <p className="mt-0.5 text-[10px] text-muted-foreground">{s.sub}</p>
            )}
          </Card>
        ))}
      </div>

      {/* ═══ 3. TABS ═══ */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList variant="line">
          <TabsTrigger value="overview" className="text-[13px] font-semibold">
            <Activity className="mr-1 size-3.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="activity" className="text-[13px] font-semibold">
            <TrendingUp className="mr-1 size-3.5" /> Activity
          </TabsTrigger>
          <TabsTrigger value="decisions" className="text-[13px] font-semibold">
            <Brain className="mr-1 size-3.5" /> Decisions
          </TabsTrigger>
          <TabsTrigger value="performance" className="text-[13px] font-semibold">
            <TrendingUp className="mr-1 size-3.5" /> Performance
          </TabsTrigger>
          <TabsTrigger value="configuration" className="text-[13px] font-semibold">
            <Sliders className="mr-1 size-3.5" /> Configuration
          </TabsTrigger>
        </TabsList>

        {/* ─── OVERVIEW ─── */}
        <TabsContent value="overview" className="space-y-4">
          {/* Current status */}
          <Card className="p-4">
            <div className="flex items-start gap-3">
              <div
                className="flex size-10 flex-shrink-0 items-center justify-center rounded-full text-base font-bold text-white"
                style={{
                  background: AGENT.gradient,
                  boxShadow: `0 0 12px ${AGENT.color}33`,
                }}
              >
                A
              </div>
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-foreground">
                    Currently Working On
                  </span>
                  <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
                </div>
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  {AGENT.currentTask}
                </p>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Task queue */}
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Active Task Queue</h3>
              <div className="space-y-2">
                {ACTIVE_QUEUE.map((t, i) => (
                  <div
                    key={t.id}
                    className={cn(
                      "flex items-center gap-2 rounded-lg p-2",
                      i === 0 ? "bg-primary/5" : "bg-muted/50"
                    )}
                  >
                    <span className="text-[10px] font-bold" style={{ color: AGENT.color }}>
                      {t.id}
                    </span>
                    <span className="flex-1 truncate text-xs text-foreground">{t.title}</span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                        t.status === "in_progress"
                          ? "bg-primary/15 text-primary"
                          : "bg-border/20 text-muted-foreground/60"
                      )}
                    >
                      {t.status === "in_progress" ? "Running" : "Queued"}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60">{t.eta}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Recent artefacts */}
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Recent Artefacts</h3>
              <div className="space-y-2">
                {RECENT_ARTEFACTS.map((a) => (
                  <div
                    key={a.name}
                    className="flex items-center gap-2 border-b border-border/10 py-1.5"
                  >
                    <span className="flex-1 truncate text-xs font-medium text-foreground">
                      {a.name}
                    </span>
                    <Badge
                      variant="secondary"
                      className={cn(
                        a.status === "approved"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-600"
                      )}
                    >
                      {a.status}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground/60">{a.date}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* AI Model usage pie */}
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold text-foreground">AI Model Usage</h3>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={MODEL_USAGE}
                      dataKey="value"
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={65}
                      paddingAngle={3}
                    >
                      {MODEL_USAGE.map((m) => (
                        <Cell key={m.name} fill={m.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 11,
                        color: "var(--foreground)",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center justify-center gap-4 text-[10px]">
                {MODEL_USAGE.map((m) => (
                  <span key={m.name} className="flex items-center gap-1 text-muted-foreground">
                    <span className="size-2.5 rounded-sm" style={{ background: m.color }} />
                    {m.name} {m.value}%
                  </span>
                ))}
              </div>
            </Card>
          </div>

          {/* Project progress */}
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Project Progress</h3>
            <div className="space-y-2">
              {[
                { phase: "Pre-Project", pct: 100 },
                { phase: "Initiation", pct: 100 },
                { phase: "Planning", pct: 100 },
                { phase: "Execution", pct: 45 },
                { phase: "Closing", pct: 0 },
              ].map((p) => (
                <div key={p.phase} className="flex items-center gap-3">
                  <span
                    className={cn(
                      "w-[100px] text-xs font-medium",
                      p.pct === 100
                        ? "text-emerald-500"
                        : p.pct > 0
                          ? "text-primary"
                          : "text-muted-foreground/60"
                    )}
                  >
                    {p.phase}
                  </span>
                  <div className="flex-1">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/30">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${p.pct}%` }}
                      />
                    </div>
                  </div>
                  <span className="w-10 text-right text-[11px] font-semibold text-muted-foreground">
                    {p.pct}%
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        {/* ─── ACTIVITY ─── */}
        <TabsContent value="activity" className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {["All", "Document", "Meeting", "Approval", "Risk", "Report", "System"].map((f) => (
              <button
                key={f}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-all",
                  activityFilter === f || (f === "All" && !activityFilter)
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-transparent text-muted-foreground/60 hover:text-muted-foreground"
                )}
                onClick={() => setActivityFilter(f === "All" ? null : f)}
              >
                {f}
              </button>
            ))}
            <Input
              className="ml-auto w-[180px] text-xs"
              placeholder="Search activity..."
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Timeline */}
            <div className="lg:col-span-2">
              <Card className="p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Activity Timeline</h3>
                {ACTIVITY_EVENTS.map((day) => {
                  const filtered = activityFilter
                    ? day.items.filter((i) => i.type === activityFilter)
                    : day.items;
                  if (filtered.length === 0) return null;
                  return (
                    <div key={day.date} className="mb-4">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/60">
                          {day.date}
                        </span>
                        <div className="h-px flex-1 bg-border/40" />
                      </div>
                      <div className="space-y-0">
                        {filtered.map((evt, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-3 border-b border-border/5 py-2"
                          >
                            <span className="w-[42px] flex-shrink-0 pt-0.5 font-mono text-[10px] text-muted-foreground/60">
                              {evt.time}
                            </span>
                            <div
                              className="mt-1.5 size-2 flex-shrink-0 rounded-full"
                              style={{ background: AGENT.color }}
                            />
                            <div className="flex-1">
                              <span
                                className="mr-2 rounded px-1.5 py-0.5 text-[9px] font-semibold"
                                style={{
                                  background: AGENT.color + "15",
                                  color: AGENT.color,
                                }}
                              >
                                {evt.type}
                              </span>
                              <span className="text-xs text-foreground">{evt.msg}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </Card>
            </div>

            {/* Heatmap + hourly */}
            <div className="space-y-4">
              <Card className="p-4">
                <h3 className="mb-2 text-[13px] font-semibold text-foreground">
                  Activity Heatmap (90 Days)
                </h3>
                <div
                  className="grid gap-[2px]"
                  style={{ gridTemplateColumns: "repeat(13, 1fr)" }}
                >
                  {HEATMAP_DATA.flat().map((v, i) => (
                    <div
                      key={i}
                      className="aspect-square rounded-[2px]"
                      style={{
                        background:
                          v === 0
                            ? "hsl(var(--border) / 0.15)"
                            : `${AGENT.color}${(20 + v * 18).toString(16)}`,
                      }}
                    />
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between text-[9px] text-muted-foreground/60">
                  <span>Less</span>
                  <div className="flex gap-[2px]">
                    {[0, 1, 2, 3, 4].map((v) => (
                      <div
                        key={v}
                        className="size-2.5 rounded-[2px]"
                        style={{
                          background:
                            v === 0
                              ? "hsl(var(--border) / 0.15)"
                              : `${AGENT.color}${(20 + v * 18).toString(16)}`,
                        }}
                      />
                    ))}
                  </div>
                  <span>More</span>
                </div>
              </Card>

              <Card className="p-4">
                <h3 className="mb-2 text-[13px] font-semibold text-foreground">
                  Hourly Distribution
                </h3>
                <div className="h-[120px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={HOURLY_DIST}>
                      <XAxis
                        dataKey="hour"
                        tick={{ fontSize: 8, fill: "var(--muted-foreground)" }}
                        interval={3}
                      />
                      <YAxis tick={{ fontSize: 8, fill: "var(--muted-foreground)" }} />
                      <Tooltip
                        contentStyle={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          fontSize: 11,
                          color: "var(--foreground)",
                        }}
                      />
                      <Bar dataKey="actions" fill={AGENT.color} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ─── DECISIONS ─── */}
        <TabsContent value="decisions" className="space-y-4">
          {/* AI autonomy recommendation */}
          <div
            className="flex items-center gap-3 rounded-xl p-4"
            style={{
              background: AGENT.color + "08",
              border: `1px solid ${AGENT.color}22`,
            }}
          >
            <div
              className="flex size-10 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{
                background: AGENT.gradient,
                boxShadow: `0 0 12px ${AGENT.color}33`,
              }}
            >
              AI
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-semibold" style={{ color: AGENT.color }}>
                Autonomy Recommendation
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Agent Alpha has a{" "}
                <strong className="text-emerald-500">96.2% decision accuracy</strong> over 156
                decisions. Current Level 3 (Co-pilot) — consider upgrading to{" "}
                <strong style={{ color: AGENT.color }}>Level 4 (Autonomous)</strong> for this
                project.
              </p>
            </div>
            <Button variant="default" size="sm">
              Upgrade to L4
            </Button>
          </div>

          {/* Decision log */}
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Decision Log</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-foreground">
                <thead>
                  <tr className="border-b border-border">
                    {["ID", "Decision", "Rationale", "Confidence", "Outcome"].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground/60"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DECISIONS.map((d) => (
                    <tr key={d.id} className="border-b border-border/10">
                      <td className="px-3 py-2.5 font-bold" style={{ color: AGENT.color }}>
                        {d.id}
                      </td>
                      <td className="max-w-[200px] px-3 py-2.5 font-medium">{d.desc}</td>
                      <td className="max-w-[250px] px-3 py-2.5 text-muted-foreground">
                        {d.rationale}
                      </td>
                      <td className="px-3 py-2.5">
                        <ConfidenceBar pct={d.confidence} color={AGENT.color} />
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant="secondary"
                          className={cn(
                            d.outcome === "Implemented"
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                              : d.outcome === "Approved"
                                ? "border-blue-500/30 bg-blue-500/10 text-blue-600"
                                : "border-border bg-muted text-muted-foreground"
                          )}
                        >
                          {d.outcome}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Quality trend */}
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold text-foreground">
                Decision Quality Trend
              </h3>
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={DECISION_QUALITY}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                    <XAxis
                      dataKey="week"
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    />
                    <YAxis
                      domain={[80, 100]}
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 11,
                        color: "var(--foreground)",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke={AGENT.color}
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: AGENT.color }}
                      name="Quality %"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Escalation history */}
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Escalation History</h3>
              <div className="space-y-2">
                {ESCALATION_HISTORY.map((e, i) => (
                  <div key={i} className="rounded-lg bg-muted/50 p-2.5">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-medium text-foreground">{e.issue}</span>
                      <span className="text-[10px] text-muted-foreground/60">{e.date}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span>→ {e.escalatedTo}</span>
                      <span>·</span>
                      <span>{e.resolution}</span>
                      <span
                        className={cn(
                          "ml-auto font-semibold",
                          e.daysToResolve <= 1 ? "text-emerald-500" : "text-amber-500"
                        )}
                      >
                        {e.daysToResolve}d
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* ─── PERFORMANCE ─── */}
        <TabsContent value="performance" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* 8-axis radar */}
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold text-foreground">Performance Radar</h3>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={PERF_RADAR} cx="50%" cy="50%" outerRadius="70%">
                    <PolarGrid stroke="var(--border)" opacity={0.4} />
                    <PolarAngleAxis
                      dataKey="axis"
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    />
                    <PolarRadiusAxis
                      tick={{ fontSize: 8, fill: "var(--muted-foreground)" }}
                      domain={[0, 100]}
                    />
                    <Radar
                      dataKey="fleet"
                      stroke="#64748B"
                      fill="#64748B22"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      name="Fleet Avg"
                    />
                    <Radar
                      dataKey="value"
                      stroke={AGENT.color}
                      fill={AGENT.color + "33"}
                      strokeWidth={2}
                      name="Alpha"
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 11,
                        color: "var(--foreground)",
                      }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground/60">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-3" style={{ background: AGENT.color }} />
                  Alpha
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-0.5 w-3 border-t border-dashed border-slate-500" />
                  Fleet Avg
                </span>
              </div>
            </Card>

            {/* Efficiency trend */}
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold text-foreground">
                Efficiency Trend (Tasks/Day)
              </h3>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={EFFICIENCY_TREND}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                    <XAxis
                      dataKey="week"
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    />
                    <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 11,
                        color: "var(--foreground)",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="fleetAvg"
                      stroke="#64748B"
                      strokeDasharray="4 4"
                      dot={false}
                      strokeWidth={1.5}
                      name="Fleet Avg"
                    />
                    <Line
                      type="monotone"
                      dataKey="tasksPerDay"
                      stroke={AGENT.color}
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: AGENT.color }}
                      name="Alpha"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <h3 className="mb-2 mt-4 text-sm font-semibold text-foreground">
                Credit Efficiency (Credits/Task)
              </h3>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={CREDIT_EFFICIENCY}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                    <XAxis
                      dataKey="week"
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    />
                    <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 11,
                        color: "var(--foreground)",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="fleetAvg"
                      stroke="#64748B"
                      fill="none"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                      name="Fleet Avg"
                    />
                    <Area
                      type="monotone"
                      dataKey="creditsPerTask"
                      stroke="#10B981"
                      fill="#10B98115"
                      strokeWidth={2}
                      name="Alpha"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 text-center text-[11px] text-emerald-500">
                ↓ Improving — 28% more efficient than Week 1
              </p>
            </Card>
          </div>
        </TabsContent>

        {/* ─── CONFIGURATION ─── */}
        <TabsContent value="configuration" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Autonomy slider */}
            <Card className="p-4">
              <h3 className="mb-4 text-sm font-semibold text-foreground">Autonomy Level</h3>
              <div className="space-y-3">
                {AUTONOMY_LEVELS.map((al) => {
                  const isSelected = configAutonomy === al.level;
                  return (
                    <button
                      key={al.level}
                      className={cn(
                        "w-full rounded-[10px] border-[1.5px] p-3 text-left transition-all",
                        isSelected
                          ? "border-primary/40 bg-primary/10"
                          : "border-border/30 bg-muted/50 hover:bg-muted"
                      )}
                      onClick={() => setConfigAutonomy(al.level)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((d) => (
                            <div
                              key={d}
                              className="size-2.5 rounded-full"
                              style={{
                                background: d <= al.level ? AGENT.color : "var(--border)",
                                opacity: d <= al.level ? 1 : 0.4,
                              }}
                            />
                          ))}
                        </div>
                        <span
                          className={cn(
                            "text-[13px] font-semibold",
                            isSelected ? "text-primary" : "text-foreground"
                          )}
                        >
                          Level {al.level} — {al.name}
                        </span>
                        {isSelected && (
                          <Badge
                            variant="secondary"
                            className="border-blue-500/30 bg-blue-500/10 text-blue-600"
                          >
                            Current
                          </Badge>
                        )}
                      </div>
                      <p className="ml-[34px] mt-1 text-[11px] text-muted-foreground">
                        {al.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
              <Button variant="default" className="mt-3 w-full">
                Save Autonomy Level
              </Button>
            </Card>

            {/* Notifications + Personality + Integrations */}
            <div className="space-y-4">
              {/* Notifications */}
              <Card className="p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">
                  Notification Preferences
                </h3>
                <div className="space-y-2">
                  {NOTIFICATION_PREFS.map((n, i) => (
                    <div key={n.label} className="flex items-center justify-between py-1.5">
                      <span className="text-xs text-foreground">{n.label}</span>
                      <button
                        className="relative h-5 w-9 rounded-full transition-all"
                        onClick={() => {
                          const copy = [...notifs];
                          copy[i] = !copy[i];
                          setNotifs(copy);
                        }}
                        style={{
                          background: notifs[i] ? AGENT.color : "var(--border)",
                          opacity: notifs[i] ? 1 : 0.6,
                        }}
                      >
                        <div
                          className="absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-all"
                          style={{ left: notifs[i] ? 18 : 2 }}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Personality slider */}
              <Card className="p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">
                  Communication Style
                </h3>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-medium text-muted-foreground">Formal</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={personality}
                    onChange={(e) => setPersonality(Number(e.target.value))}
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full"
                    style={{
                      background: `linear-gradient(to right, ${AGENT.color} ${personality}%, var(--border) ${personality}%)`,
                    }}
                  />
                  <span className="text-[11px] font-medium text-muted-foreground">Friendly</span>
                </div>
                <p className="mt-2 text-center text-[10px] text-muted-foreground/60">
                  {personality < 30
                    ? "Corporate, data-driven reports"
                    : personality < 70
                      ? "Balanced professional tone"
                      : "Conversational, uses plain language"}
                </p>
              </Card>

              {/* Integrations */}
              <Card className="p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Integrations</h3>
                <div className="space-y-2">
                  {INTEGRATIONS.map((int) => (
                    <div key={int.name} className="flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{int.icon}</span>
                        <span className="text-xs font-medium text-foreground">{int.name}</span>
                      </div>
                      <Badge
                        variant="secondary"
                        className={cn(
                          int.status === "connected"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                            : "border-border bg-muted text-muted-foreground"
                        )}
                      >
                        {int.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>

          {/* Credit limits + Reporting */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Credit Limits</h3>
              <div className="space-y-3">
                <LimitRow label="Daily limit" value="500" unit="credits/day" />
                <LimitRow label="Monthly limit" value="10,000" unit="credits/month" />
                <LimitRow label="Per-action cap" value="50" unit="credits" />
                <LimitRow label="Alert threshold" value="80%" unit="of daily limit" />
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Reporting Schedule</h3>
              <div className="space-y-2">
                {[
                  { report: "Daily status summary", schedule: "Every day at 17:00", enabled: true },
                  { report: "Weekly progress report", schedule: "Every Friday at 16:00", enabled: true },
                  { report: "Risk register update", schedule: "Every Monday at 09:00", enabled: true },
                  { report: "Budget EVM snapshot", schedule: "1st and 15th of month", enabled: false },
                ].map((r) => (
                  <div key={r.report} className="flex items-center justify-between py-1.5">
                    <div>
                      <span className="text-xs font-medium text-foreground">{r.report}</span>
                      <p className="text-[10px] text-muted-foreground/60">{r.schedule}</p>
                    </div>
                    <Badge
                      variant="secondary"
                      className={cn(
                        r.enabled
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                          : "border-border bg-muted text-muted-foreground"
                      )}
                    >
                      {r.enabled ? "Active" : "Off"}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Danger zone */}
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-destructive">Danger Zone</h3>
            <div className="flex flex-wrap gap-3">
              <div className="min-w-[200px] flex-1 rounded-[10px] border border-amber-500/20 bg-amber-500/5 p-3">
                <p className="mb-1 text-xs font-semibold text-amber-500">Pause Agent</p>
                <p className="mb-2 text-[11px] text-muted-foreground">
                  Temporarily stop all agent activity. Can be resumed.
                </p>
                <Button variant="outline" size="sm" className="border-amber-500/40 text-amber-500 hover:bg-amber-500/10">
                  <Pause className="mr-1 size-3" /> Pause Agent
                </Button>
              </div>
              <div className="min-w-[200px] flex-1 rounded-[10px] border border-primary/20 bg-primary/5 p-3">
                <p className="mb-1 text-xs font-semibold text-primary">Reassign Agent</p>
                <p className="mb-2 text-[11px] text-muted-foreground">
                  Move this agent to a different project. Preserves history.
                </p>
                <Button variant="default" size="sm">
                  <RefreshCw className="mr-1 size-3" /> Reassign
                </Button>
              </div>
              <div className="min-w-[200px] flex-1 rounded-[10px] border border-destructive/20 bg-destructive/5 p-3">
                <p className="mb-1 text-xs font-semibold text-destructive">Decommission Agent</p>
                <p className="mb-2 text-[11px] text-muted-foreground">
                  Permanently remove. All data archived. Cannot be undone.
                </p>
                <Button variant="destructive" size="sm">
                  Decommission
                </Button>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ═══ 4. FLOATING CHAT ═══ */}
      {/* Toggle button */}
      <button
        className="fixed bottom-6 right-6 z-40 flex size-14 items-center justify-center rounded-full text-xl text-white shadow-lg transition-all hover:scale-105"
        onClick={() => setChatOpen(!chatOpen)}
        style={{
          background: AGENT.gradient,
          boxShadow: `0 4px 20px ${AGENT.color}44`,
        }}
      >
        {chatOpen ? "×" : <MessageSquare className="size-5" />}
      </button>

      {/* Chat panel */}
      {chatOpen && (
        <div
          className="fixed bottom-24 right-6 z-40 w-[340px] overflow-hidden rounded-[14px] border border-border bg-card shadow-2xl"
        >
          {/* Chat header */}
          <div className="flex items-center gap-2 px-4 py-3" style={{ background: AGENT.gradient }}>
            <div className="flex size-7 items-center justify-center rounded-full bg-white/20 text-xs font-bold text-white">
              {AGENT.initials}
            </div>
            <div>
              <p className="text-xs font-semibold text-white">Chat with Agent {AGENT.name}</p>
              <p className="text-[9px] text-white/70">Online · Project Atlas</p>
            </div>
          </div>
          {/* Messages */}
          <div className="h-[220px] space-y-2.5 overflow-y-auto p-3">
            <ChatBubble
              from="agent"
              text="Good morning! I'm currently generating the Risk Register v3. Would you like a progress update?"
              agentColor={AGENT.color}
            />
            <ChatBubble
              from="user"
              text="Yes, how's it looking?"
              agentColor={AGENT.color}
            />
            <ChatBubble
              from="agent"
              text="12 risks identified — 2 rated red (vendor delay, resource conflict). I've drafted mitigation strategies for all. ETA for completion: ~2 hours. Shall I prioritise the red risks for your review?"
              agentColor={AGENT.color}
            />
          </div>
          {/* Input */}
          <div className="flex gap-2 px-3 pb-3">
            <Input
              className="flex-1 text-xs"
              placeholder="Message Alpha..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
            />
            <Button variant="default" size="sm">
              Send
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
