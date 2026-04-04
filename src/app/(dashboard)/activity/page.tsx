// @ts-nocheck
"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Activity, FileText, AlertTriangle, CheckCircle2, MessageSquare, Bot, Download, ChevronDown, ChevronRight, Calendar, Filter } from "lucide-react";

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function formatHour(date: string | Date) {
  return new Date(date).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

const ACTIVITY_ICONS: Record<string, { icon: string; color: string; bg: string }> = {
  document: { icon: "📄", color: "#6366F1", bg: "rgba(99,102,241,0.1)" },
  meeting: { icon: "🎙️", color: "#22D3EE", bg: "rgba(34,211,238,0.1)" },
  approval: { icon: "✅", color: "#10B981", bg: "rgba(16,185,129,0.1)" },
  risk: { icon: "⚠️", color: "#EF4444", bg: "rgba(239,68,68,0.1)" },
  chat: { icon: "💬", color: "#8B5CF6", bg: "rgba(139,92,246,0.1)" },
  deployment: { icon: "🚀", color: "#F59E0B", bg: "rgba(245,158,11,0.1)" },
  config_change: { icon: "⚙️", color: "#64748B", bg: "rgba(100,116,139,0.1)" },
  paused: { icon: "⏸", color: "#F59E0B", bg: "rgba(245,158,11,0.1)" },
  resumed: { icon: "▶", color: "#10B981", bg: "rgba(16,185,129,0.1)" },
  decommissioned: { icon: "🛑", color: "#EF4444", bg: "rgba(239,68,68,0.1)" },
};

export default function ActivityLogPage() {
  const [range, setRange] = useState("7d");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["activity", range, agentFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ range });
      if (agentFilter) params.set("agent", agentFilter);
      const r = await fetch(`/api/activity?${params}`);
      const j = await r.json();
      return j.data;
    },
  });

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><div className="grid grid-cols-5 gap-4">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div><Skeleton className="h-64" /></div>;

  const activities = data?.activities || [];
  const stats = data?.stats || {};
  const agents = data?.agents || [];
  const digest = data?.digest;

  // Group activities by hour
  const grouped: Record<string, any[]> = {};
  activities.forEach((a: any) => {
    const hour = new Date(a.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "00" });
    if (!grouped[hour]) grouped[hour] = [];
    grouped[hour].push(a);
  });

  // Agent breakdown for chart
  const agentBreakdown = agents.map((ag: any) => ({
    name: ag.name,
    count: activities.filter((a: any) => a.agentId === ag.id).length,
    fill: ag.gradient ? ag.gradient.match(/#[0-9A-Fa-f]{6}/)?.[0] || "#6366F1" : "#6366F1",
  }));

  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Agent Activity Log</h1>
          <p className="text-sm text-muted-foreground mt-1">What your agents did · {activities.length} actions</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled title="Coming soon"><Download className="w-4 h-4 mr-1" /> Export</Button>
          <Link href="/agents/chat"><Button size="sm"><MessageSquare className="w-4 h-4 mr-1" /> Request Digest</Button></Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-lg border border-border overflow-hidden">
          {[{ id: "today", label: "Today" }, { id: "week", label: "This Week" }, { id: "7d", label: "7 Days" }, { id: "30d", label: "30 Days" }].map(r => (
            <button key={r.id} className={`px-3 py-1.5 text-xs font-semibold ${range === r.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              onClick={() => setRange(r.id)}>{r.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Agent:</span>
          <button className={`px-2 py-1 rounded text-[10px] font-semibold ${!agentFilter ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
            onClick={() => setAgentFilter(null)}>All</button>
          {agents.map((a: any) => (
            <button key={a.id} className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold ${agentFilter === a.id ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
              onClick={() => setAgentFilter(agentFilter === a.id ? null : a.id)}>
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: a.gradient?.match(/#[0-9A-Fa-f]{6}/)?.[0] || "#6366F1" }} />
              {a.name}
            </button>
          ))}
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="p-3"><p className="text-[10px] uppercase text-muted-foreground">Total Actions</p><p className="text-2xl font-bold">{stats.totalActions || 0}</p></Card>
        <Card className="p-3"><p className="text-[10px] uppercase text-muted-foreground">Documents</p><p className="text-2xl font-bold text-primary">{stats.documents || 0}</p></Card>
        <Card className="p-3"><p className="text-[10px] uppercase text-muted-foreground">Decisions</p><p className="text-2xl font-bold text-green-500">{stats.decisions || 0}</p></Card>
        <Card className="p-3"><p className="text-[10px] uppercase text-muted-foreground">Risks Flagged</p><p className="text-2xl font-bold text-destructive">{stats.risks || 0}</p></Card>
        <Card className="p-3"><p className="text-[10px] uppercase text-muted-foreground">Meetings</p><p className="text-2xl font-bold text-chart-2">{stats.meetings || 0}</p></Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        {/* Left: Timeline */}
        <div className="xl:col-span-2 space-y-4">
          {activities.length === 0 ? (
            <div className="text-center py-16">
              <Activity className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-lg font-bold mb-2">No activity recorded</h2>
              <p className="text-sm text-muted-foreground">Agent actions will appear here as they work on your projects.</p>
            </div>
          ) : (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Timeline</CardTitle></CardHeader>
              <CardContent>
                {Object.entries(grouped).map(([hour, items]) => (
                  <div key={hour} className="mb-4">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">{hour}</p>
                    <div className="space-y-0">
                      {items.map((a: any) => {
                        const cfg = ACTIVITY_ICONS[a.type] || ACTIVITY_ICONS.document;
                        const isExpanded = expandedId === a.id;
                        return (
                          <div key={a.id} className="flex items-start gap-3 py-2.5 border-b border-border/10 last:border-0 cursor-pointer"
                            onClick={() => setExpandedId(isExpanded ? null : a.id)}>
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0" style={{ background: cfg.bg }}>
                              {cfg.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                                  style={{ background: a.agentGradient?.match(/#[0-9A-Fa-f]{6}/)?.[0] || "#6366F1" }}>
                                  {a.agentName?.[0] || "A"}
                                </div>
                                <span className="text-xs font-semibold text-primary">{a.agentName}</span>
                                <Badge variant="outline" className="text-[9px]">{a.type}</Badge>
                                <span className="text-[10px] text-muted-foreground ml-auto">{formatHour(a.createdAt)}</span>
                                {isExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                              </div>
                              <p className="text-xs text-muted-foreground">{a.summary}</p>
                              {isExpanded && a.metadata && (
                                <div className="mt-2 p-2 rounded-lg bg-muted/30 text-xs text-muted-foreground">
                                  <pre className="whitespace-pre-wrap">{JSON.stringify(a.metadata, null, 2)}</pre>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Digest + Breakdown */}
        <div className="space-y-4">
          {/* Daily Digest */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Daily Digest</CardTitle></CardHeader>
            <CardContent>
              {digest ? (
                <div>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-3">{digest.summary}</p>
                  {digest.highlights && (
                    <div className="space-y-1">
                      {(digest.highlights as any[]).map((h: string, i: number) => (
                        <div key={i} className="flex items-start gap-2 text-xs">
                          <span className="text-primary mt-0.5">•</span>
                          <span className="text-muted-foreground">{h}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Bot className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-xs text-muted-foreground mb-3">No digest for today yet. Digests are generated at end of day.</p>
                  <Link href="/agents/chat">
                    <Button variant="outline" size="sm"><MessageSquare className="w-3.5 h-3.5 mr-1" /> Request via Chat</Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Agent Breakdown */}
          {agentBreakdown.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Agent Breakdown</CardTitle></CardHeader>
              <CardContent>
                <div style={{ height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={agentBreakdown} layout="vertical" barSize={14}>
                      <XAxis type="number" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} width={60} />
                      <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11, color: "var(--foreground)" }} />
                      <Bar dataKey="count" fill="var(--primary)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1.5 mt-3">
                  {agentBreakdown.map((a: any) => (
                    <div key={a.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: a.fill }} />
                        <span>{a.name}</span>
                      </div>
                      <span className="font-semibold">{a.count} actions</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
