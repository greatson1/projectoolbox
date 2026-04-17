// @ts-nocheck
"use client";

import { usePageTitle } from "@/hooks/use-page-title";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Search, Globe, Shield, ChevronDown, ChevronRight, CheckCircle2,
  AlertTriangle, BookOpen, Lightbulb, BarChart3, FileText,
  Clock, Brain, Microscope, Filter, ArrowRight, Layers,
  Database, Eye, TrendingUp, Hash, RefreshCw,
  Activity, Zap, Download, Link2, AlertCircle,
  XCircle, CalendarClock, DollarSign, PieChart, GitBranch,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ResearchSession {
  id: string;
  agentId: string;
  agentName: string;
  agentGradient: string | null;
  projectId: string | null;
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
  projectId: string | null;
  sourceUrl: string | null;
  daysSinceUpdate: number;
  isStale: boolean;
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

interface ProvenanceLink {
  artefactId: string;
  artefactName: string;
  artefactFormat: string;
  artefactStatus: string;
  artefactVersion: number;
  artefactCreatedAt: string;
  agentId: string;
  projectId: string;
  sourceFactCount: number;
  sourceFactIds: string[];
  sourceFactTitles: string[];
  sourceSessionId: string | null;
  sourceSessionDate: string | null;
  highTrustSources: number;
  standardSources: number;
}

interface Gap {
  projectId: string;
  projectName: string;
  agentName: string;
  gapType: "no_research" | "stale_research" | "missing_category";
  detail: string;
  severity: "high" | "medium" | "low";
  lastResearchDate: string | null;
  daysSinceResearch: number | null;
}

interface Conflict {
  factA: { id: string; title: string; content: string; createdAt: string; trustLevel: string };
  factB: { id: string; title: string; content: string; createdAt: string; trustLevel: string };
  projectId: string | null;
  conflictType: string;
}

interface CostData {
  totalResearchCredits: number;
  totalGenerationCredits: number;
  factsPerCredit: string;
  byAgent: Array<{ agentId: string; agentName: string; research: number; generation: number; total: number }>;
  byProject: Array<{ projectId: string; name: string; research: number; generation: number; total: number; facts: number }>;
}

interface AuditData {
  sessions: ResearchSession[];
  kbItems: KBFact[];
  activities: AuditActivity[];
  agents: Array<{ id: string; name: string; gradient: string | null; projectId: string | null; projectName: string | null }>;
  projects: Array<{ id: string; name: string; status: string | null }>;
  provenance: ProvenanceLink[];
  gaps: Gap[];
  conflicts: Conflict[];
  staleFacts: Array<{ id: string; title: string; projectId: string | null; trustLevel: string; createdAt: string; daysSince: number }>;
  cost: CostData;
  stats: {
    totalFacts: number;
    totalSessions: number;
    totalActivities: number;
    highTrustFacts: number;
    standardFacts: number;
    categories: Record<string, number>;
    totalArtefacts: number;
    totalConflicts: number;
    totalGaps: number;
    totalStaleFacts: number;
    totalCreditsSpent: number;
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

const SEVERITY_CONFIG = {
  high: { color: "#EF4444", bg: "rgba(239,68,68,0.12)", label: "High" },
  medium: { color: "#F59E0B", bg: "rgba(245,158,11,0.12)", label: "Medium" },
  low: { color: "#10B981", bg: "rgba(16,185,129,0.12)", label: "Low" },
};

const STATUS_CONFIG: Record<string, { color: string; bg: string }> = {
  DRAFT: { color: "#64748B", bg: "rgba(100,116,139,0.12)" },
  PENDING_REVIEW: { color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  APPROVED: { color: "#10B981", bg: "rgba(16,185,129,0.12)" },
  REJECTED: { color: "#EF4444", bg: "rgba(239,68,68,0.12)" },
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

// ─── Tabs ───────────────────────────────────────────────────────────────────

type ViewTab = "timeline" | "provenance" | "insights" | "cost" | "facts";

// ─── Main Component ─────────────────────────────────────────────────────────

export default function ResearchAuditPage() {
  usePageTitle("Research Audit Trail");

  const [range, setRange] = useState("30d");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<ViewTab>("timeline");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<Set<string>>(new Set());
  const [selectedFact, setSelectedFact] = useState<string | null>(null);
  const [factCategoryFilter, setFactCategoryFilter] = useState<string | null>(null);
  const [expandedProvenance, setExpandedProvenance] = useState<string | null>(null);
  const [expandedConflict, setExpandedConflict] = useState<number | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery<AuditData>({
    queryKey: ["research-audit", range, agentFilter, projectFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ range });
      if (agentFilter) params.set("agent", agentFilter);
      if (projectFilter) params.set("project", projectFilter);
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
  const projects = data?.projects || [];
  const provenance = data?.provenance || [];
  const gaps = data?.gaps || [];
  const conflicts = data?.conflicts || [];
  const staleFacts = data?.staleFacts || [];
  const cost = data?.cost;
  const stats = data?.stats;

  // Timeline merge
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
            s.facts.some((f: any) => f.title.toLowerCase().includes(q));
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
      items = items.filter((k) => categorizeFact(k.title).category === factCategoryFilter);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter((k) => k.title.toLowerCase().includes(q) || k.content.toLowerCase().includes(q));
    }
    return items;
  }, [kbItems, searchQuery, factCategoryFilter]);

  const factCategories = useMemo(() => {
    const counts: Record<string, number> = {};
    kbItems.forEach((k) => { counts[categorizeFact(k.title).category] = (counts[categorizeFact(k.title).category] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [kbItems]);

  const toggleSectionExpand = (key: string) => {
    setExpandedSection((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  };

  // Alert count for insights tab badge
  const alertCount = gaps.length + conflicts.length + staleFacts.length;

  // Export CSV
  const exportAuditCSV = () => {
    const rows = [
      ["Type", "Date", "Agent", "Project", "Title/Summary", "Trust Level", "Category", "Status"],
      // Research sessions
      ...sessions.map((s) => [
        "Research Session", new Date(s.createdAt).toISOString(), s.agentName, s.projectName,
        `Feasibility research — ${s.factsCount} facts`, "", "", "",
      ]),
      // KB facts
      ...kbItems.map((k) => [
        "Research Fact", new Date(k.createdAt).toISOString(), "", "",
        `"${k.title.replace(/"/g, '""')}"`, k.trustLevel, categorizeFact(k.title).category,
        k.isStale ? "STALE" : "CURRENT",
      ]),
      // Provenance
      ...provenance.map((p) => [
        "Artefact Provenance", new Date(p.artefactCreatedAt).toISOString(), "", "",
        `"${p.artefactName}"`, "", `${p.sourceFactCount} source facts`, p.artefactStatus,
      ]),
      // Gaps
      ...gaps.map((g) => [
        "Research Gap", "", g.agentName, g.projectName,
        `"${g.detail}"`, "", g.gapType, g.severity.toUpperCase(),
      ]),
      // Conflicts
      ...conflicts.map((c) => [
        "Fact Conflict", "", "", "",
        `"${c.factA.title} vs ${c.factB.title}"`, "", c.conflictType, "",
      ]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `research-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen">
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 flex items-center justify-center">
              <Microscope className="w-5 h-5 text-indigo-500" />
            </div>
            <h1 className="text-xl font-bold">Research Audit Trail</h1>
            {alertCount > 0 && (
              <Badge variant="destructive" className="text-[10px]">{alertCount} alerts</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground ml-12">
            Provenance tracking, gap analysis, conflict detection, and cost analytics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={projectFilter || ""} onChange={(e) => { setProjectFilter(e.target.value || null); setAgentFilter(null); }}
            className="px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs outline-none">
            <option value="">All Projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={agentFilter || ""} onChange={(e) => setAgentFilter(e.target.value || null)}
            className="px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs outline-none">
            <option value="">All Agents</option>
            {(projectFilter ? agents.filter((a) => a.projectId === projectFilter) : agents).map((a) => (
              <option key={a.id} value={a.id}>{a.name}{a.projectName ? ` (${a.projectName})` : ""}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" className="text-xs h-8" onClick={exportAuditCSV} disabled={!data}>
            <Download className="w-3.5 h-3.5 mr-1" /> Export
          </Button>
          <button onClick={() => refetch()} disabled={isFetching}
            className="p-1.5 rounded-lg border border-border bg-background hover:bg-muted transition-colors" title="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 mb-5">
        <MiniStat icon={Microscope} label="Sessions" value={stats?.totalSessions || 0} color="#6366F1" />
        <MiniStat icon={Database} label="Facts" value={stats?.totalFacts || 0} color="#10B981" />
        <MiniStat icon={FileText} label="Artefacts" value={stats?.totalArtefacts || 0} color="#8B5CF6" />
        <MiniStat icon={Link2} label="Provenance Links" value={provenance.length} color="#22D3EE" />
        <MiniStat icon={AlertCircle} label="Gaps" value={stats?.totalGaps || 0} color={gaps.length > 0 ? "#EF4444" : "#64748B"} />
        <MiniStat icon={XCircle} label="Conflicts" value={stats?.totalConflicts || 0} color={conflicts.length > 0 ? "#F59E0B" : "#64748B"} />
        <MiniStat icon={CalendarClock} label="Stale Facts" value={stats?.totalStaleFacts || 0} color={staleFacts.length > 0 ? "#F59E0B" : "#64748B"} />
        <MiniStat icon={DollarSign} label="Credits Spent" value={stats?.totalCreditsSpent || 0} color="#10B981" />
      </div>

      {/* ── Tab bar + filters ── */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex rounded-lg border border-border overflow-hidden">
          {([
            { id: "timeline" as ViewTab, label: "Timeline", icon: Clock },
            { id: "provenance" as ViewTab, label: "Provenance", icon: GitBranch },
            { id: "insights" as ViewTab, label: "Insights", icon: AlertTriangle, badge: alertCount },
            { id: "cost" as ViewTab, label: "Cost", icon: PieChart },
            { id: "facts" as ViewTab, label: "Facts", icon: Database },
          ]).map((tab) => (
            <button key={tab.id} onClick={() => setViewTab(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors border-r border-border last:border-r-0 ${
                viewTab === tab.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}>
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.badge ? <span className="ml-1 px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive text-[9px] font-bold">{tab.badge}</span> : null}
            </button>
          ))}
        </div>

        <div className="flex rounded-lg border border-border overflow-hidden">
          {["7d", "30d", "90d"].map((r) => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors border-r border-border last:border-r-0 ${
                range === r ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
              }`}>
              {r === "7d" ? "7d" : r === "30d" ? "30d" : "90d"}
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..." className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background text-xs outline-none" />
        </div>
      </div>

      {/* ── Loading ── */}
      {isLoading && (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-muted/30 animate-pulse border border-border" />)}</div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: TIMELINE
         ══════════════════════════════════════════════════════════════════════ */}
      {!isLoading && viewTab === "timeline" && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5">
          <div>
            {Object.keys(grouped).length === 0 ? <EmptyState /> : (
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
                    {items.map((item) =>
                      item.type === "session" ? (
                        <SessionCard key={item.data.id} session={item.data}
                          isExpanded={expandedSession === item.data.id}
                          onToggle={() => setExpandedSession(expandedSession === item.data.id ? null : item.data.id)}
                          expandedSections={expandedSection} onToggleSection={toggleSectionExpand} />
                      ) : (
                        <ActivityCard key={item.data.id} activity={item.data} />
                      )
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          {/* Sidebar */}
          <div className="space-y-4">
            <SidebarPanel title="Fact Categories">
              {factCategories.map(([cat, count]) => {
                const { icon: Icon, color } = categorizeFact(cat);
                const pct = stats?.totalFacts ? Math.round((count / stats.totalFacts) * 100) : 0;
                return (
                  <div key={cat} className="mb-2">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: `${color}15` }}>
                          <Icon className="w-3 h-3" style={{ color }} />
                        </div>
                        <span className="text-[11px] font-medium">{cat}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground">{count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                    </div>
                  </div>
                );
              })}
            </SidebarPanel>
            <SidebarPanel title="Trust Distribution">
              {Object.entries(TRUST_CONFIG).map(([key, cfg]) => {
                const count = key === "HIGH_TRUST" ? (stats?.highTrustFacts || 0)
                  : key === "STANDARD" ? (stats?.standardFacts || 0)
                  : Math.max(0, (stats?.totalFacts || 0) - (stats?.highTrustFacts || 0) - (stats?.standardFacts || 0));
                const pct = stats?.totalFacts ? Math.round((count / stats.totalFacts) * 100) : 0;
                const Icon = cfg.icon;
                return (
                  <div key={key} className="flex items-center gap-3 mb-2">
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: cfg.bg }}>
                      <Icon className="w-3 h-3" style={{ color: cfg.color }} />
                    </div>
                    <div className="flex-1">
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
            </SidebarPanel>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: PROVENANCE
         ══════════════════════════════════════════════════════════════════════ */}
      {!isLoading && viewTab === "provenance" && (
        <div>
          {provenance.length === 0 ? (
            <EmptyState message="No artefact provenance data yet. Provenance links appear after agents generate documents using research data." />
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs text-muted-foreground mb-3">
                Each artefact is linked to the research facts that informed its generation. This chain proves due diligence from research through to deliverable.
              </p>
              {provenance.map((p) => {
                const isOpen = expandedProvenance === p.artefactId;
                const statusCfg = STATUS_CONFIG[p.artefactStatus] || STATUS_CONFIG.DRAFT;
                const agentInfo = agents.find((a) => a.id === p.agentId);
                const projectInfo = projects.find((pr) => pr.id === p.projectId);
                return (
                  <div key={p.artefactId}
                    className={`rounded-xl border bg-card overflow-hidden transition-all ${isOpen ? "border-cyan-500/30" : "border-border hover:border-cyan-500/20"}`}>
                    <div className="px-4 py-3 cursor-pointer flex items-center gap-3"
                      onClick={() => setExpandedProvenance(isOpen ? null : p.artefactId)}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-cyan-500/10">
                        <FileText className="w-4 h-4 text-cyan-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold">{p.artefactName}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ background: statusCfg.bg, color: statusCfg.color }}>
                            {p.artefactStatus}
                          </span>
                          <span className="text-[10px] text-muted-foreground">v{p.artefactVersion}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                          {projectInfo && <span>{projectInfo.name}</span>}
                          {agentInfo && <><span>·</span><span>{agentInfo.name}</span></>}
                          <span>·</span><span>{formatDateTime(p.artefactCreatedAt)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="text-center">
                          <p className="text-sm font-bold text-cyan-500">{p.sourceFactCount}</p>
                          <p className="text-[9px] text-muted-foreground">source facts</p>
                        </div>
                        <div className="w-px h-8 bg-border" />
                        <div className="flex gap-1.5">
                          <div className="text-center">
                            <p className="text-xs font-bold text-emerald-500">{p.highTrustSources}</p>
                            <p className="text-[8px] text-muted-foreground">high trust</p>
                          </div>
                          <div className="text-center">
                            <p className="text-xs font-bold text-indigo-500">{p.standardSources}</p>
                            <p className="text-[8px] text-muted-foreground">standard</p>
                          </div>
                        </div>
                        {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                      </div>
                    </div>
                    {isOpen && (
                      <div className="px-4 py-3 border-t border-border/30 bg-muted/10">
                        {/* Provenance chain visual */}
                        <div className="flex items-center gap-2 mb-3 text-[10px] text-muted-foreground">
                          <Globe className="w-3.5 h-3.5 text-indigo-500" />
                          <span>Perplexity AI</span>
                          <ArrowRight className="w-3 h-3" />
                          <Database className="w-3.5 h-3.5 text-emerald-500" />
                          <span>Knowledge Base ({p.sourceFactCount} facts)</span>
                          <ArrowRight className="w-3 h-3" />
                          <Brain className="w-3.5 h-3.5 text-violet-500" />
                          <span>Claude Sonnet</span>
                          <ArrowRight className="w-3 h-3" />
                          <FileText className="w-3.5 h-3.5 text-cyan-500" />
                          <span className="font-semibold text-foreground">{p.artefactName}</span>
                        </div>
                        {p.sourceSessionDate && (
                          <p className="text-[10px] text-muted-foreground mb-2">
                            Research session: {formatDateTime(p.sourceSessionDate)}
                          </p>
                        )}
                        {p.sourceFactTitles.length > 0 && (
                          <>
                            <h5 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Source Facts</h5>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {p.sourceFactTitles.map((title, i) => {
                                const { icon: Icon, color } = categorizeFact(title);
                                return (
                                  <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/30">
                                    <Icon className="w-3 h-3 flex-shrink-0" style={{ color }} />
                                    <span className="text-[11px] truncate">{title}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: INSIGHTS (gaps, conflicts, stale facts)
         ══════════════════════════════════════════════════════════════════════ */}
      {!isLoading && viewTab === "insights" && (
        <div className="space-y-6">
          {/* Gaps */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <h2 className="text-sm font-bold">Research Gaps</h2>
              <Badge variant={gaps.length > 0 ? "destructive" : "secondary"} className="text-[10px]">{gaps.length}</Badge>
            </div>
            {gaps.length === 0 ? (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto mb-1" />
                <p className="text-xs text-emerald-600 font-medium">All active projects have research coverage</p>
              </div>
            ) : (
              <div className="space-y-2">
                {gaps.map((gap, i) => {
                  const sev = SEVERITY_CONFIG[gap.severity];
                  return (
                    <div key={i} className="rounded-xl border border-border bg-card p-3.5 flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: sev.bg }}>
                        <AlertCircle className="w-4 h-4" style={{ color: sev.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-bold">{gap.projectName}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ background: sev.bg, color: sev.color }}>
                            {sev.label}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">
                            {gap.gapType === "no_research" ? "No Research" : gap.gapType === "stale_research" ? "Stale" : "Missing Coverage"}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{gap.detail}</p>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                          <span>Agent: {gap.agentName}</span>
                          {gap.lastResearchDate && <span>Last: {formatDateTime(gap.lastResearchDate)}</span>}
                          {gap.daysSinceResearch !== null && <span>{gap.daysSinceResearch}d ago</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Conflicts */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <XCircle className="w-4 h-4 text-amber-500" />
              <h2 className="text-sm font-bold">Fact Conflicts</h2>
              <Badge variant={conflicts.length > 0 ? "default" : "secondary"} className="text-[10px]">{conflicts.length}</Badge>
            </div>
            {conflicts.length === 0 ? (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto mb-1" />
                <p className="text-xs text-emerald-600 font-medium">No conflicting facts detected</p>
              </div>
            ) : (
              <div className="space-y-2">
                {conflicts.map((c, i) => {
                  const isOpen = expandedConflict === i;
                  return (
                    <div key={i} className={`rounded-xl border bg-card overflow-hidden ${isOpen ? "border-amber-500/30" : "border-border"}`}>
                      <div className="px-4 py-3 cursor-pointer flex items-center gap-3" onClick={() => setExpandedConflict(isOpen ? null : i)}>
                        <XCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold">Conflicting facts on same topic</p>
                          <p className="text-[10px] text-muted-foreground">{c.conflictType}</p>
                        </div>
                        {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                      </div>
                      {isOpen && (
                        <div className="px-4 py-3 border-t border-border/30 grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {[c.factA, c.factB].map((f, fi) => {
                            const trust = TRUST_CONFIG[f.trustLevel as keyof typeof TRUST_CONFIG] || TRUST_CONFIG.STANDARD;
                            return (
                              <div key={fi} className="rounded-lg border border-border p-3 bg-muted/10">
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span className="text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ background: trust.bg, color: trust.color }}>
                                    {trust.label}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">{formatDateTime(f.createdAt)}</span>
                                </div>
                                <h5 className="text-[11px] font-bold mb-1">{f.title}</h5>
                                <p className="text-[10px] text-muted-foreground leading-relaxed">{f.content}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Stale Facts */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <CalendarClock className="w-4 h-4 text-amber-500" />
              <h2 className="text-sm font-bold">Stale Facts</h2>
              <Badge variant={staleFacts.length > 0 ? "default" : "secondary"} className="text-[10px]">{staleFacts.length}</Badge>
              <span className="text-[10px] text-muted-foreground">(older than 30 days)</span>
            </div>
            {staleFacts.length === 0 ? (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto mb-1" />
                <p className="text-xs text-emerald-600 font-medium">All research facts are current</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {staleFacts.slice(0, 30).map((f) => {
                  const { icon: Icon, color } = categorizeFact(f.title);
                  return (
                    <div key={f.id} className="rounded-lg border border-amber-500/20 bg-card p-3 flex items-start gap-2.5">
                      <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0" style={{ background: `${color}12` }}>
                        <Icon className="w-3 h-3" style={{ color }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold leading-snug line-clamp-2">{f.title}</p>
                        <p className="text-[10px] text-amber-600 font-medium mt-0.5">{f.daysSince} days old</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: COST ANALYTICS
         ══════════════════════════════════════════════════════════════════════ */}
      {!isLoading && viewTab === "cost" && (
        <div className="space-y-5">
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={Microscope} label="Research Credits" value={cost?.totalResearchCredits || 0} color="#6366F1" />
            <StatCard icon={FileText} label="Generation Credits" value={cost?.totalGenerationCredits || 0} color="#8B5CF6" />
            <StatCard icon={TrendingUp} label="Facts / Credit" value={cost?.factsPerCredit || "N/A"} color="#10B981" />
            <StatCard icon={DollarSign} label="Total Spend" value={(cost?.totalResearchCredits || 0) + (cost?.totalGenerationCredits || 0)} color="#F59E0B" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Per-project breakdown */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Cost by Project</h3>
              </div>
              <div className="p-4">
                {(!cost?.byProject || cost.byProject.length === 0) ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No project cost data yet</p>
                ) : (
                  <div className="space-y-3">
                    {cost.byProject.map((p) => {
                      const maxTotal = Math.max(...cost.byProject.map((x) => x.total), 1);
                      return (
                        <div key={p.projectId}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium">{p.name}</span>
                            <span className="text-xs font-bold">{p.total} credits</span>
                          </div>
                          <div className="flex h-3 rounded-full overflow-hidden bg-muted/30">
                            {p.research > 0 && (
                              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${(p.research / maxTotal) * 100}%` }}
                                title={`Research: ${p.research}`} />
                            )}
                            {p.generation > 0 && (
                              <div className="h-full bg-violet-500 transition-all" style={{ width: `${(p.generation / maxTotal) * 100}%` }}
                                title={`Generation: ${p.generation}`} />
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500" /> Research: {p.research}</span>
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-500" /> Generation: {p.generation}</span>
                            <span className="ml-auto">{p.facts} facts</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Per-agent breakdown */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Cost by Agent</h3>
              </div>
              <div className="p-4">
                {(!cost?.byAgent || cost.byAgent.length === 0) ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No agent cost data yet</p>
                ) : (
                  <div className="space-y-3">
                    {cost.byAgent.filter((a) => a.total > 0).map((a) => {
                      const maxTotal = Math.max(...cost.byAgent.map((x) => x.total), 1);
                      const aInfo = agents.find((ag) => ag.id === a.agentId);
                      const color = agentColor(aInfo?.gradient || null);
                      return (
                        <div key={a.agentId}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white" style={{ background: color }}>
                                {a.agentName.charAt(0).toUpperCase()}
                              </div>
                              <span className="text-xs font-medium">{a.agentName}</span>
                            </div>
                            <span className="text-xs font-bold">{a.total} credits</span>
                          </div>
                          <div className="flex h-3 rounded-full overflow-hidden bg-muted/30">
                            {a.research > 0 && (
                              <div className="h-full bg-indigo-500" style={{ width: `${(a.research / maxTotal) * 100}%` }} />
                            )}
                            {a.generation > 0 && (
                              <div className="h-full bg-violet-500" style={{ width: `${(a.generation / maxTotal) * 100}%` }} />
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                            <span>Research: {a.research}</span>
                            <span>Generation: {a.generation}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB: FACT EXPLORER
         ══════════════════════════════════════════════════════════════════════ */}
      {!isLoading && viewTab === "facts" && (
        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Filter className="w-3 h-3 inline mr-1" />Category
                </span>
              </div>
              <div className="p-2">
                <button onClick={() => setFactCategoryFilter(null)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors ${!factCategoryFilter ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50"}`}>
                  All ({kbItems.length})
                </button>
                {factCategories.map(([cat, count]) => {
                  const { icon: Icon, color } = categorizeFact(cat);
                  return (
                    <button key={cat} onClick={() => setFactCategoryFilter(factCategoryFilter === cat ? null : cat)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${factCategoryFilter === cat ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50"}`}>
                      <Icon className="w-3.5 h-3.5" style={{ color }} />
                      <span className="flex-1 text-left">{cat}</span>
                      <span className="text-[10px] opacity-60">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div>
            {filteredFacts.length === 0 ? <EmptyState /> : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {filteredFacts.map((fact) => {
                  const { icon: Icon, color, category } = categorizeFact(fact.title);
                  const trustCfg = TRUST_CONFIG[fact.trustLevel as keyof typeof TRUST_CONFIG] || TRUST_CONFIG.STANDARD;
                  const isSelected = selectedFact === fact.id;
                  return (
                    <div key={fact.id} onClick={() => setSelectedFact(isSelected ? null : fact.id)}
                      className={`rounded-xl border bg-card p-3.5 cursor-pointer transition-all hover:shadow-sm ${
                        isSelected ? "border-primary/40 ring-1 ring-primary/20" : "border-border hover:border-primary/20"
                      } ${fact.isStale ? "border-l-2 border-l-amber-500" : ""}`}>
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
                            {fact.isStale && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium">
                                Stale ({fact.daysSinceUpdate}d)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <p className={`text-[11px] text-muted-foreground leading-relaxed ${isSelected ? "" : "line-clamp-3"}`}>{fact.content}</p>
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/30">
                        <Clock className="w-3 h-3 text-muted-foreground/50" />
                        <span className="text-[9px] text-muted-foreground">{formatDateTime(fact.createdAt)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function MiniStat({ icon: Icon, label, value, color }: { icon: any; label: string; value: number | string; color: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3 h-3" style={{ color }} />
        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-bold" style={{ color }}>{value}</p>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number | string; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${color}12` }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
    </div>
  );
}

function SidebarPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function SessionCard({
  session, isExpanded, onToggle, expandedSections, onToggleSection, fullWidth,
}: {
  session: ResearchSession; isExpanded: boolean; onToggle: () => void;
  expandedSections: Set<string>; onToggleSection: (key: string) => void; fullWidth?: boolean;
}) {
  const color = agentColor(session.agentGradient);
  return (
    <div className={`rounded-xl border bg-card overflow-hidden transition-all ${isExpanded ? "border-indigo-500/30 shadow-sm" : "border-border hover:border-indigo-500/20"}`}>
      <div className="px-4 py-3 cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3">
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
                <Microscope className="w-2.5 h-2.5 mr-0.5" />Feasibility Research
              </Badge>
              <Badge variant="secondary" className="text-[9px]">{session.factsCount} facts</Badge>
              <span className="text-[10px] text-muted-foreground">{timeAgo(session.createdAt)}</span>
            </div>
          </div>
          {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>
      {isExpanded && (
        <>
          {session.facts.length > 0 && (
            <div className="px-4 py-3 border-t border-border/30">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2.5">
                <Zap className="w-3 h-3 inline mr-1" />Discovered Facts ({session.facts.length})
              </h4>
              <div className={`grid gap-2 ${fullWidth ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"}`}>
                {session.facts.map((fact, i) => {
                  const { icon: Icon, color: fc } = categorizeFact(fact.title);
                  return (
                    <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-muted/20">
                      <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: `${fc}12` }}>
                        <Icon className="w-3 h-3" style={{ color: fc }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold leading-snug">{fact.title}</p>
                        <p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5 line-clamp-3">{fact.content}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {session.sections.length > 0 && (
            <div className="px-4 py-3 border-t border-border/30">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                <BookOpen className="w-3 h-3 inline mr-1" />Detailed Research
              </h4>
              <div className="space-y-1">
                {session.sections.map((section, i) => {
                  const sKey = `${session.id}-${i}`;
                  const isOpen = expandedSections.has(sKey);
                  const cfg = SECTION_CONFIG[section.label] || { icon: BookOpen, color: "#6366F1" };
                  const SIcon = cfg.icon;
                  return (
                    <div key={i}>
                      <button onClick={(e) => { e.stopPropagation(); onToggleSection(sKey); }}
                        className="w-full flex items-center gap-2.5 py-2 px-2 rounded-lg hover:bg-muted/30 transition-colors text-left">
                        <div className="w-6 h-6 rounded flex items-center justify-center" style={{ background: `${cfg.color}12` }}>
                          <SIcon className="w-3.5 h-3.5" style={{ color: cfg.color }} />
                        </div>
                        <span className="text-[12px] font-semibold flex-1">{section.label}</span>
                        {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                      </button>
                      {isOpen && (
                        <div className="ml-8 mr-2 mb-2 px-3 py-2.5 rounded-lg bg-muted/15 border border-border/20">
                          <div className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-line">
                            {section.content.slice(0, 3000)}{section.content.length > 3000 && "..."}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="px-4 py-2.5 border-t border-border/20 bg-muted/10 flex items-center gap-3">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-[10px] text-muted-foreground">
              {session.factsCount} facts stored to KB · Source: Perplexity AI · {formatDateTime(session.createdAt)}
            </span>
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
      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0 mt-0.5" style={{ background: color }}>
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

function EmptyState({ message }: { message?: string }) {
  return (
    <div className="text-center py-16">
      <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 flex items-center justify-center mx-auto mb-4">
        <Microscope className="w-7 h-7 text-indigo-500/50" />
      </div>
      <h3 className="text-sm font-bold mb-1">No data yet</h3>
      <p className="text-xs text-muted-foreground max-w-sm mx-auto">
        {message || "Research data will appear here when your agents run feasibility research during project deployment."}
      </p>
    </div>
  );
}
