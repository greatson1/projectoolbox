"use client";

import { usePageTitle } from "@/hooks/use-page-title";
import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useAgents } from "@/hooks/use-api";
import { toast } from "sonner";
import { Send, Bot, Loader2, BarChart3, FileText, AlertTriangle, Calendar, Search, Paperclip, ChevronRight, CheckCircle2, Circle, Shield, ExternalLink } from "lucide-react";
import Link from "next/link";
import { ClarificationCard, ClarificationCompleteCard } from "@/components/agents/ClarificationCard";
import { AgentQuestionCard, ProjectStatusCard } from "@/components/agents/AgentResponseCards";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
type MessageType = "text" | "status" | "artefact" | "risk" | "actions" | "clarification" | "clarification_complete" | "agent_question" | "project_status" | "change_proposal";

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
function RichMessage({ msg, agentGradient, agentName }: { msg: Message; agentGradient?: string; agentName?: string }) {
  // Guard against null content (DB records can have null)
  const content = msg.content ?? "";

  // Hide internal system kickoff prompts from the UI
  const isKickoff = msg.role === "user" && (content.startsWith("SYSTEM_KICKOFF:") || content.startsWith("KICKOFF:"));
  if (isKickoff) return null;

  if (msg.role === "user") {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[70%] px-4 py-3 rounded-2xl rounded-br-md bg-primary text-primary-foreground text-sm leading-relaxed whitespace-pre-line">
          {content}
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
  const askMatches = [...rawContent.matchAll(/<ASK\s+([^>]*)>([^<]*)<\/ASK>/gi)];
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
        {askMatches.length > 0 && (
          <div className="space-y-2 pl-1">
            {askMatches.map((m, i) => {
              const attrs = m[1];
              const label = m[2].trim();
              const typeMatch = attrs.match(/type="([^"]+)"/);
              const idMatch = attrs.match(/id="([^"]+)"/);
              const optionsMatch = attrs.match(/options="([^"]+)"/);
              const askType = typeMatch?.[1] || "text";
              const askId = idMatch?.[1] || `ask-${i}`;
              const options = optionsMatch?.[1]?.split("|") || [];

              return (
                <div key={askId} className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                  <label className="text-xs font-medium text-foreground mb-1.5 block">{label}</label>
                  {askType === "choice" && options.length > 0 ? (
                    <select className="w-full px-3 py-2 rounded-lg text-sm bg-background border border-input" defaultValue="">
                      <option value="" disabled>Select an option...</option>
                      {options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : askType === "date" ? (
                    <input type="date" className="w-full px-3 py-2 rounded-lg text-sm bg-background border border-input" />
                  ) : askType === "number" ? (
                    <input type="number" className="w-full px-3 py-2 rounded-lg text-sm bg-background border border-input" placeholder={label} />
                  ) : (
                    <input type="text" className="w-full px-3 py-2 rounded-lg text-sm bg-background border border-input" placeholder={label} />
                  )}
                </div>
              );
            })}
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

  usePageTitle("Chat with Agent");
  const [activeAgentId, setActiveAgentId] = useState<string | null>(searchParams.get("agent"));
  const [messagesByAgent, setMessagesByAgent] = useState<Record<string, Message[]>>({});
  const [historyLoaded, setHistoryLoaded] = useState<Set<string>>(new Set());
  const [historyLoading, setHistoryLoading] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [clarificationSubmitting, setClarificationSubmitting] = useState(false);
  const [generatingDocs, setGeneratingDocs] = useState(false);
  const [agentQuestionSubmitting, setAgentQuestionSubmitting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeAgentId && agents.length > 0) setActiveAgentId(agents[0].id);
  }, [agents, activeAgentId]);

  const activeAgent = agents.find((a: any) => a.id === activeAgentId);
  // Inject live handlers into clarification cards (handlers can't be serialised to state)
  const messages: Message[] = (activeAgentId ? (messagesByAgent[activeAgentId] || []) : []).map(m => {
    if (m.type === "clarification" && m.data && !m.data.onAnswered) {
      return { ...m, data: { ...m.data, onAnswered: (ans: string) => handleClarificationAnswer(m.data.question.id, ans), isSubmitting: clarificationSubmitting } };
    }
    if (m.type === "clarification_complete" && m.data && !m.data.onGenerate) {
      return { ...m, data: { ...m.data, onGenerate: () => handleGenerateDocuments(), isGenerating: generatingDocs } };
    }
    if (m.type === "agent_question" && m.data && !m.data.onAnswered) {
      return { ...m, data: { ...m.data, onAnswered: (ans: string) => handleAgentQuestionAnswer(m.id, ans), isSubmitting: agentQuestionSubmitting } };
    }
    return m;
  });

  // ── Load persistent chat history from DB when switching agents ──
  useEffect(() => {
    if (!activeAgentId || historyLoaded.has(activeAgentId)) return;

    setHistoryLoading(true);
    fetch(`/api/agents/${activeAgentId}/chat`)
      .then(r => r.json())
      .then(({ data }) => {
        if (!Array.isArray(data)) return;
        // Filter out system kickoff messages and raw clarification sentinels
        const filtered = data.filter((m: any) =>
          !(m.role === "user" && (m.content?.startsWith("SYSTEM_KICKOFF:") || m.content?.startsWith("KICKOFF:")))
        );

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
              },
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
            m.content === "__PROJECT_STATUS__" ||
            m.content === "__CHANGE_PROPOSAL__"
          ));
        });

        setMessagesByAgent(prev => ({ ...prev, [activeAgentId]: loaded }));
        setHistoryLoaded(prev => new Set([...prev, activeAgentId]));
        // Scroll to bottom after history loads
        setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 150);
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
      await fetch(`/api/agents/${activeAgentId}/clarification/generate`, { method: "POST" });
      // Update the complete card to show generating state
      setMessagesByAgent(prev => ({
        ...prev,
        [activeAgentId!]: (prev[activeAgentId!] || []).map(m =>
          m.type === "clarification_complete" ? { ...m, data: { ...m.data, isGenerating: true } } : m
        ),
      }));
      // Notify user
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
      // Send the answer as a normal user message — this triggers a full Claude response
      await sendMessage(answer);
    } finally {
      setAgentQuestionSubmitting(false);
    }
  };

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || !activeAgentId) return;

    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", type: "text", content: msg, timestamp: new Date() };
    setMessagesByAgent(prev => ({ ...prev, [activeAgentId!]: [...(prev[activeAgentId!] || []), userMsg] }));
    setInput("");
    setSending(true);
    scrollToBottom();

    // Create a placeholder streaming message
    const streamId = `stream-${Date.now()}`;
    const streamMsg: Message = { id: streamId, role: "agent", type: "text", content: "", timestamp: new Date() };
    setMessagesByAgent(prev => ({ ...prev, [activeAgentId!]: [...(prev[activeAgentId!] || []), streamMsg] }));

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
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.token) {
                fullContent += data.token;
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
                const errMsg = data.error === "LLM stream failed"
                  ? "I'm having trouble connecting to the AI right now. Please try again in a moment."
                  : data.error;
                setMessagesByAgent(prev => ({
                  ...prev,
                  [activeAgentId!]: (prev[activeAgentId!] || []).map(m =>
                    m.id === streamId ? { ...m, content: errMsg } : m
                  ),
                }));
                setSending(false);
                scrollToBottom();
                return; // don't fall through to the empty-stream throw
              }
            } catch {}
          }
        }

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
    scrollToBottom();
  };

  // No auto-kickoff — agent waits for the user to send the first message.
  // The system prompt already instructs the agent to introduce itself on first contact.

  if (agentsLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-[500px] rounded-xl" /></div>;

  return (
    <div className="flex gap-4 h-[calc(100vh-140px)] max-w-[1400px]">
      {/* Left: Conversation list */}
      <div className="w-[280px] flex-shrink-0 flex flex-col" style={{ borderRight: "1px solid var(--border)" }}>
        <div className="p-3">
          <input className="w-full px-3 py-1.5 rounded-lg text-xs bg-muted border border-border" placeholder="Search conversations..." />
        </div>
        <div className="flex-1 overflow-y-auto">
          {agents.length === 0 ? (
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
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          {activeAgent ? (
            <>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
                style={{ background: activeAgent.gradient || "#6366F1" }}>{activeAgent.name?.[0] ?? "A"}</div>
              <div className="flex-1">
                <p className="text-sm font-semibold">Agent {activeAgent.name}</p>
                <p className="text-[10px] text-muted-foreground">L{activeAgent.autonomyLevel} · {activeAgent.deployments?.[0]?.project?.name || "No project"} · {activeAgent.status}</p>
              </div>
              <span className={`w-2 h-2 rounded-full ${activeAgent.status === "ACTIVE" ? "bg-green-400 animate-pulse" : "bg-amber-400"}`} />
            </>
          ) : <p className="text-sm text-muted-foreground">Select an agent to start chatting</p>}
        </div>

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
          {messages.map(msg => (
            <RichMessage key={msg.id} msg={msg} agentGradient={activeAgent?.gradient} agentName={activeAgent?.name} />
          ))}
          {sending && (
            <div className="flex gap-2">
              <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-1"
                style={{ background: activeAgent?.gradient || "#6366F1" }}>{activeAgent?.name?.[0] || "A"}</div>
              <div className="bg-muted px-4 py-3 rounded-2xl rounded-bl-md flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "300ms" }} />
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

        {/* Input */}
        <div className="p-4 border-t border-border">
          <form onSubmit={e => { e.preventDefault(); sendMessage(); }} className="flex gap-2">
            <Button variant="ghost" size="sm" type="button" className="flex-shrink-0"><Paperclip className="w-4 h-4" /></Button>
            <input value={input} onChange={e => setInput(e.target.value)}
              placeholder={activeAgent ? `Message Agent ${activeAgent.name}...` : "Select an agent"}
              disabled={!activeAgent || sending}
              className="flex-1 px-3 py-2 rounded-lg text-sm bg-muted border border-border outline-none focus:border-primary transition-colors"
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} />
            <Button type="submit" disabled={!input.trim() || !activeAgent || sending} size="sm"><Send className="w-4 h-4" /></Button>
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
                {[1, 2, 3, 4, 5].map(i => <div key={i} className="w-2 h-2 rounded-full" style={{ background: i <= activeAgent.autonomyLevel ? "var(--primary)" : "var(--border)" }} />)}
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
                <Badge variant="outline" className="text-[9px] mt-1">{activeAgent.deployments[0].project.methodology}</Badge>
                {activeAgent.deployments[0].project.budget && (
                  <p className="text-xs text-muted-foreground mt-2">Budget: ${activeAgent.deployments[0].project.budget.toLocaleString()}</p>
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
