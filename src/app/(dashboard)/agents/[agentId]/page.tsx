"use client";

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAgent, useAgentArtefacts, useUpdateArtefact, useApprovals, useAgentKnowledge, useDeleteKnowledgeItem, useIngest, useAgentMetrics } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { PMProgressTracker } from "@/components/agents/PMProgressTracker";
import { usePMTasks } from "@/hooks/use-api";
import { SpreadsheetViewer } from "@/components/documents/SpreadsheetViewer";
import { isSpreadsheetArtefact } from "@/lib/artefact-types";
import { marked } from "marked";

/** Convert markdown to HTML for TipTap editor — uses proper parser */
function mdToHtml(md: string): string {
  try {
    return marked.parse(md, { gfm: true, breaks: true }) as string;
  } catch {
    return md.replace(/\n/g, "<br>");
  }
}
import {
  Pause, RefreshCw, MessageSquare, Settings, TrendingUp, FileText,
  Activity, Brain, Sliders, ChevronRight, Mail, Copy, CheckCircle2, Shield,
  BookOpen, Upload, Link as LinkIcon, FileAudio, Trash2 as TrashIcon, Star, X,
  Video, Mic, MicOff, Calendar, ExternalLink, Download,
  ListChecks, FileEdit, Zap, BarChart3 as BarChartIcon,
} from "lucide-react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// Config tab
const AUTONOMY_LEVELS = [
  { level: 1, name: "Advisor", desc: "Agent works, everything goes to your approval queue" },
  { level: 2, name: "Co-pilot", desc: "Handles routine tasks, risks, and resources — documents need approval" },
  { level: 3, name: "Autonomous", desc: "Full autonomy within governance bounds — runs the project end-to-end" },
];

const NOTIFICATION_PREFS = [
  { label: "Phase gate approvals", enabled: true },
  { label: "Risk escalations", enabled: true },
  { label: "Budget threshold alerts", enabled: true },
  { label: "Daily summary reports", enabled: true },
  { label: "Document generation complete", enabled: false },
  { label: "Meeting transcript processed", enabled: false },
];

const METHOD_LABEL: Record<string, string> = {
  PRINCE2: "Traditional", prince2: "Traditional", WATERFALL: "Waterfall", waterfall: "Waterfall",
  AGILE_SCRUM: "Scrum", scrum: "Scrum", AGILE_KANBAN: "Kanban", kanban: "Kanban",
  HYBRID: "Hybrid", hybrid: "Hybrid", SAFE: "SAFe", safe: "SAFe",
};

const INTEGRATIONS = [
  { name: "Jira", status: "disconnected", icon: "🔗" },
  { name: "Slack", status: "disconnected", icon: "💬" },
  { name: "MS Teams", status: "disconnected", icon: "📺" },
  { name: "Confluence", status: "disconnected", icon: "📝" },
  { name: "GitHub", status: "disconnected", icon: "🐙" },
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

export default function AgentProfilePage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = React.use(params);
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") || "overview";
  const { data: apiAgent, isLoading } = useAgent(agentId);

  const projectId = apiAgent?.deployments?.[0]?.projectId || null;
  const { data: pmTasks } = usePMTasks(projectId);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  // Initialise from real agent data once loaded (not hardcoded defaults)
  const [configAutonomy, setConfigAutonomy] = useState(3);
  const [personality, setPersonality] = useState(50);
  const [notifs, setNotifs] = useState(NOTIFICATION_PREFS.map((n) => n.enabled));
  const [activityFilter, setActivityFilter] = useState<string | null>(null);

  // Sync Configuration tab state from real API data when it arrives
  const [configSynced, setConfigSynced] = useState(false);
  React.useEffect(() => {
    if (apiAgent && !configSynced) {
      if (apiAgent.autonomyLevel) setConfigAutonomy(apiAgent.autonomyLevel);
      const p = apiAgent.personality as any;
      if (p) {
        const formalityVal = p.formalityLevel ?? p.formal ?? 50;
        setPersonality(formalityVal);
      }
      setConfigSynced(true);
    }
  }, [apiAgent, configSynced]);

  // ── Knowledge tab state ──
  const [kbMode, setKbMode] = useState<"transcript" | "document" | "url" | "audio">("transcript");
  const [kbTitle, setKbTitle] = useState("");
  const [kbContent, setKbContent] = useState("");
  const [kbUrl, setKbUrl] = useState("");
  const [kbDragOver, setKbDragOver] = useState(false);
  const [kbAudioFile, setKbAudioFile] = useState<File | null>(null);
  const { data: knowledgeItems, isLoading: kbLoading } = useAgentKnowledge(agentId);
  const deleteKb = useDeleteKnowledgeItem(agentId);
  const ingest = useIngest(agentId);
  // Declared here (before resolvedStats useMemo) to avoid "used before declaration" TS error
  const { data: agentArtefactsData, isLoading: artefactsLoading } = useAgentArtefacts(agentId);

  const handleKbSubmit = useCallback(async () => {
    if (!agentId) return;
    const title = kbTitle.trim() || (kbMode === "url" ? kbUrl : kbMode === "audio" ? (kbAudioFile?.name.replace(/\.[^.]+$/, "") || "Recording") : kbMode === "transcript" ? "Meeting transcript" : "Document");
    try {
      if (kbMode === "audio" && kbAudioFile) {
        const form = new FormData();
        form.append("file", kbAudioFile);
        form.append("type", "transcript");
        form.append("title", title);
        await ingest.mutateAsync(form as any);
        toast.success(`Transcribed & ingested "${title}"`);
        setKbAudioFile(null);
      } else {
        await ingest.mutateAsync(
          kbMode === "url"
            ? { type: "url", title, sourceUrl: kbUrl }
            : { type: kbMode, title, content: kbContent }
        );
        toast.success(`Ingested "${title}"`);
      }
      setKbTitle(""); setKbContent(""); setKbUrl("");
    } catch (e: any) {
      toast.error(e.message || "Ingest failed");
    }
  }, [agentId, kbMode, kbTitle, kbContent, kbUrl, kbAudioFile, ingest]);

  const handleKbFileDrop = useCallback(async (e: React.DragEvent | React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    setKbDragOver(false);
    const files = "dataTransfer" in e ? e.dataTransfer.files : (e.target as HTMLInputElement).files;
    if (!files?.length || !agentId) return;
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      form.append("type", file.name.toLowerCase().includes("transcript") ? "transcript" : "document");
      form.append("title", file.name.replace(/\.[^.]+$/, ""));
      try {
        await ingest.mutateAsync(form as any);
        toast.success(`Ingested "${file.name}"`);
      } catch (e: any) {
        toast.error(`Failed: ${file.name} — ${e.message}`);
      }
    }
  }, [agentId, ingest]);

  // ── Delete / Decommission modal state ──
  const [deleteModal, setDeleteModal] = useState<"decommission" | "purge" | null>(null);
  const [deleteProject, setDeleteProject] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Defaults used when API data is absent
  const AGENT_DEFAULTS = {
    id: agentId,
    codename: "",
    name: "Agent",
    initials: "A",
    gradient: "linear-gradient(135deg, #6366F1, #8B5CF6)",
    color: "#6366F1",
    project: "",
    methodology: "",
    status: "active" as const,
    autonomyLevel: 2,
    autonomyLabel: "Co-pilot",
    performanceScore: 0,
    deployedDate: "",
    uptimeDays: 0,
    currentTask: "",
  };

  // Merge real API data over the defaults
  const AGENT_RESOLVED = useMemo(() => {
    if (!apiAgent) return AGENT_DEFAULTS;
    const project = apiAgent.deployments?.[0]?.project;
    return {
      ...AGENT_DEFAULTS,
      id: apiAgent.id,
      name: apiAgent.name || AGENT_DEFAULTS.name,
      codename: apiAgent.codename || AGENT_DEFAULTS.codename,
      initials: (apiAgent.name || AGENT_DEFAULTS.name)[0].toUpperCase(),
      gradient: apiAgent.gradient || AGENT_DEFAULTS.gradient,
      color: apiAgent.gradient ? "#6366F1" : AGENT_DEFAULTS.color,
      project: project?.name || "No project assigned",
      methodology: project?.methodology || "",
      status: (apiAgent.status?.toLowerCase() || AGENT_DEFAULTS.status) as "active" | "paused" | "idle" | "error",
      autonomyLevel: apiAgent.autonomyLevel || AGENT_DEFAULTS.autonomyLevel,
      autonomyLabel: ["", "Advisor", "Co-pilot", "Autonomous"][apiAgent.autonomyLevel || AGENT_DEFAULTS.autonomyLevel],
      performanceScore: apiAgent.performanceScore || 0,
      currentTask: (() => {
        const dep = apiAgent.deployments?.find((d: any) => d.isActive) || apiAgent.deployments?.[0];
        const phase = dep?.currentPhase;
        const status = dep?.phaseStatus;
        if (status === "researching") return `Researching project context for ${phase || "first"} phase`;
        if (status === "awaiting_clarification") return `Awaiting your review — assumptions presented for ${phase || "current"} phase`;
        // Use latest non-stale activity (within last 24h)
        const latestActivity = apiAgent.activities?.[0];
        if (latestActivity) {
          const age = Date.now() - new Date(latestActivity.createdAt).getTime();
          if (age < 24 * 60 * 60 * 1000) return latestActivity.summary;
        }
        if (phase) return `Monitoring ${phase} phase — watching tasks, risks, and deadlines`;
        return "";
      })(),
      deployedDate: apiAgent.createdAt ? new Date(apiAgent.createdAt).toISOString().split("T")[0] : "",
      uptimeDays: apiAgent.createdAt ? Math.floor((Date.now() - new Date(apiAgent.createdAt).getTime()) / 86400000) : 0,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiAgent]);

  // Derive real stats from API data
  const resolvedStats = useMemo(() => {
    const counts = apiAgent?._count || { activities: 0, decisions: 0, chatMessages: 0 };
    const creditsUsed = apiAgent?.creditsUsed || 0;
    const actionCount = apiAgent?.actionCount || 0;
    // artefactCount comes from the API (cross-scoped by agentId + projectId)
    // Use Math.max so that a 0 from the API doesn't mask a real count from the artefacts list
    const apiCount = apiAgent?.artefactCount ?? 0;
    const dataCount = Array.isArray(agentArtefactsData) ? agentArtefactsData.length : 0;
    const docCount = Math.max(apiCount, dataCount);
    return [
      { label: "Tasks Completed", value: String(actionCount), Icon: ListChecks, color: "#6366F1", sub: undefined as string | undefined },
      { label: "Documents Generated", value: String(docCount), Icon: FileEdit, color: "#22D3EE", sub: undefined as string | undefined },
      { label: "Decisions Made", value: String(counts.decisions), Icon: CheckCircle2, color: "#10B981", sub: undefined as string | undefined },
      { label: "Chat Messages", value: String(counts.chatMessages), Icon: MessageSquare, color: "#F59E0B", sub: undefined as string | undefined },
      { label: "Activities Logged", value: String(counts.activities), Icon: BarChartIcon, color: "#EF4444", sub: undefined as string | undefined },
      { label: "Credits Consumed", value: creditsUsed.toLocaleString(), Icon: Zap, color: "#8B5CF6", sub: undefined as string | undefined },
    ];
  }, [apiAgent, agentArtefactsData]);

  // Derive activity timeline from real data
  const resolvedActivityEvents = useMemo(() => {
    const activities = (apiAgent?.activities || []).filter(
      // Suppress VPS-generated noise that fires on every cycle for brand-new projects
      (a: any) => a.type !== "comms_reminder"
    );
    if (activities.length === 0) return [];
    // Group by date
    const grouped: Record<string, { time: string; type: string; msg: string }[]> = {};
    for (const a of activities) {
      const d = new Date(a.createdAt);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      let dateLabel: string;
      if (d.toDateString() === today.toDateString()) dateLabel = "Today";
      else if (d.toDateString() === yesterday.toDateString()) dateLabel = "Yesterday";
      else dateLabel = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      if (!grouped[dateLabel]) grouped[dateLabel] = [];
      grouped[dateLabel].push({
        time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
        type: a.type || "System",
        msg: a.summary,
      });
    }
    return Object.entries(grouped).map(([date, items]) => ({ date, items }));
  }, [apiAgent]);

  // Derive decisions from real data
  const resolvedDecisions = useMemo(() => {
    return (apiAgent?.decisions || []).map((d: any, i: number) => ({
      id: `D-${String(i + 1).padStart(3, "0")}`,
      desc: d.description,
      rationale: d.reasoning,
      confidence: Math.round((d.confidence || 0) * 100),
      outcome: d.status === "APPROVED" ? "Approved" : d.status === "IMPLEMENTED" ? "Implemented" : d.status === "REJECTED" ? "Rejected" : "Pending",
    }));
  }, [apiAgent]);

  const { data: pendingApprovals } = useApprovals("PENDING");
  const { data: agentMetrics } = useAgentMetrics(agentId);
  const updateArtefact = useUpdateArtefact();
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  // Agent-specific pending approvals — deduplicated by id in case same approval
  // appears via both agentId and projectId paths
  const agentPendingApprovals = useMemo(() => {
    if (!pendingApprovals || !Array.isArray(pendingApprovals)) return [];
    const seen = new Set<string>();
    return pendingApprovals.filter((a: any) => {
      if (!(a.agentId === agentId || a.projectId === projectId)) return false;
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
  }, [pendingApprovals, agentId, projectId]);

  const recentArtefactsReal = useMemo(() => {
    if (!agentArtefactsData || !Array.isArray(agentArtefactsData)) return [];
    return agentArtefactsData.slice(0, 5);
  }, [agentArtefactsData]);

  if (isLoading) return <div className="space-y-4 max-w-[1400px] mx-auto"><Skeleton className="h-6 w-48" /><Skeleton className="h-28 rounded-xl" /><div className="grid grid-cols-6 gap-3">{[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div></div>;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      {/* ═══ BREADCRUMB ═══ */}
      <div className="flex items-center gap-1.5 text-xs">
        <Link href="/agents" className="cursor-pointer text-primary hover:underline">
          Agent Fleet
        </Link>
        <ChevronRight className="size-3 text-muted-foreground" />
        <span className="font-semibold text-foreground">{AGENT_RESOLVED.name}</span>
      </div>

      {/* ═══ 1. AGENT HEADER BANNER ═══ */}
      <div
        className="relative overflow-hidden rounded-2xl border border-border/40"
        style={{ background: "var(--card)" }}
      >
        {/* Soft gradient accent bar */}
        <div
          className="absolute top-0 left-0 right-0 h-1"
          style={{ background: AGENT_RESOLVED.gradient }}
        />
        {/* Subtle background flourish */}
        <div
          className="absolute top-0 right-0 w-[400px] h-[200px] opacity-[0.06] blur-3xl pointer-events-none"
          style={{ background: AGENT_RESOLVED.gradient }}
        />
        {/* Content */}
        <div className="relative p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {/* Avatar */}
            <div
              className="flex size-16 flex-shrink-0 items-center justify-center rounded-2xl text-2xl font-bold text-white"
              style={{
                background: AGENT_RESOLVED.gradient,
                boxShadow: `0 8px 24px ${AGENT_RESOLVED.color}40, inset 0 -2px 4px rgba(0,0,0,0.15)`,
              }}
            >
              {AGENT_RESOLVED.initials}
            </div>
            {/* Name + metadata */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-2xl font-bold text-foreground tracking-tight">
                  {AGENT_RESOLVED.name}
                </h1>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                  <span className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider">Active</span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">
                  <span className="font-medium text-foreground">{AGENT_RESOLVED.project}</span>
                </span>
                <span className="text-muted-foreground/40">•</span>
                {AGENT_RESOLVED.methodology && (
                  <>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-blue-500/10 text-blue-600 border border-blue-500/20">
                      {METHOD_LABEL[AGENT_RESOLVED.methodology] || AGENT_RESOLVED.methodology}
                    </span>
                  </>
                )}
                <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-violet-500/10 text-violet-600 border border-violet-500/20">
                  L{AGENT_RESOLVED.autonomyLevel} · {AGENT_RESOLVED.autonomyLabel}
                </span>
                {AGENT_RESOLVED.uptimeDays > 0 && (
                  <>
                    <span className="text-muted-foreground/40">•</span>
                    <span className="text-muted-foreground">{AGENT_RESOLVED.uptimeDays}d uptime</span>
                  </>
                )}
              </div>
            </div>
            {/* Actions */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-9 gap-1.5"
                onClick={async () => { try { await fetch(`/api/agents/${agentId}/pause`, { method: "POST" }); toast.success("Agent paused"); } catch { toast.error("Failed to pause agent"); } }}
              >
                <Pause className="size-3.5" /> Pause
              </Button>
              <Link href={`/agents/chat?agent=${agentId}`}>
                <Button size="sm" className="text-xs h-9 gap-1.5 bg-primary hover:bg-primary/90">
                  <MessageSquare className="size-3.5" /> Chat
                </Button>
              </Link>
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-9 gap-1.5"
                onClick={() => { const el = document.querySelector('[value="configuration"]'); if (el) (el as HTMLElement).click(); }}
              >
                <Settings className="size-3.5" /> Configure
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ 2. STATS ROW ═══ */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-6">
        {resolvedStats.map((s) => {
          const StatIcon = s.Icon;
          return (
            <div
              key={s.label}
              className="group relative overflow-hidden rounded-xl border border-border/40 p-4 transition-all hover:border-border/80 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card)" }}
            >
              {/* Subtle gradient accent background */}
              <div
                className="absolute inset-0 opacity-[0.03] transition-opacity group-hover:opacity-[0.06]"
                style={{ background: `linear-gradient(135deg, ${s.color} 0%, transparent 50%)` }}
              />
              {/* Content */}
              <div className="relative">
                <div className="flex items-center justify-between mb-2.5">
                  <div
                    className="flex items-center justify-center w-8 h-8 rounded-lg"
                    style={{ background: `${s.color}15`, color: s.color }}
                  >
                    <StatIcon className="w-4 h-4" />
                  </div>
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  {s.label}
                </p>
                <p className="text-2xl font-bold tracking-tight" style={{ color: s.color }}>
                  {s.value}
                </p>
                {s.sub && (
                  <p className="mt-1 text-[10px] text-muted-foreground">{s.sub}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ═══ 2b. COMMAND CENTRE ═══ */}
      {(agentPendingApprovals.length > 0 || recentArtefactsReal.length > 0 || AGENT_RESOLVED.currentTask) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

          {/* What the agent is doing RIGHT NOW */}
          <div className="lg:col-span-2 rounded-xl border border-border/30 p-5 relative overflow-hidden" style={{ background: "var(--card)" }}>
            <div className="absolute top-0 left-0 w-full h-[2px]" style={{ background: `linear-gradient(90deg, ${AGENT_RESOLVED.color}, transparent)` }} />
            <div className="flex items-center gap-2 mb-3">
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/8 border border-emerald-500/15">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Currently Working On</span>
              </div>
            </div>
            {AGENT_RESOLVED.currentTask ? (
              <p className="text-sm text-foreground leading-relaxed font-medium">{AGENT_RESOLVED.currentTask}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">Monitoring project — no active task.</p>
            )}

            {/* Recent artefacts */}
            {recentArtefactsReal.length > 0 && (
              <div className="mt-4 pt-3 border-t border-border/15">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2.5">Recent Documents</p>
                <div className="space-y-1">
                  {recentArtefactsReal.map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between py-1.5 px-2.5 rounded-lg hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="text-xs text-foreground truncate">{a.name}</span>
                        <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded-full", a.status === "APPROVED" ? "bg-emerald-500/10 text-emerald-600" : a.status === "REJECTED" ? "bg-red-500/10 text-red-500" : "bg-amber-500/10 text-amber-600")}>{a.status}</span>
                      </div>
                      <Link href={`/projects/${projectId}/artefacts`}>
                        <span className="text-[10px] text-primary hover:underline cursor-pointer whitespace-nowrap">Review →</span>
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* HITL — awaiting user response */}
          <div className="rounded-xl border p-5 relative overflow-hidden" style={{
            background: agentPendingApprovals.length > 0 ? "color-mix(in srgb, #F59E0B 4%, var(--card))" : "var(--card)",
            borderColor: agentPendingApprovals.length > 0 ? "#F59E0B33" : "var(--border)",
          }}>
            {agentPendingApprovals.length > 0 && <div className="absolute top-0 left-0 w-full h-[2px] bg-amber-500/60" />}
            <div className="flex items-center gap-2 mb-3">
              {agentPendingApprovals.length > 0 ? (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">Needs Your Decision</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/8 border border-emerald-500/15">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">All Clear</span>
                </div>
              )}
            </div>

            {agentPendingApprovals.length > 0 ? (
              <div className="space-y-2.5">
                {agentPendingApprovals.map((a: any) => (
                  <div key={a.id} className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/15">
                    <p className="text-xs font-semibold text-foreground mb-1">{a.title}</p>
                    <p className="text-[10px] text-muted-foreground mb-2.5 leading-relaxed">{a.description?.slice(0, 100)}{(a.description?.length ?? 0) > 100 ? "…" : ""}</p>
                    <Link href="/approvals">
                      <button className="px-3 py-1.5 rounded-lg text-[10px] font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors shadow-sm">Review & Approve</button>
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground leading-relaxed">Agent is managing everything within its autonomy bounds. You'll be notified when a decision is needed.</p>
            )}
          </div>
        </div>
      )}

      {/* ═══ 3. TABS ═══ */}
      <Tabs defaultValue={initialTab} className="space-y-4">
        <TabsList variant="line">
          <TabsTrigger value="overview" className="text-[13px] font-semibold">
            <Activity className="mr-1 size-3.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="artefacts" className="text-[13px] font-semibold">
            <FileText className="mr-1 size-3.5" /> Artefacts
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
          <TabsTrigger value="inbox" className="text-[13px] font-semibold">
            <Mail className="mr-1 size-3.5" /> Inbox
          </TabsTrigger>
          <TabsTrigger value="meetings" className="text-[13px] font-semibold">
            <Video className="mr-1 size-3.5" /> Meetings
          </TabsTrigger>
          <TabsTrigger value="configuration" className="text-[13px] font-semibold">
            <Sliders className="mr-1 size-3.5" /> Configuration
          </TabsTrigger>
          <TabsTrigger value="knowledge" className="text-[13px] font-semibold">
            <BookOpen className="mr-1 size-3.5" /> Knowledge
          </TabsTrigger>
        </TabsList>

        {/* ─── ARTEFACTS ─── */}
        <TabsContent value="artefacts" className="space-y-4">
          {(() => {
            const artefacts = agentArtefactsData || [];
            const reviewing = artefacts.find((a: any) => a.id === reviewingId);

            const statusColor: Record<string, string> = {
              DRAFT: "border-amber-500/30 bg-amber-500/10 text-amber-600",
              PENDING_REVIEW: "border-blue-500/30 bg-blue-500/10 text-blue-600",
              APPROVED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
              REJECTED: "border-red-500/30 bg-red-500/10 text-red-600",
            };

            if (artefactsLoading) return <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>;

            if (artefacts.length === 0) return (
              <Card className="p-8">
                <div className="text-center">
                  <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                  <h3 className="text-sm font-semibold mb-1">No artefacts generated yet</h3>
                  <p className="text-xs text-muted-foreground">Your agent will generate artefacts (documents, plans, reports) as it progresses through project phases.</p>
                </div>
              </Card>
            );

            // Group by phase name (phaseName resolved by the API via the Phase table)
            const phases: Record<string, any[]> = {};
            artefacts.forEach((a: any) => {
              const phase = a.phaseName || "General";
              if (!phases[phase]) phases[phase] = [];
              phases[phase].push(a);
            });

            return (
              <>
                {/* Summary bar */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span><strong className="text-foreground">{artefacts.length}</strong> artefact(s)</span>
                  <span><strong className="text-amber-500">{artefacts.filter((a: any) => a.status === "DRAFT").length}</strong> draft</span>
                  <span><strong className="text-emerald-500">{artefacts.filter((a: any) => a.status === "APPROVED").length}</strong> approved</span>
                  <span><strong className="text-red-500">{artefacts.filter((a: any) => a.status === "REJECTED").length}</strong> rejected</span>
                </div>

                {/* Artefact cards grouped by phase */}
                {Object.entries(phases).map(([phase, items]) => (
                  <div key={phase}>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">{phase === "General" ? "General" : `${phase} Phase`}</h3>
                    <div className="space-y-2">
                      {items.map((artefact: any) => (
                        <Card key={artefact.id} className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex items-start gap-3 flex-1">
                              <FileText className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-sm font-semibold">{artefact.name}</span>
                                  <Badge variant="secondary" className={statusColor[artefact.status] || ""}>{artefact.status}</Badge>
                                  {(artefact.metadata as any)?.stale && (
                                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-500 text-[9px]">Needs Update</Badge>
                                  )}
                                  <span className="text-[10px] text-muted-foreground">{artefact.format}</span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Generated {new Date(artefact.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                                </p>
                                {artefact.feedback && (
                                  <p className="text-xs text-amber-500 mt-1">Feedback: {artefact.feedback}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <Button variant="outline" size="sm" onClick={() => setReviewingId(artefact.id)}>
                                Review
                              </Button>
                              {artefact.status !== "APPROVED" && (
                                <Button variant="default" size="sm" onClick={() => {
                                  updateArtefact.mutate({ artefactId: artefact.id, status: "APPROVED" });
                                  toast.success(`${artefact.name} approved`);
                                }}>
                                  Approve
                                </Button>
                              )}
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Full-screen document/spreadsheet editor */}
                {reviewing && (
                  isSpreadsheetArtefact(reviewing.name) || reviewing.format === "csv" ? (
                    <SpreadsheetViewer
                      reportId={reviewing.id}
                      title={reviewing.name}
                      content={reviewing.content || ""}
                      status={reviewing.status}
                      projectName={reviewing.phaseId ? `${reviewing.phaseId} Phase` : undefined}
                      onSave={async (content, comment) => {
                        updateArtefact.mutate({ artefactId: reviewing.id, content });
                        toast.success("Spreadsheet saved");
                      }}
                      onApprove={async () => {
                        updateArtefact.mutate({ artefactId: reviewing.id, status: "APPROVED" });
                        toast.success(`${reviewing.name} approved`);
                        setReviewingId(null);
                      }}
                      onReject={async (reason) => {
                        updateArtefact.mutate({ artefactId: reviewing.id, status: "REJECTED", feedback: reason });
                        toast.success("Changes requested");
                        setReviewingId(null);
                      }}
                      onClose={() => setReviewingId(null)}
                    />
                  ) : (
                    <DocumentEditor
                      reportId={reviewing.id}
                      title={reviewing.name}
                      content={mdToHtml(reviewing.content || "")}
                      status={reviewing.status}
                      type={reviewing.format || "markdown"}
                      projectName={reviewing.phaseId ? `${reviewing.phaseId} Phase` : undefined}
                      onSave={async (content, comment) => {
                        updateArtefact.mutate({ artefactId: reviewing.id, content });
                        toast.success("Document saved");
                      }}
                      onApprove={async () => {
                        updateArtefact.mutate({ artefactId: reviewing.id, status: "APPROVED" });
                        toast.success(`${reviewing.name} approved`);
                        setReviewingId(null);
                      }}
                      onReject={async (reason) => {
                        updateArtefact.mutate({ artefactId: reviewing.id, status: "REJECTED", feedback: reason });
                        toast.success("Changes requested");
                        setReviewingId(null);
                      }}
                      onExportPDF={() => window.open(`/api/agents/artefacts/${reviewing.id}/export?format=pdf`, "_blank")}
                      onExportDOCX={() => window.open(`/api/agents/artefacts/${reviewing.id}/export?format=docx`, "_blank")}
                      onClose={() => setReviewingId(null)}
                    />
                  )
                )}
              </>
            );
          })()}
        </TabsContent>

        {/* ─── OVERVIEW ─── */}
        <TabsContent value="overview" className="space-y-4">
          {/* Current status */}
          <Card className="p-4">
            <div className="flex items-start gap-3">
              <div
                className="flex size-10 flex-shrink-0 items-center justify-center rounded-full text-base font-bold text-white"
                style={{
                  background: AGENT_RESOLVED.gradient,
                  boxShadow: `0 0 12px ${AGENT_RESOLVED.color}33`,
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
                  {AGENT_RESOLVED.currentTask || "No active task right now."}
                </p>
              </div>
            </div>
          </Card>

          {/* PM Progress Tracker — agent's overhead tasks as a checklist */}
          {pmTasks && pmTasks.length > 0 && (
            <Card className="p-4">
              <PMProgressTracker tasks={pmTasks} agentColor={AGENT_RESOLVED.color} />
            </Card>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 items-start">
            {/* Recent activity queue */}
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Recent Activity</h3>
              {(() => {
                // Hide noisy background types + dedupe identical summaries within 1h window
                // prediction_alert: hidden until VPS predictive-engine guards land
                // (was logging bogus "180-day slip" on young projects due to snake_case field name bug)
                const HIDDEN_TYPES = new Set(["comms_reminder", "monitoring", "chat", "autonomous_cycle", "system", "prediction_alert"]);
                const raw = (apiAgent?.activities || []) as any[];
                const filtered = raw.filter((a) => !HIDDEN_TYPES.has(a.type));
                const deduped: any[] = [];
                const seen = new Map<string, number>(); // key: summary → index in deduped
                for (const a of filtered) {
                  const key = `${a.type}:${(a.summary || "").trim()}`;
                  const existingIdx = seen.get(key);
                  if (existingIdx !== undefined) {
                    const existing = deduped[existingIdx];
                    const hourAgo = Date.now() - 60 * 60 * 1000;
                    // If both within 1h window, skip the new one (keep most recent already at top)
                    if (new Date(existing.createdAt).getTime() > hourAgo && new Date(a.createdAt).getTime() > hourAgo) {
                      continue;
                    }
                  }
                  seen.set(key, deduped.length);
                  deduped.push(a);
                }
                if (deduped.length === 0) {
                  return <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">No activity recorded yet</div>;
                }
                return <div className="space-y-2">
                  {deduped.slice(0, 5).map((a: any, i: number) => (
                    <div key={i} className="flex items-start gap-2.5 rounded-lg bg-muted/40 px-3 py-2">
                      <div className="mt-1 size-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: AGENT_RESOLVED.color }}>{a.type}</span>
                        <p className="truncate text-xs text-foreground">{a.summary}</p>
                        <p className="text-[10px] text-muted-foreground">{new Date(a.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                      </div>
                    </div>
                  ))}
                </div>;
              })()}
            </Card>

            {/* Recent artefacts */}
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Recent Artefacts</h3>
              {recentArtefactsReal.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">No artefacts generated yet</div>
              ) : (
                <div className="space-y-2">
                  {recentArtefactsReal.map((art: any) => (
                    <div key={art.id} className="flex items-center gap-2.5 rounded-lg border border-border/30 px-3 py-2">
                      <FileText className="size-3.5 flex-shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-foreground">{art.name}</p>
                        <p className="text-[10px] text-muted-foreground">{art.phase || "Draft"}</p>
                      </div>
                      <Badge variant="secondary" className={cn("text-[9px]", art.status === "APPROVED" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" : art.status === "PENDING_REVIEW" ? "border-amber-500/30 bg-amber-500/10 text-amber-600" : "border-border bg-muted text-muted-foreground")}>{art.status?.replace("_", " ") || "DRAFT"}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Credit & performance snapshot */}
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Performance Snapshot</h3>
              <div className="space-y-3">
                {[
                  { label: "Decision Accuracy", value: agentMetrics?.decisionAccuracy ?? 0, suffix: "%" },
                  { label: "Autonomy Utilisation", value: agentMetrics?.autonomyUtilisation ?? 0, suffix: "%" },
                  { label: "Approval Rate", value: agentMetrics?.approvalRate ?? 0, suffix: "%" },
                ].map(({ label, value, suffix }) => (
                  <div key={label}>
                    <div className="mb-1 flex justify-between text-[11px]">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-semibold" style={{ color: AGENT_RESOLVED.color }}>{value}{suffix}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, background: AGENT_RESOLVED.gradient }} />
                    </div>
                  </div>
                ))}
                <div className="mt-3 grid grid-cols-2 gap-2 pt-1">
                  <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
                    <p className="text-[18px] font-bold" style={{ color: AGENT_RESOLVED.color }}>{agentMetrics?.totalActions ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Total Actions</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
                    <p className="text-[18px] font-bold text-amber-500">{agentMetrics?.creditsUsedThisMonth ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Credits This Month</p>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Project phase progress */}
          {(() => {
            const phases = apiAgent?.deployments?.[0]?.project?.phases || [];
            if (phases.length === 0) return (
              <Card className="p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Project Progress</h3>
                <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">No project assigned or phases initialised yet</div>
              </Card>
            );
            const completed = phases.filter((p: any) => p.status === "COMPLETED").length;
            const pct = Math.round((completed / phases.length) * 100);
            return (
              <Card className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">Project Progress</h3>
                  <span className="text-xs font-semibold" style={{ color: AGENT_RESOLVED.color }}>{pct}% complete</span>
                </div>
                <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: AGENT_RESOLVED.gradient }} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {phases.map((p: any, i: number) => (
                    <div key={i} className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px]" style={{ borderColor: p.status === "COMPLETED" ? "#10B981" : p.status === "ACTIVE" ? AGENT_RESOLVED.color : "var(--border)", background: p.status === "COMPLETED" ? "#10B98110" : p.status === "ACTIVE" ? AGENT_RESOLVED.color + "12" : "transparent" }}>
                      <span className={cn("size-1.5 rounded-full", p.status === "COMPLETED" ? "bg-emerald-500" : p.status === "ACTIVE" ? "" : "bg-muted-foreground/30")} style={p.status === "ACTIVE" ? { background: AGENT_RESOLVED.color } : {}} />
                      <span className={p.status === "ACTIVE" ? "font-semibold" : ""}>{p.name}</span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })()}
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

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 items-start">
            {/* Timeline */}
            <div className="lg:col-span-2">
              <Card className="p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Activity Timeline</h3>
                {resolvedActivityEvents.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
                    No activity recorded yet
                  </div>
                ) : resolvedActivityEvents.map((day) => {
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
                              style={{ background: AGENT_RESOLVED.color }}
                            />
                            <div className="flex-1">
                              <span
                                className="mr-2 rounded px-1.5 py-0.5 text-[9px] font-semibold"
                                style={{
                                  background: AGENT_RESOLVED.color + "15",
                                  color: AGENT_RESOLVED.color,
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
                <h3 className="mb-3 text-[13px] font-semibold text-foreground">Activity Heatmap (90 Days)</h3>
                {(() => {
                  const allActivities = (apiAgent?.activities || []) as any[];
                  // Build a map of date → count for the last 90 days
                  const dayCounts: Record<string, number> = {};
                  const now = Date.now();
                  for (const a of allActivities) {
                    const d = new Date(a.createdAt);
                    if (now - d.getTime() > 90 * 86400000) continue;
                    const key = d.toISOString().slice(0, 10);
                    dayCounts[key] = (dayCounts[key] || 0) + 1;
                  }
                  const days: { date: string; count: number }[] = [];
                  for (let i = 89; i >= 0; i--) {
                    const d = new Date(now - i * 86400000);
                    const key = d.toISOString().slice(0, 10);
                    days.push({ date: key, count: dayCounts[key] || 0 });
                  }
                  const maxCount = Math.max(...days.map(d => d.count), 1);
                  // Render as a 13-column × 7-row grid (weeks × days)
                  const weeks: typeof days[] = [];
                  for (let w = 0; w < 13; w++) weeks.push(days.slice(w * 7, w * 7 + 7));
                  const totalEvents = Object.values(dayCounts).reduce((s, c) => s + c, 0);
                  return (
                    <>
                      <div className="flex gap-1 overflow-hidden">
                        {weeks.map((week, wi) => (
                          <div key={wi} className="flex flex-col gap-1">
                            {week.map((day, di) => {
                              const intensity = day.count === 0 ? 0 : Math.max(0.15, day.count / maxCount);
                              return (
                                <div
                                  key={di}
                                  title={`${day.date}: ${day.count} event${day.count !== 1 ? "s" : ""}`}
                                  className="size-3.5 rounded-[2px] transition-all"
                                  style={{ background: day.count === 0 ? "var(--muted)" : AGENT_RESOLVED.color + Math.round(intensity * 255).toString(16).padStart(2, "0") }}
                                />
                              );
                            })}
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-[10px] text-muted-foreground">{totalEvents} events in the last 90 days</p>
                    </>
                  );
                })()}
              </Card>

              <Card className="p-4">
                <h3 className="mb-3 text-[13px] font-semibold text-foreground">Hourly Distribution</h3>
                {(() => {
                  const allActivities = (apiAgent?.activities || []) as any[];
                  const hourCounts = Array.from({ length: 24 }, (_, h) => ({ hour: `${h.toString().padStart(2, "0")}:00`, count: 0 }));
                  for (const a of allActivities) {
                    const h = new Date(a.createdAt).getHours();
                    hourCounts[h].count++;
                  }
                  if (allActivities.length === 0) return <div className="flex items-center justify-center py-8 text-[11px] text-muted-foreground">No activity data yet</div>;
                  return (
                    <ResponsiveContainer width="100%" height={100}>
                      <BarChart data={hourCounts} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
                        <XAxis dataKey="hour" tick={{ fontSize: 8 }} interval={5} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 8 }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: any) => [v, "Events"]} />
                        <Bar dataKey="count" radius={[2, 2, 0, 0]} fill={AGENT_RESOLVED.color} opacity={0.8} />
                      </BarChart>
                    </ResponsiveContainer>
                  );
                })()}
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ─── DECISIONS ─── */}
        <TabsContent value="decisions" className="space-y-4">
          {/* AI autonomy recommendation */}
          {resolvedDecisions.length > 0 && (
            <div
              className="flex items-center gap-3 rounded-xl p-4"
              style={{
                background: AGENT_RESOLVED.color + "08",
                border: `1px solid ${AGENT_RESOLVED.color}22`,
              }}
            >
              <div
                className="flex size-10 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{
                  background: AGENT_RESOLVED.gradient,
                  boxShadow: `0 0 12px ${AGENT_RESOLVED.color}33`,
                }}
              >
                AI
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-semibold" style={{ color: AGENT_RESOLVED.color }}>
                  Autonomy Recommendation
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Agent {AGENT_RESOLVED.name} has made{" "}
                  <strong className="text-emerald-500">{resolvedDecisions.length} decisions</strong>.
                  Current Level {AGENT_RESOLVED.autonomyLevel} ({AGENT_RESOLVED.autonomyLabel}).
                </p>
              </div>
            </div>
          )}

          {/* Decision log */}
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Decision Log</h3>
            {resolvedDecisions.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
                No decisions logged yet
              </div>
            ) : (
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
                    {resolvedDecisions.map((d: any) => (
                      <tr key={d.id} className="border-b border-border/10">
                        <td className="px-3 py-2.5 font-bold" style={{ color: AGENT_RESOLVED.color }}>
                          {d.id}
                        </td>
                        <td className="max-w-[200px] px-3 py-2.5 font-medium">{d.desc}</td>
                        <td className="max-w-[250px] px-3 py-2.5 text-muted-foreground">
                          {d.rationale}
                        </td>
                        <td className="px-3 py-2.5">
                          <ConfidenceBar pct={d.confidence} color={AGENT_RESOLVED.color} />
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
            )}
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Decision quality trend */}
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Decision Quality Trend</h3>
              {(() => {
                const rawDecisions = (apiAgent?.decisions || []) as any[];
                if (rawDecisions.length === 0) return <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">No decisions logged yet</div>;
                const chartData = rawDecisions
                  .slice()
                  .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                  .map((d: any, i: number) => ({
                    idx: i + 1,
                    confidence: Math.round((d.confidence || 0) * 100),
                    label: `D-${String(i + 1).padStart(3, "0")}`,
                  }));
                return (
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                      <defs>
                        <linearGradient id="qualGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={AGENT_RESOLVED.color} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={AGENT_RESOLVED.color} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
                      <XAxis dataKey="label" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} unit="%" />
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: any) => [`${v}%`, "Confidence"]} />
                      <Area type="monotone" dataKey="confidence" stroke={AGENT_RESOLVED.color} fill="url(#qualGrad)" strokeWidth={2} dot={{ r: 3, fill: AGENT_RESOLVED.color }} />
                    </AreaChart>
                  </ResponsiveContainer>
                );
              })()}
            </Card>

            {/* Escalation history */}
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Escalation History</h3>
              {(() => {
                const escalated = (apiAgent?.decisions || []).filter((d: any) =>
                  d.status === "PENDING" || d.status === "DEFERRED" || d.approvalId
                ) as any[];
                if (escalated.length === 0) return <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">No escalations recorded yet — the agent has operated within its autonomy bounds</div>;
                return (
                  <div className="space-y-2">
                    {escalated.slice(0, 6).map((d: any, i: number) => (
                      <div key={i} className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                        <AlertTriangle className="mt-0.5 size-3.5 flex-shrink-0 text-amber-500" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">{d.description}</p>
                          <p className="text-[10px] text-muted-foreground">{new Date(d.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · {d.status}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </Card>
          </div>
        </TabsContent>

        {/* ─── PERFORMANCE ─── */}
        <TabsContent value="performance" className="space-y-4">
          {/* KPI row */}
          {agentMetrics && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Decision Accuracy", value: `${agentMetrics.decisionAccuracy}%`, sub: `${agentMetrics.totalDecisions} decisions` },
                { label: "Approval Rate", value: `${agentMetrics.approvalRate}%`, sub: "HITL approvals" },
                { label: "Autonomy Utilisation", value: `${agentMetrics.autonomyUtilisation}%`, sub: "auto-executed" },
                { label: "Avg Time to Approval", value: `${agentMetrics.avgTimeToApproval}h`, sub: "human review" },
              ].map(({ label, value, sub }) => (
                <Card key={label} className="p-3 text-center">
                  <p className="text-[22px] font-bold" style={{ color: AGENT_RESOLVED.color }}>{value}</p>
                  <p className="text-[11px] font-semibold text-foreground">{label}</p>
                  <p className="text-[10px] text-muted-foreground">{sub}</p>
                </Card>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Radar */}
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Performance Radar</h3>
              {(() => {
                const m = agentMetrics;
                if (!m) return <div className="flex items-center justify-center py-16 text-xs text-muted-foreground">Loading metrics…</div>;
                const radarData = [
                  { axis: "Accuracy", value: m.decisionAccuracy },
                  { axis: "Autonomy", value: m.autonomyUtilisation },
                  { axis: "Approval", value: m.approvalRate },
                  { axis: "Speed", value: Math.max(0, 100 - m.avgTimeToApproval * 5) },
                  { axis: "Activity", value: Math.min(100, m.totalActions * 2) },
                  { axis: "Efficiency", value: Math.min(100, m.creditEfficiency * 20) },
                ];
                return (
                  <ResponsiveContainer width="100%" height={220}>
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="var(--border)" />
                      <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                      <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                      <Radar dataKey="value" stroke={AGENT_RESOLVED.color} fill={AGENT_RESOLVED.color} fillOpacity={0.25} strokeWidth={2} />
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: any) => [`${v}`, "Score"]} />
                    </RadarChart>
                  </ResponsiveContainer>
                );
              })()}
            </Card>

            {/* Efficiency trend + credit chart */}
            <Card className="p-4 space-y-4">
              <div>
                <h3 className="mb-3 text-sm font-semibold text-foreground">Activity Trend (Last 14 Days)</h3>
                {(() => {
                  const allActivities = (apiAgent?.activities || []) as any[];
                  const dayCounts: Record<string, number> = {};
                  const now = Date.now();
                  for (const a of allActivities) {
                    const d = new Date(a.createdAt);
                    if (now - d.getTime() > 14 * 86400000) continue;
                    const key = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
                    dayCounts[key] = (dayCounts[key] || 0) + 1;
                  }
                  const chartData = Array.from({ length: 14 }, (_, i) => {
                    const d = new Date(now - (13 - i) * 86400000);
                    const key = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
                    return { day: key, count: dayCounts[key] || 0 };
                  });
                  if (allActivities.length === 0) return <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">No activity data yet</div>;
                  return (
                    <ResponsiveContainer width="100%" height={100}>
                      <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                        <defs>
                          <linearGradient id="actGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={AGENT_RESOLVED.color} stopOpacity={0.3} />
                            <stop offset="95%" stopColor={AGENT_RESOLVED.color} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.4} />
                        <XAxis dataKey="day" tick={{ fontSize: 8 }} tickLine={false} axisLine={false} interval={3} />
                        <YAxis tick={{ fontSize: 8 }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v: any) => [v, "Actions"]} />
                        <Area type="monotone" dataKey="count" stroke={AGENT_RESOLVED.color} fill="url(#actGrad)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  );
                })()}
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-foreground">Credit Usage Summary</h3>
                {agentMetrics ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Used this month</span>
                      <span className="font-bold text-amber-500">{agentMetrics.creditsUsedThisMonth}</span>
                    </div>
                    {agentMetrics.monthlyBudget && (
                      <>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.min(100, (agentMetrics.creditsUsedThisMonth / agentMetrics.monthlyBudget) * 100)}%` }} />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>Monthly budget: {agentMetrics.monthlyBudget}</span>
                          <span>{Math.round((agentMetrics.creditsUsedThisMonth / agentMetrics.monthlyBudget) * 100)}% used</span>
                        </div>
                      </>
                    )}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Efficiency</span>
                      <span className="font-bold" style={{ color: AGENT_RESOLVED.color }}>{agentMetrics.creditEfficiency} actions/credit</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">Loading…</div>
                )}
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* ─── INBOX ─── */}
        <TabsContent value="inbox" className="space-y-4">
          <AgentInboxTab agentId={AGENT_RESOLVED.id} agentColor={AGENT_RESOLVED.color} />
        </TabsContent>

        {/* ─── MEETINGS ─── */}
        <TabsContent value="meetings" className="space-y-4">
          <AgentMeetingsTab agentId={AGENT_RESOLVED.id} agentName={AGENT_RESOLVED.name} agentColor={AGENT_RESOLVED.color} />
        </TabsContent>

        {/* ─── CONFIGURATION ─── */}
        <TabsContent value="configuration" className="space-y-4">
          {/* Agent Identity — Editable */}
          <Card className="p-4">
            <h3 className="mb-4 text-sm font-semibold text-foreground">Agent Identity</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Agent Name</label>
                <input className="w-full mt-1 px-3 py-2 rounded-lg text-sm bg-background border border-input"
                  defaultValue={AGENT_RESOLVED.name}
                  id="agent-name-input" />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Codename</label>
                <input className="w-full mt-1 px-3 py-2 rounded-lg text-sm bg-background border border-input text-muted-foreground"
                  defaultValue={AGENT_RESOLVED.codename || `${AGENT_RESOLVED.name.toUpperCase()}-${Math.floor(Date.now() % 100)}`}
                  disabled />
              </div>
              <div className="md:col-span-2">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Avatar Gradient</label>
                <div className="flex gap-3 mt-2">
                  {["linear-gradient(135deg, #6366F1, #8B5CF6)", "linear-gradient(135deg, #22D3EE, #06B6D4)", "linear-gradient(135deg, #10B981, #34D399)", "linear-gradient(135deg, #F97316, #FB923C)", "linear-gradient(135deg, #EC4899, #F472B6)", "linear-gradient(135deg, #8B5CF6, #A78BFA)"].map((g, i) => (
                    <button key={i} className="w-9 h-9 rounded-full transition-all hover:scale-110"
                      style={{ background: g, outline: AGENT_RESOLVED.gradient === g ? "3px solid var(--primary)" : "none", outlineOffset: 3 }}
                      onClick={async () => {
                        try {
                          const res = await fetch(`/api/agents/${AGENT_RESOLVED.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gradient: g }) });
                          if (res.ok) window.location.reload();
                        } catch {}
                      }} />
                  ))}
                </div>
              </div>
            </div>
            <Button variant="default" className="mt-4" onClick={async () => {
              const nameInput = document.getElementById("agent-name-input") as HTMLInputElement;
              if (!nameInput?.value) return;
              try {
                const res = await fetch(`/api/agents/${AGENT_RESOLVED.id}`, {
                  method: "PATCH", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: nameInput.value }),
                });
                if (res.ok) { alert("Agent name updated!"); window.location.reload(); }
                else { const err = await res.json(); alert(err.error || "Failed to update"); }
              } catch { alert("Network error"); }
            }}>Save Identity</Button>
          </Card>

          {/* Agent Email Address */}
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Agent Email Address</h3>
            <p className="text-[11px] text-muted-foreground mb-3">
              Give this agent its own email address. Invite it to meetings, forward project updates, or CC it on correspondence. The agent will extract relevant information and use it to manage projects.
            </p>
            <AgentEmailSection agentId={AGENT_RESOLVED.id} />
          </Card>

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
                          {[1, 2, 3].map((d) => (
                            <div
                              key={d}
                              className="size-2.5 rounded-full"
                              style={{
                                background: d <= al.level ? AGENT_RESOLVED.color : "var(--border)",
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
              <Button variant="default" className="mt-3 w-full" onClick={async () => {
                try {
                  const res = await fetch(`/api/agents/${AGENT_RESOLVED.id}`, {
                    method: "PATCH", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ autonomyLevel: configAutonomy }),
                  });
                  if (res.ok) { alert(`Autonomy updated to Level ${configAutonomy}`); window.location.reload(); }
                  else { const err = await res.json(); alert(err.error || "Failed"); }
                } catch { alert("Network error"); }
              }}>
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
                          background: notifs[i] ? AGENT_RESOLVED.color : "var(--border)",
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
                <Button variant="outline" size="sm" className="mt-3 w-full" onClick={async () => {
                  const prefMap = Object.fromEntries(NOTIFICATION_PREFS.map((n, i) => [n.label.toLowerCase().replace(/\s+/g, "_"), notifs[i]]));
                  try {
                    const res = await fetch(`/api/agents/${AGENT_RESOLVED.id}`, {
                      method: "PATCH", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ notificationPrefs: prefMap }),
                    });
                    if (res.ok) toast.success("Notification preferences saved");
                    else toast.error("Failed to save");
                  } catch { toast.error("Network error"); }
                }}>Save Preferences</Button>
              </Card>

              {/* Notification Channels — email, slack, telegram */}
              <Card className="p-4">
                <h3 className="mb-1 text-sm font-semibold text-foreground">Notification Channels</h3>
                <p className="text-[10px] text-muted-foreground mb-3">Configure where your agent sends notifications. Changes apply immediately.</p>
                <div className="space-y-3">
                  {/* Email */}
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30">
                    <div className="flex items-center gap-2">
                      <span className="text-base">📧</span>
                      <div>
                        <p className="text-xs font-semibold">Email</p>
                        <p className="text-[10px] text-muted-foreground">Sends to all org admin email addresses via Resend</p>
                      </div>
                    </div>
                    <button className="relative h-5 w-9 rounded-full transition-all"
                      onClick={async () => {
                        try {
                          const res = await fetch(`/api/agents/${AGENT_RESOLVED.id}/config`, {
                            method: "PATCH", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ notifEmail: true }),
                          });
                          if (res.ok) toast.success("Email notifications enabled");
                        } catch { toast.error("Failed"); }
                      }}
                      style={{ background: AGENT_RESOLVED.color }}>
                      <div className="absolute top-0.5 size-4 rounded-full bg-white shadow-sm" style={{ left: 18 }} />
                    </button>
                  </div>

                  {/* Slack */}
                  <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-base">💬</span>
                        <div>
                          <p className="text-xs font-semibold">Slack</p>
                          <p className="text-[10px] text-muted-foreground">Posts to a Slack channel via webhook</p>
                        </div>
                      </div>
                    </div>
                    <input type="url" placeholder="https://hooks.slack.com/services/..."
                      className="w-full px-3 py-2 rounded-lg text-xs bg-background border border-input"
                      onBlur={async (e) => {
                        const url = e.target.value.trim();
                        if (!url) return;
                        try {
                          await fetch(`/api/agents/${AGENT_RESOLVED.id}/config`, {
                            method: "PATCH", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ notifSlack: true, slackWebhookUrl: url }),
                          });
                          toast.success("Slack webhook saved");
                        } catch { toast.error("Failed"); }
                      }} />
                  </div>

                  {/* Telegram */}
                  <div className="p-3 rounded-lg bg-muted/30 border border-border/30">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-base">✈️</span>
                        <div>
                          <p className="text-xs font-semibold">Telegram</p>
                          <p className="text-[10px] text-muted-foreground">Sends via Telegram Bot API</p>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="text" placeholder="Bot Token"
                        className="w-full px-3 py-2 rounded-lg text-xs bg-background border border-input" />
                      <input type="text" placeholder="Chat ID"
                        className="w-full px-3 py-2 rounded-lg text-xs bg-background border border-input"
                        onBlur={async (e) => {
                          const chatId = e.target.value.trim();
                          const botToken = (e.target.previousElementSibling as HTMLInputElement)?.value?.trim();
                          if (!chatId || !botToken) return;
                          try {
                            await fetch(`/api/agents/${AGENT_RESOLVED.id}/config`, {
                              method: "PATCH", headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ notifTelegram: true, telegramBotToken: botToken, telegramChatId: chatId }),
                            });
                            toast.success("Telegram saved");
                          } catch { toast.error("Failed"); }
                        }} />
                    </div>
                  </div>
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
                      background: `linear-gradient(to right, ${AGENT_RESOLVED.color} ${personality}%, var(--border) ${personality}%)`,
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
                <Button variant="default" size="sm" className="mt-3 w-full" onClick={async () => {
                  try {
                    const res = await fetch(`/api/agents/${AGENT_RESOLVED.id}`, {
                      method: "PATCH", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ personality: { formal: personality, detail: 50 } }),
                    });
                    if (res.ok) alert("Communication style saved!");
                    else alert("Failed to save");
                  } catch { alert("Network error"); }
                }}>Save Style</Button>
              </Card>

              {/* Integrations */}
              <Card className="p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Integrations</h3>
                {(() => {
                  const depConfig = (apiAgent?.deployments?.[0] as any)?.config || {};
                  const integrations = [
                    { name: "Jira", icon: "🔗", key: "jiraUrl", connectPath: "/settings/integrations" },
                    { name: "Slack", icon: "💬", key: "slackWebhook", connectPath: "/settings/integrations" },
                    { name: "MS Teams", icon: "📺", key: "teamsWebhook", connectPath: "/settings/integrations" },
                    { name: "GitHub", icon: "🐙", key: "githubToken", connectPath: "/settings/integrations" },
                    { name: "Google Calendar", icon: "📅", key: "googleCalendar", connectPath: "/settings/integrations" },
                  ].map(i => ({ ...i, connected: !!depConfig[i.key] }));
                  const connected = integrations.filter(i => i.connected);
                  const disconnected = integrations.filter(i => !i.connected);
                  return (
                    <div className="space-y-2">
                      {connected.map(int => (
                        <div key={int.name} className="flex items-center justify-between py-1.5">
                          <div className="flex items-center gap-2"><span className="text-sm">{int.icon}</span><span className="text-xs font-medium text-foreground">{int.name}</span></div>
                          <Badge variant="secondary" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">Connected</Badge>
                        </div>
                      ))}
                      {disconnected.map(int => (
                        <div key={int.name} className="flex items-center justify-between py-1.5 opacity-60">
                          <div className="flex items-center gap-2"><span className="text-sm">{int.icon}</span><span className="text-xs font-medium text-foreground">{int.name}</span></div>
                          <a href={int.connectPath} className="text-[10px] text-primary hover:underline">Connect →</a>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </Card>
            </div>
          </div>

          {/* Credit limits + Reporting */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Credit & Budget</h3>
              <div className="space-y-3">
                {agentMetrics?.monthlyBudget ? (
                  <>
                    <LimitRow label="Monthly budget" value={agentMetrics.monthlyBudget.toLocaleString()} unit="credits" />
                    <LimitRow label="Used this month" value={agentMetrics.creditsUsedThisMonth.toLocaleString()} unit="credits" />
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, (agentMetrics.creditsUsedThisMonth / agentMetrics.monthlyBudget) * 100)}%`, background: AGENT_RESOLVED.gradient }} />
                    </div>
                    <p className="text-[10px] text-muted-foreground text-right">{Math.round((agentMetrics.creditsUsedThisMonth / agentMetrics.monthlyBudget) * 100)}% of monthly budget used</p>
                  </>
                ) : (
                  <>
                    <LimitRow label="Used this month" value={String(agentMetrics?.creditsUsedThisMonth ?? 0)} unit="credits" />
                    <LimitRow label="Total credits used" value={String(apiAgent?.creditsUsed ?? 0)} unit="credits" />
                    <LimitRow label="HITL budget threshold" value={`£${((apiAgent?.deployments?.[0] as any)?.config?.hitlBudgetThreshold || (apiAgent?.deployments?.[0] as any)?.config?.hitleBudgetThreshold || "500").toLocaleString()}`} unit="" />
                    <p className="text-[10px] text-muted-foreground">No monthly budget cap set. Set one in agent configuration.</p>
                  </>
                )}
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Governance Settings</h3>
              <div className="space-y-2">
                {(() => {
                  const cfg = (apiAgent?.deployments?.[0] as any)?.config || {};
                  return [
                    { label: "Phase gate approvals", value: cfg.hitlPhaseGates !== false ? "Required" : "Disabled", enabled: cfg.hitlPhaseGates !== false },
                    { label: "Budget threshold", value: cfg.hitlBudgetThreshold ? `£${Number(cfg.hitlBudgetThreshold).toLocaleString()}` : cfg.hitleBudgetThreshold ? `£${Number(cfg.hitleBudgetThreshold).toLocaleString()}` : "£500", enabled: true },
                    { label: "Risk escalation level", value: cfg.hitlRiskThreshold || "high", enabled: true },
                    { label: "External comms approval", value: "Always required", enabled: true },
                  ].map((r) => (
                    <div key={r.label} className="flex items-center justify-between py-1.5">
                      <div>
                        <span className="text-xs font-medium text-foreground">{r.label}</span>
                        <p className="text-[10px] text-muted-foreground/60">{r.value}</p>
                      </div>
                      <Badge variant="secondary" className={cn(r.enabled ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" : "border-border bg-muted text-muted-foreground")}>
                        {r.enabled ? "Active" : "Off"}
                      </Badge>
                    </div>
                  ));
                })()}
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
                <Button variant="outline" size="sm" className="border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
                  onClick={async () => {
                    if (!confirm("Pause this agent? It will stop all activity.")) return;
                    try {
                      await fetch(`/api/agents/${AGENT_RESOLVED.id}/pause`, { method: "POST" });
                      alert("Agent paused"); window.location.reload();
                    } catch { alert("Failed"); }
                  }}>
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
                  Stops all activity. Agent is archived — data preserved. Can be viewed but not restarted.
                </p>
                <Button variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={() => { setDeleteModal("decommission"); setDeleteConfirmText(""); }}>
                  Decommission
                </Button>
              </div>
              <div className="min-w-[200px] flex-1 rounded-[10px] border border-red-700/30 bg-red-950/20 p-3">
                <p className="mb-1 text-xs font-semibold text-red-500">Delete Agent Permanently</p>
                <p className="mb-2 text-[11px] text-muted-foreground">
                  Purges the agent and all its data — artefacts, history, chat, risks, jobs. Irreversible.
                </p>
                <Button variant="destructive" size="sm"
                  onClick={() => { setDeleteModal("purge"); setDeleteProject(false); setDeleteConfirmText(""); }}>
                  <TrashIcon className="mr-1 size-3" /> Delete Permanently
                </Button>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* ─── KNOWLEDGE ─── */}
        <TabsContent value="knowledge" className="space-y-4">

          {/* Ingest panel */}
          <Card className="p-5">
            <CardHeader className="p-0 mb-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Upload className="size-4 text-primary" /> Teach the agent something new
              </CardTitle>
              <p className="text-[12px] text-muted-foreground mt-1">
                Ingest meeting transcripts, documents, or URLs. Everything ingested is available in every future conversation.
              </p>
            </CardHeader>

            {/* Mode selector */}
            <div className="flex flex-wrap gap-2 mb-4">
              {([
                { key: "transcript", label: "Transcript / Meeting", icon: FileAudio },
                { key: "audio",      label: "Audio / Video",        icon: Mic },
                { key: "document",   label: "Document / Notes",     icon: FileText },
                { key: "url",        label: "URL",                   icon: LinkIcon },
              ] as const).map(({ key, label, icon: Icon }) => (
                <button key={key}
                  onClick={() => setKbMode(key)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-all",
                    kbMode === key
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                  )}>
                  <Icon className="size-3" /> {label}
                </button>
              ))}
            </div>

            {/* Title */}
            <Input
              placeholder={kbMode === "transcript" ? "Meeting title (e.g. Kick-off call — 8 Apr)" : kbMode === "url" ? "Title (optional)" : "Document title"}
              value={kbTitle}
              onChange={e => setKbTitle(e.target.value)}
              className="mb-3 text-[13px]"
            />

            {kbMode === "url" ? (
              <Input
                placeholder="https://..."
                value={kbUrl}
                onChange={e => setKbUrl(e.target.value)}
                className="mb-3 text-[13px]"
              />
            ) : kbMode === "audio" ? (
              <>
                {/* Audio file drop zone */}
                <div
                  onDragOver={e => { e.preventDefault(); setKbDragOver(true); }}
                  onDragLeave={() => setKbDragOver(false)}
                  onDrop={e => {
                    e.preventDefault(); setKbDragOver(false);
                    const f = e.dataTransfer.files[0];
                    if (f) { setKbAudioFile(f); if (!kbTitle) setKbTitle(f.name.replace(/\.[^.]+$/, "")); }
                  }}
                  className={cn(
                    "relative mb-3 rounded-lg border-2 border-dashed p-4 text-center transition-all cursor-pointer",
                    kbDragOver ? "border-primary bg-primary/5" : kbAudioFile ? "border-emerald-500/50 bg-emerald-500/5" : "border-border"
                  )}
                >
                  <label className="cursor-pointer block">
                    <Mic className={cn("mx-auto mb-2 size-6", kbAudioFile ? "text-emerald-500" : "text-muted-foreground")} />
                    {kbAudioFile ? (
                      <div>
                        <p className="text-[12px] font-semibold text-foreground">{kbAudioFile.name}</p>
                        <p className="text-[11px] text-muted-foreground">{(kbAudioFile.size / 1024 / 1024).toFixed(1)} MB · ready to transcribe</p>
                        <button onClick={e => { e.preventDefault(); setKbAudioFile(null); }} className="text-[10px] text-destructive mt-1 hover:underline">Remove</button>
                      </div>
                    ) : (
                      <p className="text-[12px] text-muted-foreground">
                        Drop audio/video here or{" "}
                        <span className="text-primary underline underline-offset-2">browse</span>
                        <br />
                        <span className="text-[11px]">mp3, mp4, m4a, wav, webm — max 25 MB</span>
                      </p>
                    )}
                    <input type="file" accept=".mp3,.mp4,.m4a,.wav,.webm,.ogg,.flac,.aac,.mov" className="sr-only"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) { setKbAudioFile(f); if (!kbTitle) setKbTitle(f.name.replace(/\.[^.]+$/, "")); }
                      }} />
                  </label>
                </div>
                <p className="text-[11px] text-muted-foreground mb-3">
                  🎙️ Whisper transcribes your recording, then Claude extracts decisions, risks &amp; actions. Cost: ~£0.003/min.
                  <br />For files &gt;25 MB, export as MP3 mono 32 kbps first (1 hr ≈ 14 MB).
                </p>
              </>
            ) : (
              <>
                {/* Drag-and-drop zone for text files */}
                <div
                  onDragOver={e => { e.preventDefault(); setKbDragOver(true); }}
                  onDragLeave={() => setKbDragOver(false)}
                  onDrop={handleKbFileDrop}
                  className={cn(
                    "relative mb-3 rounded-lg border-2 border-dashed p-3 text-center transition-all",
                    kbDragOver ? "border-primary bg-primary/5" : "border-border"
                  )}
                >
                  <label className="cursor-pointer">
                    <Upload className="mx-auto mb-1 size-5 text-muted-foreground" />
                    <p className="text-[12px] text-muted-foreground">
                      Drop a file here or{" "}
                      <span className="text-primary underline underline-offset-2">browse</span>
                      <span className="text-muted-foreground"> — .txt, .md, .csv accepted</span>
                    </p>
                    <input type="file" accept=".txt,.md,.csv,.text" multiple className="sr-only"
                      onChange={handleKbFileDrop as any} />
                  </label>
                </div>
                <p className="mb-1.5 text-[11px] text-muted-foreground">Or paste content directly:</p>
                <Textarea
                  placeholder={kbMode === "transcript"
                    ? "Paste the meeting transcript here. The agent will extract decisions, action items, risks, and key facts automatically."
                    : "Paste document content, briefing notes, client requirements, or any reference material."}
                  value={kbContent}
                  onChange={e => setKbContent(e.target.value)}
                  className="mb-3 min-h-[140px] text-[12px] font-mono"
                />
              </>
            )}

            <div className="flex items-center justify-between gap-3">
              {kbMode === "transcript" && (
                <p className="text-[11px] text-muted-foreground">
                  Claude extracts decisions (⭐ HIGH TRUST), risks, actions, and key facts as separate KB items.
                </p>
              )}
              {kbMode === "audio" && (
                <p className="text-[11px] text-muted-foreground">
                  Whisper transcribes → Claude extracts. Both the transcript and intelligence are saved to KB.
                </p>
              )}
              {kbMode === "document" && (
                <p className="text-[11px] text-muted-foreground">Large documents are chunked automatically.</p>
              )}
              {kbMode === "url" && (
                <p className="text-[11px] text-muted-foreground">Page will be fetched, summarised, and cached for 7 days.</p>
              )}
              <Button size="sm" onClick={handleKbSubmit}
                disabled={
                  ingest.isPending ||
                  (kbMode === "url" ? !kbUrl.trim() :
                   kbMode === "audio" ? !kbAudioFile :
                   !kbContent.trim())
                }
                className="ml-auto shrink-0">
                {ingest.isPending
                  ? (kbMode === "audio" ? "Transcribing…" : "Ingesting…")
                  : (kbMode === "audio" ? "Transcribe & Ingest" : "Ingest")}
              </Button>
            </div>
          </Card>

          {/* KB item list */}
          <Card className="p-5">
            <CardHeader className="p-0 mb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BookOpen className="size-4 text-primary" />
                Knowledge base
                {Array.isArray(knowledgeItems) && (
                  <Badge variant="secondary" className="ml-1 text-[10px]">{knowledgeItems.length} items</Badge>
                )}
              </CardTitle>
            </CardHeader>

            {kbLoading ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
            ) : !Array.isArray(knowledgeItems) || knowledgeItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-10 text-center">
                <BookOpen className="mx-auto mb-2 size-8 text-muted-foreground/40" />
                <p className="text-[13px] text-muted-foreground">No knowledge items yet.</p>
                <p className="text-[12px] text-muted-foreground/60 mt-0.5">
                  Ingest a transcript, document, or URL above.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {(knowledgeItems as any[]).map((item: any) => {
                  const trustColor = item.trustLevel === "HIGH_TRUST"
                    ? "text-amber-500"
                    : item.trustLevel === "REFERENCE_ONLY"
                    ? "text-muted-foreground"
                    : "text-primary";
                  const trustLabel = item.trustLevel === "HIGH_TRUST" ? "⭐ High trust"
                    : item.trustLevel === "REFERENCE_ONLY" ? "📎 Reference"
                    : "📄 Standard";
                  const typeColor: Record<string, string> = {
                    DECISION: "bg-amber-500/10 text-amber-600 border-amber-500/20",
                    TRANSCRIPT: "bg-blue-500/10 text-blue-600 border-blue-500/20",
                    URL: "bg-green-500/10 text-green-600 border-green-500/20",
                    FILE: "bg-purple-500/10 text-purple-600 border-purple-500/20",
                  };
                  return (
                    <div key={item.id}
                      className="flex items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/30 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-medium truncate">{item.title}</span>
                          <Badge variant="outline"
                            className={cn("text-[10px] px-1.5 py-0 shrink-0", typeColor[item.type] || "")}>
                            {item.type}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={cn("text-[11px] font-medium", trustColor)}>{trustLabel}</span>
                          {item.tags?.length > 0 && (
                            <span className="text-[11px] text-muted-foreground">
                              {item.tags.slice(0, 3).join(", ")}
                            </span>
                          )}
                          <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
                            {new Date(item.createdAt).toLocaleDateString("en-GB")}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => deleteKb.mutate(item.id)}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                        title="Delete">
                        <X className="size-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* ═══ 4. FLOATING CHAT ═══ */}
      {/* Toggle button */}
      <button
        className="fixed bottom-6 right-6 z-40 flex size-14 items-center justify-center rounded-full text-xl text-white shadow-lg transition-all hover:scale-105"
        onClick={() => setChatOpen(!chatOpen)}
        style={{
          background: AGENT_RESOLVED.gradient,
          boxShadow: `0 4px 20px ${AGENT_RESOLVED.color}44`,
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
          <div className="flex items-center gap-2 px-4 py-3" style={{ background: AGENT_RESOLVED.gradient }}>
            <div className="flex size-7 items-center justify-center rounded-full bg-white/20 text-xs font-bold text-white">
              {AGENT_RESOLVED.initials}
            </div>
            <div>
              <p className="text-xs font-semibold text-white">Chat with Agent {AGENT_RESOLVED.name}</p>
              <p className="text-[9px] text-white/70">{AGENT_RESOLVED.project ? `Online · ${AGENT_RESOLVED.project}` : "Online"}</p>
            </div>
          </div>
          {/* Messages */}
          <div className="h-[220px] space-y-2.5 overflow-y-auto p-3">
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              Start a conversation with {AGENT_RESOLVED.name}
            </div>
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

      {/* ═══ DELETE / DECOMMISSION MODAL ═══ */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) { setDeleteModal(null); setDeleteConfirmText(""); } }}>
          <div className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl mx-4">

            {/* Header */}
            <div className="flex items-start gap-3 mb-4">
              <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${deleteModal === "purge" ? "bg-red-500/15" : "bg-destructive/15"}`}>
                {deleteModal === "purge"
                  ? <TrashIcon className="h-5 w-5 text-red-500" />
                  : <AlertTriangle className="h-5 w-5 text-destructive" />}
              </div>
              <div>
                <h2 className="text-sm font-bold text-foreground">
                  {deleteModal === "purge" ? "Delete Agent Permanently" : "Decommission Agent"}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {deleteModal === "purge"
                    ? "This will permanently erase the agent and all associated data."
                    : "This will stop the agent and archive it. All data is preserved."}
                </p>
              </div>
            </div>

            {/* What will be deleted */}
            <div className={`rounded-xl p-3 mb-4 text-xs space-y-1 ${deleteModal === "purge" ? "bg-red-950/30 border border-red-700/20" : "bg-muted/50 border border-border"}`}>
              {deleteModal === "purge" ? (
                <>
                  <p className="font-semibold text-red-400 mb-1.5">The following will be permanently deleted:</p>
                  {[
                    "Agent configuration & identity",
                    "All generated artefacts & documents",
                    "Full chat & conversation history",
                    "All activity logs & audit trail",
                    "Risk register entries",
                    "All queued & completed jobs",
                    "Agent decisions & approvals",
                    "Knowledge base items",
                    "Agent email address",
                  ].map(item => (
                    <div key={item} className="flex items-center gap-1.5 text-muted-foreground">
                      <TrashIcon className="h-2.5 w-2.5 text-red-500/70 flex-shrink-0" /> {item}
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <p className="font-semibold text-foreground mb-1.5">What happens:</p>
                  {[
                    "Agent stops all autonomous activity immediately",
                    "All artefacts, history & data are preserved",
                    "Agent appears as Decommissioned — read-only",
                    "Project remains intact and accessible",
                  ].map(item => (
                    <div key={item} className="flex items-center gap-1.5 text-muted-foreground">
                      <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500/70 flex-shrink-0" /> {item}
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Also delete project? (purge only) */}
            {deleteModal === "purge" && (
              <label className="flex items-start gap-2.5 mb-4 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={deleteProject}
                  onChange={e => setDeleteProject(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border accent-red-500"
                />
                <div>
                  <p className="text-xs font-medium text-foreground group-hover:text-red-400 transition-colors">
                    Also delete the associated project
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Removes phases, risks, tasks, and all project data. Only applies if no other agents are deployed on it.
                  </p>
                </div>
              </label>
            )}

            {/* Confirmation input (purge only) */}
            {deleteModal === "purge" && (
              <div className="mb-4">
                <p className="text-xs text-muted-foreground mb-1.5">
                  Type <span className="font-mono font-bold text-foreground">{AGENT_RESOLVED.name}</span> to confirm deletion:
                </p>
                <Input
                  value={deleteConfirmText}
                  onChange={e => setDeleteConfirmText(e.target.value)}
                  placeholder={AGENT_RESOLVED.name}
                  className="text-sm font-mono"
                  autoFocus
                />
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => { setDeleteModal(null); setDeleteConfirmText(""); setDeleteProject(false); }}
                disabled={deleting}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleting || (deleteModal === "purge" && deleteConfirmText !== AGENT_RESOLVED.name)}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    if (deleteModal === "decommission") {
                      const res = await fetch(`/api/agents/${AGENT_RESOLVED.id}`, { method: "DELETE" });
                      if (!res.ok) throw new Error("Failed");
                      toast.success(`${AGENT_RESOLVED.name} decommissioned — data preserved.`);
                      window.location.href = "/agents";
                    } else {
                      const url = `/api/agents/${AGENT_RESOLVED.id}?hard=true${deleteProject ? "&deleteProject=true" : ""}`;
                      const res = await fetch(url, { method: "DELETE" });
                      if (!res.ok) throw new Error("Failed");
                      const data = await res.json();
                      toast.success(`${AGENT_RESOLVED.name} permanently deleted.${data.projectsDeleted > 0 ? " Project also removed." : ""}`);
                      window.location.href = "/agents";
                    }
                  } catch {
                    toast.error("Action failed. Please try again.");
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? "Working…" : deleteModal === "purge" ? "Delete Permanently" : "Decommission Agent"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Agent Email Section ───
function AgentEmailSection({ agentId }: { agentId: string }) {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/agents/${agentId}/email`).then(r => r.json()).then(j => {
      setEmail(j.data?.address || null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [agentId]);

  const generateEmail = async () => {
    setGenerating(true);
    try {
      const r = await fetch(`/api/agents/${agentId}/email`, { method: "POST" });
      const j = await r.json();
      if (j.data?.address) setEmail(j.data.address);
    } catch {}
    setGenerating(false);
  };

  const copyEmail = () => {
    if (email) {
      navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) return <div className="animate-pulse h-10 bg-muted rounded" />;

  if (!email) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex-1 rounded-lg border border-dashed border-border p-3 text-center">
          <Mail className="w-5 h-5 text-muted-foreground mx-auto mb-1.5" />
          <p className="text-[11px] text-muted-foreground">No email address assigned</p>
        </div>
        <Button variant="default" size="sm" onClick={generateEmail} disabled={generating}>
          <Mail className="mr-1 h-3.5 w-3.5" />
          {generating ? "Generating..." : "Generate Email"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-primary/5 border border-primary/10">
        <Mail className="h-4 w-4 text-primary flex-shrink-0" />
        <span className="text-sm font-mono font-medium text-primary flex-1">{email}</span>
        <button onClick={copyEmail} className="p-1.5 rounded-md hover:bg-primary/10 transition-colors">
          {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4 text-muted-foreground" />}
        </button>
      </div>
      <div className="text-[10px] text-muted-foreground space-y-1">
        <p>Use this email to:</p>
        <ul className="list-disc list-inside space-y-0.5 ml-1">
          <li>Invite the agent to meetings (Zoom, Teams, Google Meet)</li>
          <li>Forward project updates, status emails, or reports</li>
          <li>CC the agent on stakeholder correspondence</li>
        </ul>
        <p className="mt-1">The agent will automatically extract action items, decisions, and risks from incoming emails.</p>
      </div>
    </div>
  );
}

// ─── Agent Inbox Tab ───
function AgentInboxTab({ agentId, agentColor }: { agentId: string; agentColor: string }) {
  const [msgs, setMsgs] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const [processed, setProcessed] = useState<Set<string>>(new Set());

  const processIntoKb = async (msgId: string) => {
    setProcessing(prev => new Set(prev).add(msgId));
    try {
      const res = await fetch(`/api/agents/${agentId}/inbox/${msgId}/process`, { method: "POST" });
      if (res.ok) {
        setMsgs(prev => prev.map(m => m.id === msgId ? { ...m, processedAs: "kb_extraction", status: "PROCESSED" } : m));
        setProcessed(prev => new Set(prev).add(msgId));
      }
    } catch {}
    setProcessing(prev => { const s = new Set(prev); s.delete(msgId); return s; });
  };

  useEffect(() => {
    const params = new URLSearchParams();
    if (filter) params.set("type", filter);
    fetch(`/api/agents/${agentId}/inbox?${params}`).then(r => r.json()).then(j => {
      setMsgs(j.data?.messages || []);
      setUnread(j.data?.unreadCount || 0);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [agentId, filter]);

  const markRead = async (ids: string[]) => {
    await fetch(`/api/agents/${agentId}/inbox`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageIds: ids, status: "READ" }),
    });
    setMsgs(msgs.map(m => ids.includes(m.id) ? { ...m, status: "READ" } : m));
    setUnread(Math.max(0, unread - ids.length));
  };

  const typeIcons: Record<string, string> = {
    MEETING_INVITE: "📅", MEETING_NOTES: "📝", STATUS_UPDATE: "📊", GENERAL: "📧",
  };

  if (loading) return <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Agent Inbox</h3>
          <p className="text-[11px] text-muted-foreground">{unread > 0 ? `${unread} unread` : "All caught up"}</p>
        </div>
        {unread > 0 && (
          <Button variant="outline" size="sm" onClick={() => markRead(msgs.filter(m => m.status === "UNREAD").map((m: any) => m.id))}>
            Mark all read
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-1.5">
        {[{ id: null, label: "All" }, { id: "MEETING_INVITE", label: "Invites" }, { id: "MEETING_NOTES", label: "Notes" }, { id: "STATUS_UPDATE", label: "Updates" }, { id: "GENERAL", label: "General" }].map(f => (
          <button key={f.id || "all"} onClick={() => setFilter(f.id)}
            className={cn("px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all",
              filter === f.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      {msgs.length === 0 ? (
        <div className="text-center py-12">
          <Mail className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">No emails received</p>
          <p className="text-[11px] text-muted-foreground">Emails sent to this agent&apos;s address will appear here.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {msgs.map((m: any) => (
            <div key={m.id} onClick={() => m.status === "UNREAD" && markRead([m.id])}
              className={cn("flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all",
                m.status === "UNREAD" ? "bg-primary/5 border border-primary/10" : "hover:bg-muted/50")}>
              <span className="text-base mt-0.5">{typeIcons[m.type] || "📧"}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={cn("text-[12px] font-semibold truncate", m.status === "UNREAD" ? "text-foreground" : "text-muted-foreground")}>{m.from}</span>
                  {m.status === "UNREAD" && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: agentColor }} />}
                  <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">
                    {new Date(m.receivedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className={cn("text-[12px] truncate", m.status === "UNREAD" ? "font-medium text-foreground" : "text-muted-foreground")}>{m.subject}</p>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">{m.preview?.slice(0, 120)}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  {m.processedAs ? (
                    <Badge variant="secondary" className="text-[9px]">
                      Processed → {m.processedAs.replace(/_/g, " ")}
                    </Badge>
                  ) : (
                    <button
                      onClick={e => { e.stopPropagation(); processIntoKb(m.id); }}
                      disabled={processing.has(m.id)}
                      className="text-[10px] font-semibold text-primary hover:underline disabled:opacity-50">
                      {processing.has(m.id) ? "Processing…" : "→ Process into KB"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── AgentMeetingsTab ─────────────────────────────────────────────────────────

const BOT_STATUS_META: Record<string, { label: string; color: string; pulse: boolean }> = {
  idle:        { label: "Scheduled",               color: "#94A3B8", pulse: false },
  joining:     { label: "Joining…",                color: "#F59E0B", pulse: true  },
  waiting:     { label: "Waiting room…",           color: "#F59E0B", pulse: true  },
  joined:      { label: "In call (starting rec…)", color: "#3B82F6", pulse: true  },
  recording:   { label: "Recording",               color: "#EF4444", pulse: true  },
  processing:  { label: "Processing transcript…",  color: "#8B5CF6", pulse: true  },
  done:        { label: "Done",                    color: "#10B981", pulse: false },
  failed:      { label: "Failed",                  color: "#EF4444", pulse: false },
};

function AgentMeetingsTab({ agentId, agentName, agentColor }: { agentId: string; agentName: string; agentColor: string }) {
  const [meetings, setMeetings] = useState<any[]>([]);
  const [upcoming, setUpcoming] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Create Meeting modal state ────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [createPlatform, setCreatePlatform] = useState<"zoom" | "meet">("zoom");
  const [createTitle, setCreateTitle] = useState("");
  const [createDate, setCreateDate] = useState(() => {
    const d = new Date(Date.now() + 10 * 60 * 1000);
    return d.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
  });
  const [createDuration, setCreateDuration] = useState(60);
  const [createInvitees, setCreateInvitees] = useState("");
  const [createAgenda, setCreateAgenda] = useState("");
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<{ joinUrl: string; message: string; botDispatched: boolean } | null>(null);
  const [createError, setCreateError] = useState("");
  const [connectUrl, setConnectUrl] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/meetings`);
      const j = await res.json();
      setMeetings(j.data?.meetings || []);
      setUpcoming(j.data?.upcomingEvents || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    load();
    // Poll every 15s when there are active bots
    pollRef.current = setInterval(() => {
      setMeetings(prev => {
        const hasActive = prev.some(m => ["joining","waiting","joined","recording","processing"].includes(m.recallBotStatus || ""));
        if (hasActive) load();
        return prev;
      });
    }, 15000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [agentId]);

  const sendBot = async (meetingUrl: string, meetingTitle?: string, calendarEventId?: string) => {
    setSending(true); setError("");
    try {
      const res = await fetch(`/api/agents/${agentId}/meetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingUrl, title: meetingTitle || title || undefined, calendarEventId }),
      });
      const j = await res.json();
      if (!res.ok) { setError(j.error || "Failed to dispatch bot"); }
      else { setSent(true); setUrl(""); setTitle(""); await load(); }
    } catch { setError("Network error"); }
    setSending(false);
  };

  const cancelBot = async (meetingId: string) => {
    await fetch(`/api/agents/${agentId}/meetings/${meetingId}`, { method: "DELETE" });
    await load();
  };

  const createMeeting = async () => {
    setCreating(true); setCreateError(""); setCreateResult(null); setConnectUrl(null);
    try {
      const invitees = createInvitees
        .split(/[\s,;]+/)
        .map(e => e.trim())
        .filter(e => e.includes("@"));

      const res = await fetch(`/api/agents/${agentId}/meetings/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: createPlatform,
          title: createTitle || "Team Meeting",
          scheduledAt: new Date(createDate).toISOString(),
          durationMins: createDuration,
          invitees,
          agenda: createAgenda,
          autoBot: true,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        if (j.code === "ZOOM_NOT_CONNECTED" || j.code === "GOOGLE_NOT_CONNECTED") {
          setConnectUrl(j.authUrl);
          setCreateError(j.error + " — click the button below to connect.");
        } else {
          setCreateError(j.error || "Failed to create meeting");
        }
      } else {
        setCreateResult(j.data);
        setCreateTitle(""); setCreateInvitees(""); setCreateAgenda("");
        await load();
      }
    } catch { setCreateError("Network error"); }
    setCreating(false);
  };

  const platformIcon = (p?: string) => ({ zoom: "💙", teams: "💜", meet: "🟢", webex: "🔵" }[p || ""] || "🎥");

  if (loading) return <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}</div>;

  return (
    <div className="space-y-5">

      {/* ── Meeting actions card ── */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Video className="size-4" style={{ color: agentColor }} />
            Meetings
          </h3>
          <Button
            size="sm"
            variant={showCreate ? "outline" : "default"}
            className="text-[12px] h-7 px-3"
            onClick={() => { setShowCreate(v => !v); setCreateResult(null); setCreateError(""); setConnectUrl(null); }}
          >
            {showCreate ? <X className="size-3 mr-1" /> : <Calendar className="size-3 mr-1" />}
            {showCreate ? "Cancel" : "Create Meeting"}
          </Button>
        </div>

        {/* ── Create Meeting form ── */}
        {showCreate && (
          <div className="mb-4 p-3 rounded-xl border border-border/40 bg-muted/30 space-y-3">
            {/* Platform selector */}
            <div className="flex gap-2">
              {(["zoom", "meet"] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setCreatePlatform(p)}
                  className={cn(
                    "flex-1 py-2 rounded-lg text-[12px] font-semibold border transition-all",
                    createPlatform === p
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border/30 bg-background text-muted-foreground hover:bg-muted"
                  )}
                >
                  {p === "zoom" ? "💙 Zoom" : "🟢 Google Meet"}
                </button>
              ))}
            </div>

            {/* Title */}
            <Input
              placeholder="Meeting title (e.g. Sprint Planning)"
              value={createTitle}
              onChange={e => setCreateTitle(e.target.value)}
              className="text-sm"
            />

            {/* Date/time + duration */}
            <div className="flex gap-2">
              <input
                type="datetime-local"
                value={createDate}
                onChange={e => setCreateDate(e.target.value)}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <select
                value={createDuration}
                onChange={e => setCreateDuration(Number(e.target.value))}
                className="w-28 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {[15, 30, 45, 60, 90, 120].map(m => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
            </div>

            {/* Invitees */}
            <Input
              placeholder="Invite by email — comma separated (optional)"
              value={createInvitees}
              onChange={e => setCreateInvitees(e.target.value)}
              className="text-sm"
            />

            {/* Agenda */}
            <Textarea
              placeholder="Agenda / notes for the meeting (optional)"
              value={createAgenda}
              onChange={e => setCreateAgenda(e.target.value)}
              className="text-sm min-h-[60px] resize-none"
            />

            {createError && (
              <div className="text-[11px] text-destructive space-y-1">
                <p>{createError}</p>
                {connectUrl && (
                  <a href={connectUrl} className="inline-block mt-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90">
                    Connect {createPlatform === "zoom" ? "Zoom" : "Google Calendar"} →
                  </a>
                )}
              </div>
            )}

            {createResult ? (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 space-y-1.5">
                <p className="text-[12px] font-semibold text-emerald-600">{createResult.message}</p>
                <a
                  href={createResult.joinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
                >
                  <ExternalLink className="size-3" /> Join Meeting
                </a>
                {createResult.botDispatched && (
                  <p className="text-[11px] text-muted-foreground">{agentName} has been dispatched and will join automatically.</p>
                )}
              </div>
            ) : (
              <Button
                onClick={createMeeting}
                disabled={creating}
                className="w-full"
              >
                {creating ? "Creating…" : `Create ${createPlatform === "zoom" ? "Zoom" : "Google Meet"} + Send ${agentName}`}
              </Button>
            )}
          </div>
        )}

        {/* ── Or join an existing meeting ── */}
        <p className="text-[11px] text-muted-foreground mb-2">
          Or paste an existing meeting URL:
        </p>
        <div className="flex flex-col gap-2">
          <Input
            placeholder="Meeting URL — zoom.us/j/…  teams.microsoft.com/l/…  meet.google.com/…"
            value={url}
            onChange={e => { setUrl(e.target.value); setSent(false); setError(""); }}
            className="text-sm"
          />
          <div className="flex gap-2">
            <Input
              placeholder="Meeting title (optional)"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="text-sm"
            />
            <Button
              onClick={() => sendBot(url)}
              disabled={!url.trim() || sending}
              className="shrink-0"
            >
              {sending ? "Dispatching…" : sent ? "✓ Dispatched" : "Send Agent"}
            </Button>
          </div>
        </div>
        {error && <p className="text-[11px] text-destructive mt-2">{error}</p>}
        {sent && <p className="text-[11px] text-emerald-600 mt-2">✓ {agentName} will join shortly. Status updates below.</p>}
      </Card>

      {/* ── Upcoming calendar events ── */}
      {upcoming.length > 0 && (
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Upcoming meetings</h4>
          <div className="space-y-1.5">
            {upcoming.map((ev: any) => (
              <div key={ev.id} className="flex items-center gap-3 p-3 rounded-xl border bg-card">
                <Calendar className="size-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold truncate">{ev.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(ev.startTime).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {ev.location && ` · ${ev.location}`}
                  </p>
                </div>
                {ev.meetingUrl ? (
                  <Button size="sm" variant="outline" className="text-[11px] shrink-0"
                    onClick={() => sendBot(ev.meetingUrl, ev.title, ev.id)}>
                    <Mic className="size-3 mr-1" /> Send Agent
                  </Button>
                ) : (
                  <span className="text-[10px] text-muted-foreground shrink-0">No URL</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Past / active meetings ── */}
      <div>
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Recent meetings</h4>
        {meetings.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <Mic className="size-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium mb-1">No meetings yet</p>
            <p className="text-[11px]">Invite {agentName} above and it will transcribe and analyse each call.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {meetings.map((m: any) => {
              const statusMeta = BOT_STATUS_META[m.recallBotStatus || "idle"] || BOT_STATUS_META.idle;
              const isActive = ["joining","waiting","joined","recording","processing"].includes(m.recallBotStatus || "");
              return (
                <Card key={m.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <span className="text-xl mt-0.5">{platformIcon(m.platform)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-[12px] font-semibold truncate">{m.title}</p>
                        <span className="flex items-center gap-1 text-[10px] font-semibold ml-auto shrink-0" style={{ color: statusMeta.color }}>
                          {statusMeta.pulse && <span className="size-1.5 rounded-full animate-pulse" style={{ background: statusMeta.color }} />}
                          {statusMeta.label}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(m.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        {m.duration && ` · ${m.duration} min`}
                      </p>
                      {m.summary && (
                        <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-2">{m.summary}</p>
                      )}
                      {m.actionItems?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {m.actionItems.slice(0, 3).map((a: any) => (
                            <Badge key={a.id} variant="secondary" className="text-[9px]">
                              {a.text.slice(0, 50)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      {m.meetingUrl && (
                        <a href={m.meetingUrl} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                          <ExternalLink className="size-2.5" /> Join
                        </a>
                      )}
                      {isActive && (
                        <button onClick={() => cancelBot(m.id)}
                          className="text-[10px] text-destructive hover:underline flex items-center gap-0.5">
                          <MicOff className="size-2.5" /> Remove
                        </button>
                      )}
                      {m.recallBotStatus === "done" && m.processedAt && (
                        <span className="text-[10px] text-emerald-600 flex items-center gap-0.5">
                          <CheckCircle2 className="size-2.5" /> KB updated
                        </span>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
