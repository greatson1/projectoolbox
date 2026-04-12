// @ts-nocheck
"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { useProject, useProjectTasks } from "@/hooks/use-api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { toast } from "sonner";
import {
  FileBarChart, FileText, Download, Play, Plus, Clock, Send,
  Calendar, Search, Trash2, Pause, RefreshCw, ChevronRight,
  CheckCircle2, AlertCircle, XCircle, AlertTriangle,
} from "lucide-react";

// Maps DB report type back to template id for refresh
const TYPE_TO_TEMPLATE_ID: Record<string, string> = {
  STATUS: "status", EXECUTIVE: "executive", RISK: "risk", EVM: "evm",
  SPRINT: "sprint", STAKEHOLDER: "stakeholder", BUDGET: "budget", PHASE_GATE: "phase_gate",
};

// ── Constants ─────────────────────────────────────────────────────────────────

const TEMPLATES = [
  { id: "status",     name: "Status Report",      desc: "Weekly project status: schedule, budget, risks, decisions",      frequency: "Weekly",    sections: ["Executive Summary","Schedule Status","Budget Status","Risk Summary","Decisions","Next Steps"],           pages: 4,  credits: 10 },
  { id: "executive",  name: "Executive Summary",   desc: "High-level overview for steering committee",                     frequency: "Monthly",   sections: ["Portfolio Health","Key Milestones","Budget Overview","Strategic Risks","Recommendations"],              pages: 3,  credits: 10 },
  { id: "risk",       name: "Risk Report",         desc: "Risk analysis with mitigation strategies and trends",            frequency: "Bi-weekly", sections: ["Risk Matrix","New Risks","Mitigated Risks","Trend Analysis","Mitigation Plan"],                         pages: 5,  credits: 10 },
  { id: "evm",        name: "EVM Report",          desc: "Earned Value Management: CPI, SPI, EAC, forecasts",             frequency: "Monthly",   sections: ["S-Curve","Variance Analysis","Forecasts","Work Package Detail","Recommendations"],                     pages: 6,  credits: 10 },
  { id: "sprint",     name: "Sprint Review",       desc: "Sprint outcomes, velocity, burndown, retrospective",             frequency: "Per Sprint",sections: ["Sprint Goal","Completed Items","Velocity","Burndown","Retro Actions"],                                  pages: 3,  credits: 10 },
  { id: "stakeholder",name: "Stakeholder Update",  desc: "Stakeholder-friendly progress update",                          frequency: "Weekly",    sections: ["Progress Summary","Key Achievements","Upcoming Milestones","Actions Required"],                         pages: 2,  credits: 5  },
  { id: "budget",     name: "Budget Report",       desc: "Budget vs actual, cost breakdown, forecasts",                   frequency: "Monthly",   sections: ["Budget Summary","CBS Breakdown","Variance Analysis","Forecast","Contingency"],                          pages: 4,  credits: 10 },
  { id: "phase_gate", name: "Phase Gate Report",   desc: "Gate review checklist and readiness assessment",                frequency: "Per Gate",  sections: ["Gate Criteria","Artefact Status","Risk Assessment","Readiness Score","Recommendation"],                 pages: 5,  credits: 10 },
];

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const HOURS = Array.from({ length: 15 }, (_, i) => i + 6); // 6am–8pm

const STATUS_ICON = {
  PUBLISHED: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
  DRAFT:     <Clock        className="w-3.5 h-3.5 text-amber-500"   />,
  FAILED:    <XCircle      className="w-3.5 h-3.5 text-destructive"  />,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function formatDate(date: string | Date | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function templateName(id: string) {
  return TEMPLATES.find(t => t.id === id)?.name || id;
}

function freqLabel(f: string) {
  return { DAILY: "Daily", WEEKLY: "Weekly", BIWEEKLY: "Bi-weekly", MONTHLY: "Monthly" }[f] || f;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReportsHubPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useProject(projectId);
  const qc = useQueryClient();

  // ── Queries ──
  const { data: reports, isLoading: reportsLoading } = useQuery({
    queryKey: ["reports", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/reports?projectId=${projectId}`);
      const j = await r.json();
      return j.data || [];
    },
  });

  const { data: schedules, isLoading: schedulesLoading } = useQuery({
    queryKey: ["report-schedules", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/reports/schedule?projectId=${projectId}`);
      const j = await r.json();
      return j.data || [];
    },
  });

  // ── Staleness detection ──
  // Track the latest task change so we can warn when a report is out of date
  const { data: tasksForStaleness } = useProjectTasks(projectId);
  const latestTaskUpdate: Date | null = useMemo(() => {
    if (!tasksForStaleness || tasksForStaleness.length === 0) return null;
    const times = tasksForStaleness.map((t: any) => new Date(t.updatedAt || t.createdAt).getTime()).filter(Boolean);
    return times.length ? new Date(Math.max(...times)) : null;
  }, [tasksForStaleness]);

  function isStale(report: any): boolean {
    if (!latestTaskUpdate) return false;
    const generated = new Date(report.generatedAt || report.publishedAt || 0);
    return latestTaskUpdate > generated;
  }

  // ── State ──
  const [activeTab, setActiveTab]         = useState("templates");
  const [search, setSearch]               = useState("");
  const [viewingReport, setViewingReport] = useState<any>(null);
  const [generating, setGenerating]       = useState<string | null>(null);
  const [showModal, setShowModal]         = useState(false);

  // Schedule form state
  const [schedName,      setSchedName]      = useState("");
  const [schedTemplate,  setSchedTemplate]  = useState("status");
  const [schedFreq,      setSchedFreq]      = useState("WEEKLY");
  const [schedDay,       setSchedDay]       = useState(1);    // day of week (Mon)
  const [schedDom,       setSchedDom]       = useState(1);    // day of month
  const [schedHour,      setSchedHour]      = useState(9);
  const [schedEmail,     setSchedEmail]     = useState("");   // optional recipient email
  const [saving,         setSaving]         = useState(false);

  // ── Mutations ──
  const generateReport = async (template: any) => {
    setGenerating(template.id);
    try {
      const r = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${template.name} — ${project?.name || "Project"}`,
          type: template.id.toUpperCase(),
          projectId,
          sections: template.sections,
        }),
      });
      const j = await r.json();
      if (r.ok) {
        toast.success(`${template.name} generated ✓`);
        qc.invalidateQueries({ queryKey: ["reports", projectId] });
        setActiveTab("reports");
      } else {
        toast.error(j.error || "Generation failed");
      }
    } catch {
      toast.error("Generation failed");
    } finally {
      setGenerating(null);
    }
  };

  const createSchedule = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/reports/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: schedName || undefined,
          templateId: schedTemplate,
          projectId,
          frequency: schedFreq,
          dayOfWeek:  schedDay,
          dayOfMonth: schedDom,
          hour:       schedHour,
          recipients: schedEmail.trim() ? [schedEmail.trim()] : [],
        }),
      });
      const j = await r.json();
      if (r.ok) {
        toast.success("Schedule created ✓");
        qc.invalidateQueries({ queryKey: ["report-schedules", projectId] });
        setShowModal(false);
        resetForm();
      } else {
        toast.error(j.error || "Failed to create schedule");
      }
    } catch {
      toast.error("Failed to create schedule");
    } finally {
      setSaving(false);
    }
  };

  const toggleSchedule = async (id: string, isActive: boolean) => {
    await fetch(`/api/reports/schedule/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    qc.invalidateQueries({ queryKey: ["report-schedules", projectId] });
    toast.success(isActive ? "Schedule resumed" : "Schedule paused");
  };

  const deleteSchedule = async (id: string) => {
    await fetch(`/api/reports/schedule/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["report-schedules", projectId] });
    toast.success("Schedule deleted");
  };

  const refreshReport = async (report: any) => {
    const templateId = TYPE_TO_TEMPLATE_ID[report.type] || "status";
    const template = TEMPLATES.find(t => t.id === templateId) || TEMPLATES[0];
    setViewingReport(null);
    await generateReport(template);
  };

  const resetForm = () => {
    setSchedName(""); setSchedTemplate("status"); setSchedFreq("WEEKLY");
    setSchedDay(1); setSchedDom(1); setSchedHour(9); setSchedEmail("");
  };

  // ── Derived data ──
  const reportItems = reports || [];
  const scheduleItems = schedules || [];

  // Monthly usage chart computed from real report data
  const usageData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of reportItems) {
      const mon = new Date(r.generatedAt).toLocaleDateString("en-GB", { month: "short" });
      map[mon] = (map[mon] || 0) + 1;
    }
    return Object.entries(map).map(([month, count]) => ({ month, count })).slice(-6);
  }, [reportItems]);

  // ── Document Editor view ──
  if (viewingReport) {
    const reportIsStale = isStale(viewingReport);
    return (
      <div className="flex flex-col gap-0">
        {/* Stale data banner */}
        {reportIsStale && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg mb-3"
            style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.35)" }}>
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: "#F59E0B" }} />
              <div>
                <span className="text-sm font-semibold" style={{ color: "#F59E0B" }}>Data may be out of date</span>
                <span className="text-xs text-muted-foreground ml-2">
                  Tasks were updated after this report was generated.
                </span>
              </div>
            </div>
            <Button size="sm" variant="outline" className="flex-shrink-0 border-amber-400/40 text-amber-600 hover:bg-amber-50/10"
              disabled={!!generating}
              onClick={() => refreshReport(viewingReport)}>
              {generating ? (
                <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Regenerating…</>
              ) : (
                <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Regenerate</>
              )}
            </Button>
          </div>
        )}
        <DocumentEditor
          reportId={viewingReport.id}
          title={viewingReport.title}
          content={viewingReport.content || `<h1>${viewingReport.title}</h1><p>Generating…</p>`}
          status={viewingReport.status}
          type={viewingReport.type}
          projectName={viewingReport.project?.name || project?.name}
          versions={viewingReport.versions || []}
          onSave={async (content, comment) => {
            await fetch(`/api/reports/${viewingReport.id}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content, comment }),
            });
            qc.invalidateQueries({ queryKey: ["reports", projectId] });
          }}
          onApprove={async () => {
            await fetch(`/api/reports/${viewingReport.id}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "PUBLISHED" }),
            });
            setViewingReport(null);
            qc.invalidateQueries({ queryKey: ["reports", projectId] });
          }}
          onReject={async (reason) => {
            await fetch(`/api/reports/${viewingReport.id}`, {
              method: "PATCH", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "FAILED", comment: reason }),
            });
            setViewingReport(null);
            qc.invalidateQueries({ queryKey: ["reports", projectId] });
          }}
          onClose={() => setViewingReport(null)}
        />
      </div>
    );
  }

  // ── Main render ──
  return (
    <div className="space-y-6 max-w-[1400px]">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reports Hub</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {project?.name || "Project"} · {reportItems.length} report{reportItems.length !== 1 ? "s" : ""} generated
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setShowModal(true); setActiveTab("schedules"); }}>
            <Calendar className="w-4 h-4 mr-1.5" /> Add Schedule
          </Button>
          <Button size="sm" onClick={() => setActiveTab("templates")}>
            <Plus className="w-4 h-4 mr-1.5" /> Generate Report
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border/30">
        {["templates", "reports", "schedules"].map(t => (
          <button key={t}
            className={`px-4 py-2 text-xs font-semibold capitalize border-b-2 transition-all ${activeTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => setActiveTab(t)}>
            {t}
            {t === "schedules" && scheduleItems.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[9px] font-bold">{scheduleItems.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Templates Tab ── */}
      {activeTab === "templates" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {TEMPLATES.map(t => (
            <Card key={t.id} className="hover:-translate-y-0.5 transition-all hover:shadow-md">
              <CardContent className="pt-5 flex flex-col h-full">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <FileBarChart className="w-4.5 h-4.5 text-primary" />
                  </div>
                  <Badge variant="outline" className="text-[9px]">{t.frequency}</Badge>
                </div>
                <h3 className="text-sm font-bold mb-1">{t.name}</h3>
                <p className="text-xs text-muted-foreground mb-3 flex-1">{t.desc}</p>
                <div className="text-[10px] text-muted-foreground mb-3 space-y-0.5">
                  <div className="flex gap-2">
                    {t.sections.slice(0, 3).map(s => (
                      <span key={s} className="flex items-center gap-0.5">
                        <ChevronRight className="w-2.5 h-2.5" />{s}
                      </span>
                    ))}
                    {t.sections.length > 3 && <span className="text-muted-foreground">+{t.sections.length - 3} more</span>}
                  </div>
                  <div className="flex justify-between mt-1.5 pt-1.5 border-t border-border/20">
                    <span>{t.sections.length} sections · ~{t.pages} pages</span>
                    <span className="font-medium">{t.credits} credits</span>
                  </div>
                </div>
                <Button size="sm" className="w-full" disabled={generating === t.id}
                  onClick={() => generateReport(t)}>
                  {generating === t.id
                    ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Generating…</>
                    : <><Play className="w-3.5 h-3.5 mr-1.5" />Generate</>}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Reports Tab ── */}
      {activeTab === "reports" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border w-[260px]">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input className="bg-transparent text-xs outline-none flex-1" placeholder="Search reports…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <span className="text-xs text-muted-foreground ml-auto">{reportItems.length} total</span>
          </div>

          {reportsLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12" />)}</div>
          ) : reportItems.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center">
                <FileText className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" />
                <h2 className="text-lg font-bold mb-2">No reports yet</h2>
                <p className="text-sm text-muted-foreground mb-4">Generate your first report from a template, or set up a schedule.</p>
                <Button size="sm" onClick={() => setActiveTab("templates")}><Plus className="w-4 h-4 mr-1" /> Browse Templates</Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Report", "Type", "Status", "Generated", "Credits", ""].map(h => (
                      <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reportItems
                    .filter((r: any) => !search || r.title?.toLowerCase().includes(search.toLowerCase()))
                    .map((r: any) => {
                    const stale = isStale(r);
                    return (
                    <tr key={r.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 px-4 font-medium max-w-[220px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate">{r.title}</span>
                          {stale && (
                            <span className="flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold"
                              style={{ background: "rgba(245,158,11,0.12)", color: "#F59E0B", border: "1px solid rgba(245,158,11,0.3)" }}>
                              <AlertTriangle className="w-2.5 h-2.5" />Stale
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        <Badge variant="outline" className="text-[9px]">{r.type?.replace(/_/g, " ")}</Badge>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-1.5">
                          {STATUS_ICON[r.status] || null}
                          <span className={r.status === "PUBLISHED" ? "text-emerald-600" : r.status === "FAILED" ? "text-destructive" : "text-amber-600"}>
                            {r.status}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-muted-foreground">{timeAgo(r.generatedAt)}</td>
                      <td className="py-2.5 px-4 text-muted-foreground">{r.creditsUsed}</td>
                      <td className="py-2.5 px-4">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2"
                            onClick={async () => {
                              const res = await fetch(`/api/reports/${r.id}`);
                              const data = await res.json();
                              setViewingReport(data.data || r);
                            }}>
                            View
                          </Button>
                          {stale && (
                            <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-amber-500 hover:text-amber-600"
                              disabled={!!generating}
                              title="Tasks have changed — regenerate this report"
                              onClick={() => refreshReport(r)}>
                              {generating === (TYPE_TO_TEMPLATE_ID[r.type] || "status")
                                ? <RefreshCw className="w-3 h-3 animate-spin" />
                                : <><RefreshCw className="w-3 h-3 mr-1" />Refresh</>}
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Download">
                            <Download className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Send">
                            <Send className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </Card>
          )}

          {/* Usage chart — computed from real data */}
          {usageData.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Report Generation Trend</CardTitle></CardHeader>
              <CardContent>
                <div style={{ height: 140 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={usageData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                      <XAxis dataKey="month" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
                      <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} allowDecimals={false} />
                      <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }} />
                      <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Schedules Tab ── */}
      {activeTab === "schedules" && (
        <div className="space-y-3">
          {schedulesLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16" />)}</div>
          ) : scheduleItems.length === 0 ? (
            <Card>
              <CardContent className="py-14 text-center">
                <Calendar className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" />
                <h2 className="text-base font-bold mb-2">No schedules yet</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Set up automatic report generation — daily, weekly, bi-weekly, or monthly.
                </p>
                <Button size="sm" onClick={() => setShowModal(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Create First Schedule
                </Button>
              </CardContent>
            </Card>
          ) : (
            scheduleItems.map((s: any) => (
              <Card key={s.id} className={`border ${s.isActive ? "" : "opacity-60"}`}>
                <CardContent className="p-4 flex items-center gap-4">
                  {/* Icon */}
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${s.isActive ? "bg-primary/10" : "bg-muted"}`}>
                    <Clock className={`w-4 h-4 ${s.isActive ? "text-primary" : "text-muted-foreground"}`} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold">{s.name}</p>
                      <Badge variant={s.isActive ? "default" : "secondary"} className="text-[9px]">
                        {s.isActive ? "Active" : "Paused"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {templateName(s.templateId)} · {freqLabel(s.frequency)}
                      {s.recipients?.length > 0 && ` · ${s.recipients.join(", ")}`}
                    </p>
                  </div>

                  {/* Dates */}
                  <div className="text-right text-[11px] text-muted-foreground flex-shrink-0 hidden sm:block">
                    <p>Last run: <span className="font-medium">{formatDate(s.lastRunAt)}</span></p>
                    <p>Next run: <span className="font-medium text-foreground">{s.isActive ? formatDate(s.nextRunAt) : "—"}</span></p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button variant="ghost" size="sm" title={s.isActive ? "Pause" : "Resume"}
                      onClick={() => toggleSchedule(s.id, !s.isActive)}>
                      {s.isActive
                        ? <Pause className="w-3.5 h-3.5 text-amber-500" />
                        : <Play  className="w-3.5 h-3.5 text-emerald-500" />}
                    </Button>
                    <Button variant="ghost" size="sm" title="Delete"
                      onClick={() => deleteSchedule(s.id)}>
                      <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive transition-colors" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}

          <Button variant="outline" className="w-full" onClick={() => setShowModal(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> Add Schedule
          </Button>
        </div>
      )}

      {/* ── Create Schedule Modal ── */}
      {showModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) { setShowModal(false); resetForm(); } }}>
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg shadow-2xl mx-4 max-h-[90vh] overflow-y-auto">

            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Calendar className="w-4.5 h-4.5 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-bold">Schedule Report</h2>
                <p className="text-xs text-muted-foreground">Automatically generate reports on a recurring basis</p>
              </div>
            </div>

            <div className="space-y-4">

              {/* Schedule name */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Schedule Name <span className="font-normal">(optional)</span></label>
                <input
                  className="w-full px-3 py-2 rounded-lg bg-muted/50 border border-border text-sm outline-none focus:border-primary transition-colors"
                  value={schedName} onChange={e => setSchedName(e.target.value)}
                  placeholder={`e.g. Weekly Status for ${project?.name || "Project"}`} />
              </div>

              {/* Report template */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Report Template</label>
                <div className="grid grid-cols-2 gap-2">
                  {TEMPLATES.map(t => (
                    <button key={t.id}
                      onClick={() => setSchedTemplate(t.id)}
                      className={`text-left px-3 py-2.5 rounded-lg border text-xs transition-all ${schedTemplate === t.id ? "bg-primary/10 border-primary/50 text-primary font-semibold" : "border-border/40 text-muted-foreground hover:border-border"}`}>
                      <div className="font-medium text-[11px]">{t.name}</div>
                      <div className="text-[10px] opacity-70 mt-0.5 truncate">{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Frequency */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Frequency</label>
                <div className="grid grid-cols-4 gap-2">
                  {["DAILY","WEEKLY","BIWEEKLY","MONTHLY"].map(f => (
                    <button key={f}
                      onClick={() => setSchedFreq(f)}
                      className={`py-2 rounded-lg text-xs font-semibold border transition-all ${schedFreq === f ? "bg-primary/10 border-primary/50 text-primary" : "border-border/30 text-muted-foreground hover:border-border"}`}>
                      {freqLabel(f)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Day of week (for WEEKLY / BIWEEKLY) */}
              {(schedFreq === "WEEKLY" || schedFreq === "BIWEEKLY") && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Day of Week</label>
                  <div className="grid grid-cols-7 gap-1">
                    {DAYS.map((d, i) => (
                      <button key={d}
                        onClick={() => setSchedDay(i)}
                        className={`py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${schedDay === i ? "bg-primary/10 border-primary/50 text-primary" : "border-border/30 text-muted-foreground hover:border-border"}`}>
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Day of month (for MONTHLY) */}
              {schedFreq === "MONTHLY" && (
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Day of Month</label>
                  <div className="grid grid-cols-7 gap-1">
                    {[1,5,10,15,20,25,28].map(d => (
                      <button key={d}
                        onClick={() => setSchedDom(d)}
                        className={`py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${schedDom === d ? "bg-primary/10 border-primary/50 text-primary" : "border-border/30 text-muted-foreground hover:border-border"}`}>
                        {d === 1 ? "1st" : d === 28 ? "Last" : `${d}th`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Time */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">Time (your local timezone)</label>
                <div className="flex flex-wrap gap-1.5">
                  {HOURS.map(h => (
                    <button key={h}
                      onClick={() => setSchedHour(h)}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${schedHour === h ? "bg-primary/10 border-primary/50 text-primary" : "border-border/30 text-muted-foreground hover:border-border"}`}>
                      {h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recipients (optional) */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1.5">
                  Recipient Email <span className="font-normal">(optional — sends on generation)</span>
                </label>
                <input
                  type="email"
                  className="w-full px-3 py-2 rounded-lg bg-muted/50 border border-border text-sm outline-none focus:border-primary transition-colors"
                  value={schedEmail} onChange={e => setSchedEmail(e.target.value)}
                  placeholder="e.g. sponsor@company.com" />
              </div>

              {/* Summary */}
              <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2.5 text-xs">
                <p className="font-semibold text-primary mb-0.5">Schedule summary</p>
                <p className="text-muted-foreground">
                  Generate a <strong>{templateName(schedTemplate)}</strong> {freqLabel(schedFreq).toLowerCase()}
                  {schedFreq === "WEEKLY" || schedFreq === "BIWEEKLY"
                    ? ` every ${DAYS[schedDay]}`
                    : schedFreq === "MONTHLY"
                    ? ` on the ${schedDom === 1 ? "1st" : schedDom === 28 ? "last day" : `${schedDom}th`} of each month`
                    : ""}
                  {" "}at {schedHour < 12 ? `${schedHour}am` : schedHour === 12 ? "12pm" : `${schedHour - 12}pm`}.
                  {schedFreq === "BIWEEKLY" && " (Every other week.)"}
                </p>
              </div>

            </div>

            <div className="flex gap-2 mt-5">
              <Button variant="outline" className="flex-1" onClick={() => { setShowModal(false); resetForm(); }}>Cancel</Button>
              <Button className="flex-1" disabled={saving} onClick={createSchedule}>
                {saving ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : "Create Schedule"}
              </Button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
