"use client";

/**
 * Inline cards rendered in the agent chat after a meeting transcript is
 * processed. Two card types:
 *
 *  PendingDecisionCard  — surfaces a decision Claude flagged as not certain
 *                         enough to use as fact. [Confirm] [Discard].
 *  ActionSuggestionCard — proposes a state change on a real PM task or risk
 *                         that matches a definite decision. [Apply] [Skip].
 *
 * Both cards call the shared /api/agents/[id]/kb-action endpoint and then
 * collapse into a one-line resolved state so the chat stays tidy.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, X, ExternalLink, ShieldAlert, ListChecks, Sparkles, Pencil, FileText } from "lucide-react";

// ─── Pending Decision Card ────────────────────────────────────────────────────

interface PendingDecisionCardProps {
  agentId: string;
  kbItemId: string;
  decisionText: string;
  by: string;
  reason: string;
  certainty: "probable" | "tentative" | "definite";
  meetingTitle?: string;
  /** When set, the [view source] expander fetches a transcript snippet around the decision. */
  meetingId?: string;
}

export function PendingDecisionCard({ agentId, kbItemId, decisionText, by, reason, certainty, meetingTitle, meetingId }: PendingDecisionCardProps) {
  const [state, setState] = useState<"idle" | "submitting" | "confirmed" | "discarded" | "edited">("idle");
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [editText, setEditText] = useState(decisionText);
  const [editedTo, setEditedTo] = useState(decisionText);
  const [showSource, setShowSource] = useState(false);
  const [sourceSnippet, setSourceSnippet] = useState<string | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);

  async function action(verb: "confirm" | "discard") {
    if (state === "submitting") return;
    setState("submitting");
    try {
      const res = await fetch(`/api/agents/${agentId}/kb-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: verb, kbItemId }),
      });
      if (res.ok) setState(verb === "confirm" ? "confirmed" : "discarded");
      else setState("idle");
    } catch {
      setState("idle");
    }
  }

  async function saveEdit() {
    if (state === "submitting") return;
    if (!editText.trim()) return;
    setState("submitting");
    try {
      const res = await fetch(`/api/agents/${agentId}/kb-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit", kbItemId, text: editText.trim() }),
      });
      if (res.ok) {
        setEditedTo(editText.trim());
        setState("edited");
        setMode("view");
      } else {
        setState("idle");
      }
    } catch {
      setState("idle");
    }
  }

  async function loadSource() {
    if (sourceSnippet || sourceLoading || !meetingId) return;
    setSourceLoading(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/meetings/${meetingId}/transcript-snippet?text=${encodeURIComponent(decisionText.slice(0, 80))}`);
      if (res.ok) {
        const json = await res.json();
        setSourceSnippet(json?.data?.snippet || "(no matching snippet found in transcript)");
      } else {
        setSourceSnippet("(could not load transcript)");
      }
    } catch {
      setSourceSnippet("(could not load transcript)");
    } finally {
      setSourceLoading(false);
    }
  }

  if (state === "confirmed") {
    return (
      <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-[12px] text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
        <span>Confirmed — "{decisionText}" is now a HIGH_TRUST fact.</span>
      </div>
    );
  }
  if (state === "edited") {
    return (
      <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-[12px] text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
        <Pencil className="w-4 h-4 flex-shrink-0" />
        <span>Edited and confirmed — "{editedTo}" is now a HIGH_TRUST fact.</span>
      </div>
    );
  }
  if (state === "discarded") {
    return (
      <div className="px-3 py-2 rounded-lg bg-muted/30 border border-border text-[12px] text-muted-foreground flex items-center gap-2">
        <X className="w-4 h-4 flex-shrink-0" />
        <span>Discarded — "{decisionText.slice(0, 80)}{decisionText.length > 80 ? "…" : ""}" removed from the Knowledge Base.</span>
      </div>
    );
  }

  const certaintyColor = certainty === "tentative" ? "text-red-500" : certainty === "probable" ? "text-amber-500" : "text-emerald-500";
  const certaintyBg = certainty === "tentative" ? "bg-red-500/10" : certainty === "probable" ? "bg-amber-500/10" : "bg-emerald-500/10";

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0">
          <ShieldAlert className="w-4 h-4 text-amber-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1">
            Decision needs confirmation
            {meetingTitle && <span className="ml-2 font-normal opacity-70">· from {meetingTitle}</span>}
          </p>
          {mode === "view" ? (
            <p className="text-sm text-foreground font-medium leading-relaxed">"{decisionText}"</p>
          ) : (
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={3}
              autoFocus
              className="w-full text-sm px-3 py-2 rounded-md border border-amber-500/30 bg-background outline-none focus:border-amber-500 leading-relaxed"
            />
          )}
          <div className="flex items-center gap-2 mt-2 text-[11px] flex-wrap">
            <span className="text-muted-foreground">— {by}</span>
            <Badge variant="outline" className={`text-[9px] ${certaintyColor} ${certaintyBg} border-0 capitalize`}>{certainty}</Badge>
            <span className="text-muted-foreground">· {reason}</span>
            {meetingId && (
              <button
                onClick={() => { setShowSource((v) => !v); if (!showSource) loadSource(); }}
                className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <FileText className="w-3 h-3" />
                {showSource ? "Hide source" : "View source"}
              </button>
            )}
          </div>
          {showSource && (
            <div className="mt-2 px-3 py-2 rounded-md bg-muted/50 border border-border text-[11px] text-muted-foreground italic leading-relaxed max-h-40 overflow-y-auto">
              {sourceLoading ? "Loading transcript snippet…" : sourceSnippet || "(no snippet)"}
            </div>
          )}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
        {mode === "view"
          ? "I won't use this as a fact until you confirm. Confirm, edit if the wording is slightly off, or discard if it's wrong/speculative."
          : "Edit the decision wording, then save. The result becomes a USER-CONFIRMED HIGH_TRUST fact."}
      </p>
      {mode === "view" ? (
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            className="bg-emerald-500 hover:bg-emerald-600 text-white flex-1 min-w-[120px]"
            onClick={() => action("confirm")}
            disabled={state === "submitting"}
          >
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
            Confirm as fact
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setMode("edit"); setEditText(decisionText); }}
            disabled={state === "submitting"}
          >
            <Pencil className="w-3.5 h-3.5 mr-1.5" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-border hover:bg-muted"
            onClick={() => action("discard")}
            disabled={state === "submitting"}
          >
            <X className="w-3.5 h-3.5 mr-1.5" />
            Discard
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={saveEdit} disabled={state === "submitting" || !editText.trim()}>
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
            Save and confirm
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setMode("view"); setEditText(decisionText); }} disabled={state === "submitting"}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Action Suggestion Card ──────────────────────────────────────────────────

interface ActionSuggestionCardProps {
  agentId: string;
  projectId: string;
  decisionText: string;
  itemType: "task" | "risk";
  itemId: string;
  itemTitle: string;
}

export function ActionSuggestionCard({ agentId, projectId, decisionText, itemType, itemId, itemTitle }: ActionSuggestionCardProps) {
  const [state, setState] = useState<"idle" | "submitting" | "applied" | "skipped">("idle");

  async function apply() {
    if (state === "submitting") return;
    setState("submitting");
    try {
      const res = await fetch(`/api/agents/${agentId}/kb-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: itemType === "task" ? "apply_task_done" : "apply_risk_close",
          projectId,
          taskId: itemType === "task" ? itemId : undefined,
          riskId: itemType === "risk" ? itemId : undefined,
        }),
      });
      if (res.ok) setState("applied");
      else setState("idle");
    } catch {
      setState("idle");
    }
  }

  if (state === "applied") {
    return (
      <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-[12px] text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
        <span>Done — {itemType === "task" ? `task "${itemTitle}" marked DONE` : `risk "${itemTitle}" closed`}.</span>
      </div>
    );
  }
  if (state === "skipped") {
    return (
      <div className="px-3 py-2 rounded-lg bg-muted/30 border border-border text-[12px] text-muted-foreground flex items-center gap-2">
        <X className="w-4 h-4 flex-shrink-0" />
        <span>Skipped — {itemType} "{itemTitle}" left as-is.</span>
      </div>
    );
  }

  const Icon = itemType === "task" ? ListChecks : ShieldAlert;
  const verb = itemType === "task" ? "Mark DONE" : "Close risk";
  const linkHref = itemType === "task"
    ? `/projects/${projectId}/agile`
    : `/projects/${projectId}/risk`;

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary mb-1">
            Suggested update from meeting
          </p>
          <p className="text-sm text-foreground italic">"{decisionText}"</p>
          <div className="mt-2 flex items-center gap-2">
            <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-[12px] text-foreground font-medium truncate">{itemTitle}</span>
            <a href={linkHref} target="_blank" rel="noopener noreferrer" className="ml-auto text-[10px] text-muted-foreground hover:text-primary inline-flex items-center gap-0.5">
              open <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
        The decision matches an open {itemType}. Apply the state change here, or skip and update manually.
      </p>
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={apply} disabled={state === "submitting"}>
          <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
          {verb}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setState("skipped")} disabled={state === "submitting"}>
          <X className="w-3.5 h-3.5 mr-1.5" />
          Skip
        </Button>
      </div>
    </div>
  );
}
