"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useProjectArtefacts, useProject } from "@/hooks/use-api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import {
  FileText, FolderOpen, Upload, Clock, Download, Eye, CheckCircle2,
  XCircle, ChevronDown, Edit3,
} from "lucide-react";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  APPROVED: "default",
  DRAFT: "outline",
  PENDING_REVIEW: "secondary",
  REJECTED: "destructive",
};

const FORMAT_LABEL: Record<string, string> = {
  markdown: "Markdown", table: "Table", html: "HTML",
  pdf: "PDF", docx: "Word", xlsx: "Excel",
};

// Convert markdown-ish content to basic HTML for TipTap
function markdownToHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/^(?!<[hulo])/gm, (line) => line ? `<p>${line}</p>` : "")
    .replace(/<p><\/p>/g, "");
}

export default function ArtefactsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId);
  const { data: project } = useProject(projectId);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editorArt, setEditorArt] = useState<any>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");

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

  const handleSave = async (content: string, comment?: string) => {
    if (!editorArt) return;
    const res = await fetch(`/api/agents/artefacts/${editorArt.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, feedback: comment }),
    });
    if (res.ok) {
      toast.success("Document saved");
      window.location.reload();
    } else {
      toast.error("Save failed");
    }
  };

  const handleApprove = async (id?: string) => {
    const artId = id || editorArt?.id;
    if (!artId) return;
    await fetch(`/api/agents/artefacts/${artId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "APPROVED" }),
    });
    toast.success("Artefact approved");
    window.location.reload();
  };

  const handleReject = async (reason: string) => {
    const artId = editorArt?.id || feedbackId;
    if (!artId) return;
    await fetch(`/api/agents/artefacts/${artId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "REJECTED", feedback: reason || "Rejected" }),
    });
    toast.success("Artefact rejected");
    setFeedbackId(null);
    setFeedbackText("");
    setEditorArt(null);
    window.location.reload();
  };

  const handleDownload = (artefact: any) => {
    const blob = new Blob([artefact.content || ""], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${artefact.name.replace(/[^a-zA-Z0-9]/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Full-screen Document Editor ──
  if (editorArt) {
    const htmlContent = editorArt.content?.startsWith("<")
      ? editorArt.content
      : markdownToHtml(editorArt.content || "");

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
        onExportDOCX={() => handleDownload(editorArt)}
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
        <Button size="sm" variant="outline">
          <Upload className="h-4 w-4 mr-2" />Upload Document
        </Button>
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
                        {art.format && <Badge variant="outline" className="text-[9px]">{FORMAT_LABEL[art.format] || art.format}</Badge>}
                        <span className="text-[10px] text-muted-foreground ml-auto">v{art.version || 1}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {art.agent && <span className="font-medium text-primary">{art.agent.name}</span>}
                        {art.agent && " · "}
                        {new Date(art.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        {art.content && ` · ${Math.ceil(art.content.length / 5)} words`}
                      </p>

                      {/* Inline Preview */}
                      {isPreview && art.content && (
                        <div className="mt-3 p-3 rounded-lg bg-muted/30 border border-border/30 max-h-[400px] overflow-y-auto">
                          <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed">{art.content}</pre>
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
                        <Button variant="ghost" size="sm" onClick={() => handleDownload(art)} title="Download">
                          <Download className="w-4 h-4" />
                        </Button>
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
