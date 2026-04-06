"use client";
// @ts-nocheck

import { usePageTitle } from "@/hooks/use-page-title";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAgents } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

/**
 * Agent Fleet — Fleet overview, activity timeline, performance comparison,
 * project-agent matrix, alerts & escalations.
 */


import {
  BarChart, Bar, AreaChart, Area, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

type AgentStatus = "active" | "paused" | "idle" | "error";
type Methodology = "Traditional" | "Scrum" | "Waterfall" | "Kanban" | "Hybrid";
type RAG = "green" | "amber" | "red";

interface Agent {
  id: string;
  name: string;
  initials: string;
  gradient: string;       // CSS gradient
  color: string;          // primary accent
  project: string;
  methodology: Methodology;
  status: AgentStatus;
  currentTask: string;
  autonomyLevel: number;  // 1-5
  autonomyLabel: string;
  performanceScore: number;
  creditsToday: number;
  creditSparkline: number[];
  phase: string;
  health: RAG;
  tasksWeek: number;
  pendingApprovals: number;
  totalCredits: number;
}

interface ActivityEvent {
  id: number;
  agentId: string;
  agentName: string;
  agentColor: string;
  agentInitials: string;
  type: string;
  message: string;
  project: string;
  time: string;
  minutesAgo: number;
}

interface Alert {
  id: number;
  agentId: string;
  agentName: string;
  agentInitials: string;
  agentColor: string;
  priority: "critical" | "high" | "medium";
  message: string;
  project: string;
  time: string;
  actions: string[];
}

// ═══════════════════════════════════════════════════════════════════
// MOCK DATA — 5 agents, 5 projects
// ═══════════════════════════════════════════════════════════════════

const AGENTS: Agent[] = [
  {
    id: "alpha", name: "Alpha", initials: "A",
    gradient: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "#6366F1",
    project: "Project Atlas", methodology: "Traditional", status: "active",
    currentTask: "Generating Risk Register v3 for Execution phase gate review",
    autonomyLevel: 4, autonomyLabel: "Autonomous",
    performanceScore: 92, creditsToday: 234,
    creditSparkline: [18, 22, 30, 28, 35, 40, 32, 29],
    phase: "Execution", health: "green", tasksWeek: 24, pendingApprovals: 2, totalCredits: 3420,
  },
  {
    id: "bravo", name: "Bravo", initials: "B",
    gradient: "linear-gradient(135deg, #22D3EE, #06B6D4)", color: "#22D3EE",
    project: "SprintForge", methodology: "Scrum", status: "active",
    currentTask: "Processing Sprint 7 retrospective notes and extracting action items",
    autonomyLevel: 3, autonomyLabel: "Co-pilot",
    performanceScore: 87, creditsToday: 189,
    creditSparkline: [15, 20, 18, 25, 22, 30, 24, 26],
    phase: "Sprint 7", health: "green", tasksWeek: 31, pendingApprovals: 1, totalCredits: 2890,
  },
  {
    id: "charlie", name: "Charlie", initials: "C",
    gradient: "linear-gradient(135deg, #10B981, #34D399)", color: "#10B981",
    project: "Riverside Development", methodology: "Waterfall", status: "active",
    currentTask: "Drafting Change Request CR-012 impact analysis document",
    autonomyLevel: 2, autonomyLabel: "Advisor",
    performanceScore: 78, creditsToday: 156,
    creditSparkline: [12, 15, 20, 18, 16, 22, 19, 20],
    phase: "Planning", health: "amber", tasksWeek: 18, pendingApprovals: 3, totalCredits: 2150,
  },
  {
    id: "delta", name: "Delta", initials: "D",
    gradient: "linear-gradient(135deg, #F97316, #FB923C)", color: "#F97316",
    project: "Cloud Migration", methodology: "Kanban", status: "paused",
    currentTask: "Paused — awaiting stakeholder feedback on migration sequence",
    autonomyLevel: 3, autonomyLabel: "Co-pilot",
    performanceScore: 71, creditsToday: 45,
    creditSparkline: [25, 30, 28, 22, 15, 8, 5, 6],
    phase: "Migration Wave 2", health: "amber", tasksWeek: 12, pendingApprovals: 0, totalCredits: 1780,
  },
  {
    id: "echo", name: "Echo", initials: "E",
    gradient: "linear-gradient(135deg, #EC4899, #F472B6)", color: "#EC4899",
    project: "Brand Refresh", methodology: "Hybrid", status: "active",
    currentTask: "Compiling design asset handoff checklist for development team",
    autonomyLevel: 5, autonomyLabel: "Strategic",
    performanceScore: 95, creditsToday: 223,
    creditSparkline: [20, 25, 28, 32, 30, 35, 28, 30],
    phase: "Execution", health: "green", tasksWeek: 28, pendingApprovals: 1, totalCredits: 3100,
  },
];

const ACTIVITY_EVENTS: ActivityEvent[] = [
  { id: 1, agentId: "alpha", agentName: "Alpha", agentColor: "#6366F1", agentInitials: "A", type: "Document", message: "Generated Risk Register v3", project: "Atlas", time: "2 min ago", minutesAgo: 2 },
  { id: 2, agentId: "echo", agentName: "Echo", agentColor: "#EC4899", agentInitials: "E", type: "Meeting", message: "Attended design review standup and extracted 4 action items", project: "Brand Refresh", time: "8 min ago", minutesAgo: 8 },
  { id: 3, agentId: "bravo", agentName: "Bravo", agentColor: "#22D3EE", agentInitials: "B", type: "Approval", message: "Requested approval for Sprint 7 scope change (+2 SP)", project: "SprintForge", time: "15 min ago", minutesAgo: 15 },
  { id: 4, agentId: "charlie", agentName: "Charlie", agentColor: "#10B981", agentInitials: "C", type: "Risk", message: "Identified new risk: supplier delivery delay for Phase 3 materials", project: "Riverside", time: "28 min ago", minutesAgo: 28 },
  { id: 5, agentId: "alpha", agentName: "Alpha", agentColor: "#6366F1", agentInitials: "A", type: "Phase Gate", message: "Passed Execution phase gate — all 7 prerequisites verified", project: "Atlas", time: "45 min ago", minutesAgo: 45 },
  { id: 6, agentId: "echo", agentName: "Echo", agentColor: "#EC4899", agentInitials: "E", type: "Document", message: "Created design asset handoff checklist (38 items)", project: "Brand Refresh", time: "1h ago", minutesAgo: 60 },
  { id: 7, agentId: "bravo", agentName: "Bravo", agentColor: "#22D3EE", agentInitials: "B", type: "Document", message: "Generated Sprint 7 burndown report with velocity analysis", project: "SprintForge", time: "1.5h ago", minutesAgo: 90 },
  { id: 8, agentId: "delta", agentName: "Delta", agentColor: "#F97316", agentInitials: "D", type: "Approval", message: "Submitted migration sequence proposal for stakeholder review", project: "Cloud Migration", time: "2h ago", minutesAgo: 120 },
  { id: 9, agentId: "charlie", agentName: "Charlie", agentColor: "#10B981", agentInitials: "C", type: "Document", message: "Drafted Change Request CR-012 for additional site survey", project: "Riverside", time: "3h ago", minutesAgo: 180 },
  { id: 10, agentId: "alpha", agentName: "Alpha", agentColor: "#6366F1", agentInitials: "A", type: "Meeting", message: "Processed project board meeting transcript — 6 decisions logged", project: "Atlas", time: "4h ago", minutesAgo: 240 },
  { id: 11, agentId: "echo", agentName: "Echo", agentColor: "#EC4899", agentInitials: "E", type: "Risk", message: "Flagged brand guideline inconsistency across 3 deliverables", project: "Brand Refresh", time: "5h ago", minutesAgo: 300 },
  { id: 12, agentId: "bravo", agentName: "Bravo", agentColor: "#22D3EE", agentInitials: "B", type: "Phase Gate", message: "Sprint 6 retrospective complete — 5 improvement actions logged", project: "SprintForge", time: "6h ago", minutesAgo: 360 },
];

const COMPARISON_DATA = [
  { metric: "Tasks", Alpha: 24, Bravo: 31, Charlie: 18, Delta: 12, Echo: 28 },
  { metric: "Docs", Alpha: 8, Bravo: 6, Charlie: 5, Delta: 3, Echo: 9 },
  { metric: "Approvals", Alpha: 4, Bravo: 3, Charlie: 5, Delta: 2, Echo: 3 },
  { metric: "Meetings", Alpha: 3, Bravo: 5, Charlie: 2, Delta: 1, Echo: 4 },
  { metric: "Risks", Alpha: 6, Bravo: 4, Charlie: 7, Delta: 3, Echo: 5 },
];

// Deterministic pseudo-random using sin seed (no Math.random — prevents hydration mismatch)
const _s = (seed: number) => Math.abs(Math.round((Math.sin(seed) + 1) * 50));
const CREDIT_30D = Array.from({ length: 30 }, (_, i) => ({
  day: `D${i + 1}`,
  Alpha: 60 + _s(i * 7 + 1) % 40,
  Bravo: 50 + _s(i * 11 + 2) % 35,
  Charlie: 40 + _s(i * 13 + 3) % 30,
  Delta: i > 20 ? 10 + _s(i * 17 + 4) % 15 : 45 + _s(i * 17 + 4) % 25,
  Echo: 55 + _s(i * 19 + 5) % 35,
}));

const FLEET_RADAR = [
  { axis: "Productivity", value: 85 },
  { axis: "Quality", value: 90 },
  { axis: "Speed", value: 78 },
  { axis: "Autonomy", value: 82 },
  { axis: "HITL Compliance", value: 95 },
  { axis: "Satisfaction", value: 88 },
];

const ALERTS: Alert[] = [
  { id: 1, agentId: "charlie", agentName: "Charlie", agentInitials: "C", agentColor: "#10B981", priority: "critical", message: "Change Request CR-012 requires budget approval before proceeding — exceeds £15K threshold", project: "Riverside Development", time: "12 min ago", actions: ["Approve", "Reject", "Defer"] },
  { id: 2, agentId: "bravo", agentName: "Bravo", agentInitials: "B", agentColor: "#22D3EE", priority: "high", message: "Sprint 7 scope change adds 2 SP to committed work — velocity at risk of missing target", project: "SprintForge", time: "15 min ago", actions: ["Approve", "Reject"] },
  { id: 3, agentId: "alpha", agentName: "Alpha", agentInitials: "A", agentColor: "#6366F1", priority: "high", message: "Risk Register v3 contains 2 red-rated risks requiring executive sponsor review", project: "Project Atlas", time: "35 min ago", actions: ["Review", "Acknowledge"] },
  { id: 4, agentId: "delta", agentName: "Delta", agentInitials: "D", agentColor: "#F97316", priority: "medium", message: "Agent paused for 4 hours awaiting migration sequence approval — SLA approaching", project: "Cloud Migration", time: "2h ago", actions: ["Resume", "Reassign"] },
  { id: 5, agentId: "echo", agentName: "Echo", agentInitials: "E", agentColor: "#EC4899", priority: "medium", message: "3 brand deliverables have inconsistent colour values — auto-fix available", project: "Brand Refresh", time: "5h ago", actions: ["Auto-fix", "Review Manually"] },
];

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

const STATUS_CONFIG: Record<AgentStatus, { label: string; color: string; pulseColor: string; badgeCn: string }> = {
  active: { label: "Active", color: "#10B981", pulseColor: "green", badgeCn: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" },
  paused: { label: "Paused", color: "#F59E0B", pulseColor: "amber", badgeCn: "border-amber-500/30 bg-amber-500/10 text-amber-600" },
  idle: { label: "Idle", color: "#64748B", pulseColor: "blue", badgeCn: "" },
  error: { label: "Error", color: "#EF4444", pulseColor: "red", badgeCn: "border-red-500/30 bg-red-500/10 text-red-600" },
};

const METHODOLOGY_CN: Record<Methodology, string> = {
  "Traditional": "border-blue-500/30 bg-blue-500/10 text-blue-600",
  "Scrum": "border-purple-500/30 bg-purple-500/10 text-purple-600",
  "Waterfall": "border-slate-500/30 bg-slate-500/10 text-slate-600",
  "Kanban": "border-amber-500/30 bg-amber-500/10 text-amber-600",
  "Hybrid": "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
};

const EVENT_ICONS: Record<string, string> = {
  "Document": "📄", "Approval": "✅", "Meeting": "🎙️", "Risk": "⚠️", "Phase Gate": "🚩",
};

const AUTONOMY_LABELS = ["", "Assistant", "Advisor", "Co-pilot", "Autonomous", "Strategic"];

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function AgentFleetPage() {
  const mode = "dark";
  usePageTitle("Agent Fleet");
  const [activityFilter, setActivityFilter] = useState<string | null>(null);
  const [showDeployModal, setShowDeployModal] = useState(false);

  // Real API data — falls back to mock AGENTS when no agents deployed yet
  const { data: apiData, isLoading } = useAgents();

  // Map API agents to the Agent shape used by the UI, or fall back to mocks
  const agents: Agent[] = useMemo(() => {
    const raw = apiData?.agents;
    if (!raw || raw.length === 0) return [];
    return raw.map((a: any, i: number) => {
      const fallbackColors = ["#6366F1", "#22D3EE", "#10B981", "#F97316", "#EC4899"];
      const fallbackGradients = [
        "linear-gradient(135deg, #6366F1, #8B5CF6)", "linear-gradient(135deg, #22D3EE, #06B6D4)",
        "linear-gradient(135deg, #10B981, #34D399)", "linear-gradient(135deg, #F97316, #FB923C)",
        "linear-gradient(135deg, #EC4899, #F472B6)",
      ];
      const color = fallbackColors[i % 5];
      const project = a.project || a.deployments?.[0]?.project;
      return {
        id: a.id, name: a.name, initials: (a.name || "?")[0].toUpperCase(),
        gradient: a.gradient || fallbackGradients[i % 5], color,
        project: project?.name || "Unassigned",
        methodology: (project?.methodology || "Hybrid") as Methodology,
        status: (a.status?.toLowerCase() || "idle") as AgentStatus,
        currentTask: a.currentTask || "Awaiting instructions",
        autonomyLevel: a.autonomyLevel || 2, autonomyLabel: ["", "Assistant", "Advisor", "Co-pilot", "Autonomous", "Strategic"][a.autonomyLevel || 2],
        performanceScore: a.performanceScore || 0, creditsToday: a.creditsUsed || 0,
        creditSparkline: [0, 0, 0, 0, 0, 0, 0, 0],
        phase: a.currentPhase || "—", health: "green" as RAG,
        tasksWeek: a._count?.activities || 0, pendingApprovals: 0, totalCredits: a.creditsUsed || 0,
      };
    });
  }, [apiData]);

  const activities: ActivityEvent[] = useMemo(() => {
    const raw = apiData?.activities;
    if (!raw || raw.length === 0) return [];
    return raw.map((a: any, i: number) => ({
      id: i + 1, agentId: a.agentId || "", agentName: a.agentName || "Agent",
      agentColor: a.agentGradient || "#6366F1", agentInitials: (a.agentName || "?")[0].toUpperCase(),
      type: a.type || "System", message: a.summary || "", project: "",
      time: new Date(a.createdAt).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      minutesAgo: Math.round((Date.now() - new Date(a.createdAt).getTime()) / 60000),
    }));
  }, [apiData]);

  const alerts: Alert[] = useMemo(() => {
    const raw = apiData?.alerts;
    if (!raw || raw.length === 0) return [];
    return raw.map((a: any, i: number) => ({
      id: i + 1, agentId: "", agentName: "System", agentInitials: "!", agentColor: "#EF4444",
      priority: (a.type === "BUDGET" || a.type === "RISK" ? "critical" : "high") as Alert["priority"],
      message: a.description || a.title, project: a.project || "",
      time: new Date(a.createdAt).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      actions: ["Review", "Acknowledge"],
    }));
  }, [apiData]);

  const filteredEvents = useMemo(() => {
    if (!activityFilter) return activities;
    return activities.filter(e => e.agentId === activityFilter);
  }, [activityFilter, activities]);

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><div className="grid grid-cols-3 gap-4">{[1,2,3].map(i => <Skeleton key={i} className="h-64 rounded-xl" />)}</div></div>;

  const totalCreditsToday = agents.reduce((s, a) => s + a.creditsToday, 0);
  const activeCount = agents.filter(a => a.status === "active").length;
  const pausedCount = agents.filter(a => a.status === "paused").length;

  return (
    <div className="space-y-6 max-w-[1600px]">
      {/* ═══ 1. HEADER ═══ */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[24px] font-bold" style={{ color: "var(--foreground)" }}>Agent Fleet</h1>
          <p className="text-[13px] mt-1 flex items-center gap-2 flex-wrap" style={{ color: "var(--muted-foreground)" }}>
            <span className="font-semibold" style={{ color: "var(--foreground)" }}>{agents.length} Agents Deployed</span>
            <Dot />
            <span>{activeCount} Active</span>
            <Dot />
            <span>{pausedCount} Paused</span>
            <Dot />
            <span className="font-semibold" style={{ color: "var(--primary)" }}>{totalCreditsToday} credits today</span>
          </p>
        </div>
        <Link href="/agents/deploy"><Button variant="default" size="sm"><span className="mr-1">🚀</span> Deploy New Agent</Button></Link>
      </div>

      {/* ═══ 2. FLEET OVERVIEW CARDS ═══ */}
      {agents.length === 0 ? (
        <Card className="px-5">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl mb-4" style={{ background: "var(--primary)", opacity: 0.1 }}>🤖</div>
            <h3 className="text-[16px] font-semibold mb-1" style={{ color: "var(--foreground)" }}>No agents deployed yet</h3>
            <p className="text-[13px] max-w-md mb-4" style={{ color: "var(--muted-foreground)" }}>Deploy your first AI project agent to start managing projects autonomously. Each agent connects to a project and handles tasks, risks, reports, and stakeholder communications.</p>
            <Link href="/agents/deploy"><Button variant="default" size="sm"><span className="mr-1">🚀</span> Deploy Your First Agent</Button></Link>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
          {agents.map(agent => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}

      {agents.length > 0 && (<>
      {/* ═══ 3. FLEET ACTIVITY TIMELINE ═══ */}
      <Card className="px-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>Fleet Activity Timeline</h3>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>Last 24 hours</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Agent filter pills */}
            <button className={`px-2 py-1 rounded-[6px] text-[10px] font-semibold transition-all`}
              onClick={() => setActivityFilter(null)}
              style={{
                background: !activityFilter ? `${"var(--primary)"}22` : "transparent",
                color: !activityFilter ? "var(--primary)" : "var(--muted-foreground)",
                border: `1px solid ${!activityFilter ? "var(--primary)" + "44" : "transparent"}`,
              }}>All</button>
            {agents.map(a => (
              <button key={a.id} className="flex items-center gap-1 px-2 py-1 rounded-[6px] text-[10px] font-semibold transition-all"
                onClick={() => setActivityFilter(activityFilter === a.id ? null : a.id)}
                style={{
                  background: activityFilter === a.id ? `${a.color}22` : "transparent",
                  color: activityFilter === a.id ? a.color : "var(--muted-foreground)",
                  border: `1px solid ${activityFilter === a.id ? a.color + "44" : "transparent"}`,
                }}>
                <span className="w-2 h-2 rounded-full" style={{ background: a.color }} />
                {a.name}
              </button>
            ))}
          </div>
        </div>

        {/* "Now" marker */}
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#10B981" }}>Now</span>
          <div className="flex-1 h-px" style={{ background: `${"#10B981"}33` }} />
        </div>

        {/* Events */}
        <div className="space-y-0">
          {filteredEvents.map((evt, i) => (
            <div key={evt.id} className="flex items-start gap-3 py-2.5" style={{ borderBottom: i < filteredEvents.length - 1 ? `1px solid ${"var(--border)"}11` : "none" }}>
              {/* Timeline line + dot */}
              <div className="flex flex-col items-center flex-shrink-0" style={{ width: 20 }}>
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: evt.agentColor, boxShadow: `0 0 6px ${evt.agentColor}44` }} />
                {i < filteredEvents.length - 1 && <div className="w-px flex-1 mt-1" style={{ background: `${"var(--border)"}33`, minHeight: 20 }} />}
              </div>
              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  
                  <span className="text-[12px] font-semibold" style={{ color: evt.agentColor }}>{evt.agentName}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-[3px] font-semibold"
                    style={{ background: `${evt.agentColor}15`, color: evt.agentColor }}>
                    {EVENT_ICONS[evt.type] || "📋"} {evt.type}
                  </span>
                  <span className="text-[10px] ml-auto flex-shrink-0" style={{ color: "var(--muted-foreground)" }}>{evt.time}</span>
                </div>
                <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>{evt.message}</p>
                <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{evt.project}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ═══ 4. FLEET PERFORMANCE (2-column) ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Comparison + Credit area */}
        <div className="space-y-4">
          <Card className="px-5">
            <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>Agent Comparison (This Week)</h3>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={COMPARISON_DATA} barGap={1} barSize={10}>
                  <CartesianGrid strokeDasharray="3 3" stroke={`${"var(--border)"}33`} />
                  <XAxis dataKey="metric" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: `1px solid ${"var(--border)"}`, borderRadius: 8, fontSize: 11, color: "var(--foreground)" }} />
                  <Bar dataKey="Alpha" fill="#6366F1" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Bravo" fill="#22D3EE" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Charlie" fill="#10B981" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Delta" fill="#F97316" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="Echo" fill="#EC4899" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              {agents.map(a => (
                <span key={a.id} className="flex items-center gap-1 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: a.color }} />{a.name}
                </span>
              ))}
            </div>
          </Card>

          <Card className="px-5">
            <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>Credit Consumption (30 Days)</h3>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={CREDIT_30D}>
                  <CartesianGrid strokeDasharray="3 3" stroke={`${"var(--border)"}22`} />
                  <XAxis dataKey="day" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} interval={4} />
                  <YAxis tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: `1px solid ${"var(--border)"}`, borderRadius: 8, fontSize: 11, color: "var(--foreground)" }} />
                  <Area type="monotone" dataKey="Alpha" stackId="1" stroke="#6366F1" fill="#6366F133" />
                  <Area type="monotone" dataKey="Bravo" stackId="1" stroke="#22D3EE" fill="#22D3EE33" />
                  <Area type="monotone" dataKey="Charlie" stackId="1" stroke="#10B981" fill="#10B98133" />
                  <Area type="monotone" dataKey="Delta" stackId="1" stroke="#F97316" fill="#F9731633" />
                  <Area type="monotone" dataKey="Echo" stackId="1" stroke="#EC4899" fill="#EC489933" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* Right: Fleet radar + utilisation */}
        <div className="space-y-4">
          <Card className="px-5">
            <h3 className="text-[14px] font-semibold mb-2" style={{ color: "var(--foreground)" }}>Fleet Health</h3>
            <div style={{ height: 230 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={FLEET_RADAR} cx="50%" cy="50%" outerRadius="72%">
                  <PolarGrid stroke={`${"var(--border)"}44`} />
                  <PolarAngleAxis dataKey="axis" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                  <PolarRadiusAxis tick={{ fontSize: 8, fill: "var(--muted-foreground)" }} domain={[0, 100]} />
                  <Radar dataKey="value" stroke={"var(--primary)"} fill={`${"var(--primary)"}33`} strokeWidth={2} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-[10px] mt-2" style={{ color: "var(--muted-foreground)" }}>
              {FLEET_RADAR.map(r => (
                <span key={r.axis} className="flex items-center gap-1">
                  <span className="font-semibold" style={{ color: r.value >= 85 ? "#10B981" : r.value >= 75 ? "#F59E0B" : "#EF4444" }}>{r.value}%</span>
                  <span className="truncate">{r.axis}</span>
                </span>
              ))}
            </div>
          </Card>

          <Card className="px-5">
            <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>Agent Utilisation</h3>
            <div className="space-y-3">
              {agents.map(agent => {
                const totalAssigned = agent.tasksWeek;
                const maxTasks = 35; // normalise against highest performer
                const pct = Math.round((totalAssigned / maxTasks) * 100);
                return (
                  <div key={agent.id}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: agent.color }} />
                        <span className="text-[12px] font-medium" style={{ color: "var(--foreground)" }}>{agent.name}</span>
                        <Badge variant="secondary" className={STATUS_CONFIG[agent.status].badgeCn}>{agent.status}</Badge>
                      </div>
                      <span className="text-[11px] font-semibold" style={{ color: agent.color }}>{agent.tasksWeek} tasks/wk</span>
                    </div>
                    <div className="w-full h-[8px] rounded-full overflow-hidden" style={{ background: `${"var(--border)"}22` }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: agent.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      {/* ═══ 5. PROJECT-AGENT MATRIX ═══ */}
      <Card className="px-5">
        <h3 className="text-[14px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>Project-Agent Matrix</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" style={{ color: "var(--foreground)" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${"var(--border)"}` }}>
                {["Project", "Agent", "Methodology", "Phase", "Health", "Autonomy", "Tasks/Wk", "Pending", "Credits", "Actions"].map(h => (
                  <th key={h} className="text-left py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.map(agent => (
                <tr key={agent.id} className="hover:opacity-80 transition-opacity" style={{ borderBottom: `1px solid ${"var(--border)"}11` }}>
                  <td className="py-2.5 px-3 font-semibold">{agent.project}</td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: agent.gradient }}>
                        {agent.initials}
                      </div>
                      <span className="font-medium">{agent.name}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3"><Badge variant="secondary" className={METHODOLOGY_CN[agent.methodology]}>{agent.methodology}</Badge></td>
                  <td className="py-2.5 px-3" style={{ color: "var(--muted-foreground)" }}>{agent.phase}</td>
                  <td className="py-2.5 px-3">
                    <RAGDot rag={agent.health} />
                  </td>
                  <td className="py-2.5 px-3">
                    <AutonomyDots level={agent.autonomyLevel} color={agent.color} />
                  </td>
                  <td className="py-2.5 px-3 font-semibold">{agent.tasksWeek}</td>
                  <td className="py-2.5 px-3">
                    {agent.pendingApprovals > 0 ? (
                      <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-[4px]" style={{ background: "rgba(245,158,11,0.12)", color: "#F59E0B" }}>
                        {agent.pendingApprovals}
                      </span>
                    ) : (
                      <span style={{ color: "var(--muted-foreground)" }}>0</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    <span style={{ color: "var(--muted-foreground)" }}>{agent.totalCredits.toLocaleString()}</span>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-1">
                      <ActionBtn icon={agent.status === "paused" ? "▶" : "⏸"} tooltip={agent.status === "paused" ? "Resume" : "Pause"} />
                      <ActionBtn icon="💬" tooltip="Chat" />
                      <ActionBtn icon="📡" tooltip="Live Console" />
                      <ActionBtn icon="⚙" tooltip="Settings" />
                    </div>
                  </td>
                </tr>
              ))}
              {/* Deploy row */}
              <tr>
                <td colSpan={10} className="py-3 px-3">
                  <Link href="/agents/deploy" className="flex items-center gap-2 text-[12px] font-semibold w-full justify-center py-2 rounded-[8px] transition-all hover:opacity-80"
                    style={{ color: "var(--primary)", background: `${"var(--primary)"}08`, border: `1px dashed ${"var(--primary)"}44` }}>
                    <span>+</span> Deploy agent to new project
                  </Link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* ═══ 6. ALERTS & ESCALATIONS ═══ */}
      <Card className="px-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>Alerts & Escalations</h3>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.12)", color: "#EF4444" }}>
              {alerts.length}
            </span>
          </div>
          <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Priority-sorted · Requires human attention</span>
        </div>
        <div className="space-y-2.5">
          {alerts.map(alert => {
            const priorityColor = alert.priority === "critical" ? "#EF4444" : alert.priority === "high" ? "#F97316" : "#F59E0B";
            return (
              <div key={alert.id} className="flex items-start gap-3 p-3 rounded-[10px] transition-all"
                style={{ background: `${priorityColor}06`, border: `1px solid ${priorityColor}18` }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                  style={{ background: alert.agentColor }}>
                  {alert.agentInitials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[12px] font-semibold" style={{ color: alert.agentColor }}>{alert.agentName}</span>
                    <Badge variant="secondary" className={
                      alert.priority === "critical" ? "border-red-500/30 bg-red-500/10 text-red-600" :
                      alert.priority === "high" ? "border-orange-500/30 bg-orange-500/10 text-orange-600" :
                      "border-amber-500/30 bg-amber-500/10 text-amber-600"
                    }>
                      {alert.priority}
                    </Badge>
                    <span className="text-[10px] ml-auto" style={{ color: "var(--muted-foreground)" }}>{alert.time}</span>
                  </div>
                  <p className="text-[12px] leading-relaxed mb-1.5" style={{ color: "var(--foreground)" }}>{alert.message}</p>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{alert.project}</span>
                    <div className="flex items-center gap-1.5 ml-auto">
                      {alert.actions.map(action => (
                        <Button key={action} variant={action === "Approve" || action === "Auto-fix" || action === "Resume" ? "default" : "ghost"} size="sm">
                          {action}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      </>)}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// AGENT CARD (section 2)
// ═══════════════════════════════════════════════════════════════════

function AgentCard({ agent,  }: { agent: Agent }) {
  const statusCfg = STATUS_CONFIG[agent.status];
  const isActive = agent.status === "active";

  return (
    <div className="rounded-[14px] p-4 transition-all duration-200 hover:translate-y-[-2px]"
      style={{
        background: "var(--card)",
        border: isActive ? `1.5px solid ${agent.color}44` : `1px solid ${"var(--border)"}`,
        boxShadow: isActive ? `0 4px 20px ${agent.color}18, ${"0 4px 6px rgba(0,0,0,0.07)"}` : "0 4px 6px rgba(0,0,0,0.07)",
      }}>
      {/* Top: Avatar + Name + Status */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-[16px] font-bold text-white"
            style={{ background: agent.gradient, boxShadow: isActive ? `0 0 16px ${agent.color}44` : "none" }}>
            {agent.initials}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold" style={{ color: "var(--foreground)" }}>{agent.name}</span>
              {isActive && <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />}
            </div>
            <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{agent.project}</span>
          </div>
        </div>
        <Badge variant="secondary" className={METHODOLOGY_CN[agent.methodology]}>{agent.methodology}</Badge>
      </div>

      {/* Current task */}
      <p className="text-[11px] leading-[15px] mb-2 line-clamp-2" style={{ color: "var(--muted-foreground)" }}>
        {agent.currentTask}
      </p>

      {/* Agent email */}
      {(agent as any).email && (
        <div className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded-md" style={{ background: `${agent.color}08` }}>
          <span className="text-[10px]">📧</span>
          <span className="text-[10px] font-mono truncate" style={{ color: agent.color }}>{(agent as any).email}</span>
        </div>
      )}

      {/* Autonomy level */}
      <div className="flex items-center justify-between mb-3">
        <AutonomyDots level={agent.autonomyLevel} color={agent.color} />
        <span className="text-[10px] font-semibold" style={{ color: agent.color }}>{agent.autonomyLabel}</span>
      </div>

      {/* Performance + Credits row */}
      <div className="flex items-center gap-3 mb-3">
        {/* Performance ring */}
        <div className="flex items-center gap-2">
          <MiniRing pct={agent.performanceScore} size={32} color={agent.color} bgColor={`${"var(--border)"}33`} />
          <div>
            <span className="text-[11px] font-bold" style={{ color: "var(--foreground)" }}>{agent.performanceScore}</span>
            <p className="text-[8px]" style={{ color: "var(--muted-foreground)" }}>Score</p>
          </div>
        </div>

        {/* Credits + sparkline */}
        <div className="flex-1 flex items-center gap-2">
          <div className="flex-1 h-[24px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={agent.creditSparkline.map((v, i) => ({ i, v }))}>
                <Line type="monotone" dataKey="v" stroke={agent.color} strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-right">
            <span className="text-[11px] font-bold" style={{ color: "var(--foreground)" }}>{agent.creditsToday}</span>
            <p className="text-[8px]" style={{ color: "var(--muted-foreground)" }}>credits</p>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-1.5 pt-2" style={{ borderTop: `1px solid ${"var(--border)"}22` }}>
        <ActionBtn icon={agent.status === "paused" ? "▶" : "⏸"} tooltip={agent.status === "paused" ? "Resume" : "Pause"} />
        <ActionBtn icon="💬" tooltip="Chat" />
        <ActionBtn icon="⚙" tooltip="Settings" />
        <div className="ml-auto">
          <Badge variant="secondary" className={statusCfg.badgeCn}>{statusCfg.label}</Badge>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SMALL HELPER COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function Dot() {
  return <span className="w-1 h-1 rounded-full bg-current opacity-30" />;
}

function MiniRing({ pct, size, color, bgColor }: { pct: number; size: number; color: string; bgColor: string }) {
  const stroke = 3;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={bgColor} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} />
    </svg>
  );
}

function AutonomyDots({ level, color}: { level: number; color: string;  }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="w-2 h-2 rounded-full transition-all" style={{
          background: i <= level ? color : `${"var(--border)"}44`,
          boxShadow: i <= level ? `0 0 4px ${color}44` : "none",
        }} />
      ))}
      <span className="text-[9px] font-semibold ml-1" style={{ color: "var(--muted-foreground)" }}>L{level}</span>
    </div>
  );
}

function RAGDot({ rag}: { rag: RAG;  }) {
  const colors = { green: "#10B981", amber: "#F59E0B", red: "#EF4444" };
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-2.5 h-2.5 rounded-full" style={{ background: colors[rag], boxShadow: `0 0 6px ${colors[rag]}44` }} />
      <span className="text-[11px] font-semibold capitalize" style={{ color: colors[rag] }}>{rag}</span>
    </div>
  );
}

function ActionBtn({ icon, tooltip}: { icon: string; tooltip: string;  }) {
  return (
    <button className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[12px] hover:opacity-80 transition-all"
      title={tooltip}
      style={{ background: `${"var(--border)"}22`, color: "var(--muted-foreground)" }}>
      {icon}
    </button>
  );
}
