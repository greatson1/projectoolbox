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
type MessageType = "text" | "status" | "artefact" | "risk" | "actions";

interface Message {
  id: string;
  role: "user" | "agent";
  type: MessageType;
  content: string;
  data?: any;
  timestamp: Date;
}

const QUICK_ACTIONS = [
  { label: "Status Update", icon: BarChart3, prompt: "Give me a full status update on the current project including progress, risks, and blockers.", color: "#6366F1" },
  { label: "Generate Artefact", icon: FileText, prompt: "Generate a status report for the current project phase.", color: "#22D3EE" },
  { label: "Check Risks", icon: AlertTriangle, prompt: "Analyse current project risks. Flag any new risks and update existing risk scores.", color: "#EF4444" },
  { label: "Schedule", icon: Calendar, prompt: "What meetings and deadlines are coming up this week?", color: "#10B981" },
  { label: "Research", icon: Search, prompt: "Research best practices for our current project methodology.", color: "#8B5CF6" },
];

// ── Rich message renderer ──
function RichMessage({ msg, agentGradient, agentName }: { msg: Message; agentGradient?: string; agentName?: string }) {
  // Hide internal system kickoff prompts from the UI
  const isKickoff = msg.role === "user" && (msg.content.startsWith("SYSTEM_KICKOFF:") || msg.content.startsWith("KICKOFF:"));
  if (isKickoff) return null;

  if (msg.role === "user") {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[70%] px-4 py-3 rounded-2xl rounded-br-md bg-primary text-primary-foreground text-sm leading-relaxed whitespace-pre-line">
          {msg.content}
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

  // Default text — render with proper markdown (tables, headings, lists, bold, etc.)
  return (
    <div className="flex gap-2">
      {avatar}
      <div className="max-w-[80%] px-4 py-3 rounded-2xl rounded-bl-md bg-muted text-sm leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
          {msg.content}
        </ReactMarkdown>
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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeAgentId && agents.length > 0) setActiveAgentId(agents[0].id);
  }, [agents, activeAgentId]);

  const activeAgent = agents.find((a: any) => a.id === activeAgentId);
  const messages = activeAgentId ? (messagesByAgent[activeAgentId] || []) : [];

  // ── Load persistent chat history from DB when switching agents ──
  useEffect(() => {
    if (!activeAgentId || historyLoaded.has(activeAgentId)) return;

    setHistoryLoading(true);
    fetch(`/api/agents/${activeAgentId}/chat`)
      .then(r => r.json())
      .then(({ data }) => {
        if (!Array.isArray(data)) return;
        // Filter out system kickoff messages stored in DB
        const filtered = data.filter((m: any) =>
          !(m.role === "user" && (m.content?.startsWith("SYSTEM_KICKOFF:") || m.content?.startsWith("KICKOFF:")))
        );
        const loaded: Message[] = filtered.map((m: any) => ({
          id: m.id,
          role: m.role === "user" ? "user" : "agent",
          type: "text" as const,
          content: m.content,
          timestamp: new Date(m.createdAt),
        }));
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
            } catch {}
          }
        }

        // If streaming produced no content, parse the final message
        if (!fullContent) throw new Error("Empty stream");
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
            m.id === streamId ? { ...m, content: "Connection error. Please try again." } : m
          ),
        }));
      }
    }

    setSending(false);
    scrollToBottom();
  };

  // Auto-kickoff: only fire on genuine FIRST contact (no history in DB).
  // If history loaded and messages exist → skip entirely (agent is silent, ready for input).
  // If history loaded and empty → this is a brand new agent, fire first-contact kickoff.
  useEffect(() => {
    if (!activeAgentId || !activeAgent || sending) return;
    // Wait until history fetch has completed for this agent
    if (!historyLoaded.has(activeAgentId)) return;
    if (kickoffFiredRef.current.has(activeAgentId)) return;

    const existingMsgs = messagesByAgent[activeAgentId] || [];
    // History exists — user is returning. Don't greet. Agent is ready.
    if (existingMsgs.length > 0) {
      kickoffFiredRef.current.add(activeAgentId);
      return;
    }

    // Only kickoff for deployed agents with a project
    const hasProject = activeAgent.deployments?.length > 0 || activeAgent.project;
    if (!hasProject) return;

    kickoffFiredRef.current.add(activeAgentId);
    setTimeout(() => {
      sendMessage(`SYSTEM_KICKOFF: This is our first interaction. Please: (1) introduce yourself and confirm the project details, (2) present your initial assessment and any research findings, (3) summarise any artefacts you've already generated, (4) list the top risks identified, and (5) state clearly what needs to happen next and whether you require my approval to proceed.`);
    }, 1200);
  }, [activeAgentId, activeAgent, messagesByAgent, historyLoaded, sending]);

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
                    style={{ background: agent.gradient || "#6366F1" }}>{agent.name[0]}</div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${agent.status === "ACTIVE" ? "bg-green-400" : "bg-amber-400"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold truncate">{agent.name}</span>
                    <span className="text-[10px] text-muted-foreground">{agentMsgs.length > 0 ? "now" : ""}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {lastMsg
                      ? lastMsg.content.slice(0, 45) + (lastMsg.content.length > 45 ? "..." : "")
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
                style={{ background: activeAgent.gradient || "#6366F1" }}>{activeAgent.name[0]}</div>
              <div className="flex-1">
                <p className="text-sm font-semibold">Agent {activeAgent.name}</p>
                <p className="text-[10px] text-muted-foreground">L{activeAgent.autonomyLevel} · {activeAgent.deployments?.[0]?.project?.name || "No project"} · {activeAgent.status}</p>
              </div>
              <span className={`w-2 h-2 rounded-full ${activeAgent.status === "ACTIVE" ? "bg-green-400 animate-pulse" : "bg-amber-400"}`} />
            </>
          ) : <p className="text-sm text-muted-foreground">Select an agent to start chatting</p>}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
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
                style={{ background: activeAgent.gradient || "#6366F1" }}>{activeAgent.name[0]}</div>
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
                  style={{ background: activeAgent.gradient || "#6366F1" }}>{activeAgent.name[0]}</div>
                <div>
                  <p className="text-sm font-bold">{activeAgent.name}</p>
                  <p className="text-[10px] text-muted-foreground">{activeAgent.codename || `${activeAgent.name.toUpperCase()}-${activeAgent.autonomyLevel}`}</p>
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
