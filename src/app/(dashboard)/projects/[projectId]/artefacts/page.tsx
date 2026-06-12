"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useProjectArtefacts, useProject, useArtefactVersions } from "@/hooks/use-api";
import { getMethodology } from "@/lib/methodology-definitions";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
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
  XCircle, ChevronDown, Edit3, RefreshCw, Bot, ArrowRight, Sparkles, AlertCircle, CalendarDays, X, RotateCcw,
} from "lucide-react";
import { useAppStore } from "@/stores/app";

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
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  // Poll every 4 s while generation is running so the list updates live
  // without the user needing to manually refresh.
  const { data: artefacts, isLoading } = useProjectArtefacts(projectId, { polling: generating || regenerating });
  const { data: project } = useProject(projectId);
  const qc = useQueryClient();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editorArt, setEditorArt] = useState<any>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  // Version history for whichever artefact is open in the editor —
  // disabled (no fetch) while no editor is open.
  const { data: editorVersions } = useArtefactVersions(editorArt?.id ?? null);

  /** Invalidate cache so next render fetches fresh data from server */
  const refreshArtefacts = () => {
    qc.invalidateQueries({ queryKey: ["project-artefacts", projectId] });
  };

  /** Build a lower-cased Set of every artefact name across every phase
   * of the project's methodology. Anything outside this set is bespoke
   * (chat-created or uploaded) — used to render the "Custom" badge. */
  const methodologyArtefactSet = (() => {
    const meth = (project as any)?.methodology;
    if (!meth) return new Set<string>();
    try {
      const def = getMethodology(meth);
      const names: string[] = [];
      for (const p of def.phases) {
        for (const a of p.artefacts) names.push(a.name.toLowerCase());
      }
      return new Set(names);
    } catch {
      return new Set<string>();
    }
  })();

  /** Lower-cased name → required flag, across every phase of the
   * methodology. Used to render a Required / Optional pill next to the
   * Methodology badge on each artefact card so the user can see at a
   * glance which methodology slot each one fills. Last write wins if
   * the same name appears in multiple phases (rare; safe to ignore). */
  const methodologyRequiredByName = (() => {
    const map = new Map<string, boolean>();
    const meth = (project as any)?.methodology;
    if (!meth) return map;
    try {
      const def = getMethodology(meth);
      for (const p of def.phases) {
        for (const a of p.artefacts) {
          if (a.aiGeneratable) map.set(a.name.toLowerCase(), !!a.required);
        }
      }
    } catch { /* ignore */ }
    return map;
  })();

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
      qc.invalidateQueries({ queryKey: ["artefact-versions", editorArt.id] });
    } else {
      rollback();
      toast.error("Save failed");
    }
  };

  /** Restore a past version's content as a new save (the replaced content
   * is itself snapshotted server-side, so nothing is lost). TipTap only
   * reads its content prop on mount, so close the editor afterwards —
   * reopening shows the restored content. */
  const handleRestore = async (v: { version: number; content?: string }) => {
    if (!editorArt || !v.content) return;
    const artId = editorArt.id;
    const rollback = optimisticPatch(artId, { content: v.content });
    setEditorArt(null);
    const res = await fetch(`/api/agents/artefacts/${artId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: v.content, feedback: `Restored from version ${v.version}` }),
    });
    if (res.ok) {
      toast.success(`Version ${v.version} restored`);
      refreshArtefacts();
      qc.invalidateQueries({ queryKey: ["artefact-versions", artId] });
    } else {
      rollback();
      toast.error("Restore failed");
    }
  };

  const handleApprove = async (idOrConfirm?: string | boolean) => {
    // Polymorphic call:
    //   handleApprove("artefactId")          — list-row Approve button
    //   handleApprove(true)                  — DocumentEditor override approval
    //   handleApprove() / handleApprove(false) — DocumentEditor normal approval
    const isConfirmIntentional = typeof idOrConfirm === "boolean" && idOrConfirm === true;
    const id = typeof idOrConfirm === "string" ? idOrConfirm : undefined;
    const artId = id || editorArt?.id;
    if (!artId) return;
    // Optimistically mark as APPROVED immediately — list never goes empty
    const rollback = optimisticPatch(artId, { status: "APPROVED" });
    setEditorArt(null); // close editor, show list (already has updated cache)

    const res = await fetch(`/api/agents/artefacts/${artId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "APPROVED", confirmNotNames: true, ...(isConfirmIntentional ? { confirmIntentional: true } : {}) }),
    });
    if (res.ok) {
      refreshArtefacts(); // background sync
      // ── Phase-advance gate ──
      // Previously: counted pending artefacts in the local items[] array and
      // fired handleGenerate() the moment the last DRAFT was approved. That
      // bypassed PM tasks, gate prerequisites, delivery threshold and active
      // clarification — i.e. it advanced the phase even when getPhaseCompletion
      // would have blocked it. The user then saw "Generating next phase…"
      // while the tracker still showed open blockers.
      //
      // Now: defer the decision to the authoritative /phase-completion endpoint
      // (the single source of truth used by gate creation, gate approval,
      // pipeline, metrics and tracker). Only fire handleGenerate when the
      // endpoint says canAdvance === true; otherwise surface the blockers
      // so the user knows exactly what's left.
      const agentId = project?.agents?.[0]?.agent?.id;
      if (!agentId) {
        toast.success("Artefact approved ✓");
      } else {
        try {
          const pcRes = await fetch(`/api/agents/${agentId}/phase-completion`);
          const pcJson = pcRes.ok ? await pcRes.json() : null;
          const currentPhaseName: string | undefined = pcJson?.data?.currentPhase;
          const currentCompletion = Array.isArray(pcJson?.data?.phases)
            ? pcJson.data.phases.find((p: any) => p.phaseName === currentPhaseName)
            : null;
          if (currentCompletion?.canAdvance) {
            toast.success("All gate requirements met — generating next phase…", { duration: 5000 });
            // Delay slightly so the phase-advance DB write propagates before we hit the generate endpoint
            setTimeout(() => handleGenerate(), 1500);
          } else if (Array.isArray(currentCompletion?.blockers) && currentCompletion.blockers.length > 0) {
            // Intentionally NO count here. `blockers` from /phase-completion is a
            // list of categorical blockers ("3 artefacts not yet approved",
            // "2 PM tasks incomplete"), but the PM Tracker renders every
            // individual row inside those categories. Showing blockers.length
            // mismatched the tracker's row count and confused users.
            toast.success(
              `Artefact approved ✓ — the phase isn't ready to advance yet. Open the PM Tracker to see what's left.`,
              { duration: 6000 },
            );
          } else {
            toast.success("Artefact approved ✓");
          }
        } catch {
          toast.success("Artefact approved ✓");
        }
      }
    } else {
      rollback();
      // Parse the actual API error so the user knows what to fix.
      // overrideFlags is non-null when the user can "Approve anyway" from
      // the toast — applies to both fabricated-name false positives and
      // contradiction overrides. Without the inline action the user has
      // to open the document editor and find a separately-placed
      // override button, which they reported as un-findable.
      let errMsg = "Approval failed";
      let overrideFlags: { confirmNotNames?: boolean; confirmIntentional?: boolean } | null = null;
      try {
        const body = await res.json();
        if (body.error === "Artefact contains fabricated names" && Array.isArray(body.fabricatedNames)) {
          const count = body.fabricatedNames.length;
          const samples = body.fabricatedNames.slice(0, 3).map((v: any) => v.name || v).join(", ");
          errMsg = `Can't approve — ${count} flagged token${count === 1 ? "" : "s"} (${samples}${count > 3 ? "…" : ""}). If these are real fabricated names, edit them out. If they're concept phrases mis-flagged by the heuristic, use "Approve anyway".`;
          overrideFlags = { confirmNotNames: true };
        } else if (body.error === "Artefact contradicts confirmed facts" && Array.isArray(body.contradictions)) {
          const c = body.contradictions.length;
          const samples = body.contradictions.slice(0, 3).map((v: any) => v.field || v.drafted || "").filter(Boolean).join(", ");
          errMsg = `${c} contradiction${c === 1 ? "" : "s"} with confirmed facts${samples ? ` (${samples}${c > 3 ? "…" : ""})` : ""}. Use "Approve anyway" if you're happy to proceed.`;
          overrideFlags = { confirmIntentional: true };
        } else if (body.message) {
          errMsg = body.message.slice(0, 200);
        } else if (body.error) {
          errMsg = body.error.slice(0, 200);
        }
      } catch {}
      if (overrideFlags) {
        // Inline override action — retries the same PATCH with the
        // appropriate confirm-* flag so the server lets the approval
        // through and stamps the override on the audit trail. One toast
        // covers both contradiction and fabricated-name overrides so the
        // pattern is consistent.
        //
        // The retry must KEEP confirmNotNames=true (the baseline every
        // first attempt sends, line ~195) on top of the override flags.
        // Previously it sent only `flags`, so an artefact flagged with
        // BOTH fabricated names and contradictions failed its retry on
        // the names gate the first attempt had already passed — the user
        // clicked "Approve anyway" and got a dead-end "Override failed".
        // The agent-detail page (agents/[agentId]/page.tsx) always sent
        // both flags together; this now matches it.
        const flags = overrideFlags;
        toast.error(errMsg, {
          duration: 12000,
          action: {
            label: "Approve anyway",
            onClick: async () => {
              const rb = optimisticPatch(artId, { status: "APPROVED" });
              const r2 = await fetch(`/api/agents/artefacts/${artId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "APPROVED", confirmNotNames: true, ...flags }),
              });
              if (r2.ok) { refreshArtefacts(); toast.success("Artefact approved ✓ (override stamped on audit trail)"); }
              else {
                rb();
                // Surface the server's reason — "see console" was a dead end.
                let why = "";
                try { const b = await r2.clone().json(); why = (b.message || b.error || "").slice(0, 250); } catch {}
                toast.error(why ? `Override failed — ${why}` : "Override failed — please retry or contact support", { duration: 12000 });
                console.error(await r2.text());
              }
            },
          },
        });
      } else {
        toast.error(errMsg, { duration: 8000 });
      }
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
        } else if (skipped > 0) {
          toast.info(`All ${phase} artefacts already exist (${skipped} found)`);
        } else {
          toast.info(`Generation deferred — your agent has questions to answer first. Open Chat to respond.`);
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

  const handleRegenerate = async (explicitPhase?: string) => {
    if (!confirm("Delete all DRAFT and REJECTED artefacts and regenerate from scratch with the latest prompt rules? Approved artefacts will be preserved.")) return;
    setRegenerating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/artefacts/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(explicitPhase ? { phase: explicitPhase } : {}),
      });
      const json = await res.json();
      if (res.ok && json?.data) {
        const { generated, phase, draftsDeleted } = json.data;
        toast.success(`Regenerated ${generated} artefact(s) for ${phase} — ${draftsDeleted} old draft/rejected replaced.`, { duration: 5000 });
        refreshArtefacts();
      } else {
        toast.error(json?.error || "Regeneration failed");
      }
    } catch (e: any) {
      toast.error(e?.message || "Regeneration failed");
    } finally {
      setRegenerating(false);
    }
  };

  // Per-artefact regenerate — for a single rejected artefact. Deletes that
  // record then triggers phase-level regeneration so the agent recreates it.
  const handleRegenerateOne = async (art: any) => {
    if (!confirm(`Regenerate "${art.name}"? The current rejected version will be deleted and the agent will produce a fresh draft that addresses your rejection feedback.`)) return;
    setRegenerating(true);
    try {
      // Capture rejection feedback BEFORE deletion so the regeneration prompt
      // can address it explicitly. The DELETE below removes the row.
      // Skip if the row was REJECTED because of a generation failure — that
      // feedback is a technical error ("Anthropic API error 500"), not a
      // critique the next attempt should address. metadata.systemFailure
      // flags those rows; see lifecycle-init.ts retry-with-REJECTED path.
      const priorFeedback: Record<string, string> = {};
      const isSystemFailure = (art?.metadata as any)?.systemFailure === true;
      if (!isSystemFailure && art.feedback && typeof art.feedback === "string" && art.feedback.trim().length > 0) {
        priorFeedback[art.name] = art.feedback;
      }

      const del = await fetch(`/api/agents/artefacts/${art.id}`, { method: "DELETE" });
      if (!del.ok) {
        const j = await del.json().catch(() => ({}));
        throw new Error(j?.error || `Could not delete rejected artefact (${del.status})`);
      }
      // Backend defaults to deployment.currentPhase when no phase is passed.
      // Pass priorFeedback so Sonnet sees the rejection reason in its prompt.
      const res = await fetch(`/api/projects/${projectId}/artefacts/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(art.phaseName ? { phase: art.phaseName } : {}),
          ...(Object.keys(priorFeedback).length > 0 ? { priorFeedback } : {}),
        }),
      });
      const json = await res.json();
      if (res.ok && json?.data) {
        toast.success(`"${art.name}" regenerated.`, { duration: 5000 });
        refreshArtefacts();
      } else {
        toast.error(json?.error || "Regeneration failed");
      }
    } catch (e: any) {
      toast.error(e?.message || "Regeneration failed");
    } finally {
      setRegenerating(false);
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
        metadata={editorArt.metadata}
        versions={editorVersions || []}
        onSave={handleSave}
        onRestore={handleRestore}
        onApprove={editorArt.status !== "APPROVED" ? (confirmIntentional) => handleApprove(confirmIntentional) : undefined}
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
          <Button size="sm" variant="outline" onClick={() => handleGenerate()} disabled={generating || regenerating}>
            <RefreshCw className={`h-4 w-4 mr-2 ${generating ? "animate-spin" : ""}`} />
            {generating ? "Generating…" : "Generate Artefacts"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleRegenerate()} disabled={generating || regenerating}
            title="Delete all DRAFT artefacts and regenerate from scratch using the latest prompt rules. Approved artefacts are preserved.">
            <RefreshCw className={`h-4 w-4 mr-2 ${regenerating ? "animate-spin" : ""}`} />
            {regenerating ? "Regenerating…" : "Regenerate (Fresh)"}
          </Button>
          <Button size="sm" variant="outline">
            <Upload className="h-4 w-4 mr-2" />Upload Document
          </Button>
          {/* Bespoke-document CTA — deep-links to chat with a starter prompt */}
          {(() => {
            const firstAgent = items.find((a: any) => a.agent?.id)?.agent;
            const agentId = firstAgent?.id || "";
            const agentName = firstAgent?.name || "your agent";
            const promptText = "Create a custom document for this project — please ask me what kind I need (e.g. vendor comparison, status update, risk heat map).";
            const href = agentId
              ? `/agents/chat?agent=${agentId}&prompt=${encodeURIComponent(promptText)}`
              : `/agents/chat?prompt=${encodeURIComponent(promptText)}`;
            return (
              <Link href={href} title={`Ask ${agentName} in chat to create any custom document not covered by the methodology.`}>
                <Button size="sm" variant="default" className="gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Ask {agentName} for a custom document
                </Button>
              </Link>
            );
          })()}
        </div>
      </div>

      {/* Custom-document quick prompts — single click prefills the chat with
          a focused starter so users see what kinds of bespoke artefacts the
          agent can produce on demand. */}
      {(() => {
        const firstAgentId = items.find((a: any) => a.agent?.id)?.agent?.id || "";
        const SUGGESTIONS: Array<{ label: string; prompt: string }> = [
          { label: "Vendor Comparison", prompt: "Create a Vendor Comparison Report covering the top 3 candidate vendors for this project — include price, fit, risks, and a recommendation." },
          { label: "Status Update", prompt: "Create a one-page Status Update for this week — RAG, key milestones, top 3 risks, what's blocked, and the next 7 days." },
          { label: "Risk Heat Map", prompt: "Create a Risk Heat Map as a CSV with severity (1-5) on one axis and likelihood (1-5) on the other, listing each open risk in its cell." },
          { label: "Meeting Minutes", prompt: "Create Meeting Minutes for our last meeting — attendees, decisions, action items with owners and due dates, and follow-up notes." },
          { label: "Lessons Capture", prompt: "Create a Lessons Capture document recording what's worked well so far in this project, what hasn't, and what we'd do differently next time." },
        ];
        const baseHref = (prompt: string) => firstAgentId
          ? `/agents/chat?agent=${firstAgentId}&prompt=${encodeURIComponent(prompt)}`
          : `/agents/chat?prompt=${encodeURIComponent(prompt)}`;
        return (
          <div className="flex items-center gap-2 flex-wrap text-[11px]">
            <span className="text-muted-foreground">Try:</span>
            {SUGGESTIONS.map(s => (
              <Link
                key={s.label}
                href={baseHref(s.prompt)}
                className="px-2.5 py-1 rounded-full border border-border bg-muted/40 text-muted-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/30 transition-colors"
                title={s.prompt}
              >
                {s.label}
              </Link>
            ))}
          </div>
        );
      })()}

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
        projectId={projectId}
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
                        {/* Source badge — methodology-defined vs bespoke (chat-created or uploaded).
                            Inferred from whether the name appears in the project methodology's
                            artefact catalogue. Bespoke ones don't gate phase advancement. */}
                        {methodologyArtefactSet.size > 0 && (() => {
                          const itemName = (art.name || "").toLowerCase().trim();
                          // Resolve to the methodology slot this artefact fills
                          // (exact match first, then fuzzy match — same logic as
                          // the missing-artefacts banner). The slot tells us
                          // whether this card sits in a required or optional
                          // position in the methodology, which we render as a
                          // second badge so the user doesn't have to guess.
                          let matchedSlot: string | null = null;
                          if (methodologyArtefactSet.has(itemName)) {
                            matchedSlot = itemName;
                          } else {
                            for (const canonical of methodologyArtefactSet) {
                              if (itemName.includes(canonical) || canonical.includes(itemName)) {
                                matchedSlot = canonical;
                                break;
                              }
                            }
                          }
                          if (!matchedSlot) {
                            return <Badge variant="outline" className="text-[9px] text-amber-400 border-amber-400/30" title="Custom document created via chat or upload — does not gate phase advancement.">Custom</Badge>;
                          }
                          const isRequired = methodologyRequiredByName.get(matchedSlot);
                          return (
                            <>
                              <Badge variant="outline" className="text-[9px] text-indigo-400 border-indigo-400/30"
                                title={matchedSlot === itemName
                                  ? "Defined by the project's methodology."
                                  : `Custom name matches the methodology's "${matchedSlot}".`}>
                                Methodology
                              </Badge>
                              {isRequired === true && (
                                <Badge variant="outline" className="text-[9px] text-red-500 border-red-500/40"
                                  title="The methodology marks this artefact as required — the phase gate blocks until it's generated and approved.">
                                  Required
                                </Badge>
                              )}
                              {isRequired === false && (
                                <Badge variant="outline" className="text-[9px] text-sky-500 border-sky-500/40"
                                  title="The methodology marks this artefact as optional — recommended but not required for phase advancement.">
                                  Optional
                                </Badge>
                              )}
                            </>
                          );
                        })()}
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
                      {art.status === "REJECTED" && (
                        <Button variant="ghost" size="sm" className="text-primary" disabled={regenerating}
                          onClick={() => handleRegenerateOne(art)}
                          title="Regenerate this rejected artefact with the latest prompt">
                          <RefreshCw className={`w-4 h-4 ${regenerating ? "animate-spin" : ""}`} />
                        </Button>
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
  items, project, projectId, generating, onGenerate,
}: {
  items: any[];
  project: any;
  projectId: string;
  generating: boolean;
  onGenerate: (phase?: string) => void;
}) {
  // Phase reversion modal — replaces the legacy prompt() flow with a proper
  // dialog that lets the user pick the target phase, capture a multi-line
  // reason, and see exactly what will happen before submitting.
  const [revertModalOpen, setRevertModalOpen] = useState(false);
  const [revertTargetPhase, setRevertTargetPhase] = useState<string>("");
  const [revertReason, setRevertReason] = useState("");
  const [reverting, setReverting] = useState(false);

  // ⚠️ HOOKS-RULE FIX (2026-06): these store reads MUST sit alongside the
  // useState declarations above so the hook call count stays constant across
  // renders. They used to live below the `if (!project) return null` guard
  // — first render (project undefined) called 4 hooks, second render
  // (project loaded) called 7. React threw error #310 ("Rendered fewer
  // hooks than expected") and the whole `/artefacts` page died with
  // "Something went wrong". Do NOT move these back below the guard.
  const dismissedArtefacts = useAppStore((s) => s.dismissedArtefacts);
  const dismissArtefact = useAppStore((s) => s.dismissArtefact);
  const restoreAllArtefacts = useAppStore((s) => s.restoreAllArtefacts);

  if (!project) return null;

  // Filter to current phase artefacts for banner state (avoid mixing phases).
  // We start with phase-matched items, then add ANY items whose name fuzzy-
  // matches a methodology-defined name for this phase even if they have no
  // phaseId set. That's what catches custom uploads like
  // "Project Brief - Family Trip to Lagos" that the user named themselves
  // and uploaded via the Upload Document button — strict phase filtering
  // dropped those, so the banner reported "0/4 approved, 3 not generated"
  // while the stats card said "2 documents, 1 approved".
  const activePhaseForFilter = project.phases?.find((p: any) => p.status === "ACTIVE");
  const phaseMatchedItems = activePhaseForFilter
    ? items.filter((a: any) => {
        const artPhase = a.phaseId || a.phaseName || "";
        return artPhase === activePhaseForFilter.name || artPhase === activePhaseForFilter.id;
      })
    : items;

  // Pull methodology-expected names for the active phase — used both for
  // expectedCount AND for absorbing custom-named items that fulfil a
  // canonical artefact slot.
  const methodologyExpectedNamesForPhase = (() => {
    const meth = (project as any)?.methodology;
    if (!meth || !activePhaseForFilter?.name) return [] as string[];
    try {
      const def = getMethodology(meth);
      const phaseDef = def.phases.find((p: any) => p.name === activePhaseForFilter.name);
      if (!phaseDef) return [];
      return phaseDef.artefacts
        .filter((a: any) => a.aiGeneratable)
        .map((a: any) => a.name as string);
    } catch {
      return [];
    }
  })();

  // Absorb un-tagged items whose name fuzzy-matches a methodology name for
  // this phase (case-insensitive substring either direction). Already-phase-
  // matched items are kept verbatim.
  const phaseMatchedIds = new Set(phaseMatchedItems.map((i: any) => i.id).filter(Boolean));
  const fuzzyAbsorbed = items.filter((a: any) => {
    if (phaseMatchedIds.has(a.id)) return false;
    const itemName = (a.name || "").toLowerCase().trim();
    if (!itemName) return false;
    return methodologyExpectedNamesForPhase.some((canonical: string) => {
      const c = canonical.toLowerCase().trim();
      return itemName === c || itemName.includes(c) || c.includes(itemName);
    });
  });
  const currentPhaseItems = [...phaseMatchedItems, ...fuzzyAbsorbed];

  // Use current phase items (including fuzzy-absorbed) for banner state.
  const approved  = currentPhaseItems.filter((a: any) => a.status === "APPROVED").length;
  const pending   = currentPhaseItems.filter((a: any) => a.status === "DRAFT" || a.status === "PENDING_REVIEW").length;
  const rejected  = currentPhaseItems.filter((a: any) => a.status === "REJECTED").length;
  const generated = currentPhaseItems.length;

  // Expected artefact count — every artefact the methodology defines as
  // ai-generatable for this phase. Same source PM Tracker uses, so the two
  // pages can never disagree.
  //
  // Earlier this filtered by `a.required === true`. For methodologies like
  // Traditional / Pre-Project where every artefact is `required: false`,
  // the count collapsed to 0 and `total` fell through to `generated.length`
  // (3) — silently hiding that Project Brief had never been drafted. The
  // PM Tracker happily showed Project Brief as "Missing" while this page
  // showed "3/3 approved", and the user couldn't reconcile the two.
  //
  // Now we count every `aiGeneratable` artefact the methodology defines.
  // The `required` flag still gates phase ADVANCEMENT (handled server-side
  // in phase-completion.ts), but it doesn't gate visibility here.
  const expectedCount = (() => {
    const meth = (project as any)?.methodology;
    if (!meth || !activePhaseForFilter?.name) return 0;
    try {
      const def = getMethodology(meth);
      const phaseDef = def.phases.find(p => p.name === activePhaseForFilter.name);
      if (!phaseDef) return 0;
      return phaseDef.artefacts.filter((a: any) => a.aiGeneratable).length;
    } catch {
      return 0;
    }
  })();
  // Missing artefacts BY NAME. Used by the "Generate the missing ones"
  // banner so the user can see exactly which optional docs the agent
  // hasn't produced yet (e.g. "Communication Plan, RACI Matrix, Quality
  // Plan"). Two-pass:
  //   1. Build a normalised Set of every currentPhaseItem's name.
  //   2. Walk the methodology's aiGeneratable artefacts for this phase
  //      and any whose name isn't in the Set are missing. Split into
  //      required vs optional so each gets its own banner styling
  //      (required = amber, optional = blue, less alarming).
  // Per-phase dismissal keys derive from the store reads hoisted above the
  // `if (!project) return null` guard at line ~718 — see the hook-rule fix
  // there. Don't redeclare the store reads here.
  const dismissalKey = activePhaseForFilter?.name
    ? `${projectId}::${activePhaseForFilter.name}`
    : "";
  const dismissedSet = new Set(dismissedArtefacts[dismissalKey] || []);

  const { missingRequiredNames, missingOptionalNames, dismissedCount } = (() => {
    const meth = (project as any)?.methodology;
    if (!meth || !activePhaseForFilter?.name) return { missingRequiredNames: [] as string[], missingOptionalNames: [] as string[], dismissedCount: 0 };
    try {
      const def = getMethodology(meth);
      const phaseDef = def.phases.find(p => p.name === activePhaseForFilter.name);
      if (!phaseDef) return { missingRequiredNames: [], missingOptionalNames: [], dismissedCount: 0 };
      const haveNames = new Set(
        currentPhaseItems.map((a: any) => (a.name || "").toLowerCase().trim())
      );
      const missingReq: string[] = [];
      const missingOpt: string[] = [];
      let dismissed = 0;
      for (const art of phaseDef.artefacts) {
        if (!art.aiGeneratable) continue;
        const c = art.name.toLowerCase().trim();
        // Fuzzy match — same logic as the absorbItems pass above. Catches
        // "Project Brief - Family Trip" as fulfilling "Project Brief".
        const have = haveNames.has(c) || Array.from(haveNames).some(h => h.includes(c) || c.includes(h));
        if (!have) {
          if (art.required) missingReq.push(art.name);
          else if (dismissedSet.has(art.name)) dismissed++;
          else missingOpt.push(art.name);
        }
      }
      return { missingRequiredNames: missingReq, missingOptionalNames: missingOpt, dismissedCount: dismissed };
    } catch {
      return { missingRequiredNames: [], missingOptionalNames: [], dismissedCount: 0 };
    }
  })();
  const total = Math.max(expectedCount, generated);
  const pct = total > 0 ? Math.round((approved / total) * 100) : 0;
  // Are any methodology-defined artefacts missing? Used to keep the banner
  // honest when every generated draft is approved but the methodology lists
  // more (e.g. 3 approved, Project Brief never drafted → not "all done").
  const missingRequired = Math.max(0, expectedCount - generated);
  // A phase is only "complete" when EVERY required artefact has been
  // generated AND every generated draft is approved. The earlier check was
  // `approved === total` where total was just generated.length — meaning a
  // phase with 3 of 4 required docs all approved would render "phase
  // complete" even though Project Brief was never created.
  const allDone   = total > 0 && approved === total && missingRequired === 0 && !generating;
  const hasRejections = rejected > 0 && !generating;
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

  // Determine state — rejections take priority over complete/review
  let state: "generating" | "review" | "rejected" | "complete" | "empty" = "review";
  if (generating)          state = "generating";
  else if (noneYet)        state = "empty";
  else if (hasRejections)  state = "rejected";
  else if (allDone)        state = "complete";

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
      headline: missingRequired > 0
        ? `${missingRequired} document${missingRequired === 1 ? "" : "s"} not yet generated`
        : `Review ${pending} document${pending === 1 ? "" : "s"} to advance`,
      // Honest copy about the actual advance sequence. Approving every
      // artefact doesn't trigger Initiation generation — it creates a
      // phase gate that the user has to approve, and the gate may have
      // other prerequisites (PM tasks, manual confirmations) the user
      // can see on the PM Tracker. The old "automatically generate the
      // Initiation phase documents" line skipped 4 intermediate steps
      // (gate approval → research → research-finding approval →
      // clarification → THEN generation).
      sub: missingRequired > 0
        ? `${approved}/${total} approved · ${missingRequired} of the ${expectedCount} documents the methodology defines for ${phaseName} haven't been generated yet. Click "Generate Artefacts" to produce the missing ones, then review and approve.`
        : `Open each document below, review it, then click the green ✓ to approve. Once all ${total} are approved, a phase gate appears on the Approvals page; gate prerequisites on the PM Tracker may also need ticking before ${nextPhase ? nextPhase.name : "the next phase"} starts. After you approve the gate, the agent runs research and any clarification questions before generating ${nextPhase ? nextPhase.name : "next-phase"} documents.`,
    },
    rejected: {
      border: "border-red-500/30 bg-red-500/5",
      badge: "bg-red-500/10 text-red-600 dark:text-red-400",
      badgeText: "Rejected — action needed",
      icon: <AlertCircle className="w-4 h-4" />,
      headline: `${rejected} document${rejected === 1 ? "" : "s"} rejected — regenerate before advancing`,
      sub: `${approved}/${total} approved, ${rejected} rejected. Open each rejected document, regenerate or edit it, then re-approve. Once approved, check the PM Tracker — gate prerequisites and manual confirmations also need to be in place before the ${nextPhase ? nextPhase.name : "next"} phase can start.`,
    },
    complete: {
      border: "border-emerald-500/30 bg-emerald-500/5",
      badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      badgeText: "Phase Complete",
      icon: <CheckCircle2 className="w-4 h-4" />,
      headline: `${phaseName} phase complete — all ${total} documents approved`,
      sub: nextPhase
        ? `All artefacts approved. Confirm the gate prerequisites are also satisfied on the PM Tracker, then click "Generate Next Phase".`
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

    {/* Missing-optionals banner — softer than the missing-required path
        because the user CAN advance without these, but they're typically
        forgotten ("did I generate the Communication Plan?") and silently
        leave the project incomplete. Skipped entirely when there's
        nothing missing OR when the current phase has nothing generated
        yet (the empty / "Generate Artefacts" state covers that case).

        Each missing item gets a small "×" so the user can mark it as
        intentionally skipped — the next reload won't re-flag it. A
        "Restore skipped" link reappears once anything is dismissed so
        nothing is permanently buried. State lives in the Zustand store
        (localStorage) keyed by `${projectId}::${phaseName}`. */}
    {missingOptionalNames.length > 0 && generated > 0 && !generating && (
      <Card className="border border-blue-500/30 bg-blue-500/5">
        <CardContent className="p-3 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <FileText className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-blue-700 dark:text-blue-400">
                <span className="font-semibold">
                  {missingOptionalNames.length} optional document{missingOptionalNames.length === 1 ? "" : "s"} not yet generated for {phaseName}
                </span>
              </p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {missingOptionalNames.map((name) => (
                  <span key={name}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20">
                    {name}
                    <button
                      type="button"
                      title={`Skip "${name}" — won't re-flag on reload`}
                      onClick={() => dismissArtefact(projectId, activePhaseForFilter?.name || phaseName, name)}
                      className="hover:bg-blue-500/20 rounded-full p-0.5 -mr-0.5"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground/80 mt-1.5">
                You can advance without these — click × to skip any you don&apos;t need.
                {dismissedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => restoreAllArtefacts(projectId, activePhaseForFilter?.name || phaseName)}
                    className="ml-2 inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    Restore {dismissedCount} skipped
                  </button>
                )}
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="border-blue-500/40 text-blue-600 hover:bg-blue-500/10 flex-shrink-0"
            onClick={() => onGenerate(phaseName)} disabled={generating}>
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            Generate missing
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

          {/* CTA buttons */}
          <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
            {(state === "complete" || state === "empty") && (
              <Button size="sm" onClick={() => onGenerate(state === "complete" && nextPhase ? nextPhase.name : undefined)} disabled={generating}>
                <Sparkles className="w-4 h-4 mr-1.5" />
                {state === "complete"
                  ? (nextPhase ? `Generate ${nextPhase.name} Phase` : "Generate Next Phase")
                  : "Generate Artefacts"}
              </Button>
            )}
            {/* Revert to previous phase — only show if not on first phase */}
            {phaseNumber > 1 && (
              <Button size="sm" variant="ghost" className="text-xs text-muted-foreground"
                onClick={() => {
                  // Default to the immediate previous phase but the modal
                  // lets the user pick any earlier one.
                  const prevPhase = project.phases?.[phaseNumber - 2];
                  setRevertTargetPhase(prevPhase?.name || "");
                  setRevertReason("");
                  setRevertModalOpen(true);
                }}>
                ← Revert Phase
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>

    {/* Phase reversion modal — replaces the old prompt() flow.
        Picks any earlier phase (not just immediate prev), captures a
        multi-line reason, and explains the side-effects up front so the
        user knows exactly what gets re-opened / deferred / closed before
        they submit. The reversion itself is gated server-side behind a
        SCOPE_CHANGE approval (executes only when an admin approves) —
        the modal makes that explicit too. */}
    {revertModalOpen && project?.phases && (
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={(e) => { if (e.target === e.currentTarget) setRevertModalOpen(false); }}>
        <div className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/15">
              <AlertCircle className="w-5 h-5 text-amber-500" />
            </div>
            <div className="flex-1">
              <h3 className="text-base font-semibold text-foreground">Revert Phase</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Step the project back to an earlier phase. Submits a SCOPE_CHANGE approval — only takes effect once an admin approves.
              </p>
            </div>
          </div>

          {/* Target phase selector — every phase BEFORE the current one */}
          <label className="block mb-4">
            <span className="text-xs font-medium text-muted-foreground mb-1.5 block">Revert to:</span>
            <select
              value={revertTargetPhase}
              onChange={(e) => setRevertTargetPhase(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {project.phases.slice(0, phaseNumber - 1).map((p: any) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </label>

          {/* Reason — multi-line */}
          <label className="block mb-4">
            <span className="text-xs font-medium text-muted-foreground mb-1.5 block">Reason for reverting <span className="text-red-500">*</span></span>
            <textarea
              value={revertReason}
              onChange={(e) => setRevertReason(e.target.value)}
              rows={3}
              placeholder="e.g. Sponsor changed, baseline assumptions invalid, scope reset…"
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
            />
          </label>

          {/* What will happen — explain ALL the side-effects up front */}
          <div className="mb-4 px-3 py-2.5 rounded-md border border-amber-500/30 bg-amber-500/5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1.5">If the admin approves, this will:</p>
            <ul className="text-[11px] text-foreground/80 space-y-0.5 list-disc list-inside">
              <li>Set <span className="font-semibold">{revertTargetPhase || "target phase"}</span> back to ACTIVE</li>
              <li>Mark phases between target and current as REVERTED (paused)</li>
              <li>Re-open the target phase&apos;s artefacts as DRAFT for revision</li>
              <li>Re-open scaffolded PM tasks tied to those artefacts and the gate-request / phase-advanced events for any reverted phase</li>
              <li>Auto-defer any pending phase-gate approvals that are no longer advance-ready</li>
              <li>Close any active clarification session — questions belong to a phase you&apos;re stepping out of</li>
              <li>Defer pending research-finding approvals scoped to the reverted-from phases</li>
            </ul>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setRevertModalOpen(false)} disabled={reverting}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-amber-500 hover:bg-amber-600 text-white"
              disabled={!revertTargetPhase || revertReason.trim().length < 5 || reverting}
              onClick={async () => {
                setReverting(true);
                try {
                  const res = await fetch(`/api/projects/${projectId}/phases/revert`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ targetPhase: revertTargetPhase, reason: revertReason.trim() }),
                  });
                  const data = await res.json();
                  if (data?.data?.pendingApproval) {
                    toast.success("Phase reversion submitted for approval", { duration: 4500 });
                    setRevertModalOpen(false);
                  } else if (data?.data?.reverted) {
                    toast.success(`Reverted to ${revertTargetPhase}`, { duration: 4000 });
                    setRevertModalOpen(false);
                    window.location.reload();
                  } else {
                    toast.error(data?.error || "Reversion failed");
                  }
                } catch {
                  toast.error("Network error");
                } finally {
                  setReverting(false);
                }
              }}
            >
              {reverting ? "Submitting…" : "Submit for approval"}
            </Button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
