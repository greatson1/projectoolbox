"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useCreditUsage } from "@/hooks/use-api";
import { cn, PLAN_LIMITS } from "@/lib/utils";
import { toast } from "sonner";
import {
  Zap, TrendingDown, ArrowRight, Pause, Play, Plus,
  Download, FileText, CalendarDays, Activity,
} from "lucide-react";
import {
  BarChart, Bar, ComposedChart, LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";

// ═══════════════════════════════════════════════════════════════════
// MOCK DATA
// ═══════════════════════════════════════════════════════════════════

const MOCK_BALANCE = {
  burnRate: 84, depletionDays: 9, depletionDate: "11 Apr",
  resetDays: 29, resetDate: "1 May", dayOfCycle: 19,
};

const USAGE_STREAM_ITEMS = [
  { agent: "Alpha", initials: "A", color: "#6366F1", action: "Generated Risk Register v3 (12 pages)", cost: 18, time: "10:24" },
  { agent: "Bravo", initials: "B", color: "#22D3EE", action: "Processed sprint retro transcript", cost: 12, time: "10:21" },
  { agent: "Echo", initials: "E", color: "#EC4899", action: "Drafted stakeholder update email", cost: 4, time: "10:18" },
  { agent: "Alpha", initials: "A", color: "#6366F1", action: "Risk probability analysis (Monte Carlo)", cost: 22, time: "10:15" },
  { agent: "Charlie", initials: "C", color: "#10B981", action: "Change impact assessment CR-012", cost: 14, time: "10:12" },
  { agent: "Bravo", initials: "B", color: "#22D3EE", action: "Sprint burndown chart generation", cost: 6, time: "10:08" },
  { agent: "Alpha", initials: "A", color: "#6366F1", action: "Meeting summary extraction (45 min call)", cost: 15, time: "10:02" },
  { agent: "Echo", initials: "E", color: "#EC4899", action: "Brand consistency audit across 3 deliverables", cost: 11, time: "09:55" },
  { agent: "Charlie", initials: "C", color: "#10B981", action: "Weekly status report generation", cost: 8, time: "09:48" },
  { agent: "Bravo", initials: "B", color: "#22D3EE", action: "Backlog grooming -- priority re-scoring", cost: 9, time: "09:40" },
  { agent: "Alpha", initials: "A", color: "#6366F1", action: "EVM snapshot: CPI/SPI calculation", cost: 7, time: "09:32" },
  { agent: "Echo", initials: "E", color: "#EC4899", action: "Design asset checklist compilation", cost: 5, time: "09:25" },
];

const CATEGORY_DATA = [
  { name: "Documents", value: 375, color: "#6366F1" },
  { name: "Meetings", value: 250, color: "#22D3EE" },
  { name: "Chat", value: 200, color: "#10B981" },
  { name: "Risk Analysis", value: 175, color: "#F59E0B" },
  { name: "Research", value: 125, color: "#8B5CF6" },
  { name: "Reports", value: 75, color: "#EC4899" },
  { name: "Email", value: 47, color: "#64748B" },
];

const PROJECT_DATA = [
  { project: "Atlas", credits: 412, budget: 500 },
  { project: "SprintForge", credits: 356, budget: 450 },
  { project: "Riverside", credits: 289, budget: 400 },
  { project: "Cloud Migration", credits: 0, budget: 350 },
  { project: "Brand Refresh", credits: 190, budget: 300 },
];

const DAILY_USAGE = Array.from({ length: 30 }, (_, i) => {
  const base = 55 + (i * 1.2) + (((i * 7 + 3) % 20) - 10);
  const val = Math.round(Math.max(20, base));
  return { day: `D${i + 1}`, usage: val, avg7: null as number | null, budget: 67 };
});
DAILY_USAGE.forEach((d, i) => {
  if (i >= 6) {
    d.avg7 = Math.round(DAILY_USAGE.slice(i - 6, i + 1).reduce((s, x) => s + x.usage, 0) / 7);
  }
});

const HOURLY_DATA = Array.from({ length: 24 }, (_, h) => ({
  hour: `${h.toString().padStart(2, "0")}:00`,
  credits: h >= 8 && h <= 18 ? 3 + ((h * 7 + 5) % 13) : ((h * 3 + 1) % 3),
}));

const MODEL_DATA = [
  { name: "Haiku", value: 50, color: "#22D3EE", desc: "Routine tasks, chat, quick lookups" },
  { name: "Sonnet", value: 40, color: "#6366F1", desc: "Documents, analysis, reports" },
  { name: "Opus", value: 10, color: "#8B5CF6", desc: "Premium decisions, complex reasoning" },
];

const AGENT_COLORS: Record<string, string> = {
  Alpha: "#6366F1", Bravo: "#22D3EE", Charlie: "#10B981", Delta: "#F97316", Echo: "#EC4899",
};

const AGENT_30D = Array.from({ length: 30 }, (_, i) => ({
  day: `D${i + 1}`,
  Alpha: 15 + ((i * 7 + 3) % 13),
  Bravo: 12 + ((i * 5 + 2) % 11),
  Charlie: 10 + ((i * 3 + 1) % 9),
  Delta: i < 20 ? 8 + ((i * 4 + 6) % 7) : 0,
  Echo: 7 + ((i * 6 + 4) % 9),
}));

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function ProgressRing({
  pct, size, stroke, color, bgColor, children,
}: {
  pct: number; size: number; stroke: number; color: string; bgColor: string; children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);
  return (
    <div className="relative inline-flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={bgColor} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
          className="transition-all duration-600" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function CreditCentrePage() {
  const { data, isLoading } = useCreditUsage();
  const [streamPaused, setStreamPaused] = useState(false);
  const [autoTopup, setAutoTopup] = useState(false);
  const [alertRules, setAlertRules] = useState([
    { id: 1, label: "Balance below 200 credits", enabled: true, type: "balance" as const },
    { id: 2, label: "Daily spend exceeds 120 credits", enabled: true, type: "daily" as const },
    { id: 3, label: "Alpha exceeds 30 credits/day", enabled: false, type: "agent" as const },
    { id: 4, label: "Bravo exceeds 25 credits/day", enabled: false, type: "agent" as const },
  ]);

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-64 rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
        <Skeleton className="h-48 rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <Skeleton className="h-64 rounded-xl lg:col-span-2" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  const balance = data?.balance || 0;
  const plan = data?.plan || "FREE";
  const totalAllowed = PLAN_LIMITS[plan]?.credits || 50;
  const totalUsed = data?.totalUsed || 0;
  const usedPct = totalAllowed > 0 ? Math.round((totalUsed / totalAllowed) * 100) : 0;
  const remainPct = Math.max(0, Math.round((balance / totalAllowed) * 100));
  const agentBreakdown = data?.agentBreakdown || [];
  const recentTxns = data?.recentTransactions || [];

  // Build forecast data dynamically based on real balance
  const forecastData = Array.from({ length: 30 }, (_, i) => ({
    day: `D${0 + i + 1}`,
    current: Math.max(0, balance - (i * 0)),
    withDelta: Math.max(0, balance - (i * (0 + 15))),
    withTopup: i >= 9 ? Math.max(0, balance + 500 - (i * 0)) : Math.max(0, balance - (i * 0)),
  }));

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* ═══ 1. CREDIT BALANCE HERO ═══ */}
      <div className="rounded-2xl p-6 relative overflow-hidden border border-primary/20 bg-gradient-to-br from-primary/10 via-purple-500/5 to-transparent">
        <div className="flex items-center gap-8 flex-wrap">
          {/* Circular gauge */}
          <ProgressRing
            pct={remainPct}
            size={120}
            stroke={10}
            color={remainPct > 50 ? "var(--primary)" : remainPct > 25 ? "#F59E0B" : "#EF4444"}
            bgColor="var(--border)"
          >
            <span className="text-2xl font-bold text-foreground">{balance.toLocaleString()}</span>
            <span className="text-[10px] text-muted-foreground">credits left</span>
          </ProgressRing>

          {/* Stats */}
          <div className="flex-1 min-w-[300px]">
            <h2 className="text-xl font-bold mb-1 text-foreground">
              {balance.toLocaleString()} credits remaining
            </h2>
            <div className="flex items-center gap-4 flex-wrap text-xs mb-3 text-muted-foreground">
              <span>Burn rate: <strong className="text-foreground">~{0}/day</strong></span>
              <span className="flex items-center gap-1">
                Projected depletion:
                <strong className="text-amber-500">{0} days ({"—"})</strong>
                <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/20">Warning</Badge>
              </span>
              <span>Reset: <strong className="text-primary">{0} days to {"—"}</strong></span>
            </div>
            <Progress value={usedPct} className="h-2.5" />
            <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
              <span>Day {0} of 30</span>
              <span>{totalUsed.toLocaleString()} used / {totalAllowed.toLocaleString()} total</span>
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={async () => { try { const r = await fetch("/api/billing/checkout", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ type: "credits", packId: "pack_500" }) }); const d = await r.json(); if (d.data?.checkoutUrl) window.location.href = d.data.checkoutUrl; else toast.error("Checkout unavailable"); } catch { toast.error("Checkout failed"); } }}>+200</Button>
              <Button size="sm" onClick={async () => { try { const r = await fetch("/api/billing/checkout", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ type: "credits", packId: "pack_500" }) }); const d = await r.json(); if (d.data?.checkoutUrl) window.location.href = d.data.checkoutUrl; else toast.error("Checkout unavailable"); } catch { toast.error("Checkout failed"); } }}>+500</Button>
              <Button variant="ghost" size="sm" onClick={async () => { try { const r = await fetch("/api/billing/checkout", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ type: "credits", packId: "pack_2000" }) }); const d = await r.json(); if (d.data?.checkoutUrl) window.location.href = d.data.checkoutUrl; else toast.error("Checkout unavailable"); } catch { toast.error("Checkout failed"); } }}>+1000</Button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Auto top-up</span>
              <Switch checked={autoTopup} onCheckedChange={setAutoTopup} />
            </div>
          </div>
        </div>
      </div>

      {/* ═══ 2. REAL-TIME USAGE STREAM ═══ */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">Real-Time Usage</CardTitle>
              <span className="relative flex h-2 w-2">
                <span className={cn(
                  "absolute inline-flex h-full w-full rounded-full opacity-75",
                  streamPaused ? "bg-amber-400 animate-none" : "bg-green-400 animate-ping"
                )} />
                <span className={cn("relative inline-flex rounded-full h-2 w-2", streamPaused ? "bg-amber-500" : "bg-green-500")} />
              </span>
              <span className="text-[10px] text-muted-foreground">{streamPaused ? "Paused" : "Live"}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setStreamPaused(!streamPaused)}>
              {streamPaused ? <><Play className="w-3 h-3 mr-1" /> Resume</> : <><Pause className="w-3 h-3 mr-1" /> Pause</>}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {recentTxns.length > 0 ? (
            <div className="space-y-0 max-h-[260px] overflow-y-auto">
              {recentTxns.map((txn: any) => (
                <div key={txn.id} className="flex items-center gap-3 py-2 border-b border-border/10 last:border-0">
                  <span className="text-[10px] font-mono w-[60px] flex-shrink-0 text-muted-foreground">{timeAgo(txn.createdAt)}</span>
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0",
                    txn.amount > 0 ? "bg-green-500" : "bg-primary"
                  )}>
                    {txn.amount > 0 ? "+" : "-"}
                  </div>
                  <span className="text-xs flex-1 truncate text-foreground">{txn.description}</span>
                  <span className={cn("text-xs font-bold flex-shrink-0", txn.amount < -15 ? "text-amber-500" : "text-muted-foreground")}>
                    {txn.amount > 0 ? "+" : ""}{txn.amount}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-0 max-h-[260px] overflow-y-auto">
              {([] as any[]).map((item, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-3 py-2 border-b border-border/10",
                    streamPaused && i > 2 && "opacity-40"
                  )}
                >
                  <span className="text-[10px] font-mono w-[40px] flex-shrink-0 text-muted-foreground">{item.time}</span>
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                    style={{ background: item.color }}
                  >
                    {item.initials}
                  </div>
                  <span className="text-xs flex-1 truncate text-foreground">{item.action}</span>
                  <span className={cn("text-xs font-bold flex-shrink-0", item.cost >= 15 ? "text-amber-500" : "text-muted-foreground")}>
                    -{item.cost}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ 3. USAGE BY AGENT + 4. USAGE BY CATEGORY ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* By Agent */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Usage by Agent (This Cycle)</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Stacked bar chart */}
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={AGENT_30D}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" />
                  <XAxis dataKey="day" tick={{ fontSize: 8 }} className="text-muted-foreground" interval={4} />
                  <YAxis tick={{ fontSize: 8 }} className="text-muted-foreground" />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                  {Object.keys(AGENT_COLORS).map(name => (
                    <Bar key={name} dataKey={name} stackId="a" fill={AGENT_COLORS[name]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* Breakdown table -- use real data if available, else mock */}
            <div className="mt-3 space-y-1.5">
              {agentBreakdown.length > 0 ? (
                agentBreakdown.map((a: any) => {
                  const pct = totalUsed > 0 ? Math.round((a.creditsUsed / totalUsed) * 100) : 0;
                  return (
                    <div key={a.agentId || "system"} className="flex items-center gap-2">
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                        style={{ background: a.agentGradient || "#6366F1" }}
                      >
                        {a.agentName?.[0] || "?"}
                      </div>
                      <span className="text-xs font-medium w-[60px] text-foreground">{a.agentName}</span>
                      <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-border/20">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] font-bold w-[50px] text-right text-primary">{a.creditsUsed}</span>
                      <span className="text-[10px] w-[35px] text-right text-muted-foreground">{pct}%</span>
                    </div>
                  );
                })
              ) : (
                [
                  { name: "Alpha", initials: "A", color: "#6366F1", credits: 412, pct: 33, daily: 21.7 },
                  { name: "Bravo", initials: "B", color: "#22D3EE", credits: 356, pct: 28, daily: 18.7 },
                  { name: "Charlie", initials: "C", color: "#10B981", credits: 289, pct: 23, daily: 15.2 },
                  { name: "Delta", initials: "D", color: "#F97316", credits: 0, pct: 0, daily: 0 },
                  { name: "Echo", initials: "E", color: "#EC4899", credits: 190, pct: 15, daily: 10.0 },
                ].map(a => (
                  <div key={a.name} className="flex items-center gap-2">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                      style={{ background: a.color }}
                    >
                      {a.initials}
                    </div>
                    <span className="text-xs font-medium w-[60px] text-foreground">{a.name}</span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-border/20">
                      <div className="h-full rounded-full" style={{ width: `${a.pct}%`, background: a.color }} />
                    </div>
                    <span className="text-[11px] font-bold w-[50px] text-right" style={{ color: a.color }}>{a.credits}</span>
                    <span className="text-[10px] w-[35px] text-right text-muted-foreground">{a.pct}%</span>
                    <span className="text-[9px] w-[55px] text-right text-muted-foreground">{a.daily}/day</span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* By Category (mock) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Usage by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="w-[160px] h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={[] as any[]} dataKey="value" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2}>
                      {CATEGORY_DATA.map(c => <Cell key={c.name} fill={c.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1.5">
                {CATEGORY_DATA.map(c => {
                  const pct = Math.round((c.value / CATEGORY_DATA.reduce((s, x) => s + x.value, 0)) * 100);
                  return (
                    <div key={c.name} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: c.color }} />
                      <span className="text-[11px] flex-1 text-muted-foreground">{c.name}</span>
                      <span className="text-[11px] font-bold text-foreground">{c.value}</span>
                      <span className="text-[10px] w-[30px] text-right text-muted-foreground">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Treemap bar */}
            <div className="flex h-6 rounded-md overflow-hidden mt-3">
              {CATEGORY_DATA.map(c => {
                const pctW = (c.value / CATEGORY_DATA.reduce((s, x) => s + x.value, 0)) * 100;
                return (
                  <div
                    key={c.name}
                    className="h-full flex items-center justify-center text-[8px] font-bold text-white transition-all"
                    title={`${c.name}: ${c.value}`}
                    style={{ width: `${pctW}%`, background: c.color, minWidth: pctW > 5 ? undefined : 0 }}
                  >
                    {pctW > 8 ? c.name : ""}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ 5. USAGE BY PROJECT ═══ */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Usage by Project</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {PROJECT_DATA.map(p => {
              const pct = Math.round((p.credits / p.budget) * 100);
              const overBudget = pct > 90;
              return (
                <div key={p.project}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-foreground">{p.project}</span>
                    <span className={cn("text-[11px]", overBudget ? "text-destructive" : "text-muted-foreground")}>
                      {p.credits} / {p.budget} budget ({pct}%)
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full overflow-hidden relative bg-border/20">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        overBudget ? "bg-destructive" : pct > 70 ? "bg-amber-500" : "bg-primary"
                      )}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ═══ 6. DAILY USAGE TREND + 7. HOURLY DISTRIBUTION ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Daily Usage Trend (30 Days)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={DAILY_USAGE}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" />
                    <XAxis dataKey="day" tick={{ fontSize: 9 }} className="text-muted-foreground" interval={4} />
                    <YAxis tick={{ fontSize: 9 }} className="text-muted-foreground" />
                    <Tooltip contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                    <Bar dataKey="usage" fill="var(--primary)" fillOpacity={0.35} radius={[2, 2, 0, 0]} name="Daily Usage" />
                    <Line type="monotone" dataKey="avg7" stroke="var(--primary)" strokeWidth={2.5} dot={false} name="7-Day Avg" connectNulls />
                    <ReferenceLine y={67} stroke="#EF4444" strokeDasharray="5 5" label={{ value: "Budget", position: "right", fontSize: 9, fill: "#EF4444" }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-primary/35" /> Daily</span>
                <span className="flex items-center gap-1"><span className="w-4 h-0.5 bg-primary rounded" /> 7-Day Avg</span>
                <span className="flex items-center gap-1"><span className="w-4 h-0.5 border-t-2 border-dashed border-destructive" /> Daily Budget (67)</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Hourly */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Hourly Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={HOURLY_DATA}>
                  <XAxis dataKey="hour" tick={{ fontSize: 7 }} className="text-muted-foreground" interval={3} />
                  <YAxis tick={{ fontSize: 8 }} className="text-muted-foreground" />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                  <Bar dataKey="credits" radius={[2, 2, 0, 0]}>
                    {HOURLY_DATA.map((h, i) => (
                      <Cell key={i} fill={h.credits > 10 ? "var(--primary)" : "var(--primary)"} fillOpacity={h.credits > 10 ? 1 : 0.4} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-center mt-1 text-muted-foreground">Peak: 09:00--12:00 (42% of daily usage)</p>
          </CardContent>
        </Card>
      </div>

      {/* ═══ 8. AI MODEL TIER + 9. CREDIT FORECASTING ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Model breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">AI Model Tier Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="w-[130px] h-[130px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={[] as any[]} dataKey="value" cx="50%" cy="50%" innerRadius={38} outerRadius={58} paddingAngle={3}>
                      {MODEL_DATA.map(m => <Cell key={m.name} fill={m.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2">
                {MODEL_DATA.map(m => (
                  <div key={m.name}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: m.color }} />
                      <span className="text-xs font-semibold text-foreground">{m.name}</span>
                      <span className="text-[11px] font-bold" style={{ color: m.color }}>{m.value}%</span>
                    </div>
                    <p className="text-[10px] ml-[18px] text-muted-foreground">{m.desc}</p>
                  </div>
                ))}
              </div>
            </div>
            {/* Insight */}
            <div className="mt-3 p-2.5 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-[11px] text-primary">
                <strong>Optimization:</strong> 12% of Sonnet calls could be routed to Haiku (routine summaries, status checks).
                Estimated saving: ~45 credits/month.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Forecasting */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Credit Forecast (30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={forecastData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" />
                  <XAxis dataKey="day" tick={{ fontSize: 8 }} className="text-muted-foreground" interval={4} />
                  <YAxis tick={{ fontSize: 8 }} className="text-muted-foreground" />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                  <ReferenceLine y={0} className="stroke-border/40" />
                  <Line type="monotone" dataKey="current" stroke="var(--primary)" strokeWidth={2.5} dot={false} name="Current Pace" />
                  <Line type="monotone" dataKey="withDelta" stroke="#F97316" strokeDasharray="5 3" strokeWidth={1.5} dot={false} name="If Delta Resumes" />
                  <Line type="monotone" dataKey="withTopup" stroke="#10B981" strokeDasharray="3 3" strokeWidth={1.5} dot={false} name="With Auto Top-up" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-primary rounded" /> Current</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 border-t-2 border-dashed border-orange-500" /> +Delta</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 border-t-2 border-dashed border-green-500" /> +Top-up</span>
            </div>
            {/* AI recommendation */}
            <div className="mt-3 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                <strong>Recommendation:</strong> At current pace, credits deplete 20 days before reset.
                Enable auto top-up (500 credits at 200 threshold) or upgrade to Professional+ for 3,000 credits/month.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ 10. USAGE ALERT RULES ═══ */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Usage Alert Rules</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setAlertRules([...alertRules, { id: Date.now(), label: "New rule -- click to edit", enabled: false, type: "balance" as const }])}>
              <Plus className="w-3 h-3 mr-1" /> Add Rule
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {alertRules.map(rule => (
              <div
                key={rule.id}
                className={cn(
                  "flex items-center justify-between p-2.5 rounded-lg border",
                  rule.enabled ? "bg-primary/5 border-primary/20" : "border-border/20"
                )}
              >
                <div className="flex items-center gap-2">
                  <Badge variant={rule.type === "balance" ? "secondary" : rule.type === "daily" ? "destructive" : "outline"}>
                    {rule.type}
                  </Badge>
                  <span className="text-xs text-foreground">{rule.label}</span>
                </div>
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={v => setAlertRules(alertRules.map(r => r.id === rule.id ? { ...r, enabled: v } : r))}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ═══ 11. EXPORT ═══ */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Export & Reports</h3>
              <p className="text-[11px] text-muted-foreground">Download usage data or schedule automated reports</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
