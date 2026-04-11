"use client";

import { usePageTitle } from "@/hooks/use-page-title";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  Users,
  CheckSquare,
  AlertTriangle,
  BarChart2,
  Settings,
  Activity,
  Search,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  MessageSquare,
  Bot,
  RefreshCw,
  Wifi,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentActivity {
  id: string;
  agentId: string;
  agentName: string;
  agentGradient: string | null;
  type: string;
  summary: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface ActivityData {
  activities: AgentActivity[];
  total: number;
  page: number;
  stats: {
    totalActions: number;
    documents: number;
    decisions: number;
    risks: number;
    meetings: number;
  };
  agents: { id: string; name: string; gradient: string | null }[];
  digest: { summary: string; highlights: string[] } | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BG = "var(--background)";
const CARD = "var(--card)";
const SURFACE = "var(--muted)";
const BORDER = "hsl(var(--border))";
const TEXT = "var(--foreground)";
const MUTED = "var(--muted-foreground)";
const DIM = "var(--muted-foreground)";
const PRIMARY = "hsl(var(--primary))";

const TYPE_CONFIG: Record<string, { label: string; color: string; bgColor: string; Icon: React.ComponentType<{ size?: number; color?: string }> }> = {
  document: {
    label: "Document",
    color: "#6366F1",
    bgColor: "rgba(99,102,241,0.15)",
    Icon: FileText,
  },
  meeting: {
    label: "Meeting",
    color: "#22D3EE",
    bgColor: "rgba(34,211,238,0.15)",
    Icon: Users,
  },
  approval: {
    label: "Approval",
    color: "#F59E0B",
    bgColor: "rgba(245,158,11,0.15)",
    Icon: CheckSquare,
  },
  risk: {
    label: "Risk",
    color: "#EF4444",
    bgColor: "rgba(239,68,68,0.15)",
    Icon: AlertTriangle,
  },
  report: {
    label: "Report",
    color: "#6366F1",
    bgColor: "rgba(99,102,241,0.15)",
    Icon: BarChart2,
  },
  system: {
    label: "System",
    color: "#64748B",
    bgColor: "rgba(100,116,139,0.15)",
    Icon: Settings,
  },
  // legacy / fallback mappings
  chat: {
    label: "System",
    color: "#64748B",
    bgColor: "rgba(100,116,139,0.15)",
    Icon: Settings,
  },
  deployment: {
    label: "System",
    color: "#64748B",
    bgColor: "rgba(100,116,139,0.15)",
    Icon: Settings,
  },
  config_change: {
    label: "System",
    color: "#64748B",
    bgColor: "rgba(100,116,139,0.15)",
    Icon: Settings,
  },
  paused: {
    label: "System",
    color: "#64748B",
    bgColor: "rgba(100,116,139,0.15)",
    Icon: Settings,
  },
  resumed: {
    label: "System",
    color: "#64748B",
    bgColor: "rgba(100,116,139,0.15)",
    Icon: Settings,
  },
  decommissioned: {
    label: "System",
    color: "#64748B",
    bgColor: "rgba(100,116,139,0.15)",
    Icon: Settings,
  },
  decision: {
    label: "Approval",
    color: "#F59E0B",
    bgColor: "rgba(245,158,11,0.15)",
    Icon: CheckSquare,
  },
  // Agent-generated document types
  artefact_generated: {
    label: "Document",
    color: "#6366F1",
    bgColor: "rgba(99,102,241,0.15)",
    Icon: FileText,
  },
  artefact: {
    label: "Document",
    color: "#6366F1",
    bgColor: "rgba(99,102,241,0.15)",
    Icon: FileText,
  },
  ingest: {
    label: "Document",
    color: "#6366F1",
    bgColor: "rgba(99,102,241,0.15)",
    Icon: FileText,
  },
  knowledge: {
    label: "Document",
    color: "#6366F1",
    bgColor: "rgba(99,102,241,0.15)",
    Icon: FileText,
  },
  // Risk/alert types
  proactive_alert: {
    label: "Risk",
    color: "#EF4444",
    bgColor: "rgba(239,68,68,0.15)",
    Icon: AlertTriangle,
  },
  risk_flag: {
    label: "Risk",
    color: "#EF4444",
    bgColor: "rgba(239,68,68,0.15)",
    Icon: AlertTriangle,
  },
  // Lifecycle types
  lifecycle_init: {
    label: "System",
    color: "#8B5CF6",
    bgColor: "rgba(139,92,246,0.15)",
    Icon: Settings,
  },
  autonomous_cycle: {
    label: "System",
    color: "#64748B",
    bgColor: "rgba(100,116,139,0.15)",
    Icon: Settings,
  },
  transcript: {
    label: "Meeting",
    color: "#22D3EE",
    bgColor: "rgba(34,211,238,0.15)",
    Icon: Users,
  },
  report_generated: {
    label: "Report",
    color: "#6366F1",
    bgColor: "rgba(99,102,241,0.15)",
    Icon: BarChart2,
  },
};

const FALLBACK_TYPE = {
  label: "System",
  color: "#64748B",
  bgColor: "rgba(100,116,139,0.15)",
  Icon: Settings,
};

const FILTER_TABS = [
  { id: "all", label: "All" },
  { id: "document", label: "Document" },
  { id: "meeting", label: "Meeting" },
  { id: "approval", label: "Approval" },
  { id: "risk", label: "Risk" },
  { id: "report", label: "Report" },
  { id: "system", label: "System" },
] as const;

type FilterTab = (typeof FILTER_TABS)[number]["id"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(date: string | Date): string {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function formatTime(date: string | Date): string {
  return new Date(date).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function agentInitial(name: string): string {
  return name?.charAt(0)?.toUpperCase() || "A";
}

function agentColor(gradient: string | null): string {
  if (!gradient) return PRIMARY;
  const match = gradient.match(/#[0-9A-Fa-f]{6}/);
  return match?.[0] || PRIMARY;
}

/** Map any activity type string to one of our canonical filter tabs */
function resolveFilterGroup(type: string): FilterTab {
  if (!type) return "system";
  const t = type.toLowerCase();
  // Document / artefact types
  if (t === "document" || t === "artefact_generated" || t === "artefact" || t === "ingest" || t === "knowledge") return "document";
  // Report types
  if (t === "report" || t === "report_generated") return "report";
  // Meeting types
  if (t === "meeting" || t === "transcript") return "meeting";
  // Approval / decision types
  if (t === "approval" || t === "decision") return "approval";
  // Risk / alert types
  if (t === "risk" || t === "proactive_alert" || t === "risk_flag") return "risk";
  // Everything else → system (deployment, lifecycle_init, config_change, chat, paused, resumed, autonomous_cycle, etc.)
  return "system";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LiveDot() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#34D399",
          boxShadow: "0 0 0 2px rgba(52,211,153,0.3)",
          animation: "pulse 2s ease-in-out infinite",
          display: "inline-block",
        }}
      />
      <span style={{ fontSize: 11, fontWeight: 600, color: "#34D399", letterSpacing: "0.05em" }}>
        LIVE
      </span>
    </span>
  );
}

function StatCard({ label, value, valueColor }: { label: string; value: number | string; valueColor?: string }) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 10,
        padding: "16px 20px",
      }}
    >
      <p style={{ margin: "0 0 6px 0", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: MUTED }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: valueColor || TEXT, lineHeight: 1 }}>
        {value}
      </p>
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const cfg = TYPE_CONFIG[type.toLowerCase()] || FALLBACK_TYPE;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 4,
        background: cfg.bgColor,
        color: cfg.color,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        flexShrink: 0,
      }}
    >
      {cfg.label}
    </span>
  );
}

function ActivityItem({ activity, isExpanded, onToggle }: { activity: AgentActivity; isExpanded: boolean; onToggle: () => void }) {
  const cfg = TYPE_CONFIG[activity.type?.toLowerCase()] || FALLBACK_TYPE;
  const TypeIcon = cfg.Icon;
  const color = agentColor(activity.agentGradient);

  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${isExpanded ? PRIMARY : BORDER}`,
        borderRadius: 8,
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      onClick={onToggle}
      onMouseEnter={(e) => { if (!isExpanded) (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(99,102,241,0.5)"; }}
      onMouseLeave={(e) => { if (!isExpanded) (e.currentTarget as HTMLDivElement).style.borderColor = BORDER; }}
    >
      {/* Main row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px" }}>
        {/* Type icon circle */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: cfg.bgColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <TypeIcon size={16} color={cfg.color} />
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Top row: agent badge + type badge + time */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5, flexWrap: "wrap" }}>
            {/* Agent avatar + name */}
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 9,
                  fontWeight: 700,
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                {agentInitial(activity.agentName)}
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: PRIMARY }}>{activity.agentName}</span>
            </div>

            <TypeBadge type={activity.type} />

            <span style={{ fontSize: 11, color: DIM, marginLeft: "auto", flexShrink: 0 }}>
              {timeAgo(activity.createdAt)}
            </span>
            <span style={{ fontSize: 11, color: DIM, flexShrink: 0 }}>
              {formatTime(activity.createdAt)}
            </span>
            {isExpanded
              ? <ChevronDown size={14} color={DIM} style={{ flexShrink: 0 }} />
              : <ChevronRight size={14} color={DIM} style={{ flexShrink: 0 }} />
            }
          </div>

          {/* Summary */}
          <p style={{ margin: 0, fontSize: 13, color: TEXT, lineHeight: 1.5 }}>
            {activity.summary}
          </p>
        </div>
      </div>

      {/* Expanded metadata panel */}
      {isExpanded && activity.metadata && (
        <div
          style={{
            borderTop: `1px solid ${BORDER}`,
            background: "var(--muted)",
            padding: "12px 14px 14px 62px",
          }}
        >
          <p style={{ margin: "0 0 8px 0", fontSize: 11, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Metadata
          </p>
          <pre
            style={{
              margin: 0,
              fontSize: 11,
              color: MUTED,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            }}
          >
            {JSON.stringify(activity.metadata, null, 2)}
          </pre>
        </div>
      )}
      {isExpanded && !activity.metadata && (
        <div
          style={{
            borderTop: `1px solid ${BORDER}`,
            padding: "10px 14px 10px 62px",
            background: "var(--muted)",
          }}
        >
          <p style={{ margin: 0, fontSize: 11, color: DIM, fontStyle: "italic" }}>No additional metadata.</p>
        </div>
      )}
    </div>
  );
}

function EmptyState({ filter }: { filter: FilterTab }) {
  return (
    <div style={{ textAlign: "center", padding: "64px 24px" }}>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "rgba(99,102,241,0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 16px",
        }}
      >
        <Activity size={24} color={PRIMARY} />
      </div>
      <h3 style={{ margin: "0 0 8px 0", fontSize: 16, fontWeight: 700, color: TEXT }}>No activity found</h3>
      <p style={{ margin: 0, fontSize: 13, color: MUTED }}>
        {filter === "all"
          ? "Agent actions will appear here as your agents work on projects."
          : `No ${filter} activity in the selected time range.`}
      </p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ActivityLogPage() {
  usePageTitle("Activity Log");

  const [range, setRange] = useState("7d");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [justUpdated, setJustUpdated] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const justUpdatedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const PAGE_SIZE = 50;

  const { data, isLoading, refetch, isFetching } = useQuery<ActivityData>({
    queryKey: ["activity", range, agentFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams({ range, page: String(page), limit: String(PAGE_SIZE) });
      if (agentFilter) params.set("agent", agentFilter);
      const res = await fetch(`/api/activity?${params}`);
      const json = await res.json();
      return json.data;
    },
    staleTime: 30_000,
  });

  // Auto-refresh every 30 seconds
  const doRefresh = useCallback(() => {
    refetch().then(() => {
      setLastRefreshed(new Date());
      setJustUpdated(true);
      if (justUpdatedTimerRef.current) clearTimeout(justUpdatedTimerRef.current);
      justUpdatedTimerRef.current = setTimeout(() => setJustUpdated(false), 3000);
    });
  }, [refetch]);

  useEffect(() => {
    refreshTimerRef.current = setInterval(doRefresh, 30_000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
      if (justUpdatedTimerRef.current) clearTimeout(justUpdatedTimerRef.current);
    };
  }, [doRefresh]);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [range, agentFilter, typeFilter, search]);

  const activities = data?.activities || [];
  const stats = data?.stats;
  const agents = data?.agents || [];
  const digest = data?.digest;
  const total = data?.total || 0;

  // Client-side filter by type tab and search
  const filtered = activities.filter((a) => {
    const matchesType = typeFilter === "all" || resolveFilterGroup(a.type) === typeFilter;
    const matchesSearch =
      !search.trim() ||
      a.summary.toLowerCase().includes(search.toLowerCase()) ||
      a.agentName.toLowerCase().includes(search.toLowerCase()) ||
      a.type.toLowerCase().includes(search.toLowerCase());
    return matchesType && matchesSearch;
  });

  // Group by date+hour
  const grouped: Record<string, AgentActivity[]> = {};
  filtered.forEach((a) => {
    const d = new Date(a.createdAt);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const isToday = d.toDateString() === today.toDateString();
    const isYesterday = d.toDateString() === yesterday.toDateString();
    const dayLabel = isToday ? "Today" : isYesterday ? "Yesterday" : formatDate(a.createdAt);
    const hour = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const key = `${dayLabel} · ${hour}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(a);
  });

  const hasMore = page * PAGE_SIZE < total;

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.85); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div style={{ minHeight: "100vh", color: TEXT, fontFamily: "system-ui, -apple-system, sans-serif" }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
                <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: TEXT }}>Agent Activity</h1>
                <LiveDot />
              </div>
              <p style={{ margin: 0, fontSize: 13, color: MUTED }}>
                Real-time activity feed across all agents
                {justUpdated && (
                  <span
                    style={{ marginLeft: 10, color: "#34D399", fontWeight: 600, animation: "fadeIn 0.3s ease" }}
                  >
                    · Updated just now
                  </span>
                )}
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {/* Agent selector */}
              <select
                value={agentFilter || ""}
                onChange={(e) => setAgentFilter(e.target.value || null)}
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  color: TEXT,
                  padding: "7px 10px",
                  borderRadius: 7,
                  fontSize: 13,
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                <option value="">All Agents</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>

              {/* Manual refresh */}
              <button
                onClick={doRefresh}
                disabled={isFetching}
                title="Refresh now"
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  color: MUTED,
                  padding: "7px 9px",
                  borderRadius: 7,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  opacity: isFetching ? 0.5 : 1,
                  transition: "opacity 0.2s",
                }}
              >
                <RefreshCw size={15} style={{ animation: isFetching ? "spin 1s linear infinite" : "none" }} />
              </button>

              {/* Export as CSV */}
              <button
                onClick={() => {
                  if (!filtered.length) return;
                  const rows = [
                    ["Time", "Agent", "Type", "Summary"],
                    ...filtered.map(a => [
                      new Date(a.createdAt).toISOString(),
                      a.agentName,
                      a.type,
                      `"${(a.summary || "").replace(/"/g, '""')}"`,
                    ])
                  ];
                  const csv = rows.map(r => r.join(",")).join("\n");
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `activity-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                title="Export as CSV"
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  color: filtered.length ? MUTED : DIM,
                  padding: "7px 13px",
                  borderRadius: 7,
                  cursor: filtered.length ? "pointer" : "not-allowed",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  opacity: filtered.length ? 1 : 0.55,
                  transition: "opacity 0.2s",
                }}
              >
                <Download size={14} /> Export
              </button>
            </div>
          </div>
        </div>

        {/* ── Stats row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 24 }}>
          <StatCard label="Total Actions" value={stats?.totalActions ?? 0} />
          <StatCard label="Documents" value={stats?.documents ?? 0} valueColor={PRIMARY} />
          <StatCard label="Decisions" value={stats?.decisions ?? 0} valueColor="#34D399" />
          <StatCard label="Risks Flagged" value={stats?.risks ?? 0} valueColor="#EF4444" />
          <StatCard label="Meetings" value={stats?.meetings ?? 0} valueColor="#22D3EE" />
        </div>

        {/* ── Filters row ── */}
        <div
          style={{
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            padding: "14px 16px",
            marginBottom: 20,
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {/* Date range tabs */}
          <div style={{ display: "flex", gap: 2, background: SURFACE, borderRadius: 7, padding: 3 }}>
            {[
              { id: "today", label: "Today" },
              { id: "7d", label: "7 Days" },
              { id: "30d", label: "30 Days" },
            ].map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 5,
                  border: "none",
                  background: range === r.id ? PRIMARY : "transparent",
                  color: range === r.id ? "#fff" : MUTED,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "background 0.15s, color 0.15s",
                }}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 24, background: BORDER }} />

          {/* Type filter tabs */}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {FILTER_TABS.map((tab) => {
              const isActive = typeFilter === tab.id;
              const cfg = tab.id === "all" ? null : (TYPE_CONFIG[tab.id] || FALLBACK_TYPE);
              return (
                <button
                  key={tab.id}
                  onClick={() => setTypeFilter(tab.id)}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 6,
                    border: `1px solid ${isActive ? (cfg?.color || PRIMARY) : "transparent"}`,
                    background: isActive ? (cfg ? cfg.bgColor : "rgba(99,102,241,0.15)") : "transparent",
                    color: isActive ? (cfg?.color || PRIMARY) : MUTED,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  {cfg && <cfg.Icon size={12} />}
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 24, background: BORDER }} />

          {/* Search */}
          <div style={{ display: "flex", alignItems: "center", gap: 7, flex: 1, minWidth: 180 }}>
            <Search size={14} color={DIM} />
            <input
              type="text"
              placeholder="Search activity…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                color: TEXT,
                fontSize: 13,
                flex: 1,
                minWidth: 0,
              }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{ background: "none", border: "none", color: DIM, cursor: "pointer", fontSize: 14, padding: 0, lineHeight: 1 }}
              >
                ×
              </button>
            )}
          </div>

          {/* Result count */}
          <span style={{ fontSize: 12, color: DIM, flexShrink: 0, marginLeft: "auto" }}>
            {filtered.length} of {total} actions
          </span>
        </div>

        {/* ── Main layout ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 20, alignItems: "start" }}>

          {/* Left: Timeline */}
          <div>
            {isLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    style={{
                      height: 72,
                      borderRadius: 8,
                      background: CARD,
                      border: `1px solid ${BORDER}`,
                      animation: "pulse 1.5s ease-in-out infinite",
                    }}
                  />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10 }}>
                <EmptyState filter={typeFilter} />
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {Object.entries(grouped).map(([groupKey, items]) => (
                  <div key={groupKey} style={{ marginBottom: 20 }}>
                    {/* Group label */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <Clock size={13} color={DIM} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: DIM, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        {groupKey} &mdash; {items.length} action{items.length !== 1 ? "s" : ""}
                      </span>
                      <div style={{ flex: 1, height: 1, background: BORDER }} />
                    </div>

                    {/* Items with timeline line */}
                    <div
                      style={{
                        paddingLeft: 12,
                        borderLeft: `2px solid ${BORDER}`,
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      {items.map((a) => (
                        <ActivityItem
                          key={a.id}
                          activity={a}
                          isExpanded={expandedId === a.id}
                          onToggle={() => setExpandedId(expandedId === a.id ? null : a.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}

                {/* Load more */}
                {hasMore && !search && typeFilter === "all" && (
                  <div style={{ textAlign: "center", paddingTop: 8 }}>
                    <button
                      onClick={() => setPage((p) => p + 1)}
                      style={{
                        background: CARD,
                        border: `1px solid ${BORDER}`,
                        color: MUTED,
                        padding: "9px 24px",
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "border-color 0.15s, color 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.borderColor = PRIMARY;
                        (e.currentTarget as HTMLButtonElement).style.color = TEXT;
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.borderColor = BORDER;
                        (e.currentTarget as HTMLButtonElement).style.color = MUTED;
                      }}
                    >
                      Load more
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: Digest + Agent breakdown */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Daily Digest */}
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: "14px 16px 10px", borderBottom: `1px solid ${BORDER}` }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Daily Digest
                </span>
              </div>
              <div style={{ padding: "14px 16px" }}>
                {digest ? (
                  <>
                    <p style={{ margin: "0 0 12px 0", fontSize: 13, color: TEXT, lineHeight: 1.6 }}>
                      {digest.summary}
                    </p>
                    {Array.isArray(digest.highlights) && digest.highlights.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {digest.highlights.map((h, i) => (
                          <div key={i} style={{ display: "flex", gap: 8, fontSize: 12 }}>
                            <span style={{ color: PRIMARY, marginTop: 2 }}>•</span>
                            <span style={{ color: MUTED, lineHeight: 1.5 }}>{h}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ textAlign: "center", padding: "20px 0" }}>
                    <Bot size={28} color={DIM} style={{ display: "block", margin: "0 auto 10px" }} />
                    <p style={{ margin: "0 0 12px 0", fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
                      No digest for today yet. Digests are generated at end of day.
                    </p>
                    <Link href="/agents/chat">
                      <button
                        style={{
                          background: "transparent",
                          border: `1px solid ${BORDER}`,
                          color: TEXT,
                          padding: "7px 14px",
                          borderRadius: 7,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <MessageSquare size={13} /> Open Chat
                      </button>
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* Agent Breakdown */}
            {agents.length > 0 && (
              <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, overflow: "hidden" }}>
                <div style={{ padding: "14px 16px 10px", borderBottom: `1px solid ${BORDER}` }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Agent Breakdown
                  </span>
                </div>
                <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {agents.map((ag) => {
                    const count = activities.filter((a) => a.agentId === ag.id).length;
                    const pct = total > 0 ? Math.round((count / (activities.length || 1)) * 100) : 0;
                    const color = agentColor(ag.gradient);
                    return (
                      <div key={ag.id}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <div
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: "50%",
                                background: color,
                                flexShrink: 0,
                              }}
                            />
                            <span style={{ fontSize: 12, color: TEXT, fontWeight: 600 }}>{ag.name}</span>
                          </div>
                          <span style={{ fontSize: 12, color: MUTED, fontWeight: 600 }}>{count}</span>
                        </div>
                        <div style={{ height: 4, background: BORDER, borderRadius: 2, overflow: "hidden" }}>
                          <div
                            style={{
                              height: "100%",
                              width: `${pct}%`,
                              background: color,
                              borderRadius: 2,
                              transition: "width 0.4s ease",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Refresh indicator */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 4px" }}>
              <Wifi size={11} color={DIM} />
              <span style={{ fontSize: 11, color: DIM }}>
                Auto-refreshes every 30s · Last: {timeAgo(lastRefreshed)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
