// @ts-nocheck
"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { useProject } from "@/hooks/use-api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { toast } from "sonner";
import { FileBarChart, FileText, Download, Play, Plus, Clock, Send, Calendar, Filter, Search, Trash2 } from "lucide-react";

const TEMPLATES = [
  { id: "status", name: "Status Report", desc: "Weekly project status: schedule, budget, risks, decisions", frequency: "Weekly", sections: ["Executive Summary", "Schedule Status", "Budget Status", "Risk Summary", "Decisions", "Next Steps"], pages: 4, credits: 10 },
  { id: "executive", name: "Executive Summary", desc: "High-level overview for steering committee", frequency: "Monthly", sections: ["Portfolio Health", "Key Milestones", "Budget Overview", "Strategic Risks", "Recommendations"], pages: 3, credits: 10 },
  { id: "risk", name: "Risk Report", desc: "Risk analysis with mitigation strategies and trends", frequency: "Bi-weekly", sections: ["Risk Matrix", "New Risks", "Mitigated Risks", "Trend Analysis", "Mitigation Plan"], pages: 5, credits: 10 },
  { id: "evm", name: "EVM Report", desc: "Earned Value Management: CPI, SPI, EAC, forecasts", frequency: "Monthly", sections: ["S-Curve", "Variance Analysis", "Forecasts", "Work Package Detail", "Recommendations"], pages: 6, credits: 10 },
  { id: "sprint", name: "Sprint Review", desc: "Sprint outcomes, velocity, burndown, retrospective", frequency: "Per Sprint", sections: ["Sprint Goal", "Completed Items", "Velocity", "Burndown", "Retro Actions"], pages: 3, credits: 10 },
  { id: "stakeholder", name: "Stakeholder Update", desc: "Stakeholder-friendly progress update email", frequency: "Weekly", sections: ["Progress Summary", "Key Achievements", "Upcoming Milestones", "Actions Required"], pages: 2, credits: 5 },
  { id: "budget", name: "Budget Report", desc: "Budget vs actual, cost breakdown, forecasts", frequency: "Monthly", sections: ["Budget Summary", "CBS Breakdown", "Variance Analysis", "Forecast", "Contingency"], pages: 4, credits: 10 },
  { id: "phase_gate", name: "Phase Gate Report", desc: "Gate review checklist and readiness assessment", frequency: "Per Gate", sections: ["Gate Criteria", "Artefact Status", "Risk Assessment", "Readiness Score", "Recommendation"], pages: 5, credits: 10 },
];

const SCHEDULES = [
  { id: "s1", name: "Weekly Status", template: "Status Report", frequency: "Every Friday 5pm", isActive: true, lastRun: "28 Mar", nextRun: "4 Apr" },
  { id: "s2", name: "Monthly Executive", template: "Executive Summary", frequency: "1st of month", isActive: true, lastRun: "1 Mar", nextRun: "1 Apr" },
  { id: "s3", name: "Sprint Review", template: "Sprint Review", frequency: "End of sprint", isActive: false, lastRun: "22 Mar", nextRun: "—" },
];

const USAGE_DATA = [
  { month: "Jan", count: 4 }, { month: "Feb", count: 7 }, { month: "Mar", count: 12 }, { month: "Apr", count: 5 },
];

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function ReportsHubPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useProject(projectId);
  const qc = useQueryClient();

  const { data: reports, isLoading } = useQuery({
    queryKey: ["reports", projectId],
    queryFn: async () => { const r = await fetch(`/api/reports?projectId=${projectId || ""}`); const j = await r.json(); return j.data || []; },
  });

  const generateReport = useMutation({
    mutationFn: async (template: any) => {
      const r = await fetch("/api/reports", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `${template.name} — ${project?.name || "Project"}`, type: template.id.toUpperCase(), projectId, sections: template.sections }),
      });
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reports"] }); },
  });

  const [activeTab, setActiveTab] = useState("templates");
  const [search, setSearch] = useState("");
  const [viewingReport, setViewingReport] = useState<any>(null);

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-64" /></div>;

  const reportItems = reports || [];

  // Document editor for viewing/editing reports
  if (viewingReport) {
    return (
      <DocumentEditor
        reportId={viewingReport.id}
        title={viewingReport.title}
        content={viewingReport.content || `<h1>${viewingReport.title}</h1><p>This report was generated by your AI agent. Content will be populated when the agent produces the full document.</p><h2>Executive Summary</h2><p>Report type: ${viewingReport.type}</p><h2>Details</h2><p>Generated on ${new Date(viewingReport.generatedAt).toLocaleDateString()}</p>`}
        status={viewingReport.status}
        type={viewingReport.type}
        projectName={viewingReport.project?.name || project?.name}
        versions={viewingReport.versions || []}
        onSave={async (content, comment) => {
          await fetch(`/api/reports/${viewingReport.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content, comment }),
          });
          qc.invalidateQueries({ queryKey: ["reports"] });
        }}
        onApprove={async () => {
          await fetch(`/api/reports/${viewingReport.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "PUBLISHED" }),
          });
          setViewingReport(null);
          qc.invalidateQueries({ queryKey: ["reports"] });
        }}
        onReject={async (reason) => {
          await fetch(`/api/reports/${viewingReport.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "FAILED", comment: reason }),
          });
          setViewingReport(null);
          qc.invalidateQueries({ queryKey: ["reports"] });
        }}
        onClose={() => setViewingReport(null)}
      />
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reports Hub</h1>
          <p className="text-sm text-muted-foreground mt-1">{project?.name || "All Projects"} · {reportItems.length} reports generated</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { const freq = prompt("Frequency (DAILY/WEEKLY/MONTHLY):", "WEEKLY"); if (!freq) return; fetch("/api/reports/schedule", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ frequency: freq.toUpperCase(), projectId: window.location.pathname.split("/")[2], name: "Scheduled Report" }) }).then(() => toast.success("Schedule created")).catch(() => toast.error("Failed")); }}><Calendar className="w-4 h-4 mr-1" /> Schedule</Button>
          <Button size="sm" onClick={() => { fetch("/api/reports", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ type: "STATUS", projectId: window.location.pathname.split("/")[2], title: "Status Report" }) }).then(() => { toast.success("Report generated"); window.location.reload(); }).catch(() => toast.error("Failed")); }}><Plus className="w-4 h-4 mr-1" /> Generate Report</Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border/30">
        {["templates", "reports", "schedules"].map(t => (
          <button key={t} className={`px-4 py-2 text-xs font-semibold capitalize border-b-2 transition-all ${activeTab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
            onClick={() => setActiveTab(t)}>{t}</button>
        ))}
      </div>

      {/* Templates Tab */}
      {activeTab === "templates" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {TEMPLATES.map(t => (
            <Card key={t.id} className="hover:-translate-y-0.5 transition-all">
              <CardContent className="pt-5">
                <div className="flex items-start justify-between mb-2">
                  <FileBarChart className="w-5 h-5 text-primary" />
                  <Badge variant="outline" className="text-[9px]">{t.frequency}</Badge>
                </div>
                <h3 className="text-sm font-bold mb-1">{t.name}</h3>
                <p className="text-xs text-muted-foreground mb-3">{t.desc}</p>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-3">
                  <span>{t.sections.length} sections</span>
                  <span>~{t.pages} pages</span>
                  <span>{t.credits} credits</span>
                </div>
                <Button size="sm" className="w-full" disabled={generateReport.isPending}
                  onClick={() => generateReport.mutate(t)}>
                  <Play className="w-3.5 h-3.5 mr-1" /> Generate
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Reports Tab */}
      {activeTab === "reports" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border w-[250px]">
              <Search className="w-3.5 h-3.5 text-muted-foreground" />
              <input className="bg-transparent text-xs outline-none flex-1" placeholder="Search reports..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          {reportItems.length === 0 ? (
            <div className="text-center py-16">
              <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-lg font-bold mb-2">No reports yet</h2>
              <p className="text-sm text-muted-foreground mb-4">Generate your first report from a template, or set up a schedule.</p>
              <Button size="sm" onClick={() => setActiveTab("templates")}><Plus className="w-4 h-4 mr-1" /> Browse Templates</Button>
            </div>
          ) : (
            <Card className="p-0">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border">
                  {["Report", "Type", "Project", "Status", "Date", "Credits", ""].map(h => (
                    <th key={h} className="text-left py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {reportItems.filter((r: any) => !search || r.title?.toLowerCase().includes(search.toLowerCase())).map((r: any) => (
                    <tr key={r.id} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-2.5 px-4 font-medium">{r.title}</td>
                      <td className="py-2.5 px-4"><Badge variant="outline" className="text-[9px]">{r.type}</Badge></td>
                      <td className="py-2.5 px-4 text-muted-foreground">{r.project?.name || "—"}</td>
                      <td className="py-2.5 px-4"><Badge variant={r.status === "PUBLISHED" ? "default" : "secondary"}>{r.status}</Badge></td>
                      <td className="py-2.5 px-4 text-muted-foreground">{timeAgo(r.generatedAt)}</td>
                      <td className="py-2.5 px-4">{r.creditsUsed}</td>
                      <td className="py-2.5 px-4">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={async () => {
                            const res = await fetch(`/api/reports/${r.id}`);
                            const data = await res.json();
                            setViewingReport(data.data || r);
                          }}>View</Button>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0"><Download className="w-3 h-3" /></Button>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0"><Send className="w-3 h-3" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* Usage chart */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Report Generation Trend</CardTitle></CardHeader>
            <CardContent>
              <div style={{ height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[] as any[]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                    <XAxis dataKey="month" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
                    <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
                    <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11, color: "var(--foreground)" }} />
                    <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Schedules Tab */}
      {activeTab === "schedules" && (
        <div className="space-y-3">
          {([] as any[]).map(s => (
            <Card key={s.id}>
              <CardContent className="pt-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Clock className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-semibold">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.template} · {s.frequency}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right text-[10px] text-muted-foreground">
                    <p>Last: {s.lastRun}</p>
                    <p>Next: {s.nextRun}</p>
                  </div>
                  <Badge variant={s.isActive ? "default" : "secondary"}>{s.isActive ? "Active" : "Paused"}</Badge>
                  <Button variant="ghost" size="sm"><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
          <Button variant="outline" className="w-full" onClick={() => { const freq = prompt("Frequency (DAILY/WEEKLY/MONTHLY):", "WEEKLY"); if (!freq) return; fetch("/api/reports/schedule", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ frequency: freq.toUpperCase(), projectId: window.location.pathname.split("/")[2], name: "Scheduled Report" }) }).then(() => toast.success("Schedule added")).catch(() => toast.error("Failed")); }}><Plus className="w-4 h-4 mr-1" /> Add Schedule</Button>
        </div>
      )}
    </div>
  );
}
