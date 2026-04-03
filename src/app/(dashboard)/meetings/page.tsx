// @ts-nocheck
"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useMeetings, useMeeting, useCreateMeeting, useProjects, useAgents } from "@/hooks/use-api";
import {
  ArrowLeft, Search, Download, Plus, CheckCircle2, Circle, Upload,
  FileText, AlertTriangle, Calendar, Bot, Mail, Copy, X,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

const PLATFORM_ICONS: Record<string, string> = {
  zoom: "📹", teams: "🟦", meet: "🟢", email: "📧", other: "💬",
};

const HIGHLIGHT_STYLES: Record<string, { bg: string; label: string }> = {
  risk: { bg: "bg-red-500/10", label: "Risk" },
  decision: { bg: "bg-violet-500/10", label: "Decision" },
  action: { bg: "bg-emerald-500/10", label: "Action" },
};

function timeAgo(date: string | Date) {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function MeetingsPage() {
  const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"summary" | "transcript" | "actions" | "decisions">("summary");
  const [searchTranscript, setSearchTranscript] = useState("");
  const [showUpload, setShowUpload] = useState(false);

  const { data: meetingsData, isLoading } = useMeetings();
  const { data: meeting, isLoading: meetingLoading } = useMeeting(selectedMeeting);

  if (isLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-3 gap-3">{[1,2,3].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      <Skeleton className="h-64" />
    </div>
  );

  const upcoming = meetingsData?.upcoming || [];
  const past = meetingsData?.past || [];

  // ─── Detail view ───
  if (selectedMeeting && meeting) {
    const speakers = (meeting.speakers as any[]) || [];
    const decisions = (meeting.decisions as any[]) || [];
    const risks = (meeting.risks as any[]) || [];
    const actions = meeting.actionItems || [];
    const topics = (meeting.topics as string[]) || [];
    const transcript = meeting.rawTranscript || "";

    const sentimentColorMap: Record<string, string> = { positive: "text-emerald-500", neutral: "text-muted-foreground", concerned: "text-amber-500", negative: "text-red-500" };
    const sentimentDotMap: Record<string, string> = { positive: "bg-emerald-500", neutral: "bg-muted-foreground", concerned: "bg-amber-500", negative: "bg-red-500" };

    return (
      <div className="space-y-5">
        <button onClick={() => setSelectedMeeting(null)}
          className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to meetings
        </button>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[20px] font-bold text-foreground">{meeting.title}</h2>
            <div className="flex items-center gap-3 mt-1 text-[12px] text-muted-foreground">
              <span>{PLATFORM_ICONS[meeting.platform || "other"]} {meeting.platform || "other"}</span>
              <span>· {new Date(meeting.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
              {meeting.duration && <span>· {meeting.duration} min</span>}
              {meeting.project && <span>· {meeting.project.name}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {meeting.confidence && <Badge variant="default">Confidence {meeting.confidence}%</Badge>}
            {meeting.summary && meeting.agentId && (
              <Button variant="default" size="sm" onClick={async () => {
                const r = await fetch(`/api/meetings/${meeting.id}/follow-up`, { method: "POST" });
                if (r.ok) alert("Follow-up email sent to attendees!");
                else alert("Failed to send follow-up");
              }}>
                <Mail className="h-3.5 w-3.5 mr-1" /> Send Follow-up
              </Button>
            )}
            <Button variant="ghost" size="sm"><Download className="h-3.5 w-3.5 mr-1" /> Export</Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-[10px] bg-muted/50">
          {(["summary", "transcript", "actions", "decisions"] as const).map(tab => (
            <button key={tab} onClick={() => setDetailTab(tab)}
              className={cn("px-4 py-2 rounded-lg text-[12px] font-semibold capitalize transition-all",
                detailTab === tab ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {tab === "actions" ? `Actions (${actions.length})` : tab === "decisions" ? `Decisions (${decisions.length})` : tab}
            </button>
          ))}
        </div>

        {/* SUMMARY */}
        {detailTab === "summary" && (
          <div className="grid grid-cols-3 gap-5">
            <div className="col-span-2 space-y-4">
              <Card className="px-5">
                <CardContent>
                  <p className="text-[11px] font-semibold uppercase tracking-wider mb-3 text-muted-foreground">AI Summary</p>
                  {meeting.summary ? meeting.summary.split("\n\n").map((p: string, i: number) => (
                    <p key={i} className="text-[13px] leading-relaxed mb-3 text-foreground">{p}</p>
                  )) : <p className="text-sm text-muted-foreground">No summary generated yet.</p>}
                  {topics.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-4">
                      {topics.map((t: string) => <Badge key={t} variant="secondary">{t}</Badge>)}
                    </div>
                  )}
                </CardContent>
              </Card>
              {/* Risks extracted */}
              {risks.length > 0 && (
                <Card className="px-5">
                  <CardContent>
                    <p className="text-[11px] font-semibold uppercase tracking-wider mb-3 text-muted-foreground">
                      <AlertTriangle className="inline h-3.5 w-3.5 mr-1 text-destructive" />Risks Identified ({risks.length})
                    </p>
                    <div className="space-y-2">
                      {risks.map((r: any, i: number) => (
                        <div key={i} className="flex items-start gap-3 p-2 rounded-lg bg-red-500/5">
                          <Badge variant={r.severity === "HIGH" ? "destructive" : "secondary"} className="text-[9px] mt-0.5">{r.severity}</Badge>
                          <div>
                            <p className="text-[13px] font-medium text-foreground">{r.title}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">{r.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
            <div className="space-y-4">
              {/* Sentiment */}
              <Card className="px-5">
                <CardContent>
                  <p className="text-[11px] font-semibold uppercase tracking-wider mb-2 text-muted-foreground">Sentiment</p>
                  <div className="flex items-center gap-2">
                    <span className={cn("w-3 h-3 rounded-full", sentimentDotMap[meeting.sentiment || "neutral"])} />
                    <span className={cn("text-[13px] font-semibold capitalize", sentimentColorMap[meeting.sentiment || "neutral"])}>
                      {meeting.sentiment || "neutral"}
                    </span>
                  </div>
                </CardContent>
              </Card>
              {/* Speaker Breakdown */}
              {speakers.length > 0 && (
                <Card className="px-5">
                  <CardContent>
                    <p className="text-[11px] font-semibold uppercase tracking-wider mb-3 text-muted-foreground">Speaker Breakdown</p>
                    <div className="flex items-center gap-4">
                      <div style={{ width: 120, height: 120 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={speakers.map((s: any, i: number) => ({ name: s.name, value: s.minutes || s.percentage || 1, color: ["#6366F1","#22D3EE","#F59E0B","#8B5CF6","#10B981","#EF4444"][i % 6] }))}
                              dataKey="value" cx="50%" cy="50%" innerRadius={30} outerRadius={50} paddingAngle={3}>
                              {speakers.map((_: any, i: number) => <Cell key={i} fill={["#6366F1","#22D3EE","#F59E0B","#8B5CF6","#10B981","#EF4444"][i % 6]} />)}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex-1 space-y-2">
                        {speakers.map((s: any, i: number) => (
                          <div key={i} className="flex items-center justify-between text-[11px]">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ["#6366F1","#22D3EE","#F59E0B","#8B5CF6","#10B981","#EF4444"][i % 6] }} />
                              <span>{s.name}</span>
                            </div>
                            <span className="text-muted-foreground">{s.minutes ? `${s.minutes}m` : ""} ({s.percentage}%)</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
              {/* Agent info */}
              {meeting.agent && (
                <Card className="px-5">
                  <CardContent>
                    <p className="text-[11px] font-semibold uppercase tracking-wider mb-2 text-muted-foreground">Processed By</p>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                        style={{ background: meeting.agent.gradient || "#6366F1" }}>{meeting.agent.name[0]}</div>
                      <span className="text-sm font-medium">{meeting.agent.name}</span>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* TRANSCRIPT */}
        {detailTab === "transcript" && (
          <Card className="!py-0 !gap-0">
            <div className="px-4 py-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input value={searchTranscript} onChange={e => setSearchTranscript(e.target.value)}
                  placeholder="Search transcript..." className="w-full pl-9 pr-3 py-1.5 text-[13px] rounded-lg outline-none bg-muted/50 border border-border text-foreground placeholder:text-muted-foreground" />
              </div>
            </div>
            <div className="max-h-[500px] overflow-y-auto p-4">
              {transcript ? (
                <pre className="text-[13px] leading-relaxed whitespace-pre-wrap text-foreground font-sans">
                  {searchTranscript ? transcript.split("\n").filter((l: string) => l.toLowerCase().includes(searchTranscript.toLowerCase())).join("\n") : transcript}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">No transcript available.</p>
              )}
            </div>
          </Card>
        )}

        {/* ACTIONS */}
        {detailTab === "actions" && (
          <div className="space-y-3">
            {actions.length > 0 && (
              <div className="flex justify-end">
                <Button variant="default" size="sm"><Plus className="h-3.5 w-3.5 mr-1" /> Add All to Project Tasks</Button>
              </div>
            )}
            {actions.length === 0 ? (
              <div className="text-center py-12"><CheckCircle2 className="w-8 h-8 text-muted-foreground mx-auto mb-3" /><p className="text-sm text-muted-foreground">No action items extracted.</p></div>
            ) : actions.map((a: any) => (
              <Card key={a.id}>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {a.status === "DONE" ? <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" /> : <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />}
                      <div>
                        <p className="text-[13px] font-medium text-foreground">{a.text}</p>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                          {a.assignee && <span>{a.assignee}</span>}
                          {a.assignee && a.deadline && <span>·</span>}
                          {a.deadline && <span>{a.deadline}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 items-center">
                      <Badge variant={a.status === "DONE" ? "default" : "secondary"}>{a.status}</Badge>
                      {a.status !== "DONE" && <Button variant="ghost" size="sm">Add to Tasks</Button>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* DECISIONS */}
        {detailTab === "decisions" && (
          <div className="space-y-3">
            {decisions.length === 0 ? (
              <div className="text-center py-12"><FileText className="w-8 h-8 text-muted-foreground mx-auto mb-3" /><p className="text-sm text-muted-foreground">No decisions extracted.</p></div>
            ) : decisions.map((d: any, i: number) => (
              <Card key={i}>
                <CardContent>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-violet-500/10">
                      <span className="text-[14px]">🔷</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-[14px] font-semibold text-foreground">{d.text}</p>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                        <span>Decided by: <strong className="text-foreground">{d.by}</strong></span>
                      </div>
                      {d.rationale && (
                        <p className="text-[12px] mt-2 px-3 py-2 rounded-lg bg-muted/50 text-muted-foreground">Rationale: {d.rationale}</p>
                      )}
                    </div>
                    <Button variant="ghost" size="sm">Add to Decision Log</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── List view ───
  return (
    <div className="space-y-6 max-w-[1100px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Meetings</h1>
          <p className="text-sm text-muted-foreground mt-1">Upload transcripts, review AI-extracted insights</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowUpload(true)}>
            <Upload className="h-3.5 w-3.5 mr-1" /> Upload Transcript
          </Button>
          <Button size="sm" onClick={() => setShowUpload(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New Meeting
          </Button>
        </div>
      </div>

      {/* Upload/Paste Modal */}
      {showUpload && <TranscriptUploadModal onClose={() => setShowUpload(false)} />}

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div>
          <h2 className="text-[15px] font-semibold text-foreground mb-3">Upcoming Meetings</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {upcoming.map((u: any) => (
              <Card key={u.id} className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all" onClick={() => { setSelectedMeeting(u.id); setDetailTab("summary"); }}>
                <CardContent>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[16px]">{PLATFORM_ICONS[u.platform || "other"]}</span>
                    <span className="text-[12px] font-semibold text-foreground">
                      {u.scheduledAt ? new Date(u.scheduledAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "TBD"}
                    </span>
                  </div>
                  <p className="text-[13px] font-medium text-foreground">{u.title}</p>
                  {u.project && <p className="text-[11px] mt-0.5 text-muted-foreground">{u.project.name}</p>}
                  <div className="flex items-center justify-between mt-3">
                    {u.agent && (
                      <div className="flex items-center gap-1.5">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                          style={{ background: u.agent.gradient || "#6366F1" }}>{u.agent.name[0]}</div>
                        <span className="text-[10px] text-muted-foreground">{u.agent.name}</span>
                      </div>
                    )}
                    <Badge variant="default" className="gap-1">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Scheduled
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Past Meetings */}
      <div>
        <h2 className="text-[15px] font-semibold mb-3 text-foreground">Past Meetings</h2>
        {past.length === 0 ? (
          <div className="text-center py-16">
            <Bot className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-bold mb-2">No meetings yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Upload a transcript or paste meeting notes to get started.</p>
            <Button onClick={() => setShowUpload(true)}><Upload className="h-4 w-4 mr-1" /> Upload Transcript</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {past.map((m: any) => (
              <Card key={m.id} className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all"
                onClick={() => { setSelectedMeeting(m.id); setDetailTab("summary"); }}>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="text-center w-[50px]">
                        <p className="text-[11px] text-muted-foreground">{new Date(m.createdAt).toLocaleDateString("en-GB", { month: "short" })}</p>
                        <p className="text-[18px] font-bold text-foreground">{new Date(m.createdAt).getDate()}</p>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span>{PLATFORM_ICONS[m.platform || "other"]}</span>
                          <p className="text-[14px] font-semibold text-foreground">{m.title}</p>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                          {m.duration && <><span>{m.duration} min</span><span>·</span></>}
                          {m.project && <><span>{m.project.name}</span><span>·</span></>}
                          <span>{timeAgo(m.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      {m.summary && <Badge variant="default">Summarised</Badge>}
                      {m.actionItems?.length > 0 && <Badge variant="default">{m.actionItems.length} Actions</Badge>}
                      {m.confidence && <Badge variant="secondary">{m.confidence}%</Badge>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Transcript Upload Modal ───

function TranscriptUploadModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"paste" | "upload">("paste");
  const [title, setTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [projectId, setProjectId] = useState("");
  const [platform, setPlatform] = useState("other");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const { data: projects } = useProjects();
  const { data: agents } = useAgents();
  const createMeeting = useCreateMeeting();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setTranscript(text);
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
    };
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    if (!title.trim()) { setError("Title is required"); return; }
    if (!transcript.trim()) { setError("Transcript content is required"); return; }

    setIsSubmitting(true);
    setError("");

    try {
      // Find first active agent for the project
      const projectAgents = agents?.filter((a: any) => a.status === "ACTIVE") || [];
      const agentId = projectAgents[0]?.id || null;

      await createMeeting.mutateAsync({
        title: title.trim(),
        rawTranscript: transcript.trim(),
        projectId: projectId || null,
        platform,
        agentId,
      });
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to process transcript");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-bold">Upload Meeting Transcript</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
          </div>

          {/* Title */}
          <label className="block mb-4">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Meeting Title</span>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Sprint Planning — CRM Migration"
              className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/20" />
          </label>

          {/* Project & Platform */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Project</span>
              <select value={projectId} onChange={e => setProjectId(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground outline-none">
                <option value="">No project</option>
                {(projects || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Platform</span>
              <select value={platform} onChange={e => setPlatform(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground outline-none">
                <option value="zoom">Zoom</option>
                <option value="teams">Microsoft Teams</option>
                <option value="meet">Google Meet</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>

          {/* Paste / Upload tabs */}
          <div className="flex gap-1 p-1 rounded-lg bg-muted/50 mb-3">
            <button onClick={() => setTab("paste")}
              className={cn("flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                tab === "paste" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
              <Copy className="inline h-3.5 w-3.5 mr-1" /> Paste Transcript
            </button>
            <button onClick={() => setTab("upload")}
              className={cn("flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                tab === "upload" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
              <Upload className="inline h-3.5 w-3.5 mr-1" /> Upload File
            </button>
          </div>

          {tab === "paste" ? (
            <textarea value={transcript} onChange={e => setTranscript(e.target.value)}
              placeholder={"Paste your meeting transcript here...\n\nSupported formats:\n• Plain text notes\n• Speaker-labelled transcript (e.g. \"Sarah: I think we should...\")\n• Zoom/Teams exported transcript\n• Meeting minutes or notes"}
              className="w-full h-48 px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none resize-y font-mono"
            />
          ) : (
            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
              <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground mb-2">Drop a transcript file or click to browse</p>
              <p className="text-[10px] text-muted-foreground mb-4">Supports .txt, .vtt, .srt, .md</p>
              <input type="file" accept=".txt,.vtt,.srt,.md,.csv" onChange={handleFileUpload} className="hidden" id="file-upload" />
              <label htmlFor="file-upload"><Button variant="outline" size="sm" className="cursor-pointer" asChild><span>Browse Files</span></Button></label>
              {transcript && <p className="text-xs text-emerald-500 mt-3">✓ File loaded ({transcript.length.toLocaleString()} characters)</p>}
            </div>
          )}

          {/* Info */}
          <div className="mt-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
            <p className="text-[11px] text-muted-foreground">
              <Bot className="inline h-3.5 w-3.5 mr-1 text-primary" />
              Your AI agent will analyse the transcript and extract: <strong>summary</strong>, <strong>action items</strong>, <strong>decisions</strong>, <strong>risks</strong>, and <strong>speaker breakdown</strong>. Costs 5 credits.
            </p>
          </div>

          {error && <p className="text-sm text-destructive mt-3">{error}</p>}

          <div className="flex justify-end gap-2 mt-5">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isSubmitting || !title.trim() || !transcript.trim()}>
              {isSubmitting ? (
                <><span className="animate-spin mr-1">⏳</span> Processing...</>
              ) : (
                <><FileText className="h-4 w-4 mr-1" /> Process Transcript</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
