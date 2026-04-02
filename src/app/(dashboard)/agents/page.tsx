"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgents } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import {
  Bot, Play, Pause, MessageSquare, Settings, Rocket, Plus,
  AlertTriangle, CheckCircle2, FileText, Users, Shield,
} from "lucide-react";
import {
  BarChart, Bar, AreaChart, Area, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

// ═══════════════════════════════════════════════════════════════════
// HELPERS & CONSTANTS
// ═══════════════════════════════════════════════════════════════════

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const AUTONOMY_LABEL: Record<number, string> = {
  1: "Assistant", 2: "Advisor", 3: "Co-pilot", 4: "Autonomous", 5: "Strategic",
};
const METHOD_LABEL: Record<string, string> = {
  PRINCE2: "PRINCE2", AGILE_SCRUM: "Scrum", AGILE_KANBAN: "Kanban",
  WATERFALL: "Waterfall", HYBRID: "Hybrid", SAFE: "SAFe",
};
const STATUS_CLASS: Record<string, string> = {
  ACTIVE: "bg-green-400 animate-pulse",
  PAUSED: "bg-amber-400",
  IDLE: "bg-muted-foreground",
  ERROR: "bg-red-400",
};
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active", PAUSED: "Paused", IDLE: "Idle", ERROR: "Error",
};

const AGENT_COLORS: string[] = [
  "#6366F1", "#22D3EE", "#10B981", "#F97316", "#EC4899",
  "#8B5CF6", "#14B8A6", "#F43F5E", "#EAB308", "#3B82F6",
];

const AGENT_GRADIENTS: string[] = [
  "linear-gradient(135deg, #6366F1, #8B5CF6)",
  "linear-gradient(135deg, #22D3EE, #06B6D4)",
  "linear-gradient(135deg, #10B981, #34D399)",
  "linear-gradient(135deg, #F97316, #FB923C)",
  "linear-gradient(135deg, #EC4899, #F472B6)",
  "linear-gradient(135deg, #8B5CF6, #A78BFA)",
  "linear-gradient(135deg, #14B8A6, #2DD4BF)",
  "linear-gradient(135deg, #F43F5E, #FB7185)",
  "linear-gradient(135deg, #EAB308, #FACC15)",
  "linear-gradient(135deg, #3B82F6, #60A5FA)",
];

// Mock comparison data (per-agent weekly breakdown)
const COMPARISON_METRICS = ["Tasks", "Docs", "Approvals", "Meetings", "Risks"];

// Mock 30-day credit data generator (seeded so it's stable per render)
function generateCredit30D(agentNames: string[]) {
  const seed = 42;
  const pseudoRandom = (i: number) => ((Math.sin(seed + i) + 1) / 2);
  return Array.from({ length: 30 }, (_, dayIdx) => {
    const entry: Record<string, string | number> = { day: `D${dayIdx + 1}` };
    agentNames.forEach((name, agentIdx) => {
      entry[name] = Math.round(40 + pseudoRandom(dayIdx * 10 + agentIdx * 100) * 60);
    });
    return entry;
  });
}

// Fleet health radar (mock -- API doesn't provide this breakdown)
const FLEET_RADAR = [
  { axis: "Productivity", value: 85 },
  { axis: "Quality", value: 90 },
  { axis: "Speed", value: 78 },
  { axis: "Autonomy", value: 82 },
  { axis: "HITL Compliance", value: 95 },
  { axis: "Satisfaction", value: 88 },
];

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

function AutonomyDots({ level, color }: { level: number; color: string }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <div
          key={i}
          className={cn("w-2 h-2 rounded-full transition-all", i > level && "bg-border/40")}
          style={i <= level ? { background: color, boxShadow: `0 0 4px ${color}44` } : undefined}
        />
      ))}
      <span className="text-[9px] font-semibold text-muted-foreground ml-1">L{level}</span>
    </div>
  );
}

function RAGDot({ rag }: { rag: string }) {
  const colors: Record<string, string> = { green: "#10B981", amber: "#F59E0B", red: "#EF4444" };
  const c = colors[rag] || colors.green;
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-2.5 h-2.5 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}44` }} />
      <span className="text-[11px] font-semibold capitalize" style={{ color: c }}>{rag}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// AGENT CARD
// ═══════════════════════════════════════════════════════════════════

function AgentCard({ agent, color, gradient }: { agent: any; color: string; gradient: string }) {
  const isActive = agent.status === "ACTIVE";
  const performanceScore = agent.performanceScore ?? 85;
  const creditsToday = agent.creditsUsed ?? 0;
  // Generate a stable sparkline from agent id hash
  const sparkline = useMemo(() => {
    let h = 0;
    const id = agent.id || "x";
    for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
    return Array.from({ length: 8 }, (_, i) => ({
      i,
      v: 15 + Math.abs((Math.sin(h + i * 1.7) + 1) * 20),
    }));
  }, [agent.id]);

  return (
    <Card className={cn(
      "transition-all duration-200 hover:-translate-y-0.5",
      isActive && "border-primary/30 shadow-lg shadow-primary/5",
    )}>
      <CardContent className="pt-5 pb-4">
        {/* Top: Avatar + Name + Status */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-base font-bold text-white"
              style={{
                background: gradient,
                boxShadow: isActive ? `0 0 16px ${color}44` : "none",
              }}
            >
              {agent.name?.[0] || "?"}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">{agent.name}</span>
                <span className={cn("w-2 h-2 rounded-full", STATUS_CLASS[agent.status])} />
              </div>
              <span className="text-xs text-muted-foreground">
                {agent.project ? agent.project.name : "Unassigned"}
              </span>
            </div>
          </div>
          {agent.project && (
            <Badge variant="outline" className="text-[9px]">
              {METHOD_LABEL[agent.project.methodology] || agent.project.methodology}
            </Badge>
          )}
        </div>

        {/* Current task (if available) */}
        {agent.currentTask && (
          <p className="text-[11px] leading-[15px] mb-3 line-clamp-2 text-muted-foreground">
            {agent.currentTask}
          </p>
        )}

        {/* Autonomy level */}
        <div className="flex items-center justify-between mb-3">
          <AutonomyDots level={agent.autonomyLevel} color={color} />
          <span className="text-[10px] font-semibold" style={{ color }}>
            {AUTONOMY_LABEL[agent.autonomyLevel]}
          </span>
        </div>

        {/* Performance + Credits row */}
        <div className="flex items-center gap-3 mb-3">
          {/* Performance ring */}
          <div className="flex items-center gap-2">
            <MiniRing pct={performanceScore} size={32} color={color} bgColor="var(--border)" />
            <div>
              <span className="text-[11px] font-bold">{performanceScore}</span>
              <p className="text-[8px] text-muted-foreground">Score</p>
            </div>
          </div>

          {/* Credits + sparkline */}
          <div className="flex-1 flex items-center gap-2">
            <div className="flex-1 h-[24px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sparkline}>
                  <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="text-right">
              <span className="text-[11px] font-bold">{creditsToday}</span>
              <p className="text-[8px] text-muted-foreground">credits</p>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-3">
          <span>{agent._count?.activities || 0} actions</span>
          <span>{agent._count?.decisions || 0} decisions</span>
          <span>{agent.creditsUsed || 0} credits</span>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-1.5 pt-3 border-t border-border/30">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
            {agent.status === "PAUSED" ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          </Button>
          <Link href={`/agents/chat?agent=${agent.id}`}>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
              <MessageSquare className="w-3.5 h-3.5" />
            </Button>
          </Link>
          <Link href={`/agents/${agent.id}`}>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
              <Settings className="w-3.5 h-3.5" />
            </Button>
          </Link>
          <div className="ml-auto">
            <Badge
              variant={agent.status === "ACTIVE" ? "default" : agent.status === "PAUSED" ? "secondary" : "outline"}
              className="text-[9px]"
            >
              {STATUS_LABEL[agent.status]}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════

export default function AgentFleetPage() {
  const { data, isLoading } = useAgents();
  const [activityFilter, setActivityFilter] = useState<string | null>(null);

  // ── Loading state ──
  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1600px]">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  const agents: any[] = data?.agents || [];
  const activities: any[] = data?.activities || [];
  const alerts: any[] = data?.alerts || [];
  const activeCount = agents.filter((a) => a.status === "ACTIVE").length;
  const pausedCount = agents.filter((a) => a.status === "PAUSED").length;
  const totalCredits = agents.reduce((s: number, a: any) => s + (a.creditsUsed || 0), 0);

  // Assign stable colors to agents
  const agentColors = agents.map((_: any, i: number) => AGENT_COLORS[i % AGENT_COLORS.length]);
  const agentGradients = agents.map((_: any, i: number) => AGENT_GRADIENTS[i % AGENT_GRADIENTS.length]);
  const agentNames = agents.map((a: any) => a.name);

  const filteredActivities = activityFilter
    ? activities.filter((a: any) => a.agentName === activityFilter)
    : activities;

  // Build comparison data from real agents
  const comparisonData = COMPARISON_METRICS.map(metric => {
    const row: Record<string, string | number> = { metric };
    agents.forEach((agent: any, idx: number) => {
      const count = agent._count;
      if (metric === "Tasks") row[agent.name] = count?.activities || 18;
      else if (metric === "Docs") row[agent.name] = 6;
      else if (metric === "Approvals") row[agent.name] = count?.decisions || 3;
      else if (metric === "Meetings") row[agent.name] = 3;
      else if (metric === "Risks") row[agent.name] = 4;
    });
    return row;
  });

  // Mock 30-day credit data
  const agentKey = agentNames.join(",");
  const credit30D = useMemo(() => generateCredit30D(agentNames), [agentKey]);

  // ── Empty state ──
  if (agents.length === 0) {
    return (
      <div className="space-y-6 max-w-[1600px]">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">Agent Fleet</h1>
            <p className="text-sm text-muted-foreground mt-1">No agents deployed yet</p>
          </div>
        </div>
        <div className="text-center py-20">
          <Bot className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">No agents deployed</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Deploy your first AI project manager to get started.
          </p>
          <Link href="/agents/deploy">
            <Button><Rocket className="w-4 h-4 mr-1" /> Deploy First Agent</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1600px]">
      {/* ═══ 1. HEADER ═══ */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Agent Fleet</h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground">{agents.length} Agents Deployed</span>
            <Dot />
            <span>{activeCount} Active</span>
            <Dot />
            <span>{pausedCount} Paused</span>
            <Dot />
            <span className="font-semibold text-primary">{totalCredits} credits used</span>
          </p>
        </div>
        <Link href="/agents/deploy">
          <Button><Rocket className="w-4 h-4 mr-1" /> Deploy New Agent</Button>
        </Link>
      </div>

      {/* ═══ 2. FLEET OVERVIEW CARDS ═══ */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
        {agents.map((agent: any, idx: number) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            color={agent.gradient ? AGENT_COLORS[0] : agentColors[idx]}
            gradient={agent.gradient || agentGradients[idx]}
          />
        ))}
      </div>

      {/* ═══ 3. FLEET ACTIVITY TIMELINE ═══ */}
      {activities.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-sm">Fleet Activity Timeline</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Recent agent actions</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className={cn(
                  "px-2 py-1 rounded-md text-[10px] font-semibold transition-all border",
                  !activityFilter
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "text-muted-foreground border-transparent",
                )}
                onClick={() => setActivityFilter(null)}
              >
                All
              </button>
              {agents.map((a: any, idx: number) => (
                <button
                  key={a.id}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-all border",
                    activityFilter === a.name
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "text-muted-foreground border-transparent",
                  )}
                  onClick={() => setActivityFilter(activityFilter === a.name ? null : a.name)}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: agentColors[idx] }}
                  />
                  {a.name}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {/* "Now" marker */}
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-green-500">Now</span>
              <div className="flex-1 h-px bg-green-500/20" />
            </div>

            {/* Events */}
            <div className="space-y-0">
              {filteredActivities.map((evt: any, i: number) => {
                const evtAgentIdx = agents.findIndex((a: any) => a.name === evt.agentName);
                const evtColor = evtAgentIdx >= 0 ? agentColors[evtAgentIdx] : "var(--primary)";
                return (
                  <div
                    key={evt.id}
                    className={cn(
                      "flex items-start gap-3 py-2.5",
                      i < filteredActivities.length - 1 && "border-b border-border/10",
                    )}
                  >
                    {/* Timeline line + dot */}
                    <div className="flex flex-col items-center flex-shrink-0 w-5">
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: evtColor, boxShadow: `0 0 6px ${evtColor}44` }}
                      />
                      {i < filteredActivities.length - 1 && (
                        <div className="w-px flex-1 mt-1 bg-border/30 min-h-[20px]" />
                      )}
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                          style={{ background: evtColor }}
                        >
                          {evt.agentName?.[0] || "?"}
                        </span>
                        <span className="text-xs font-semibold" style={{ color: evtColor }}>
                          {evt.agentName}
                        </span>
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                          style={{ background: `${evtColor}15`, color: evtColor }}
                        >
                          {evt.type}
                        </span>
                        <span className="text-[10px] ml-auto text-muted-foreground">
                          {timeAgo(evt.createdAt)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{evt.summary}</p>
                      {evt.project && (
                        <span className="text-[10px] text-muted-foreground/60">{evt.project}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ 4. FLEET PERFORMANCE (2-column) ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left column: Comparison + Credit consumption */}
        <div className="space-y-4">
          {/* Performance comparison bar chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Agent Comparison (This Week)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparisonData} barGap={1} barSize={10}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                    <XAxis dataKey="metric" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                    <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                    <Tooltip
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 11,
                        color: "var(--foreground)",
                      }}
                    />
                    {agents.map((agent: any, idx: number) => (
                      <Bar
                        key={agent.id}
                        dataKey={agent.name}
                        fill={agentColors[idx]}
                        radius={[2, 2, 0, 0]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {agents.map((a: any, idx: number) => (
                  <span key={a.id} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: agentColors[idx] }} />
                    {a.name}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Credit consumption stacked area chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Credit Consumption (30 Days)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={credit30D}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" />
                    <XAxis dataKey="day" tick={{ fontSize: 9 }} className="fill-muted-foreground" interval={4} />
                    <YAxis tick={{ fontSize: 9 }} className="fill-muted-foreground" />
                    <Tooltip
                      contentStyle={{
                        background: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 11,
                        color: "var(--foreground)",
                      }}
                    />
                    {agents.map((agent: any, idx: number) => (
                      <Area
                        key={agent.id}
                        type="monotone"
                        dataKey={agent.name}
                        stackId="1"
                        stroke={agentColors[idx]}
                        fill={`${agentColors[idx]}33`}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right column: Fleet radar + Utilisation */}
        <div className="space-y-4">
          {/* Fleet health radar chart */}
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm">Fleet Health</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[230px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={FLEET_RADAR} cx="50%" cy="50%" outerRadius="72%">
                    <PolarGrid className="stroke-border/40" />
                    <PolarAngleAxis dataKey="axis" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                    <PolarRadiusAxis tick={{ fontSize: 8 }} className="fill-muted-foreground" domain={[0, 100]} />
                    <Radar
                      dataKey="value"
                      stroke="var(--primary)"
                      fill="var(--primary)"
                      fillOpacity={0.2}
                      strokeWidth={2}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1 flex-wrap gap-1">
                {FLEET_RADAR.map(r => (
                  <span key={r.axis}>
                    <span className={cn(
                      "font-semibold",
                      r.value >= 85 ? "text-green-500" : r.value >= 75 ? "text-amber-500" : "text-red-500",
                    )}>
                      {r.value}%
                    </span>{" "}
                    {r.axis}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Agent utilisation bars */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Agent Utilisation</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {agents.map((agent: any, idx: number) => {
                  const tasksWeek = agent._count?.activities || 18;
                  const maxTasks = 35;
                  const pct = Math.min(100, Math.round((tasksWeek / maxTasks) * 100));
                  return (
                    <div key={agent.id}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ background: agentColors[idx] }}
                          />
                          <span className="text-xs font-medium">{agent.name}</span>
                          <Badge
                            variant={
                              agent.status === "ACTIVE" ? "default"
                              : agent.status === "PAUSED" ? "secondary"
                              : "outline"
                            }
                            className="text-[9px]"
                          >
                            {STATUS_LABEL[agent.status]}
                          </Badge>
                        </div>
                        <span className="text-[11px] font-semibold" style={{ color: agentColors[idx] }}>
                          {tasksWeek} tasks/wk
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full overflow-hidden bg-border/20">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: agentColors[idx] }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ═══ 5. PROJECT-AGENT MATRIX ═══ */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Project-Agent Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {["Project", "Agent", "Methodology", "Phase", "Health", "Autonomy", "Tasks/Wk", "Pending", "Credits", "Actions"].map(h => (
                    <th key={h} className="text-left py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agents.map((agent: any, idx: number) => {
                  const tasksWeek = agent._count?.activities || 18;
                  const pending = agent._count?.decisions || 0;
                  const health = agent.status === "ACTIVE" ? "green" : agent.status === "PAUSED" ? "amber" : "red";
                  return (
                    <tr key={agent.id} className="border-b border-border/10 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 px-3 font-semibold">
                        {agent.project?.name || "Unassigned"}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                            style={{ background: agentGradients[idx] }}
                          >
                            {agent.name?.[0] || "?"}
                          </div>
                          <span className="font-medium">{agent.name}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge variant="outline" className="text-[9px]">
                          {agent.project ? (METHOD_LABEL[agent.project.methodology] || agent.project.methodology) : "-"}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground">
                        {agent.project?.phase || "-"}
                      </td>
                      <td className="py-2.5 px-3">
                        <RAGDot rag={health} />
                      </td>
                      <td className="py-2.5 px-3">
                        <AutonomyDots level={agent.autonomyLevel} color={agentColors[idx]} />
                      </td>
                      <td className="py-2.5 px-3 font-semibold">{tasksWeek}</td>
                      <td className="py-2.5 px-3">
                        {pending > 0 ? (
                          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500">
                            {pending}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground">
                        {(agent.creditsUsed || 0).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                            {agent.status === "PAUSED"
                              ? <Play className="w-3 h-3" />
                              : <Pause className="w-3 h-3" />}
                          </Button>
                          <Link href={`/agents/chat?agent=${agent.id}`}>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                              <MessageSquare className="w-3 h-3" />
                            </Button>
                          </Link>
                          <Link href={`/agents/${agent.id}`}>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                              <Settings className="w-3 h-3" />
                            </Button>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {/* Deploy row */}
                <tr>
                  <td colSpan={10} className="py-3 px-3">
                    <Link href="/agents/deploy" className="block">
                      <button className="flex items-center gap-2 text-xs font-semibold w-full justify-center py-2 rounded-lg transition-all hover:opacity-80 text-primary bg-primary/5 border border-dashed border-primary/30">
                        <Plus className="w-3.5 h-3.5" /> Deploy agent to new project
                      </button>
                    </Link>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ═══ 6. ALERTS & ESCALATIONS ═══ */}
      {alerts.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">Alerts & Escalations</CardTitle>
              <Badge variant="destructive" className="text-[9px]">{alerts.length}</Badge>
            </div>
            <span className="text-[11px] text-muted-foreground">Priority-sorted -- Requires human attention</span>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {alerts.map((alert: any) => {
              const priorityColor =
                alert.priority === "critical" ? "#EF4444"
                : alert.priority === "high" ? "#F97316"
                : "#F59E0B";
              const alertAgentIdx = agents.findIndex((a: any) => a.name === alert.agentName);
              const alertColor = alertAgentIdx >= 0 ? agentColors[alertAgentIdx] : "var(--primary)";
              return (
                <div
                  key={alert.id}
                  className="flex items-start gap-3 p-3 rounded-xl transition-all"
                  style={{ background: `${priorityColor}08`, border: `1px solid ${priorityColor}18` }}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                    style={{ background: alertColor }}
                  >
                    {alert.agentName?.[0] || "!"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-semibold" style={{ color: alertColor }}>
                        {alert.agentName || alert.title}
                      </span>
                      <Badge
                        variant={alert.priority === "critical" ? "destructive" : "secondary"}
                        className="text-[9px]"
                      >
                        {alert.priority || alert.type}
                      </Badge>
                      <span className="text-[10px] ml-auto text-muted-foreground">
                        {alert.time || timeAgo(alert.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed mb-1.5">
                      {alert.message || alert.description}
                    </p>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-muted-foreground">{alert.project}</span>
                      <div className="flex items-center gap-1.5 ml-auto">
                        {alert.actions ? (
                          alert.actions.map((action: string) => (
                            <Button
                              key={action}
                              variant={
                                action === "Approve" || action === "Auto-fix" || action === "Resume"
                                  ? "default"
                                  : "ghost"
                              }
                              size="sm"
                            >
                              {action}
                            </Button>
                          ))
                        ) : (
                          <Link href="/approvals">
                            <Button variant="outline" size="sm">Review</Button>
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
