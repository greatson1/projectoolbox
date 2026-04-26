"use client";

import { usePageTitle } from "@/hooks/use-page-title";
import { useState, useRef, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useAgents, useResumeAgent, usePauseAgent } from "@/hooks/use-api";
import { useOrgCurrency } from "@/hooks/use-currency";
import { formatMoney } from "@/lib/currency";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Send, Bot, Loader2, BarChart3, FileText, AlertTriangle, Calendar, Search, Paperclip, ChevronRight, CheckCircle2, Circle, Shield, ExternalLink, RefreshCw, MessageSquare, Info, PauseCircle, PlayCircle } from "lucide-react";
import Link from "next/link";
import { ClarificationCard, ClarificationCompleteCard } from "@/components/agents/ClarificationCard";
import { PendingDecisionCard, ActionSuggestionCard } from "@/components/agents/MeetingDecisionCards";
import { AgentQuestionCard, ProjectStatusCard } from "@/components/agents/AgentResponseCards";
import { ResearchFindingsCard } from "@/components/agents/ResearchFindingsCard";
import { SentimentFeedback } from "@/components/ml/SentimentFeedback";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const METHOD_LABEL: Record<string, string> = {
  PRINCE2: "Traditional", prince2: "Traditional", WATERFALL: "Waterfall", waterfall: "Waterfall",
  AGILE_SCRUM: "Scrum", scrum: "Scrum", AGILE_KANBAN: "Kanban", kanban: "Kanban",
  HYBRID: "Hybrid", hybrid: "Hybrid", SAFE: "SAFe", safe: "SAFe",
};

export default function ChatPageWrapper() {
  return <Suspense fallback={null}><AgentChatPage /></Suspense>;
}

// ── ReactMarkdown components for clean chat rendering ──
const MD_COMPONENTS: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  h1: ({ children }) => <h1 className="text-base font-bold mt-4 mb-2 text-foreground">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-bold mt-3 mb-1.5 text-foreground border-b border-border/30 pb-1">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1 text-foreground">{children}</h3>,
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic text-muted-foreground">{children}</em>,
  ul: ({ children }) => <ul className="mb-2 space-y-0.5 ml-3">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 space-y-0.5 ml-3 list-decimal">{children}</ol>,
  li: ({ children }) => <li className="text-sm leading-relaxed flex gap-1.5"><span className="text-primary mt-1 flex-shrink-0">•</span><span>{children}</span></li>,
  hr: () => <hr className="my-3 border-border/40" />,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/40 pl-3 italic text-muted-foreground my-2">{children}</blockquote>,
  code: ({ children, className }) => {
    const isBlock = className?.includes("language-");
    return isBlock
      ? <pre className="bg-muted rounded-lg p-3 text-xs font-mono overflow-x-auto my-2"><code>{children}</code></pre>
      : <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{children}</code>;
  },
  table: ({ children }) => (
    <div className="overflow-x-auto my-3 rounded-lg border border-border">
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/70">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-border/30">{children}</tbody>,
  tr: ({ children }) => <tr className="hover:bg-muted/30 transition-colors">{children}</tr>,
  th: ({ children }) => <th className="px-3 py-2 text-left font-semibold text-foreground text-[11px] uppercase tracking-wide">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 text-muted-foreground">{children}</td>,
};

// ── Rich message types matching Vite original ──
type MessageType = "text" | "status" | "artefact" | "risk" | "actions" | "clarification" | "clarification_complete" | "agent_question" | "project_status" | "change_proposal" | "research_findings" | "pending_decision" | "action_suggestion" | "tool_effects" | "lifecycle";

interface Message {
  id: string;
  role: "user" | "agent";
  type: MessageType;
  content: string;
  data?: any;
  timestamp: Date;
}

const QUICK_ACTIONS = [
  { label: "What's next?", icon: ChevronRight, prompt: "What do I need to do next? Give me the current project status and the most important action required from me right now.", color: "#F97316" },
  { label: "Status Update", icon: BarChart3, prompt: "Give me a full status update on the current project including progress, risks, and blockers.", color: "#6366F1" },
  { label: "Generate Artefact", icon: FileText, prompt: "Generate a status report for the current project phase.", color: "#22D3EE" },
  { label: "Check Risks", icon: AlertTriangle, prompt: "Analyse current project risks. Flag any new risks and update existing risk scores.", color: "#EF4444" },
  { label: "Research", icon: Search, prompt: "Research best practices for our current project methodology.", color: "#8B5CF6" },
];

// ── Rich message renderer ──
// Compact "what I just did" card — one row per side-effecting tool call from
// the most recent agent turn. Each row has a "Why?" expander (the inputs +
// reasoning) and an optional jump-link to the surface where the entity lives.
function ToolEffectsCard({ avatar, data }: { avatar: React.ReactNode; data: any }) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const effects: any[] = Array.isArray(data?.effects) ? data.effects : [];
  if (effects.length === 0) return null;

  const TOOL_LABELS: Record<string, string> = {
    schedule_meeting: "Meeting",
    create_task: "Task",
    update_risk: "Risk",
    create_artefact: "Document",
    record_assumption: "Assumption",
    run_phase_research: "Research",
    generate_report: "Report",
    search_knowledge: "Knowledge",
  };

  return (
    <div className="flex gap-2">
      {avatar}
      <div className="max-w-[85%] flex-1 rounded-2xl rounded-bl-md border border-border/60 bg-muted/30 p-3 space-y-1.5">
        <div className="flex items-center gap-2 mb-1">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            What I just did
          </span>
          {data.errorCount > 0 && (
            <span className="text-[10px] px-1.5 py-0 rounded bg-destructive/10 text-destructive font-semibold">
              {data.errorCount} failed
            </span>
          )}
        </div>
        {effects.map((e: any, i: number) => {
          const label = TOOL_LABELS[e.tool] || e.tool;
          const isExpanded = expanded[i];
          return (
            <div key={i} className={`rounded-lg border ${e.status === "error" ? "border-destructive/20 bg-destructive/5" : "border-border/40 bg-background/60"} px-2.5 py-1.5`}>
              <div className="flex items-center gap-2">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${e.status === "error" ? "bg-destructive/15 text-destructive" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"}`}>
                  {label}
                </span>
                <span className="text-[12px] flex-1 min-w-0 truncate">{e.summary}</span>
                {e.link && (
                  <Link href={e.link} className="text-[10px] text-primary hover:underline flex-shrink-0">
                    Open →
                  </Link>
                )}
                {e.why && (
                  <button
                    onClick={() => setExpanded(p => ({ ...p, [i]: !p[i] }))}
                    className="text-[10px] text-muted-foreground hover:text-foreground flex-shrink-0"
                    title={isExpanded ? "Hide details" : "Show details"}
                  >
                    {isExpanded ? "Hide" : "Why?"}
                  </button>
                )}
              </div>
              {isExpanded && e.why && (
                <div className="mt-1.5 px-2 py-1.5 rounded bg-muted/40 text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
                  {e.why}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RichMessage({ msg, agentGradient, agentName }: { msg: Message; agentGradient?: string; agentName?: string }) {
  // Guard against null content (DB records can have null)
  const content = msg.content ?? "";

  // Hide internal system kickoff prompts from the UI
  const isKickoff = msg.role === "user" && (content.startsWith("SYSTEM_KICKOFF:") || content.startsWith("KICKOFF:"));
  if (isKickoff) return null;

  if (msg.role === "user") {
    const msgSentiment = (msg as any).data?.sentiment || ((msg as any).metadata as any)?.sentiment;
    const msgSentimentConf = (msg as any).data?.sentimentConfidence || ((msg as any).metadata as any)?.sentimentConfidence;
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[70%] flex flex-col items-end">
          <div className="px-4 py-3 rounded-2xl rounded-br-md bg-primary text-primary-foreground text-sm leading-relaxed whitespace-pre-line">
            {content}
          </div>
          {msgSentiment && content.length > 20 && (
            <div className="mt-1 opacity-70 hover:opacity-100 transition-opacity">
              <SentimentFeedback
                sourceType="chat"
                sourceId={msg.id}
                sentiment={msgSentiment}
                confidence={msgSentimentConf}
                compact
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  const avatar = (
    <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-1"
      style={{ background: agentGradient || "#6366F1" }}>{agentName?.[0] || "A"}</div>
  );

  // Status card
  if (msg.type === "status" && msg.data?.items) {
    return (
      <div className="flex gap-2">
        {avatar}
        <div className="max-w-[80%]">
          {msg.content && <div className="bg-muted px-4 py-3 rounded-2xl rounded-bl-md text-sm mb-2">{msg.content}</div>}
          <div className="grid grid-cols-2 gap-2">
            {msg.data.items.map((item: any, i: number) => (
              <div key={i} className="px-3 py-2 rounded-xl bg-muted/50 border border-border/30">
                <p className="text-[10px] text-muted-foreground">{item.label}</p>
                <p className="text-sm font-semibold">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Artefact card
  if (msg.type === "artefact" && msg.data) {
    return (
      <div className="flex gap-2">
        {avatar}
        <div className="max-w-[80%] rounded-2xl rounded-bl-md border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold">{msg.data.title}</span>
            <Badge variant="secondary" className="text-[9px]">{msg.data.status}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-3">{msg.data.description}</p>
          {msg.data.phase && <Badge variant="outline" className="text-[9px]">{msg.data.phase}</Badge>}
          <div className="flex gap-2 mt-3">
            <Button size="sm" className="text-xs h-7" onClick={() => { if (msg.data?.id) { fetch(`/api/agents/artefacts/${msg.data.id}`, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ status: "PENDING_REVIEW" }) }).then(() => toast.success("Marked for review")).catch(() => toast.error("Failed")); } else { toast.success("Reviewed"); } }}>Review</Button>
            <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => { if (msg.data?.id) { fetch(`/api/agents/artefacts/${msg.data.id}`, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ status: "APPROVED" }) }).then(() => toast.success("Artefact approved")).catch(() => toast.error("Failed")); } else { toast.success("Approved"); } }}>Approve</Button>
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => { const feedback = prompt("What changes are needed?"); if (!feedback) return; if (msg.data?.id) { fetch(`/api/agents/artefacts/${msg.data.id}`, { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ status: "REJECTED", feedback }) }).then(() => toast.success("Changes requested")).catch(() => toast.error("Failed")); } else { toast.success("Changes requested"); } }}>Request Changes</Button>
          </div>
        </div>
      </div>
    );
  }

  // Risk card
  if (msg.type === "risk" && msg.data) {
    return (
      <div className="flex gap-2">
        {avatar}
        <div className="max-w-[80%] rounded-2xl rounded-bl-md border border-destructive/20 bg-destructive/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-destructive" />
            <span className="text-sm font-bold">{msg.data.title}</span>
            <Badge variant="destructive" className="text-[9px]">Score: {msg.data.score}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2 text-xs">
            <div><span className="text-muted-foreground">Probability:</span> <strong>{msg.data.probability}</strong></div>
            <div><span className="text-muted-foreground">Impact:</span> <strong>{msg.data.impact}</strong></div>
          </div>
          {msg.data.source && <p className="text-[10px] text-muted-foreground mb-1">Source: {msg.data.source}</p>}
          <p className="text-xs text-muted-foreground">{msg.data.mitigation}</p>
        </div>
      </div>
    );
  }

  // Actions checklist
  if (msg.type === "actions" && msg.data?.items) {
    return (
      <div className="flex gap-2">
        {avatar}
        <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-muted p-4">
          {msg.data.title && <p className="text-sm font-semibold mb-2">{msg.data.title}</p>}
          <div className="space-y-1.5">
            {msg.data.items.map((item: any, i: number) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                {item.done
                  ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                  : <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />}
                <span className={item.done ? "text-muted-foreground line-through" : ""}>{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Research findings card — enterprise visual display of feasibility research
  if (msg.type === "research_findings" && msg.data) {
    return (
      <div className="flex gap-2">
        {avatar}
        <div className="flex-1 max-w-[90%]">
          <ResearchFindingsCard
            projectName={msg.data.projectName || "Project"}
            factsCount={msg.data.factsCount || 0}
            sections={msg.data.sections || []}
            facts={msg.data.facts || []}
            phase={msg.data.phase}
          />
        </div>
      </div>
    );
  }

  // Clarification question card — interactive widget, zero credits
  if (msg.type === "clarification" && msg.data?.question) {
    return (
      <div className="flex gap-2">
        {avatar}
        <div className="flex-1 max-w-[85%]">
          <ClarificationCard
            agentId={msg.data.agentId}
            question={msg.data.question}
            progress={msg.data.progress}
            questionIndex={msg.data.questionIndex}
            intro={msg.data.intro}
            onAnswered={msg.data.onAnswered}
            isSubmitting={msg.data.isSubmitting}
          />
        </div>
      </div>
    );
  }

  // Clarification complete card — shows CTA to generate documents
  if (msg.type === "clarification_complete" && msg.data) {
    return (
      <div className="flex gap-2">
        {avatar}
        <div className="flex-1 max-w-[85%]">
          <ClarificationCompleteCard
            agentId={msg.data.agentId}
            artefactNames={msg.data.artefactNames || []}
            answeredCount={msg.data.answeredCount || 0}
            totalCount={msg.data.totalCount || 0}
            onGenerate={msg.data.onGenerate}
            isGenerating={msg.data.isGenerating}
          />
        </div>
      </div>
    );
  }

  // Pending meeting decision — Confirm / Discard inline
  if (msg.type === "pending_decision" && msg.data?.kbItemId) {
    return (
      <div className="flex gap-2">
        {avatar}
        <div className="flex-1 max-w-[85%]">
          <PendingDecisionCard
            agentId={msg.data.agentId}
            kbItemId={msg.data.kbItemId}
            decisionText={msg.data.decisionText || ""}
            by={msg.data.by || "Unknown"}
            reason={msg.data.reason || "needs review"}
            certainty={msg.data.certainty || "probable"}
            meetingTitle={msg.data.meetingTitle}
            meetingId={msg.data.meetingId}
          />
        </div>
      </div>
    );
  }

  // Action suggestion — Apply / Skip a state change suggested by a meeting decision
  if (msg.type === "action_suggestion" && msg.data?.itemId) {
    return (
      <div className="flex gap-2">
        {avatar}
        <div className="flex-1 max-w-[85%]">
          <ActionSuggestionCard
            agentId={msg.data.agentId}
            projectId={msg.data.projectId}
            decisionText={msg.data.decisionText || ""}
            itemType={msg.data.itemType || "task"}
            itemId={msg.data.itemId}
            itemTitle={msg.data.itemTitle || ""}
          />
        </div>
      </div>
    );
  }

  // Agent question card — interactive question asked mid-conversation
  if (msg.type === "agent_question" && msg.data?.question) {
    return (
      <div data-agent-questions className="flex gap-2">
        {avatar}
        <div className="flex-1 max-w-[85%]">
          <AgentQuestionCard
            question={msg.data.question}
            onAnswered={msg.data.onAnswered || (() => {})}
            isSubmitting={msg.data.isSubmitting || false}
            priorAnswer={msg.data.priorAnswer ?? null}
          />
        </div>
      </div>
    );
  }

  // Project status card — visual snapshot of project state
  if (msg.type === "project_status" && msg.data) {
    return (
      <div className="flex gap-2">
        {avatar}
        <div className="flex-1 max-w-[90%]">
          <ProjectStatusCard
            projectName={msg.data.projectName || "Project"}
            phase={msg.data.phase}
            phases={msg.data.phases || []}
            nextPhase={msg.data.nextPhase}
            pendingApprovals={msg.data.pendingApprovals || 0}
            pendingArtefacts={msg.data.pendingArtefacts || 0}
            pendingQuestions={msg.data.pendingQuestions || 0}
            risks={msg.data.risks || 0}
          />
        </div>
      </div>
    );
  }

  // Lifecycle marker — faint divider for pause/resume events. Reads as a
  // timeline note rather than a real message; click-through to the activity
  // log feels excessive so it stays informational only.
  if (msg.type === "lifecycle" && msg.data) {
    const isPause = msg.data.kind === "paused";
    const ts = new Date(msg.data.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    return (
      <div className="flex items-center gap-2 my-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
        <div className="flex-1 h-px bg-border/40" />
        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${isPause ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
          {isPause
            ? <PauseCircle className="w-2.5 h-2.5" />
            : <PlayCircle className="w-2.5 h-2.5" />}
          {msg.data.summary || (isPause ? "Agent paused" : "Agent resumed")} · {ts}
        </span>
        <div className="flex-1 h-px bg-border/40" />
      </div>
    );
  }

  // Tool-effects trace — compact "what I just did" card with per-row Why expander
  if (msg.type === "tool_effects" && msg.data) {
    return <ToolEffectsCard avatar={avatar} data={msg.data} />;
  }

  // Change proposal card — interactive approval widget
  if (msg.type === "change_proposal" && msg.data) {
    const d = msg.data as any;
    return (
      <div className="flex gap-2">
        {avatar}
        <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-amber-500 text-lg">📋</span>
            <h4 className="text-sm font-bold">{d.title}</h4>
          </div>
          <p className="text-xs text-muted-foreground">Trigger: {(d.trigger || "").replace(/_/g, " ")} — {d.source}</p>
          <div className="space-y-1.5">
            {(d.changes || []).map((c: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs p-2 rounded-lg bg-background/50 border border-border/30">
                <span className="font-medium flex-1 min-w-0 truncate">{c.title}</span>
                <span className="text-muted-foreground">{c.field}:</span>
                <span className="text-red-400 line-through">{c.from}</span>
                <span className="text-muted-foreground">→</span>
                <span className="text-emerald-400 font-semibold">{c.to}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>Impact: S:{d.impact?.schedule}/4 C:{d.impact?.cost}/4</span>
            <span>·</span>
            <span>Confidence: {Math.round((d.confidence || 0) * 100)}%</span>
          </div>
          <div className="flex gap-2 pt-1">
            <Link href="/approvals">
              <Button size="sm" className="h-7 text-xs">Review & Approve</Button>
            </Link>
            <Link href="/approvals">
              <Button variant="outline" size="sm" className="h-7 text-xs">View Details</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Strip sentinel values and <ASK> tags from content
  const rawContent = content
    .replace(/^__(?:AGENT_QUESTION|CLARIFICATION_SESSION|CLARIFICATION_COMPLETE|PROJECT_STATUS|CHANGE_PROPOSAL)__$/g, "");
  // Strip <ASK> tags entirely — clarification questions are rendered via dedicated ClarificationCard widgets
  const cleanContent = rawContent.replace(/<ASK\s+[^>]*>[^<]*<\/ASK>/gi, "").trim();

  // Default text — render with proper markdown (tables, headings, lists, bold, etc.)
  return (
    <div className="flex gap-2">
      {avatar}
      <div className="max-w-[80%] space-y-2">
        {cleanContent && (
          <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-muted text-sm leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
              {cleanContent}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Parse AI response for rich message types ──
function parseAgentResponse(content: string): Message[] {
  const messages: Message[] = [];

  // Try to detect structured content from the AI response
  // Status update pattern
  if (content.includes("**") && (content.includes("Health") || content.includes("Progress") || content.includes("Budget"))) {
    const lines = content.split("\n").filter(l => l.includes("**") && l.includes(":"));
    if (lines.length >= 3) {
      const items = lines.slice(0, 6).map(l => {
        const match = l.match(/\*\*([^*]+)\*\*[:\s]*(.+)/);
        return match ? { label: match[1].trim(), value: match[2].trim() } : null;
      }).filter(Boolean);

      if (items.length >= 3) {
        messages.push({ id: `status-${Date.now()}`, role: "agent", type: "status", content: content.split("\n")[0].replace(/[*#]/g, "").trim(), data: { items }, timestamp: new Date() });
        return messages;
      }
    }
  }

  // Risk pattern
  if (content.toLowerCase().includes("risk") && (content.includes("Score") || content.includes("Probability"))) {
    const titleMatch = content.match(/(?:Risk|RISK)[:\s]*(.+?)(?:\n|$)/);
    const scoreMatch = content.match(/[Ss]core[:\s]*(\d+)/);
    if (titleMatch && scoreMatch) {
      messages.push({ id: `risk-${Date.now()}`, role: "agent", type: "risk", content: "", data: {
        title: titleMatch[1].replace(/[*#]/g, "").trim(),
        score: parseInt(scoreMatch[1]),
        probability: "High", impact: "High",
        mitigation: content.split("\n").slice(-2).join(" ").replace(/[*#]/g, "").trim(),
      }, timestamp: new Date() });
      return messages;
    }
  }

  // Default: plain text
  messages.push({ id: `text-${Date.now()}`, role: "agent", type: "text", content, timestamp: new Date() });
  return messages;
}

// ── Main component ──
function AgentChatPage() {
  const searchParams = useSearchParams();
  const { data: agentData, isLoading: agentsLoading } = useAgents();
  const agents = agentData?.agents || [];
  const currency = useOrgCurrency();
  const queryClient = useQueryClient();
  const resumeAgent = useResumeAgent();
  const pauseAgent = usePauseAgent();

  usePageTitle("Chat with Agent");
  const [activeAgentId, setActiveAgentId] = useState<string | null>(searchParams.get("agent"));
  const [messagesByAgent, setMessagesByAgent] = useState<Record<string, Message[]>>({});
  const [historyLoaded, setHistoryLoaded] = useState<Set<string>>(new Set());
  const [historyLoading, setHistoryLoading] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [agentStatus, setAgentStatus] = useState<{ stage: string; detail: string } | null>(null);
  const [agentStuck, setAgentStuck] = useState(false);
  const [clarificationSubmitting, setClarificationSubmitting] = useState(false);
  const [generatingDocs, setGeneratingDocs] = useState(false);
  const [agentQuestionSubmitting, setAgentQuestionSubmitting] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeAgentId && agents.length > 0) setActiveAgentId(agents[0].id);
  }, [agents, activeAgentId]);

  const activeAgent = agents.find((a: any) => a.id === activeAgentId);
  const isPaused = activeAgent?.status === "PAUSED";
  // In-flight summary fetched when the active agent is paused — surfaces
  // "what's about to re-run when you click Resume" in the banner so the
  // operator isn't guessing what work was lost. null = not loaded yet,
  // {pausedAt: null} = not paused or no info available.
  const [pauseSummary, setPauseSummary] = useState<{ pausedAt: string | null; pausedBy?: string; cancelledJobsCount?: number; countsByType?: Record<string, number> } | null>(null);
  useEffect(() => {
    if (!activeAgentId || !isPaused) { setPauseSummary(null); return; }
    let cancelled = false;
    fetch(`/api/agents/${activeAgentId}/paused-summary`)
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (!cancelled && j?.data) setPauseSummary(j.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeAgentId, isPaused]);
  // Inject live handlers into clarification cards (handlers can't be serialised to state)
  const messages: Message[] = (activeAgentId ? (messagesByAgent[activeAgentId] || []) : []).map(m => {
    if (m.type === "clarification" && m.data && !m.data.onAnswered) {
      return { ...m, data: { ...m.data, onAnswered: (ans: string) => handleClarificationAnswer(m.data.question.id, ans), isSubmitting: clarificationSubmitting } };
    }
    if (m.type === "clarification_complete" && m.data && !m.data.onGenerate) {
      return { ...m, data: { ...m.data, onGenerate: () => handleGenerateDocuments(), isGenerating: generatingDocs } };
    }
    if (m.type === "agent_question" && m.data && !m.data.onAnswered) {
      // Don't re-wire the live answer handler on cards that were already
      // answered in a previous session — they're historical, not actionable.
      if (m.data.priorAnswer) return m;
      return { ...m, data: { ...m.data, onAnswered: (ans: string) => handleAgentQuestionAnswer(m.id, ans), isSubmitting: agentQuestionSubmitting } };
    }
    return m;
  });

  // ── Open-questions tracking ─────────────────────────────────────────────────
  // A question card is "open" when an answer handler is still wired (we strip
  // it once the user answers, so this naturally tracks unresolved state). We
  // also include pending decisions and change proposals because they're
  // user-action cards that block forward motion the same way.
  // Used by:
  //   - Header badge (count + click-to-jump-to-oldest)
  //   - Resume banner (shown when reopening chat with a stale unanswered card)
  const openQuestions = useMemo(() => {
    return messages.filter(m => {
      // Pre-answered cards (priorAnswer hydrated from history) are
      // historical, not open — exclude them so the badge doesn't
      // double-count answered questions across reloads.
      if (m.type === "agent_question") {
        if (m.data?.priorAnswer) return false;
        return m.data?.onAnswered !== null;
      }
      if (m.type === "clarification" && m.data?.onAnswered !== null) return true;
      // change_proposal and pending_decision don't carry an onAnswered handler
      // so we fall back to the timestamp heuristic — they're "open" until the
      // user clicks Confirm/Discard which removes the card from local state.
      if (m.type === "change_proposal") return true;
      if (m.type === "pending_decision") return true;
      return false;
    });
  }, [messages]);

  // Resume banner — show only the OLDEST unanswered question that's at least
  // 30 minutes old, so we don't pester the user about something they just saw.
  const staleOpenQuestion = useMemo(() => {
    const THIRTY_MIN = 30 * 60 * 1000;
    const now = Date.now();
    return openQuestions
      .filter(q => now - new Date(q.timestamp).getTime() > THIRTY_MIN)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0];
  }, [openQuestions]);

  // Scroll a specific message into view (used by the header badge + resume
  // banner). The message wrapper carries id={`msg-${msg.id}`} so we can
  // anchor straight to it.
  const scrollToMessage = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary", "ring-offset-2", "rounded-2xl", "transition-all");
      setTimeout(() => el.classList.remove("ring-2", "ring-primary", "ring-offset-2", "rounded-2xl", "transition-all"), 2200);
    }
  };

  // ── Load persistent chat history from DB when switching agents ──
  useEffect(() => {
    if (!activeAgentId || historyLoaded.has(activeAgentId)) return;

    setHistoryLoading(true);
    fetch(`/api/agents/${activeAgentId}/chat`)
      .then(r => r.json())
      .then(({ data, lifecycle }) => {
        if (!Array.isArray(data)) return;
        // Filter out system kickoff messages and raw clarification sentinels
        const filtered = data.filter((m: any) =>
          !(m.role === "user" && (m.content?.startsWith("SYSTEM_KICKOFF:") || m.content?.startsWith("KICKOFF:")))
        );
        // Pause/resume lifecycle markers — interleaved into the chat stream
        // by createdAt below so the user sees "— Agent paused 18:42 —" right
        // where it happened in the conversation.
        const lifecycleMsgs: Message[] = Array.isArray(lifecycle) ? lifecycle.map((l: any) => ({
          id: `lifecycle-${l.id}`,
          role: "agent" as const,
          type: "lifecycle" as const,
          content: "",
          timestamp: new Date(l.createdAt),
          data: { kind: l.type, summary: l.summary, at: l.createdAt },
        })) : [];

        // Map clarification metadata into interactive card messages
        const loaded: Message[] = filtered.map((m: any) => {
          const meta = m.metadata as any;

          if (meta?.type === "clarification_question" && meta.question) {
            // Answered if a later message in the session has a higher questionIndex
            const isCurrentQ = meta.questionIndex === (meta.totalQuestions - 1 - filtered.filter((x: any) => x.metadata?.type === "clarification_question").reverse().findIndex((x: any) => x.id === m.id) - 1);
            return {
              id: m.id,
              role: "agent" as const,
              type: "clarification" as const,
              content: "",
              timestamp: new Date(m.createdAt),
              data: {
                agentId: activeAgentId,
                question: meta.question,
                questionIndex: meta.questionIndex,
                progress: {
                  current: meta.questionIndex,
                  total: meta.totalQuestions,
                  artefactNames: meta.artefactNames || [],
                },
                intro: meta.intro || false,
                // onAnswered injected below after state is set
                onAnswered: null,
                isSubmitting: false,
              },
            };
          }

          if (meta?.type === "clarification_complete") {
            return {
              id: m.id,
              role: "agent" as const,
              type: "clarification_complete" as const,
              content: "",
              timestamp: new Date(m.createdAt),
              data: {
                agentId: activeAgentId,
                artefactNames: meta.artefactNames || [],
                answeredCount: meta.answeredCount || 0,
                totalCount: meta.totalCount || 0,
                onGenerate: null,  // injected below
                isGenerating: false,
              },
            };
          }

          if (meta?.type === "agent_question" && meta.question) {
            // Find the user reply that immediately followed this question.
            // The next user message (before any subsequent agent_question /
            // sentinel card) is the answer the user previously gave. This
            // restores the "answered" state on chat reload so the card
            // doesn't look unresolved.
            const myIdx = filtered.findIndex((x: any) => x.id === m.id);
            let priorAnswer: string | null = null;
            if (myIdx >= 0) {
              for (let j = myIdx + 1; j < filtered.length; j++) {
                const next = filtered[j];
                const nMeta = next.metadata as any;
                // Stop if we hit another structured card before any user reply
                if (next.role === "agent" && (nMeta?.type === "agent_question" || nMeta?.type === "clarification_question")) {
                  break;
                }
                if (next.role === "user" && next.content && !next.content.startsWith("__") && !next.content.startsWith("SYSTEM_KICKOFF:") && !next.content.startsWith("KICKOFF:")) {
                  priorAnswer = next.content.length > 200 ? `${next.content.slice(0, 200)}…` : next.content;
                  break;
                }
              }
            }
            return {
              id: m.id,
              role: "agent" as const,
              type: "agent_question" as const,
              content: "",
              timestamp: new Date(m.createdAt),
              data: {
                question: meta.question,
                questionIndex: meta.questionIndex ?? 0,
                totalQuestions: meta.totalQuestions ?? 1,
                onAnswered: null,   // injected below
                isSubmitting: false,
                priorAnswer,
              },
            };
          }

          if (meta?.type === "research_findings") {
            return {
              id: m.id,
              role: "agent" as const,
              type: "research_findings" as const,
              content: "",
              timestamp: new Date(m.createdAt),
              data: meta,
            };
          }

          if (meta?.type === "project_status") {
            return {
              id: m.id,
              role: "agent" as const,
              type: "project_status" as const,
              content: "",
              timestamp: new Date(m.createdAt),
              data: meta,
            };
          }

          if (meta?.type === "tool_effects") {
            return {
              id: m.id,
              role: "agent" as const,
              type: "tool_effects" as const,
              content: "",
              timestamp: new Date(m.createdAt),
              data: meta,
            };
          }

          if (meta?.type === "change_proposal") {
            return {
              id: m.id,
              role: "agent" as const,
              type: "change_proposal" as const,
              content: "",
              timestamp: new Date(m.createdAt),
              data: meta,
            };
          }

          if (meta?.type === "pending_decision" && meta.kbItemId) {
            return {
              id: m.id,
              role: "agent" as const,
              type: "pending_decision" as const,
              content: "",
              timestamp: new Date(m.createdAt),
              data: { ...meta, agentId: activeAgentId },
            };
          }

          if (meta?.type === "action_suggestion" && meta.itemId) {
            return {
              id: m.id,
              role: "agent" as const,
              type: "action_suggestion" as const,
              content: "",
              timestamp: new Date(m.createdAt),
              data: { ...meta, agentId: activeAgentId },
            };
          }

          return {
            id: m.id,
            role: m.role === "user" ? "user" as const : "agent" as const,
            type: "text" as const,
            content: m.content,
            timestamp: new Date(m.createdAt),
          };
        }).filter((m: any) => {
          // Hide raw sentinel content messages (they rendered as interactive cards above)
          return !(m.type === "text" && (
            m.content === "__CLARIFICATION_SESSION__" ||
            m.content === "__CLARIFICATION_COMPLETE__" ||
            m.content === "__AGENT_QUESTION__" ||
            m.content === "__TOOL_EFFECTS__" ||
            m.content === "__PROJECT_STATUS__" ||
            m.content === "__CHANGE_PROPOSAL__" ||
            m.content === "__RESEARCH_FINDINGS__" ||
            m.content === "__PENDING_DECISION__" ||
            m.content === "__ACTION_SUGGESTION__"
          ));
        });

        // Merge lifecycle markers (paused/resumed) into the chat stream by
        // timestamp so they appear inline where the agent went silent or
        // came back. Sorted ascending = chronological flow.
        const merged = [...loaded, ...lifecycleMsgs].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
        setMessagesByAgent(prev => ({ ...prev, [activeAgentId]: merged }));
        setHistoryLoaded(prev => new Set([...prev, activeAgentId]));
        // Snap to bottom after history loads. A single 150ms timeout wasn't
        // enough for long histories — the DOM hadn't finished laying out all
        // the message bubbles yet, so scrollHeight was still climbing and we
        // landed mid-conversation. Two rAF passes + a couple of late ticks
        // covers the slow cases without flashing the top of the chat.
        const snapToBottom = () => {
          const el = scrollRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        };
        requestAnimationFrame(() => {
          snapToBottom();
          requestAnimationFrame(snapToBottom);
        });
        setTimeout(snapToBottom, 120);
        setTimeout(snapToBottom, 350);
      })
      .catch(() => {
        // If history fetch fails, mark as loaded so we fall through to kickoff
        setHistoryLoaded(prev => new Set([...prev, activeAgentId]));
      })
      .finally(() => setHistoryLoading(false));
  }, [activeAgentId, historyLoaded]);

  // Auto-kickoff ref — set after sendMessage is defined
  const kickoffFiredRef = useRef<Set<string>>(new Set());
  const pendingKickoffRef = useRef<string | null>(null);

  const scrollToBottom = () => {
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 100);
  };

  // ── Clarification answer handler (zero-cost, dedicated endpoint) ──
  const handleClarificationAnswer = async (questionId: string, answer: string) => {
    if (!activeAgentId || clarificationSubmitting) return;
    setClarificationSubmitting(true);
    try {
      const res = await fetch(`/api/agents/${activeAgentId}/clarification/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, answer }),
      });
      const json = await res.json();
      const result = json?.data;
      if (!result) return;

      // Bust caches that drive the bottom status bar / pipeline / dashboard so
      // they reflect the answered question immediately instead of on the next
      // 60-second poll. The bar reads from useAgents() and the per-agent
      // pipeline endpoint; dashboard reads from useDashboard.
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["agent", activeAgentId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline", activeAgentId] });

      if (result.status === "complete") {
        // Replace the current active question card with the completion card
        const completionMsg: Message = {
          id: `clarification-complete-${Date.now()}`,
          role: "agent",
          type: "clarification_complete",
          content: "",
          timestamp: new Date(),
          data: {
            agentId: activeAgentId,
            artefactNames: result.progress.artefactNames,
            answeredCount: result.progress.current,
            totalCount: result.progress.total,
            onGenerate: () => handleGenerateDocuments(),
            isGenerating: false,
          },
        };
        setMessagesByAgent(prev => ({ ...prev, [activeAgentId!]: [...(prev[activeAgentId!] || []), completionMsg] }));
      } else if (result.nextQuestion) {
        // Add the next question card
        const nextMsg: Message = {
          id: `clarification-q-${Date.now()}`,
          role: "agent",
          type: "clarification",
          content: "",
          timestamp: new Date(),
          data: {
            agentId: activeAgentId,
            question: result.nextQuestion,
            questionIndex: result.progress.current,
            progress: result.progress,
            intro: false,
            onAnswered: (ans: string) => handleClarificationAnswer(result.nextQuestion.id, ans),
            isSubmitting: false,
          },
        };
        setMessagesByAgent(prev => ({ ...prev, [activeAgentId!]: [...(prev[activeAgentId!] || []), nextMsg] }));
      }
      scrollToBottom();
    } catch {}
    finally { setClarificationSubmitting(false); }
  };

  // ── Generate documents (user-initiated, costs 10 credits) ──
  const handleGenerateDocuments = async () => {
    if (!activeAgentId || generatingDocs) return;
    setGeneratingDocs(true);
    try {
      // Check if artefacts already exist
      const checkRes = await fetch(`/api/agents/${activeAgentId}/artefacts`);
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        const existing = Array.isArray(checkData) ? checkData : (checkData.data || []);
        if (existing.length > 0) {
          const drafts = existing.filter((a: any) => a.status === "DRAFT").length;
          const approved = existing.filter((a: any) => a.status === "APPROVED").length;
          const msg: Message = {
            id: `exists-${Date.now()}`, role: "agent", type: "text",
            content: `Your documents have already been created — **${existing.length} artefact(s)** (${drafts} drafts, ${approved} approved). Head to the **[Artefacts tab](/agents/${activeAgentId}?tab=artefacts)** to review and approve them.`,
            timestamp: new Date(),
          };
          setMessagesByAgent(prev => ({ ...prev, [activeAgentId!]: [...(prev[activeAgentId!] || []), msg] }));
          scrollToBottom();
          setGeneratingDocs(false);
          return;
        }
      }

      await fetch(`/api/agents/${activeAgentId}/clarification/generate`, { method: "POST" });
      setMessagesByAgent(prev => ({
        ...prev,
        [activeAgentId!]: (prev[activeAgentId!] || []).map(m =>
          m.type === "clarification_complete" ? { ...m, data: { ...m.data, isGenerating: true } } : m
        ),
      }));
      setTimeout(() => {
        const doneMsg: Message = { id: `done-${Date.now()}`, role: "agent", type: "text", content: "Your documents are being generated. Head to the **Artefacts** tab to review them once ready.", timestamp: new Date() };
        setMessagesByAgent(prev => ({ ...prev, [activeAgentId!]: [...(prev[activeAgentId!] || []), doneMsg] }));
        scrollToBottom();
      }, 1500);
    } catch {}
    finally { setGeneratingDocs(false); }
  };

  // ── Agent question answer handler — sends as a real chat message so Claude responds naturally ──
  const handleAgentQuestionAnswer = async (messageId: string, answer: string) => {
    if (!activeAgentId || agentQuestionSubmitting) return;
    setAgentQuestionSubmitting(true);
    try {
      // Mark the card as answered in local state immediately
      setMessagesByAgent(prev => ({
        ...prev,
        [activeAgentId!]: (prev[activeAgentId!] || []).map(m =>
          m.id === messageId ? { ...m, data: { ...m.data, onAnswered: null, isSubmitting: false } } : m
        ),
      }));

      // Store the answer to KB directly (zero-credit) before sending to chat
      const questionData = messagesByAgent[activeAgentId!]?.find(m => m.id === messageId)?.data;
      if (questionData?.question) {
        const qText = questionData.question.question?.slice(0, 80) || questionData.question.id || "User answer";
        fetch(`/api/agents/${activeAgentId}/kb/store-fact`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: qText, content: answer }),
        })
          // Toast acknowledges the answer was captured to project memory.
          // The card itself shows "Answered: X" and the chat is about to
          // stream a fresh response — this third signal makes it impossible
          // to think the click was lost.
          .then((r) => { if (r.ok) toast.success("Saved your answer to project memory"); })
          .catch(() => { /* Non-blocking — don't fail if KB store fails */ });
      }

      // Send the answer as a normal user message — this triggers a full Claude response
      await sendMessage(answer);
    } finally {
      setAgentQuestionSubmitting(false);
    }
  };

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || !activeAgentId) return;

    // Defence-in-depth: even though the input is disabled when paused, an
    // answer-card click or a programmatic send could still bypass the UI.
    // Bail out with a friendly toast rather than firing a request that 423s.
    if (isPaused) {
      toast.error(`${activeAgent?.name} is paused — resume the agent to send messages`);
      return;
    }

    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", type: "text", content: msg, timestamp: new Date() };
    setMessagesByAgent(prev => ({ ...prev, [activeAgentId!]: [...(prev[activeAgentId!] || []), userMsg] }));
    setInput("");
    setSending(true);
    setAgentStatus(null);
    setAgentStuck(false);
    scrollToBottom();

    // Create a placeholder streaming message
    const streamId = `stream-${Date.now()}`;
    const streamMsg: Message = { id: streamId, role: "agent", type: "text", content: "", timestamp: new Date() };
    setMessagesByAgent(prev => ({ ...prev, [activeAgentId!]: [...(prev[activeAgentId!] || []), streamMsg] }));

    // Stuck detection: if no events for 45s, show retry
    let lastEventTime = Date.now();
    const stuckTimer = setInterval(() => {
      if (Date.now() - lastEventTime > 45_000) {
        setAgentStuck(true);
      }
    }, 5_000);

    try {
      // Try SSE streaming first
      const res = await fetch(`/api/agents/${activeAgentId}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });

      if (res.ok && res.headers.get("content-type")?.includes("text/event-stream")) {
        // Stream tokens
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          lastEventTime = Date.now();
          setAgentStuck(false);
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              // Progress status events
              if (data.status) {
                setAgentStatus(data.status);
                if (data.status.stage === "error") {
                  setAgentStuck(true);
                }
                scrollToBottom();
              }
              if (data.token) {
                fullContent += data.token;
                setAgentStatus(null); // clear status once tokens flow
                setMessagesByAgent(prev => ({
                  ...prev,
                  [activeAgentId!]: (prev[activeAgentId!] || []).map(m =>
                    m.id === streamId ? { ...m, content: fullContent } : m
                  ),
                }));
                scrollToBottom();
              }
              // Surface server-side errors (e.g. Anthropic API failure, credit exhaustion)
              if (data.error && !fullContent) {
                const errMsg = data.error;
                setMessagesByAgent(prev => ({
                  ...prev,
                  [activeAgentId!]: (prev[activeAgentId!] || []).map(m =>
                    m.id === streamId ? { ...m, content: errMsg } : m
                  ),
                }));
                setSending(false);
                setAgentStatus(null);
                clearInterval(stuckTimer);
                scrollToBottom();
                return; // don't fall through to the empty-stream throw
              }
            } catch {}
          }
        }

        clearInterval(stuckTimer);
        setAgentStatus(null);
        setAgentStuck(false);

        // If streaming produced no content, parse the final message
        if (!fullContent) throw new Error("Empty stream");

        // Re-fetch chat history to pick up agent_question / project_status cards
        // that the stream route saved to DB after streaming finished
        const agentIdSnapshot = activeAgentId;
        setTimeout(async () => {
          try {
            const r = await fetch(`/api/agents/${agentIdSnapshot}/chat`);
            const { data: freshData } = await r.json();
            if (!Array.isArray(freshData)) return;

            // Collect IDs we already have so we only append genuinely new messages
            setMessagesByAgent(prev => {
              const existing = prev[agentIdSnapshot] || [];
              const existingIds = new Set(existing.map(m => m.id));
              const newCards: Message[] = [];

              for (const m of freshData) {
                if (existingIds.has(m.id)) continue;
                const meta = m.metadata as any;
                if (meta?.type === "agent_question" && meta.question) {
                  newCards.push({
                    id: m.id,
                    role: "agent",
                    type: "agent_question",
                    content: "",
                    timestamp: new Date(m.createdAt),
                    data: { question: meta.question, onAnswered: null, isSubmitting: false },
                  });
                } else if (meta?.type === "project_status") {
                  newCards.push({
                    id: m.id,
                    role: "agent",
                    type: "project_status",
                    content: "",
                    timestamp: new Date(m.createdAt),
                    data: meta,
                  });
                } else if (meta?.type === "change_proposal") {
                  newCards.push({
                    id: m.id,
                    role: "agent",
                    type: "change_proposal",
                    content: "",
                    timestamp: new Date(m.createdAt),
                    data: meta,
                  });
                } else if (meta?.type === "tool_effects") {
                  newCards.push({
                    id: m.id,
                    role: "agent",
                    type: "tool_effects",
                    content: "",
                    timestamp: new Date(m.createdAt),
                    data: meta,
                  });
                }
              }

              if (newCards.length === 0) return prev;
              return { ...prev, [agentIdSnapshot]: [...existing, ...newCards] };
            });

            scrollToBottom();
          } catch {}
        }, 800); // short delay — route saves cards just after stream ends
      } else {
        // Fallback to regular API
        const data = await res.json();
        if (data.data?.agentMessage) {
          const richMessages = parseAgentResponse(data.data.agentMessage.content);
          // Replace the placeholder with parsed messages
          setMessagesByAgent(prev => ({
            ...prev,
            [activeAgentId!]: [
              ...(prev[activeAgentId!] || []).filter(m => m.id !== streamId),
              ...richMessages,
            ],
          }));
        } else {
          setMessagesByAgent(prev => ({
            ...prev,
            [activeAgentId!]: (prev[activeAgentId!] || []).map(m =>
              m.id === streamId ? { ...m, content: data.error || "Sorry, I encountered an error." } : m
            ),
          }));
        }
      }
    } catch {
      // Fallback: try non-streaming endpoint
      try {
        const res2 = await fetch(`/api/agents/${activeAgentId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: msg }),
        });
        const data2 = await res2.json();
        if (data2.data?.agentMessage) {
          const richMessages = parseAgentResponse(data2.data.agentMessage.content);
          setMessagesByAgent(prev => ({
            ...prev,
            [activeAgentId!]: [
              ...(prev[activeAgentId!] || []).filter(m => m.id !== streamId),
              ...richMessages,
            ],
          }));
        }
      } catch {
        setMessagesByAgent(prev => ({
          ...prev,
          [activeAgentId!]: (prev[activeAgentId!] || []).map(m =>
            m.id === streamId ? { ...m, content: "I'm unable to respond right now — the server may be restarting. Please try again in a moment." } : m
          ),
        }));
      }
    }

    setSending(false);
    setAgentStatus(null);
    setAgentStuck(false);
    scrollToBottom();
  };

  // No auto-kickoff — agent waits for the user to send the first message.
  // The system prompt already instructs the agent to introduce itself on first contact.

  if (agentsLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-[500px] rounded-xl" /></div>;

  return (
    <div className="flex gap-0 lg:gap-4 h-[calc(100vh-120px)] lg:h-[calc(100vh-140px)] max-w-[1400px]">
      {/* Left: Conversation list — hidden on mobile */}
      <div className="hidden lg:flex w-[280px] flex-shrink-0 flex-col" style={{ borderRight: "1px solid var(--border)" }}>
        <div className="p-3">
          <input className="w-full px-3 py-1.5 rounded-lg text-xs bg-muted border border-border" placeholder="Search conversations..." />
        </div>
        <div className="flex-1 overflow-y-auto">
          {agentsLoading || agentData === undefined ? (
            <div className="p-6 text-center"><div className="w-8 h-8 mx-auto mb-3 rounded-full border-2 border-muted-foreground/20 border-t-primary animate-spin" /><p className="text-xs text-muted-foreground">Loading agents…</p></div>
          ) : agents.length === 0 ? (
            <div className="p-6 text-center"><Bot className="w-8 h-8 text-muted-foreground mx-auto mb-3" /><p className="text-sm font-medium mb-1">No agents deployed</p><p className="text-xs text-muted-foreground mb-3">Deploy your first agent to start chatting</p><a href="/agents/deploy" className="inline-flex items-center px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold">Deploy Agent →</a></div>
          ) : agents.map((agent: any) => {
            const agentMsgs = messagesByAgent[agent.id] || [];
            const lastMsg = agentMsgs[agentMsgs.length - 1];
            const active = activeAgentId === agent.id;
            const project = agent.deployments?.[0]?.project;
            return (
              <div key={agent.id}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-all ${active ? "bg-primary/10 border-l-[3px] border-l-primary" : "border-l-[3px] border-l-transparent hover:bg-muted/30"}`}
                onClick={() => setActiveAgentId(agent.id)}>
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
                    style={{ background: agent.gradient || "#6366F1" }}>{agent.name?.[0] ?? "A"}</div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${agent.status === "ACTIVE" ? "bg-green-400" : "bg-amber-400"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold truncate">{agent.name}</span>
                    <span className="text-[10px] text-muted-foreground">{agentMsgs.length > 0 ? "now" : ""}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {lastMsg
                      ? (lastMsg.content ?? "").slice(0, 45) + ((lastMsg.content ?? "").length > 45 ? "..." : "")
                      : agent._count?.chatMessages > 0
                        ? "Tap to continue conversation"
                        : (project?.name || "No messages yet")}
                  </p>
                </div>
                {agentMsgs.filter(m => m.role === "agent").length > 0 && !active && (
                  <span className="w-5 h-5 rounded-full bg-primary flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
                    {agentMsgs.filter(m => m.role === "agent").length}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Middle: Chat */}
      <div className="flex-1 flex flex-col">
        {/* Mobile agent selector — only visible on small screens */}
        {agents.length > 1 && (
          <div className="flex lg:hidden items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
            <Bot className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <select
              value={activeAgentId || ""}
              onChange={(e) => setActiveAgentId(e.target.value || null)}
              className="flex-1 px-2 py-1 rounded-lg border border-border bg-background text-xs font-medium outline-none"
            >
              {agents.map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.deployments?.[0]?.project?.name || "No project"}
                </option>
              ))}
            </select>
          </div>
        )}
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          {activeAgent ? (
            <>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white relative ${isPaused ? "grayscale opacity-60" : ""}`}
                style={{ background: activeAgent.gradient || "#6366F1" }}>{activeAgent.name?.[0] ?? "A"}</div>
              <div className="flex-1">
                <p className="text-sm font-semibold flex items-center gap-2">
                  Agent {activeAgent.name}
                  {isPaused && (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400">
                      Paused
                    </span>
                  )}
                </p>
                <p className="text-[10px] text-muted-foreground">L{activeAgent.autonomyLevel} · {activeAgent.deployments?.[0]?.project?.name || "No project"} · {activeAgent.status}</p>
              </div>
              <span className={`w-2 h-2 rounded-full ${activeAgent.status === "ACTIVE" ? "bg-green-400 animate-pulse" : "bg-amber-400"}`} />
              {/* Open-questions badge — click to jump to the oldest unresolved card */}
              {openQuestions.length > 0 && (
                <button
                  onClick={() => scrollToMessage(openQuestions[0].id)}
                  className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors text-[11px] font-semibold"
                  title="Jump to the oldest unresolved question"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  {openQuestions.length} {openQuestions.length === 1 ? "question waiting" : "questions waiting"}
                </button>
              )}
              {/* Search + Pause/Resume + Export buttons */}
              <div className={`${openQuestions.length > 0 ? "" : "ml-auto"} flex items-center gap-1`}>
                {/* Pause / Resume — symmetric with the resume banner so the
                    operator can toggle agent state without leaving chat. */}
                {!isPaused ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    title={`Pause Agent ${activeAgent.name}`}
                    disabled={pauseAgent.isPending}
                    onClick={() => {
                      if (!confirm(`Pause Agent ${activeAgent.name}?\n\nChat + autonomous cycles will stop. In-flight queued jobs will be cancelled. Resume any time.`)) return;
                      pauseAgent.mutate(activeAgentId!, {
                        onSuccess: () => toast.success(`${activeAgent.name} paused`),
                        onError: (e: any) => toast.error(e?.message || "Pause failed"),
                      });
                    }}
                  >
                    {pauseAgent.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PauseCircle className="w-3.5 h-3.5" />}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-amber-600"
                    title={`Resume Agent ${activeAgent.name}`}
                    disabled={resumeAgent.isPending}
                    onClick={() => {
                      resumeAgent.mutate(activeAgentId!, {
                        onSuccess: () => toast.success(`${activeAgent.name} resumed`),
                        onError: (e: any) => toast.error(e?.message || "Resume failed"),
                      });
                    }}
                  >
                    {resumeAgent.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowSearch(!showSearch)} title="Search conversation">
                  <Search className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Export conversation" onClick={() => {
                  const msgs = messagesByAgent[activeAgentId!] || [];
                  const text = msgs.map(m => `[${m.role === "user" ? "You" : activeAgent.name}] ${m.content}`).join("\n\n");
                  const blob = new Blob([text], { type: "text/plain" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = `chat-${activeAgent.name}-${new Date().toISOString().slice(0,10)}.txt`;
                  a.click(); URL.revokeObjectURL(url);
                  toast.success("Conversation exported");
                }}>
                  <ExternalLink className="w-3.5 h-3.5" />
                </Button>
              </div>
            </>
          ) : <p className="text-sm text-muted-foreground">Select an agent to start chatting</p>}
        </div>

        {/* Search bar */}
        {showSearch && (
          <div className="px-4 py-2 border-b border-border/30">
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search messages..."
              className="w-full px-3 py-1.5 rounded-lg text-xs bg-muted border border-border outline-none focus:border-primary"
              autoFocus />
          </div>
        )}

        {/* Paused banner — when the operator has paused this agent we make the
            state impossible to miss. Backend chat routes return 423 for paused
            agents so messages won't go through anyway; this banner explains
            why and offers one-click resume so the user isn't stuck. */}
        {isPaused && activeAgentId && (() => {
          const cancelledCount = pauseSummary?.cancelledJobsCount ?? 0;
          const counts = pauseSummary?.countsByType || {};
          const TYPE_LABELS: Record<string, string> = {
            autonomous_cycle: "autonomous cycle",
            lifecycle_init: "lifecycle init",
            approval_resume: "approval resume",
            report_generate: "report generation",
            user_edit_reconcile: "user-edit reconcile",
          };
          const breakdown = Object.entries(counts)
            .map(([t, n]) => `${n}× ${TYPE_LABELS[t] || t}`)
            .join(", ");
          const pausedAgo = pauseSummary?.pausedAt
            ? Math.round((Date.now() - new Date(pauseSummary.pausedAt).getTime()) / 60000)
            : null;
          return (
            <div className="mx-4 mt-3 px-3 py-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                <Circle className="w-4 h-4 text-amber-600 dark:text-amber-400 fill-current" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                  Agent paused{pausedAgo !== null && pausedAgo > 0 ? ` · ${pausedAgo < 60 ? `${pausedAgo}m ago` : `${Math.round(pausedAgo / 60)}h ago`}` : ""}
                </p>
                <p className="text-xs text-foreground">
                  {activeAgent?.name} won&apos;t reply to chat or run autonomous cycles until you resume.
                  Existing meetings + webhooks still process.
                </p>
                {cancelledCount > 0 && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                    Resuming will re-run {cancelledCount} cancelled job{cancelledCount === 1 ? "" : "s"}{breakdown ? `: ${breakdown}` : ""}.
                  </p>
                )}
              </div>
              <Button
                size="sm"
                className="h-7 text-[11px] flex-shrink-0 bg-amber-600 hover:bg-amber-700 text-white"
                disabled={resumeAgent.isPending}
                onClick={() => {
                  resumeAgent.mutate(activeAgentId, {
                    onSuccess: () => toast.success(
                      cancelledCount > 0
                        ? `${activeAgent?.name} resumed — re-running ${cancelledCount} job${cancelledCount === 1 ? "" : "s"}`
                        : `${activeAgent?.name} resumed — agent is active again`,
                    ),
                    onError: (e: any) => toast.error(e?.message || "Resume failed"),
                  });
                }}
              >
                {resumeAgent.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}
                Resume agent
              </Button>
            </div>
          );
        })()}

        {/* Resume banner — surfaces stale unresolved questions when you reopen
            chat after a break, so you don't have to scroll to find what the
            agent was waiting on. */}
        {staleOpenQuestion && !sending && (
          <div className="mx-4 mt-3 px-3 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
              <MessageSquare className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                Picking up where you left off
              </p>
              <p className="text-xs text-foreground truncate">
                {staleOpenQuestion.type === "agent_question" || staleOpenQuestion.type === "clarification"
                  ? staleOpenQuestion.data?.question?.question || "An open question is waiting for your answer"
                  : staleOpenQuestion.type === "pending_decision"
                    ? `Pending decision: "${staleOpenQuestion.data?.decisionText || "(no text)"}"`
                    : staleOpenQuestion.type === "change_proposal"
                      ? `Change proposal: ${staleOpenQuestion.data?.title || "(untitled)"}`
                      : "An action is waiting for you"}
              </p>
              <p className="text-[10px] text-muted-foreground">
                Asked {new Date(staleOpenQuestion.timestamp).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {openQuestions.length > 1 && ` · ${openQuestions.length - 1} more waiting`}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] flex-shrink-0"
              onClick={() => scrollToMessage(staleOpenQuestion.id)}
            >
              Show me
            </Button>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} data-chat-scroll className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Loading history indicator */}
          {historyLoading && activeAgent && (
            <div className="flex items-center gap-2 justify-center py-4 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading conversation history…
            </div>
          )}
          {/* Empty state — only shown after history has loaded and there's genuinely nothing */}
          {!historyLoading && messages.length === 0 && activeAgent && historyLoaded.has(activeAgentId!) && (
            <div className="text-center py-8">
              <div className="w-14 h-14 rounded-full mx-auto mb-3 flex items-center justify-center text-xl font-bold text-white"
                style={{ background: activeAgent.gradient || "#6366F1" }}>{activeAgent.name?.[0] ?? "A"}</div>
              <h3 className="text-sm font-bold mb-1">Starting conversation with {activeAgent.name}</h3>
              <p className="text-xs text-muted-foreground mb-5">
                {activeAgent.deployments?.[0]?.project?.name
                  ? `${activeAgent.deployments[0].project.name} · L${activeAgent.autonomyLevel} Autonomy`
                  : "No project assigned"}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {QUICK_ACTIONS.map(qa => (
                  <Button key={qa.label} variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => sendMessage(qa.prompt)}>
                    <qa.icon className="w-3.5 h-3.5" style={{ color: qa.color }} /> {qa.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {messages
            .filter(msg => !searchQuery || (msg.content || "").toLowerCase().includes(searchQuery.toLowerCase()))
            .map(msg => (
            <div key={msg.id} id={`msg-${msg.id}`}>
              <RichMessage msg={msg} agentGradient={activeAgent?.gradient} agentName={activeAgent?.name} />
            </div>
          ))}
          {/* Working indicator with live status + stuck detection */}
          {sending && (
            <div className="flex gap-2">
              <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-1"
                style={{ background: activeAgent?.gradient || "#6366F1" }}>{activeAgent?.name?.[0] || "A"}</div>
              <div className="space-y-1.5">
                {/* Status card */}
                <div className={`px-4 py-2.5 rounded-2xl rounded-bl-md flex items-center gap-2.5 ${agentStuck ? "bg-amber-500/10 border border-amber-500/20" : "bg-muted"}`}>
                  {!agentStuck ? (
                    <>
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
                      </span>
                      <span className="text-[11px] font-medium text-foreground">
                        {agentStatus?.detail || "Thinking..."}
                      </span>
                      {agentStatus?.stage && agentStatus.stage !== "thinking" && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium uppercase">
                          {agentStatus.stage}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="text-[11px] font-medium text-amber-600">
                        {agentStatus?.stage === "error" ? agentStatus.detail : "Agent seems to be taking longer than expected..."}
                      </span>
                    </>
                  )}
                </div>
                {/* Retry button when stuck */}
                {agentStuck && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setSending(false); setAgentStuck(false); setAgentStatus(null); }}
                      className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        setSending(false);
                        setAgentStuck(false);
                        setAgentStatus(null);
                        // Remove the empty stream message and retry
                        setMessagesByAgent(prev => ({
                          ...prev,
                          [activeAgentId!]: (prev[activeAgentId!] || []).filter(m => m.content),
                        }));
                        const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
                        if (lastUserMsg?.content) {
                          setTimeout(() => sendMessage(lastUserMsg.content), 100);
                        }
                      }}
                      className="text-[11px] font-semibold text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" /> Retry
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Quick actions row */}
        {messages.length > 0 && activeAgent && (
          <div className="px-4 py-2 border-t border-border/30 flex gap-2 overflow-x-auto">
            {QUICK_ACTIONS.map(qa => (
              <button key={qa.label} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium whitespace-nowrap bg-muted/50 hover:bg-muted text-muted-foreground transition-colors"
                onClick={() => sendMessage(qa.prompt)}>
                <qa.icon className="w-3 h-3" style={{ color: qa.color }} /> {qa.label}
              </button>
            ))}
          </div>
        )}

        {/* Input + file upload */}
        <div className="p-4 border-t border-border">
          {/* Attached file preview */}
          {attachedFile && (
            <div className="flex items-center gap-2 mb-2 px-3 py-1.5 rounded-lg bg-primary/5 border border-primary/20 text-xs">
              <FileText className="w-3 h-3 text-primary" />
              <span className="font-medium">{attachedFile.name}</span>
              <span className="text-muted-foreground">({(attachedFile.size / 1024).toFixed(0)}KB)</span>
              <button onClick={() => setAttachedFile(null)} className="ml-auto text-muted-foreground hover:text-foreground">&times;</button>
            </div>
          )}
          <form onSubmit={e => { e.preventDefault(); sendMessage(); }} className="flex gap-2">
            {/* File upload button */}
            <Button variant="ghost" size="sm" type="button" className="flex-shrink-0" disabled={isPaused} onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="w-4 h-4" />
            </Button>
            <input ref={fileInputRef} type="file" className="hidden"
              accept=".txt,.csv,.md,.json,.pdf,.png,.jpg,.jpeg,.gif,.xlsx,.docx"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file || !activeAgentId) return;
                setAttachedFile(file);
                // Upload immediately
                const fd = new FormData();
                fd.append("file", file);
                try {
                  const res = await fetch(`/api/agents/${activeAgentId}/chat/upload`, { method: "POST", body: fd });
                  const data = await res.json();
                  if (data.data?.contextForAgent) {
                    // Send the file context as a message so the agent can read it
                    sendMessage(`[File attached: ${file.name}] ${data.data.contextForAgent}`);
                    setAttachedFile(null);
                  }
                } catch { toast.error("Upload failed"); }
                e.target.value = "";
              }} />
            <input value={input} onChange={e => setInput(e.target.value)}
              placeholder={
                isPaused ? `Agent ${activeAgent?.name} is paused — resume to send messages`
                : activeAgent ? `Message Agent ${activeAgent.name}...`
                : "Select an agent"
              }
              disabled={!activeAgent || sending || isPaused}
              className="flex-1 px-3 py-2 rounded-lg text-sm bg-muted border border-border outline-none focus:border-primary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} />
            <Button type="submit" disabled={!input.trim() || !activeAgent || sending || isPaused} size="sm"><Send className="w-4 h-4" /></Button>
          </form>
        </div>
      </div>

      {/* Right: Context panel */}
      {activeAgent && (
        <div className="w-[260px] flex-shrink-0 space-y-3 overflow-y-auto border-l border-border pl-4">
          {/* Agent info */}
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-base font-bold text-white"
                  style={{ background: activeAgent.gradient || "#6366F1" }}>{activeAgent.name?.[0] ?? "A"}</div>
                <div>
                  <p className="text-sm font-bold">{activeAgent.name}</p>
                  <p className="text-[10px] text-muted-foreground">{activeAgent.codename || `${(activeAgent.name ?? "AGENT").toUpperCase()}-${activeAgent.autonomyLevel}`}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {[1, 2, 3].map(i => <div key={i} className="w-2 h-2 rounded-full" style={{ background: i <= activeAgent.autonomyLevel ? "var(--primary)" : "var(--border)" }} />)}
                <span className="text-[9px] ml-1 text-muted-foreground">Level {activeAgent.autonomyLevel}</span>
              </div>
            </CardContent>
          </Card>

          {/* Project context */}
          {activeAgent.deployments?.[0]?.project && (
            <Card>
              <CardContent className="pt-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Project Context</p>
                <p className="text-sm font-bold">{activeAgent.deployments[0].project.name}</p>
                <Badge variant="outline" className="text-[9px] mt-1">{METHOD_LABEL[activeAgent.deployments[0].project.methodology] || activeAgent.deployments[0].project.methodology}</Badge>
                {activeAgent.deployments[0].project.budget && (
                  <p className="text-xs text-muted-foreground mt-2">Budget: {formatMoney(activeAgent.deployments[0].project.budget, currency)}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Stats */}
          <Card>
            <CardContent className="pt-4 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Agent Stats</p>
              {[
                { label: "Actions", value: activeAgent._count?.activities || 0 },
                { label: "Decisions", value: activeAgent._count?.decisions || 0 },
                { label: "Messages", value: activeAgent._count?.chatMessages || 0 },
                { label: "Credits Used", value: activeAgent.creditsUsed || 0 },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="font-semibold">{s.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Artefacts (if project has them) */}
          <Card>
            <CardContent className="pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Quick Actions</p>
              <div className="space-y-1">
                {QUICK_ACTIONS.map(qa => (
                  <button key={qa.label} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs hover:bg-muted/50 transition-colors text-left"
                    onClick={() => sendMessage(qa.prompt)}>
                    <qa.icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: qa.color }} />
                    <span className="text-muted-foreground flex-1">{qa.label}</span>
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
