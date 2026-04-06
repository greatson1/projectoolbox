// @ts-nocheck
"use client";

import { useState, useEffect, useRef, use } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Speedometer } from "@/components/gauges/speedometer";
import { RingGauge } from "@/components/gauges/ring-gauge";
import {
  Activity, Zap, Clock, FileText, AlertTriangle, CheckCircle2,
  Shield, Bot, ArrowLeft, Download, RefreshCw,
} from "lucide-react";
import Link from "next/link";

const ACTIVITY_ICONS: Record<string, { icon: any; color: string; bg: string }> = {
  lifecycle_init: { icon: Bot, color: "#6366F1", bg: "bg-primary/10" },
  document: { icon: FileText, color: "#22D3EE", bg: "bg-cyan-500/10" },
  proactive_alert: { icon: AlertTriangle, color: "#F59E0B", bg: "bg-amber-500/10" },
  meeting: { icon: Activity, color: "#8B5CF6", bg: "bg-violet-500/10" },
  approval: { icon: Shield, color: "#10B981", bg: "bg-emerald-500/10" },
  chat: { icon: Bot, color: "#6366F1", bg: "bg-primary/10" },
  error: { icon: AlertTriangle, color: "#EF4444", bg: "bg-red-500/10" },
  risk: { icon: AlertTriangle, color: "#EF4444", bg: "bg-red-500/10" },
  cost_planning: { icon: Zap, color: "#F59E0B", bg: "bg-amber-500/10" },
};

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function LiveConsolePage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params);
  usePageTitle("Live Console");

  const [agent, setAgent] = useState<any>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [nextCycleIn, setNextCycleIn] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // Fetch agent + deployment info
  useEffect(() => {
    fetch(`/api/agents/${agentId}`).then(r => r.json()).then(d => {
      setAgent(d.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [agentId]);

  // Poll metrics + activities every 10 seconds
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Get deployment to find projectId
        const agentRes = await fetch(`/api/agents/${agentId}`).then(r => r.json());
        const deployment = agentRes.data?.deployments?.[0];
        if (!deployment?.projectId) return;

        // Fetch metrics
        const metricsRes = await fetch(`/api/projects/${deployment.projectId}/metrics`).then(r => r.json());
        setMetrics(metricsRes.data);

        // Fetch activities
        const actRes = await fetch(`/api/agents/${agentId}/inbox`).then(r => r.json());
        // Use agent activities from metrics
        const newActivities = metricsRes.data?.activities || [];

        // Detect new entries
        if (newActivities.length > prevCountRef.current) {
          // New activity arrived
        }
        prevCountRef.current = newActivities.length;
        setActivities(newActivities);
        setLastUpdate(new Date());

        // Calculate next cycle
        if (deployment.nextCycleAt) {
          const next = new Date(deployment.nextCycleAt).getTime();
          setNextCycleIn(Math.max(0, Math.round((next - Date.now()) / 1000)));
        }
      } catch {}
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [agentId]);

  // Countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      setNextCycleIn(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-muted-foreground">Connecting to agent...</p>
      </div>
    </div>
  );

  if (!agent) return (
    <div className="text-center py-20">
      <p className="text-muted-foreground">Agent not found</p>
      <Link href="/agents"><Button variant="outline" className="mt-4">Back to Fleet</Button></Link>
    </div>
  );

  const deployment = agent.deployments?.[0];
  const evm = metrics?.evm || {};
  const health = metrics?.health || {};
  const tasks = metrics?.tasks || {};
  const risks = metrics?.risks || {};
  const phases = metrics?.phases || {};
  const artefacts = metrics?.artefacts || [];
  const pendingApprovals = metrics?.pendingApprovals || [];

  const taskPct = tasks.total > 0 ? Math.round((tasks.done / tasks.total) * 100) : 0;
  const budgetBurn = evm.budget > 0 ? Math.round((evm.ac / evm.budget) * 100) : 0;
  const daysTotal = agent.project?.startDate && agent.project?.endDate
    ? Math.round((new Date(agent.project.endDate).getTime() - new Date(agent.project.startDate).getTime()) / 86400000) : 0;
  const daysElapsed = agent.project?.startDate
    ? Math.round((Date.now() - new Date(agent.project.startDate).getTime()) / 86400000) : 0;
  const daysRemaining = Math.max(0, daysTotal - daysElapsed);
  const daysPct = daysTotal > 0 ? Math.round((daysElapsed / daysTotal) * 100) : 0;

  const formatCountdown = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6 max-w-[1400px] animate-page-enter">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/agents/${agentId}`}>
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Agent Detail</Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
                style={{ background: agent.gradient || "#6366F1" }}>{agent.name[0]}</div>
              <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-card ${agent.status === "ACTIVE" ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
            </div>
            <div>
              <h1 className="text-lg font-bold">Agent {agent.name} — Live Console</h1>
              <p className="text-xs text-muted-foreground">L{agent.autonomyLevel} · {phases.current || "—"} · {deployment?.projectId ? "Deployed" : "Idle"}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Heartbeat + Next Cycle */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/30 border border-border/30">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-mono text-muted-foreground">Next cycle: <strong className="text-foreground">{formatCountdown(nextCycleIn)}</strong></span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            Updated {timeAgo(lastUpdate)}
          </div>
        </div>
      </div>

      {/* ── Section 1: Performance Gauges ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* SPI Speedometer */}
        <Card className="flex items-center justify-center py-4">
          <Speedometer value={evm.spi || 1} label="SPI" subtitle="Schedule Performance" size={160} />
        </Card>

        {/* CPI Speedometer */}
        <Card className="flex items-center justify-center py-4">
          <Speedometer value={evm.cpi || 1} label="CPI" subtitle="Cost Performance" size={160} />
        </Card>

        {/* Overall Health */}
        <Card>
          <CardContent className="pt-5 flex flex-col items-center justify-center h-full">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold border-4 ${
              health.overall === "GREEN" ? "border-emerald-500 text-emerald-500 bg-emerald-500/10"
              : health.overall === "AMBER" ? "border-amber-500 text-amber-500 bg-amber-500/10"
              : health.overall === "RED" ? "border-red-500 text-red-500 bg-red-500/10"
              : "border-border text-muted-foreground bg-muted/30"
            }`}>
              {health.overall === "GREEN" ? "✓" : health.overall === "AMBER" ? "!" : health.overall === "RED" ? "✗" : "—"}
            </div>
            <p className="text-xs font-bold mt-2">Project Health</p>
            <p className={`text-[10px] ${health.overall === "GREEN" ? "text-emerald-500" : health.overall === "AMBER" ? "text-amber-500" : health.overall === "RED" ? "text-red-500" : "text-muted-foreground"}`}>
              {health.overall === "GREEN" ? "On Track" : health.overall === "AMBER" ? "At Risk" : health.overall === "RED" ? "Critical" : "No Data"}
            </p>
          </CardContent>
        </Card>

        {/* Credits */}
        <Card>
          <CardContent className="pt-5 flex flex-col items-center justify-center h-full">
            <Zap className="w-8 h-8 text-amber-400 mb-2" />
            <p className="text-2xl font-bold">{metrics?.project?.creditBalance?.toLocaleString() || "—"}</p>
            <p className="text-[10px] text-muted-foreground">Credits Remaining</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Section 2: Mini Ring Gauges ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="flex items-center justify-center py-3">
          <RingGauge value={taskPct} label="Tasks Done" subtitle={`${tasks.done || 0}/${tasks.total || 0}`} size={80} />
        </Card>
        <Card className="flex items-center justify-center py-3">
          <RingGauge value={budgetBurn} label="Budget Burn" subtitle={evm.budget ? `$${(evm.ac/1000).toFixed(0)}K / $${(evm.budget/1000).toFixed(0)}K` : "—"} size={80} invertColor />
        </Card>
        <Card className="flex items-center justify-center py-3">
          <RingGauge value={daysPct} label="Time Elapsed" subtitle={`${daysRemaining}d remaining`} size={80} invertColor />
        </Card>
        <Card className="flex items-center justify-center py-3">
          <RingGauge value={risks.critical > 0 ? 100 : risks.high > 0 ? 60 : risks.total > 0 ? 30 : 0} label="Risk Level"
            subtitle={`${risks.critical || 0} critical, ${risks.total || 0} total`} size={80} invertColor />
        </Card>
        <Card className="flex items-center justify-center py-3">
          <RingGauge value={pendingApprovals.length > 3 ? 100 : pendingApprovals.length * 25} label="Approvals"
            subtitle={`${pendingApprovals.length} pending`} size={80} invertColor />
        </Card>
      </div>

      {/* ── Section 3: Live Activity Feed + Sidebar ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activity Feed (2/3) */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">Live Activity Feed</CardTitle>
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <span className="text-[10px] text-muted-foreground">{activities.length} events</span>
          </CardHeader>
          <CardContent>
            <div ref={feedRef} className="space-y-1 max-h-[400px] overflow-y-auto pr-2">
              {activities.length === 0 ? (
                <div className="text-center py-12">
                  <Bot className="w-8 h-8 text-muted-foreground mx-auto mb-3 animate-bounce" />
                  <p className="text-sm font-medium">Waiting for agent activity...</p>
                  <p className="text-xs text-muted-foreground mt-1">Deploy an agent to see real-time actions here</p>
                </div>
              ) : (
                activities.map((a: any, i: number) => {
                  const config = ACTIVITY_ICONS[a.type] || ACTIVITY_ICONS.chat;
                  const Icon = config.icon;
                  const isNew = i === 0;
                  return (
                    <div key={i} className={`flex items-start gap-3 p-2.5 rounded-lg transition-all ${isNew ? "bg-primary/5 ring-1 ring-primary/10" : "hover:bg-muted/20"}`}
                      style={{ animation: isNew ? "fadeInUp 0.3s ease-out" : "none" }}>
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${config.bg}`}>
                        <Icon className="w-3.5 h-3.5" style={{ color: config.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] leading-snug">{a.summary}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-muted-foreground">{timeAgo(a.date || a.createdAt)}</span>
                          <Badge variant="secondary" className="text-[8px] px-1">{a.type}</Badge>
                          {a.metadata?.creditCost && <span className="text-[9px] text-amber-500">{a.metadata.creditCost} credits</span>}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* Sidebar: Phase + Artefacts + Approvals (1/3) */}
        <div className="space-y-4">
          {/* Current Phase */}
          <Card>
            <CardContent className="pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Current Phase</p>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-white">
                  {(phases.list || []).findIndex((p: any) => p.status === "ACTIVE") + 1 || "—"}
                </div>
                <div>
                  <p className="text-sm font-bold">{phases.current || "Not started"}</p>
                  <p className="text-[10px] text-muted-foreground">{phases.status || "—"}</p>
                </div>
              </div>
              {/* Mini phase dots */}
              <div className="flex gap-1.5 mt-3">
                {(phases.list || []).map((p: any, i: number) => (
                  <div key={i} className={`h-1.5 flex-1 rounded-full ${
                    p.status === "COMPLETED" ? "bg-emerald-500" : p.status === "ACTIVE" ? "bg-primary animate-pulse" : "bg-border/30"
                  }`} title={p.name} />
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Latest Artefacts */}
          <Card>
            <CardContent className="pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Latest Artefacts</p>
              {artefacts.length === 0 ? (
                <p className="text-xs text-muted-foreground">None generated yet</p>
              ) : (
                <div className="space-y-1.5">
                  {artefacts.slice(0, 4).map((a: any) => (
                    <div key={a.id} className="flex items-center gap-2 p-1.5 rounded-md hover:bg-muted/20">
                      <FileText className="w-3.5 h-3.5 text-cyan-500 flex-shrink-0" />
                      <span className="text-[11px] truncate flex-1">{a.name}</span>
                      <Badge variant={a.status === "APPROVED" ? "default" : "secondary"} className="text-[8px]">{a.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pending Approvals */}
          <Card>
            <CardContent className="pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Pending Approvals</p>
              {pendingApprovals.length === 0 ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <span className="text-xs text-muted-foreground">All clear</span>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {pendingApprovals.slice(0, 3).map((a: any) => (
                    <Link key={a.id} href="/approvals" className="flex items-center gap-2 p-1.5 rounded-md hover:bg-muted/20">
                      <Shield className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                      <span className="text-[11px] truncate flex-1">{a.title}</span>
                      <Badge variant="destructive" className="text-[8px]">{a.urgency || "—"}</Badge>
                    </Link>
                  ))}
                  {pendingApprovals.length > 3 && (
                    <Link href="/approvals" className="text-[10px] text-primary">+{pendingApprovals.length - 3} more →</Link>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Agent Info */}
          <Card>
            <CardContent className="pt-4 space-y-2 text-[11px]">
              <div className="flex justify-between"><span className="text-muted-foreground">Autonomy</span><span className="font-semibold">Level {agent.autonomyLevel}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span className="font-semibold">{agent.status}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Last Cycle</span><span className="font-semibold">{deployment?.lastCycleAt ? timeAgo(deployment.lastCycleAt) : "Never"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Cycle Interval</span><span className="font-semibold">{deployment?.cycleInterval || 10} min</span></div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
