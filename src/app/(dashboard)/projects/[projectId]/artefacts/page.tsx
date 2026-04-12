"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { SpreadsheetViewer } from "@/components/documents/SpreadsheetViewer";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isSpreadsheetArtefact } from "@/lib/artefact-types";
import { marked } from "marked";
import { Progress } from "@/components/ui/progress";
import {
  FileText, FolderOpen, Upload, Clock, Download, Eye, CheckCircle2,
  XCircle, ChevronDown, Edit3, RefreshCw, Bot, ArrowRight, Sparkles, AlertCircle, CalendarDays,
} from "lucide-react";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  APPROVED: "default",
  DRAFT: "outline",
  PENDING_REVIEW: "secondary",
  REJECTED: "destructive",
};

const FORMAT_LABEL: Record<string, string> = {
  markdown: "Word", html: "Word", table: "Excel",
  pdf: "PDF", docx: "Word", xlsx: "Excel", csv: "Excel",
};

/** Convert markdown to HTML for TipTap editor */
function markdownToHtml(md: string): string {
  try {
    return marked.parse(md, { gfm: true, breaks: true }) as string;
  } catch {
    return md.replace(/\n/g, "<br>");
  }
}

export default function ArtefactsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);
  const qc = useQueryClient();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editorArt, setEditorArt] = useState<any>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [generating, setGenerating] = useState(false);

  /** Invalidate cache so next render fetches fresh data from server */
  const refreshArtefacts = () => {
    qc.invalidateQueries({ queryKey: ["project-artefacts", projectId] });
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const items = artefacts || [];
  const approved = items.filter((a: any) => a.status === "APPROVED").length;
  const inReview = items.filter((a: any) => a.status === "PENDING_REVIEW").length;
  const drafts = items.filter((a: any) => a.status === "DRAFT").length;

  /** Optimistically patch a single artefact in the cache; returns a rollback fn */
  const optimisticPatch = (artId: string, patch: Record<string, any>) => {
    const prev = qc.getQueryData(["project-artefacts", projectId]);
    qc.setQueryData(["project-artefacts", projectId], (old: any) =>
      Array.isArray(old) ? old.map((a: any) => a.id === artId ? { ...a, ...patch } : a) : old
    );
    return () => qc.setQueryData(["project-artefacts", projectId], prev);
  };

  const handleSave = async (content: string, comment?: string) => {
    if (!editorArt) return;
    // Optimistically update content in list cache
    const rollback = optimisticPatch(editorArt.id, { content });
    setEditorArt((prev: any) => prev ? { ...prev, content } : null);
    const res = await fetch(`/api/agents/artefacts/${editorArt.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, feedback: comment }),
    });
    if (res.ok) {
      toast.success("Document saved");
      refreshArtefacts(); // background sync
    } else {
      rollback();
      toast.error("Save failed");
    }
  };

  const handleApprove = async (id?: string) => {
    const artId = id || editorArt?.id;
    if (!artId) return;
    // Optimistically mark as APPROVED immediately — list never goes empty
    const rollback = optimisticPatch(artId, { status: "APPROVED" });
    setEditorArt(null); // close editor, show list (already has updated cache)

    // Check if this is the last non-approved artefact BEFORE the API call
    const pendingAfter = items.filter((a: any) =>
      a.id !== artId && (a.status === "DRAFT" || a.status === "PENDING_REVIEW")
    );
    const wasLastPending = pendingAfter.length === 0 && items.length > 0;

    const res = await fetch(`/api/agents/artefacts/${artId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "APPROVED" }),
    });
    if (res.ok) {
      if (wasLastPending) {
        toast.success("All artefacts approved! Generating next phase documents…", { duration: 5000 });
        // Auto-advance: compute next phase from project data and pass it explicitly
        const activeIdx = project?.phases?.findIndex((p: any) => p.status === "ACTIVE") ?? -1;
        const nextPhaseName = (activeIdx >= 0 && activeIdx < (project?.phases?.length ?? 0) - 1)
          ? project.phases[activeIdx + 1].name
          : undefined;
        handleGenerate(nextPhaseName);
      } else {
        toast.success("Artefact approved ✓");
      }
      refreshArtefacts(); // background sync
    } else {
      rollback();
      toast.error("Approval failed");
    }
  };

  const handleReject = async (reason: string) => {
    const artId = editorArt?.id || feedbackId;
    if (!artId) return;
    // Optimistically mark as REJECTED immediately
    const rollback = optimisticPatch(artId, { status: "REJECTED", feedback: reason || "Rejected" });
    setFeedbackId(null);
    setFeedbackText("");
    setEditorArt(null);
    const res = await fetch(`/api/agents/artefacts/${artId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "REJECTED", feedback: reason || "Rejected" }),
    });
    if (res.ok) {
      toast.success("Artefact rejected");
      refreshArtefacts(); // background sync
    } else {
      rollback();
      toast.error("Rejection failed");
    }
  };

  const handleGenerate = async (explicitPhase?: string) => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/artefacts/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(explicitPhase ? { phase: explicitPhase } : {}),
      });
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      if (res.ok && json?.data) {
        const { generated, skipped, phase } = json.data;
        if (generated > 0) {
          toast.success(`Generated ${generated} artefact(s) for ${phase} phase`);
          refreshArtefacts();
        } else {
          toast.info(`All ${phase} artefacts already exist (${skipped} found)`);
        }
      } else {
        toast.error(json?.error || `Error ${res.status}: ${text.slice(0, 80)}`);
      }
    } catch (e: any) {
      toast.error(e?.message || "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleSyncSchedule = async (art: any) => {
    toast.loading("Syncing data…", { id: `sync-${art.id}` });
    try {
      const res = await fetch(`/api/agents/artefacts/${art.id}/sync-schedule`, { method: "POST" });
      const json = await res.json();
      if (res.ok) {
        toast.success(json.data?.message || "Data synced ✓", { id: `sync-${art.id}` });
      } else {
        toast.error(json.error || "Sync failed", { id: `sync-${art.id}` });
      }
    } catch (e: any) {
      toast.error(e?.message || "Sync failed", { id: `sync-${art.id}` });
    }
  };

  const handleDownload = (artefact: any, format: "docx" | "pdf" | "md" = "docx") => {
    const a = document.createElement("a");
    a.href = `/api/agents/artefacts/${artefact.id}/export?format=${format}`;
    if (format === "pdf") {
      // Open in new tab so browser print dialog can generate the PDF
      window.open(a.href, "_blank");
    } else {
      a.download = `${artefact.name.replace(/[^a-zA-Z0-9\s]/g, "").trim().replace(/\s+/g, "_")}.${format}`;
      a.click();
    }
  };

  // ── Full-screen viewer — SpreadsheetViewer for tabular artefacts, DocumentEditor for prose ──
  if (editorArt) {
    const isSheet = editorArt.format === "csv" || editorArt.format === "table" || isSpreadsheetArtefact(editorArt.name);

    if (isSheet) {
      return (
        <SpreadsheetViewer
          reportId={editorArt.id}
          title={editorArt.name}
          content={editorArt.content || ""}
          status={editorArt.status}
          projectName={project?.name}
          onSave={handleSave}
          onApprove={editorArt.status !== "APPROVED" ? () => handleApprove() : undefined}
          onReject={editorArt.status !== "APPROVED" ? (reason) => handleReject(reason) : undefined}
          onClose={() => setEditorArt(null)}
        />
      );
    }

    // Determine HTML content:
    // 1. format === "html" or content starts with "<" → already HTML, pass directly
    // 2. format === "markdown" → convert via marked
    const rawContent = editorArt.content || "";
    const htmlContent = (editorArt.format === "html" || rawContent.trimStart().startsWith("<"))
      ? rawContent
      : markdownToHtml(rawContent);

    return (
      <DocumentEditor
        reportId={editorArt.id}
        title={editorArt.name}
        content={htmlContent}
        status={editorArt.status}
        type={editorArt.format || "markdown"}
        projectName={project?.name}
        onSave={handleSave}
        onApprove={editorArt.status !== "APPROVED" ? () => handleApprove() : undefined}
        onReject={editorArt.status !== "APPROVED" ? (reason) => handleReject(reason) : undefined}
        onExportPDF={() => handleDownload(editorArt, "pdf")}
        onExportDOCX={() => handleDownload(editorArt, "docx")}
        onClose={() => setEditorArt(null)}
      />
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Artefacts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {items.length} documents · {approved} approved · {inReview} in review
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleGenerate} disabled={generating}>
            <RefreshCw className={`h-4 w-4 mr-2 ${generating ? "animate-spin" : ""}`} />
            {generating ? "Generating…" : "Generate Artefacts"}
          </Button>
          <Button size="sm" variant="outline">
            <Upload className="h-4 w-4 mr-2" />Upload Document
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</p>
              <p className="text-2xl font-bold">{items.length}</p>
            </div>
            <FolderOpen className="w-5 h-5 text-primary" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Approved</p>
              <p className="text-2xl font-bold text-emerald-500">{approved}</p>
            </div>
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">In Review</p>
              <p className="text-2xl font-bold text-amber-500">{inReview}</p>
            </div>
            <Clock className="w-5 h-5 text-amber-500" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Drafts</p>
              <p className="text-2xl font-bold text-muted-foreground">{drafts}</p>
            </div>
            <FileText className="w-5 h-5 text-muted-foreground" />
          </div>
        </Card>
      </div>

      {/* ── Agent Status Banner ── */}
      <AgentStatusBanner
        items={items}
        project={project}
        generating={generating}
        onGenerate={handleGenerate}
      />

      {/* Document Library */}
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-16">
            <div className="flex flex-col items-center justify-center text-center">
              <FolderOpen className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <h3 className="text-lg font-medium mb-2">No artefacts yet</h3>
              <p className="text-sm text-muted-foreground max-w-md mb-6">
                Artefacts are generated by your AI agent as it progresses through project phases — charters, WBS, risk registers, reports, and more.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((art: any) => {
            const isPreview = previewId === art.id;
            const isFeedback = feedbackId === art.id;
            return (
              <Card key={art.id} className="hover:border-primary/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 cursor-pointer"
                      onClick={() => setEditorArt(art)}>
                      <FileText className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {art.agent && (
                          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                            style={{ background: art.agent.gradient?.match(/#[0-9A-Fa-f]{6}/)?.[0] || "#6366F1" }}
                            title={`Generated by ${art.agent.name}`}>
                            {art.agent.name[0]}
                          </div>
                        )}
                        <h3 className="text-sm font-semibold truncate cursor-pointer hover:text-primary transition-colors"
                          onClick={() => setEditorArt(art)}>
                          {art.name}
                        </h3>
                        <Badge variant={STATUS_VARIANT[art.status] || "outline"} className="text-[10px]">{art.status}</Badge>
                        {(art.format === "csv" || art.format === "table" || isSpreadsheetArtefact(art.name))
                          ? <Badge variant="outline" className="text-[9px] text-emerald-500 border-emerald-500/30">Spreadsheet</Badge>
                          : art.format && <Badge variant="outline" className="text-[9px]">{FORMAT_LABEL[art.format] || art.format}</Badge>
                        }
                        <span className="text-[10px] text-muted-foreground ml-auto">v{art.version || 1}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {art.agent && <span className="font-medium text-primary">{art.agent.name}</span>}
                        {art.agent && " · "}
                        {new Date(art.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        {art.content && ` · ${Math.ceil(art.content.length / 5)} words`}
                      </p>

                      {/* Inline Preview — renders both HTML and markdown cleanly */}
                      {isPreview && art.content && (
                        <div className="mt-3 p-4 rounded-lg bg-muted/30 border border-border/30 max-h-[500px] overflow-y-auto doc-preview max-w-none text-sm">
                          {(art.format === "html" || art.content.trimStart().startsWith("<"))
                            ? <div dangerouslySetInnerHTML={{ __html: art.content }} />
                            : <ReactMarkdown remarkPlugins={[remarkGfm]}>{art.content}</ReactMarkdown>
                          }
                        </div>
                      )}

                      {/* Feedback form */}
                      {isFeedback && (
                        <div className="mt-3 flex gap-2">
                          <input type="text" className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-background text-sm"
                            placeholder="Reason for rejection..." value={feedbackText}
                            onChange={(e) => setFeedbackText(e.target.value)} />
                          <Button size="sm" variant="destructive" onClick={() => handleReject(feedbackText)}>Reject</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setFeedbackId(null); setFeedbackText(""); }}>Cancel</Button>
                        </div>
                      )}

                      {art.feedback && (
                        <p className="text-xs text-muted-foreground mt-2 italic">Feedback: {art.feedback}</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => setEditorArt(art)} title="Open Editor">
                        <Edit3 className="w-4 h-4" />
                      </Button>
                      {art.content && (
                        <Button variant="ghost" size="sm" onClick={() => setPreviewId(isPreview ? null : art.id)} title="Quick Preview">
                          {isPreview ? <ChevronDown className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                      )}
                      {art.content && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => handleDownload(art, "docx")} title="Download Word (.docx)">
                            <Download className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDownload(art, "pdf")} title="Print / Save as PDF">
                            <Eye className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      {(art.status === "DRAFT" || art.status === "PENDING_REVIEW") && (
                        <>
                          <Button variant="ghost" size="sm" className="text-emerald-500" onClick={() => handleApprove(art.id)} title="Approve">
                            <CheckCircle2 className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setFeedbackId(art.id)} title="Reject">
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      {/* Sync to module — shown for approved seedable artefacts */}
                      {art.status === "APPROVED" && (() => {
                        const ln = (art.name || "").toLowerCase();
                        return (
                          ln.includes("schedule") || ln.includes("wbs") || ln.includes("work breakdown") ||
                          ln.includes("stakeholder") || ln.includes("risk register") || ln.includes("initial risk") ||
                          ln.includes("budget") || ln.includes("cost management") || ln.includes("cost plan") ||
                          ln.includes("sprint plan") || ln.includes("iteration plan")
                        );
                      })() && (
                        <Button variant="ghost" size="sm" className="text-sky-500" onClick={() => handleSyncSchedule(art)}
                          title="Sync data to project module">
                          <CalendarDays className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Agent Status Banner ──────────────────────────────────────────────────────
function AgentStatusBanner({
  items, project, generating, onGenerate,
}: {
  items: any[];
  project: any;
  generating: boolean;
  onGenerate: (phase?: string) => void;
}) {
  if (!project) return null;

  const approved  = items.filter((a: any) => a.status === "APPROVED").length;
  const pending   = items.filter((a: any) => a.status === "DRAFT" || a.status === "PENDING_REVIEW").length;
  const total     = items.length;
  const pct       = total > 0 ? Math.round((approved / total) * 100) : 0;
  const allDone   = total > 0 && pending === 0 && !generating;
  const noneYet   = total === 0 && !generating;

  // Derive current phase from project phases
  const activePhase   = project.phases?.find((p: any) => p.status === "ACTIVE");
  const nextPhase     = (() => {
    if (!project.phases?.length) return null;
    const idx = project.phases.findIndex((p: any) => p.status === "ACTIVE");
    return idx >= 0 && idx < project.phases.length - 1 ? project.phases[idx + 1] : null;
  })();
  const phaseName     = activePhase?.name || project.phases?.[0]?.name || "Pre-Project";
  const phaseNumber   = project.phases ? (project.phases.findIndex((p: any) => p.name === phaseName) + 1) : 1;
  const totalPhases   = project.phases?.length || 0;

  // Detect phases that are COMPLETED or ACTIVE but have zero artefacts in the DB
  // (indicates a phase was skipped/failed) — show recovery prompt
  const completedPhaseNames = (project.phases || [])
    .filter((p: any) => p.status === "COMPLETED" || p.status === "ACTIVE")
    .map((p: any) => p.name as string);
  const artefactPhaseNames = new Set(items.map((a: any) => a.phaseName || "").filter(Boolean));
  // Find earliest phase with no artefacts at all (not just no approved)
  const missingPhase = completedPhaseNames.find((name: string) => {
    // Check by matching artefact.phaseId or by checking if no artefacts belong to that phase
    // If artefacts don't carry phaseName we fall back to checking if ANY artefact exists
    const hasAny = artefactPhaseNames.has(name);
    return !hasAny;
  });
  // Only surface the missing phase warning if there IS a mismatch AND we have some artefacts
  const showMissingPhaseWarning = !!(missingPhase && items.length > 0 && missingPhase !== phaseName);

  // Pick the agent from the first artefact that has one, or fall back to project agents
  const agentInfo     = items.find((a: any) => a.agent)?.agent
    || project.agents?.[0]?.agent
    || null;
  const agentColor    = agentInfo?.gradient?.match(/#[0-9A-Fa-f]{6}/)?.[0] || "#6366f1";

  // Determine state
  let state: "generating" | "review" | "complete" | "empty" = "review";
  if (generating)     state = "generating";
  else if (noneYet)   state = "empty";
  else if (allDone)   state = "complete";

  const stateConfig = {
    generating: {
      border: "border-primary/30 bg-primary/5",
      badge: "bg-primary/10 text-primary",
      badgeText: "Generating…",
      icon: <RefreshCw className="w-4 h-4 animate-spin" />,
      headline: `Generating ${phaseName} documents…`,
      sub: "Your agent is writing the documents for this phase. This takes about 30–60 seconds.",
    },
    review: {
      border: "border-amber-500/30 bg-amber-500/5",
      badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      badgeText: "Awaiting Review",
      icon: <AlertCircle className="w-4 h-4" />,
      headline: `Review ${pending} document${pending === 1 ? "" : "s"} to advance`,
      sub: `Open each document below, review it, then click the green ✓ to approve. Once all ${total} are approved, your agent will automatically generate the ${nextPhase ? nextPhase.name : "next"} phase documents.`,
    },
    complete: {
      border: "border-emerald-500/30 bg-emerald-500/5",
      badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      badgeText: "Phase Complete",
      icon: <CheckCircle2 className="w-4 h-4" />,
      headline: `${phaseName} phase complete — all ${total} documents approved`,
      sub: nextPhase
        ? `Your agent is ready to start the ${nextPhase.name} phase. Click "Generate Next Phase" to continue.`
        : "All project phases complete. Your full document set is approved.",
    },
    empty: {
      border: "border-border bg-muted/20",
      badge: "bg-muted text-muted-foreground",
      badgeText: "No Documents Yet",
      icon: <FileText className="w-4 h-4" />,
      headline: "No documents generated yet",
      sub: `Click "Generate Artefacts" to have your agent create the ${phaseName} phase documents.`,
    },
  };

  const cfg = stateConfig[state];

  return (
    <>
    {/* Missing phase recovery banner */}
    {showMissingPhaseWarning && (
      <Card className="border border-amber-500/40 bg-amber-500/5">
        <CardContent className="p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <p className="text-sm text-amber-700 dark:text-amber-400">
              <span className="font-semibold">{missingPhase} phase documents are missing.</span>{" "}
              They were skipped when the phase advanced. Click to generate them now.
            </p>
          </div>
          <Button size="sm" variant="outline" className="border-amber-500/50 text-amber-600 hover:bg-amber-500/10 flex-shrink-0"
            onClick={() => onGenerate(missingPhase)} disabled={generating}>
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            Generate {missingPhase} Docs
          </Button>
        </CardContent>
      </Card>
    )}
    <Card className={`border ${cfg.border} transition-colors`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4">

          {/* Agent avatar */}
          {agentInfo ? (
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 mt-0.5"
              style={{ background: agentColor }}>
              {agentInfo.name[0]}
            </div>
          ) : (
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bot className="w-5 h-5 text-primary" />
            </div>
          )}

          {/* Main content */}
          <div className="flex-1 min-w-0">
            {/* Top row */}
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              {agentInfo && (
                <span className="text-sm font-semibold">{agentInfo.name}</span>
              )}
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.badge}`}>
                {cfg.icon}
                {cfg.badgeText}
              </span>
              {totalPhases > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  Phase {phaseNumber} of {totalPhases} · {phaseName}
                </span>
              )}
            </div>

            {/* Headline */}
            <p className="text-sm font-semibold mb-0.5">{cfg.headline}</p>
            <p className="text-xs text-muted-foreground">{cfg.sub}</p>

            {/* Progress bar — only show when there are documents */}
            {total > 0 && (
              <div className="flex items-center gap-3 mt-3">
                <Progress value={pct} className="flex-1 h-1.5" />
                <span className="text-[11px] text-muted-foreground whitespace-nowrap font-medium">
                  {approved}/{total} approved
                </span>
              </div>
            )}

            {/* Phase dots */}
            {project.phases?.length > 0 && (
              <div className="flex gap-1.5 mt-3 items-center">
                {project.phases.map((p: any, i: number) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium transition-all ${
                      p.status === "COMPLETED" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : p.status === "ACTIVE"    ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                      : "bg-muted text-muted-foreground"
                    }`}>
                      {p.status === "COMPLETED" && "✓ "}
                      {p.name}
                    </div>
                    {i < project.phases.length - 1 && (
                      <ArrowRight className="w-2.5 h-2.5 text-muted-foreground/40 flex-shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* CTA button */}
          {(state === "complete" || state === "empty") && (
            <Button size="sm" onClick={() => onGenerate(state === "complete" && nextPhase ? nextPhase.name : undefined)} disabled={generating} className="flex-shrink-0 mt-0.5">
              <Sparkles className="w-4 h-4 mr-1.5" />
              {state === "complete"
                ? (nextPhase ? `Generate ${nextPhase.name} Phase` : "Generate Next Phase")
                : "Generate Artefacts"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
    </>
  );
}
