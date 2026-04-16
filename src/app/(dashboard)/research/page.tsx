// @ts-nocheck
"use client";

import { usePageTitle } from "@/hooks/use-page-title";
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Search, Globe, Shield, ChevronDown, ChevronRight, CheckCircle2,
  AlertTriangle, BookOpen, Lightbulb, BarChart3, FileText,
  Clock, Brain, Microscope, Filter, ArrowRight, Layers,
  Database, Eye, TrendingUp, Hash, ExternalLink, RefreshCw,
  Activity, Zap, Target, Info,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ResearchSession {
  id: string;
  agentId: string;
  agentName: string;
  agentGradient: string | null;
  projectName: string;
  factsCount: number;
  sections: Array<{ label: string; content: string }>;
  facts: Array<{ title: string; content: string }>;
  createdAt: string;
}

interface KBFact {
  id: string;
  title: string;
  content: string;
  type: string;
  layer: string;
  trustLevel: string;
  tags: string[];
  createdAt: string;
  agentId: string | null;
  sourceUrl: string | null;
}

interface AuditActivity {
  id: string;
  agentId: string;
  agentName: string;
  agentGradient: string | null;
  type: string;
  summary: string;
  metadata: any;
  createdAt: string;
}

interface AuditData {
  sessions: ResearchSession[];
  kbItems: KBFact[];
  activities: AuditActivity[];
  agents: Array<{ id: string; name: string; gradient: string | null }>;
  stats: {
    totalFacts: number;
    totalSessions: number;
    totalActivities: number;
    highTrustFacts: number;
    standardFacts: number;
    categories: Record<string, number>;
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TRUST_CONFIG = {
  HIGH_TRUST: { label: "High Trust", color: "#10B981", bg: "rgba(16,185,129,0.12)", icon: CheckCircle2 },
  STANDARD: { label: "Standard", color: "#6366F1", bg: "rgba(99,102,241,0.12)", icon: Database },
  REFERENCE_ONLY: { label: "Reference", color: "#F59E0B", bg: "rgba(245,158,11,0.12)", icon: Eye },
};

const SECTION_CONFIG: Record<string, { icon: typeof Search; color: string }> = {
  "Core feasibility": { icon: BarChart3, color: "#6366F1" },
  "Domain-specific research": { icon: Lightbulb, color: "#10B981" },
  "Regulatory & compliance": { icon: Shield, color: "#F59E0B" },
};

function categorizeFact(title: string): { icon: typeof Search; color: string; category: string } {
  const t = title.toLowerCase();
  if (t.includes("cost") || t.includes("price") || t.includes("budget") || t.includes("fee") || t.includes("\u00a3"))
    return { icon: BarChart3, color: "#10B981", category: "Costs & Budget" };
  if (t.includes("risk") || t.includes("danger") || t.includes("warning") || t.includes("safety"))
    return { icon: AlertTriangle, color: "#EF4444", category: "Risks & Safety" };
  if (t.includes("regulation") || t.includes("compliance") || t.includes("legal") || t.includes("permit") || t.includes("licence") || t.includes("law"))
    return { icon: Shield, color: "#F59E0B", category: "Regulatory" };
  if (t.includes("timeline") || t.includes("duration") || t.includes("schedule") || t.includes("deadline"))
    return { icon: FileText, color: "#8B5CF6", category: "Timeline" };
  return { icon: BookOpen, color: "#6366F1", category: "Key Information" };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(date: string | Date): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function agentColor(gradient: string | null): string {
  if (!gradient) return "#6366F1";
  const match = gradient.match(/#[0-9A-Fa-f]{6}/);
  return match?.[0] || "#6366F1";
}

// ─── Tab type ───────────────────────────────────────────────────────────────

type ViewTab = "timeline" | "facts" | "sessions";

// ─── Main Component ─────────────────────────────────────────────────────────

export default function ResearchAuditPage() {
  usePageTitle("Research Audit Trail");

  const [range, setRange] = useState("30d");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<ViewTab>("timeline");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<Set<string>>(new Set());
  const [selectedFact, setSelectedFact] = useState<string | null>(null);
  const [factCategoryFilter, setFactCategoryFilter] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery<AuditData>({
    queryKey: ["research-audit", range, agentFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ range });
      if (agentFilter) params.set("agent", agentFilter);
      const res = await fetch(`/api/research-audit?${params}`);
      const json = await res.json();
      return json.data;
    },
    staleTime: 60_000,
  });

  const sessions = data?.sessions || [];
  const kbItems = data?.kbItems || [];
  const activities = data?.activities || [];
  const agents = data?.agents || [];
  const stats = data?.stats;

  // Merge + sort timeline (sessions + activities)
  const timeline = useMemo(() => {
    const all: Array<{ type: "session" | "activity"; data: any; date: Date }> = [];
    sessions.forEach((s) => all.push({ type: "session", data: s, date: new Date(s.createdAt) }));
    activities.forEach((a) => all.push({ type: "activity", data: a, date: new Date(a.createdAt) }));
    all.sort((a, b) => b.date.getTime() - a.date.getTime());

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return all.filter((item) => {
        if (item.type === "session") {
          const s = item.data as ResearchSession;
          return s.projectName.toLowerCase().includes(q) || s.agentName.toLowerCase().includes(q) ||
            s.facts.some((f: any) => f.title.toLowerCase().includes(q) || f.content.toLowerCase().includes(q));
        }
        const a = item.data as AuditActivity;
        return a.summary.toLowerCase().includes(q) || a.agentName.toLowerCase().includes(q);
      });
    }
    return all;
  }, [sessions, activities, searchQuery]);

  // Group timeline by date
  const grouped = useMemo(() => {
    const groups: Record<string, typeof timeline> = {};
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    timeline.forEach((item) => {
      const ds = item.date.toDateString();
      const label = ds === today ? "Today" : ds === yesterday ? "Yesterday" : formatDate(item.date);
      if (!groups[label]) groups[label] = [];
      groups[label].push(item);
    });
    return groups;
  }, [timeline]);

  // Filtered facts
  const filteredFacts = useMemo(() => {
    let items = kbItems;
    if (factCategoryFilter) {
      items = items.filter((k) => {
        const { category } = categorizeFact(k.title);
        return category === factCategoryFilter;
      });
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter((k) =>
        k.title.toLowerCase().includes(q) || k.content.toLowerCase().includes(q) ||
        (k.tags || []).some((t: string) => t.toLowerCase().includes(q))
      );
    }
    return items;
  }, [kbItems, searchQuery, factCategoryFilter]);

  // Fact categories with counts
  const factCategories = useMemo(() => {
    const counts: Record<string, number> = {};
    kbItems.forEach((k) => {
      const { category } = categorizeFact(k.title);
      counts[category] = (counts[category] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [kbItems]);

  const toggleSectionExpand = (key: string) => {
    setExpandedSection((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen">
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 flex items-center justify-center">
              <Microscope className="w-5 h-5 text-indigo-500" />
            </div>
            <h1 className="text-xl font-bold">Research Audit Trail</h1>
            <Badge variant="secondary" className="text-[10px]">
              {stats?.totalSessions || 0} sessions
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground ml-12">
            Complete audit trail of AI research, discovered facts, and knowledge provenance
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={agentFilter || ""}
            onChange={(e) => setAgentFilter(e.target.value || null)}
            className="px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs outline-none"
          >
            <option value="">All Agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1.5 rounded-lg border border-border bg-background hover:bg-muted transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ── Stats Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
        <StatCard icon={Microscope} label="Research Sessions" value={stats?.totalSessions || 0} color="#6366F1" />
        <StatCard icon={Database} label="Facts Discovered" value={stats?.totalFacts || 0} color="#10B981" />
        <StatCard icon={CheckCircle2} label="High Trust" value={stats?.highTrustFacts || 0} color="#10B981" />
        <StatCard icon={Layers} label="Standard Trust" value={stats?.standardFacts || 0} color="#8B5CF6" />
        <StatCard icon={Activity} label="Research Events" value={stats?.totalActivities || 0} color="#F59E0B" />
      </div>

      {/* ── Filter bar ── */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        {/* View tabs */}
        <div className="flex rounded-lg border border-border overflow-hidden">
          {([
            { id: "timeline" as ViewTab, label: "Timeline", icon: Clock },
            { id: "facts" as ViewTab, label: "Fact Explorer", icon: Database },
            { id: "sessions" as ViewTab, label: "Sessions", icon: Microscope },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setViewTab(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors border-r border-border last:border-r-0 ${
                viewTab === tab.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Date range */}
        <div className="flex rounded-lg border border-border overflow-hidden">
          {["7d", "30d", "90d"].map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors border-r border-border last:border-r-0 ${
                range === r ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r === "7d" ? "7 Days" : r === "30d" ? "30 Days" : "90 Days"}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search research, facts, activities..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background text-xs outline-none"
          />
        </div>

        <span className="text-[11px] text-muted-foreground ml-auto">
          {timeline.length} events
        </span>
      </div>

      {/* ── Loading ── */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl bg-muted/30 animate-pulse border border-border" />
          ))}
        </div>
      )}

      {/* ── Timeline View ── */}
      {!isLoading && viewTab === "timeline" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
          {/* Main timeline */}
          <div>
            {Object.keys(grouped).length === 0 ? (
              <EmptyState />
            ) : (
              Object.entries(grouped).map(([dayLabel, items]) => (
                <div key={dayLabel} className="mb-6">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      {dayLabel} &mdash; {items.length} event{items.length !== 1 ? "s" : ""}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  <div className="pl-3 border-l-2 border-border space-y-2.5">
                    {items.map((item, i) =>
                      item.type === "session" ? (
                        <SessionCard
                          key={item.data.id}
                          session={item.data}
                          isExpanded={expandedSession === item.data.id}
                          onToggle={() => setExpandedSession(expandedSession === item.data.id ? null : item.data.id)}
                          expandedSections={expandedSection}
                          onToggleSection={toggleSectionExpand}
                        />
                      ) : (
                        <ActivityCard key={item.data.id} activity={item.data} />
                      )
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Right sidebar — category breakdown + provenance stats */}
          <div className="space-y-4">
            {/* Category breakdown */}
            {factCategories.length > 0 && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Fact Categories
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  {factCategories.map(([cat, count]) => {
                    const { icon: Icon, color } = categorizeFact(cat);
                    const pct = stats?.totalFacts ? Math.round((count / stats.totalFacts) * 100) : 0;
                    return (
                      <div key={cat}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: `${color}15` }}>
                              <Icon className="w-3 h-3" style={{ color }} />
                            </div>
                            <span className="text-[11px] font-medium">{cat}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground">{count} ({pct}%)</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Trust distribution */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Trust Distribution
                </span>
              </div>
              <div className="p-3 space-y-2.5">
                {Object.entries(TRUST_CONFIG).map(([key, cfg]) => {
                  const count = key === "HIGH_TRUST" ? (stats?.highTrustFacts || 0)
                    : key === "STANDARD" ? (stats?.standardFacts || 0)
                    : Math.max(0, (stats?.totalFacts || 0) - (stats?.highTrustFacts || 0) - (stats?.standardFacts || 0));
                  const pct = stats?.totalFacts ? Math.round((count / stats.totalFacts) * 100) : 0;
                  const Icon = cfg.icon;
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: cfg.bg }}>
                        <Icon className="w-3 h-3" style={{ color: cfg.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[11px] font-medium">{cfg.label}</span>
                          <span className="text-[10px] text-muted-foreground">{count}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: cfg.color }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Agent research breakdown */}
            {agents.length > 0 && sessions.length > 0 && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Agent Research Activity
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  {agents.map((agent) => {
                    const count = sessions.filter((s) => s.agentId === agent.id).length;
                    if (count === 0) return null;
                    const color = agentColor(agent.gradient);
                    return (
                      <div key={agent.id} className="flex items-center gap-2.5">
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                          style={{ background: color }}
                        >
                          {agent.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-[11px] font-medium flex-1 truncate">{agent.name}</span>
                        <Badge variant="secondary" className="text-[9px]">{count} sessions</Badge>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Fact Explorer View ── */}
      {!isLoading && viewTab === "facts" && (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
          {/* Left sidebar: category filter */}
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Filter className="w-3 h-3 inline mr-1" />
                  Filter by Category
                </span>
              </div>
              <div className="p-2">
                <button
                  onClick={() => setFactCategoryFilter(null)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    !factCategoryFilter ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                >
                  All Facts ({kbItems.length})
                </button>
                {factCategories.map(([cat, count]) => {
                  const { icon: Icon, color } = categorizeFact(cat);
                  return (
                    <button
                      key={cat}
                      onClick={() => setFactCategoryFilter(factCategoryFilter === cat ? null : cat)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                        factCategoryFilter === cat ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" style={{ color }} />
                      <span className="flex-1 text-left">{cat}</span>
                      <span className="text-[10px] opacity-60">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tag cloud */}
            {stats?.categories && Object.keys(stats.categories).length > 0 && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <Hash className="w-3 h-3 inline mr-1" />
                    Research Tags
                  </span>
                </div>
                <div className="p-3 flex flex-wrap gap-1.5">
                  {Object.entries(stats.categories)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 20)
                    .map(([tag, count]) => (
                      <button
                        key={tag}
                        onClick={() => setSearchQuery(tag)}
                        className="px-2 py-0.5 rounded-full bg-muted/50 hover:bg-primary/10 text-[10px] font-medium text-muted-foreground hover:text-primary transition-colors"
                      >
                        #{tag} <span className="opacity-50">{count}</span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: fact grid */}
          <div>
            {filteredFacts.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {filteredFacts.map((fact) => {
                  const { icon: Icon, color, category } = categorizeFact(fact.title);
                  const trustCfg = TRUST_CONFIG[fact.trustLevel as keyof typeof TRUST_CONFIG] || TRUST_CONFIG.STANDARD;
                  const isSelected = selectedFact === fact.id;
                  return (
                    <div
                      key={fact.id}
                      onClick={() => setSelectedFact(isSelected ? null : fact.id)}
                      className={`rounded-xl border bg-card p-3.5 cursor-pointer transition-all hover:shadow-sm ${
                        isSelected ? "border-primary/40 ring-1 ring-primary/20" : "border-border hover:border-primary/20"
                      }`}
                    >
                      <div className="flex items-start gap-2.5 mb-2">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}12` }}>
                          <Icon className="w-3.5 h-3.5" style={{ color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-semibold leading-snug line-clamp-2">{fact.title}</h4>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: trustCfg.bg, color: trustCfg.color }}>
                              {trustCfg.label}
                            </span>
                            <span className="text-[9px] text-muted-foreground">{category}</span>
                          </div>
                        </div>
                      </div>
                      <p className={`text-[11px] text-muted-foreground leading-relaxed ${isSelected ? "" : "line-clamp-3"}`}>
                        {fact.content}
                      </p>
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/30">
                        <Clock className="w-3 h-3 text-muted-foreground/50" />
                        <span className="text-[9px] text-muted-foreground">{formatDateTime(fact.createdAt)}</span>
                        {fact.tags?.length > 0 && (
                          <div className="flex gap-1 ml-auto">
                            {fact.tags.filter((t: string) => !["research", "feasibility", "perplexity"].includes(t)).slice(0, 2).map((t: string) => (
                              <span key={t} className="text-[8px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">#{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Sessions View ── */}
      {!isLoading && viewTab === "sessions" && (
        <div>
          {sessions.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-4">
              {sessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  isExpanded={expandedSession === session.id}
                  onToggle={() => setExpandedSession(expandedSession === session.id ? null : session.id)}
                  expandedSections={expandedSection}
                  onToggleSection={toggleSectionExpand}
                  fullWidth
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${color}12` }}>
          <Icon className="w-3.5 h-3.5" style={{ color }} />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
    </div>
  );
}

function SessionCard({
  session,
  isExpanded,
  onToggle,
  expandedSections,
  onToggleSection,
  fullWidth,
}: {
  session: ResearchSession;
  isExpanded: boolean;
  onToggle: () => void;
  expandedSections: Set<string>;
  onToggleSection: (key: string) => void;
  fullWidth?: boolean;
}) {
  const color = agentColor(session.agentGradient);

  return (
    <div className={`rounded-xl border bg-card overflow-hidden transition-all ${isExpanded ? "border-indigo-500/30 shadow-sm" : "border-border hover:border-indigo-500/20"}`}>
      {/* Header — always visible */}
      <div className="px-4 py-3 cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3">
          {/* Agent avatar */}
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ background: color }}>
            {session.agentName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold">{session.agentName}</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">{session.projectName}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge className="text-[9px] border-indigo-500/30 bg-indigo-500/10 text-indigo-600">
                <Microscope className="w-2.5 h-2.5 mr-0.5" />
                Feasibility Research
              </Badge>
              <Badge variant="secondary" className="text-[9px]">
                {session.factsCount} facts
              </Badge>
              <span className="text-[10px] text-muted-foreground">{timeAgo(session.createdAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">{formatDateTime(session.createdAt)}</span>
            {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </div>
        </div>
      </div>

      {/* Expanded body */}
      {isExpanded && (
        <>
          {/* Key facts grid */}
          {session.facts.length > 0 && (
            <div className="px-4 py-3 border-t border-border/30">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2.5">
                <Zap className="w-3 h-3 inline mr-1" />
                Discovered Facts ({session.facts.length})
              </h4>
              <div className={`grid gap-2 ${fullWidth ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"}`}>
                {session.facts.map((fact, i) => {
                  const { icon: Icon, color: factColor, category } = categorizeFact(fact.title);
                  return (
                    <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors">
                      <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: `${factColor}12` }}>
                        <Icon className="w-3 h-3" style={{ color: factColor }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold leading-snug">{fact.title}</p>
                        <p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5 line-clamp-3">{fact.content}</p>
                        <span className="text-[8px] text-muted-foreground/60 mt-1 inline-block">{category}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Research sections (expandable) */}
          {session.sections.length > 0 && (
            <div className="px-4 py-3 border-t border-border/30">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                <BookOpen className="w-3 h-3 inline mr-1" />
                Detailed Research
              </h4>
              <div className="space-y-1">
                {session.sections.map((section, i) => {
                  const sectionKey = `${session.id}-${i}`;
                  const isOpen = expandedSections.has(sectionKey);
                  const cfg = SECTION_CONFIG[section.label] || { icon: BookOpen, color: "#6366F1" };
                  const SIcon = cfg.icon;
                  return (
                    <div key={i}>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleSection(sectionKey); }}
                        className="w-full flex items-center gap-2.5 py-2 px-2 rounded-lg hover:bg-muted/30 transition-colors text-left"
                      >
                        <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0" style={{ background: `${cfg.color}12` }}>
                          <SIcon className="w-3.5 h-3.5" style={{ color: cfg.color }} />
                        </div>
                        <span className="text-[12px] font-semibold flex-1">{section.label}</span>
                        {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                      </button>
                      {isOpen && (
                        <div className="ml-8 mr-2 mb-2 px-3 py-2.5 rounded-lg bg-muted/15 border border-border/20">
                          <div className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-line">
                            {section.content.slice(0, 3000)}
                            {section.content.length > 3000 && "..."}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Provenance footer */}
          <div className="px-4 py-2.5 border-t border-border/20 bg-muted/10 flex items-center gap-3">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-[10px] text-muted-foreground">
              All {session.factsCount} facts stored to Knowledge Base with Standard trust level
            </span>
            <Globe className="w-3 h-3 text-muted-foreground/50 ml-auto" />
            <span className="text-[10px] text-muted-foreground/50">Source: Perplexity AI</span>
          </div>
        </>
      )}
    </div>
  );
}

function ActivityCard({ activity }: { activity: AuditActivity }) {
  const color = agentColor(activity.agentGradient);
  return (
    <div className="flex items-start gap-3 px-3.5 py-2.5 rounded-lg border border-border bg-card hover:border-primary/20 transition-colors">
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0 mt-0.5"
        style={{ background: color }}
      >
        {activity.agentName.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[11px] font-bold text-primary">{activity.agentName}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 font-medium text-muted-foreground uppercase">{activity.type}</span>
        </div>
        <p className="text-xs text-foreground/80 leading-relaxed">{activity.summary}</p>
      </div>
      <span className="text-[10px] text-muted-foreground flex-shrink-0 mt-0.5">{timeAgo(activity.createdAt)}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16">
      <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 flex items-center justify-center mx-auto mb-4">
        <Microscope className="w-7 h-7 text-indigo-500/50" />
      </div>
      <h3 className="text-sm font-bold mb-1">No research data yet</h3>
      <p className="text-xs text-muted-foreground max-w-sm mx-auto">
        Research audit entries will appear here when your agents run feasibility research,
        PESTLE scans, or web searches during project deployment.
      </p>
    </div>
  );
}
