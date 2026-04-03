"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgents } from "@/hooks/use-api";
import { Send, Bot, Loader2, BarChart3, FileText, AlertTriangle, Calendar, Search, Paperclip, ChevronRight } from "lucide-react";

export default function ChatPageWrapper() {
  return <Suspense fallback={null}><AgentChatPage /></Suspense>;
}

interface Message {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: Date;
}

const QUICK_ACTIONS = [
  { label: "Status Update", icon: BarChart3, prompt: "Give me a full status update on the current project including progress, risks, and blockers.", color: "#6366F1" },
  { label: "Generate Artefact", icon: FileText, prompt: "Generate a status report for the current project phase.", color: "#22D3EE" },
  { label: "Check Risks", icon: AlertTriangle, prompt: "Analyse current project risks. Flag any new risks and update existing risk scores.", color: "#EF4444" },
  { label: "Schedule", icon: Calendar, prompt: "What meetings and deadlines are coming up this week?", color: "#10B981" },
  { label: "Research", icon: Search, prompt: "Research best practices for our current project methodology.", color: "#8B5CF6" },
];

function AgentChatPage() {
  const searchParams = useSearchParams();
  const { data: agentData, isLoading: agentsLoading } = useAgents();
  const agents = agentData?.agents || [];

  const [activeAgentId, setActiveAgentId] = useState<string | null>(searchParams.get("agent"));
  const [messagesByAgent, setMessagesByAgent] = useState<Record<string, Message[]>>({});
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeAgentId && agents.length > 0) setActiveAgentId(agents[0].id);
  }, [agents, activeAgentId]);

  const activeAgent = agents.find((a: any) => a.id === activeAgentId);
  const messages = activeAgentId ? (messagesByAgent[activeAgentId] || []) : [];

  const scrollToBottom = () => {
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 100);
  };

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || !activeAgentId) return;

    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: msg, timestamp: new Date() };
    setMessagesByAgent(prev => ({ ...prev, [activeAgentId!]: [...(prev[activeAgentId!] || []), userMsg] }));
    setInput("");
    setSending(true);
    scrollToBottom();

    try {
      const res = await fetch(`/api/agents/${activeAgentId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();

      if (res.ok && data.data?.agentMessage) {
        const agentMsg: Message = {
          id: data.data.agentMessage.id, role: "agent",
          content: data.data.agentMessage.content,
          timestamp: new Date(data.data.agentMessage.createdAt),
        };
        setMessagesByAgent(prev => ({ ...prev, [activeAgentId!]: [...(prev[activeAgentId!] || []), agentMsg] }));
      } else {
        setMessagesByAgent(prev => ({
          ...prev, [activeAgentId!]: [...(prev[activeAgentId!] || []), {
            id: `err-${Date.now()}`, role: "agent" as const,
            content: data.error || "Sorry, I encountered an error. Please try again.",
            timestamp: new Date(),
          }]
        }));
      }
    } catch {
      setMessagesByAgent(prev => ({
        ...prev, [activeAgentId!]: [...(prev[activeAgentId!] || []), {
          id: `err-${Date.now()}`, role: "agent" as const,
          content: "Connection error. Please check your network and try again.",
          timestamp: new Date(),
        }]
      }));
    }

    setSending(false);
    scrollToBottom();
  };

  if (agentsLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-[500px] rounded-xl" /></div>;

  return (
    <div className="flex gap-4 h-[calc(100vh-140px)] max-w-[1400px]">
      {/* Left: Agent list */}
      <div className="w-[260px] flex-shrink-0 space-y-1 overflow-y-auto">
        <h2 className="text-sm font-bold px-2 mb-2">Conversations</h2>
        {agents.length === 0 ? (
          <div className="p-4 text-center"><Bot className="w-6 h-6 text-muted-foreground mx-auto mb-2" /><p className="text-xs text-muted-foreground">No agents deployed</p></div>
        ) : agents.map((agent: any) => {
          const agentMsgs = messagesByAgent[agent.id] || [];
          const lastMsg = agentMsgs[agentMsgs.length - 1];
          return (
            <button key={agent.id}
              className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${activeAgentId === agent.id ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/30"}`}
              onClick={() => setActiveAgentId(agent.id)}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                style={{ background: agent.gradient || "#6366F1" }}>{agent.name[0]}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold truncate">{agent.name}</p>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${agent.status === "ACTIVE" ? "bg-green-400 animate-pulse" : "bg-amber-400"}`} />
                </div>
                <p className="text-[10px] text-muted-foreground truncate">
                  {lastMsg ? lastMsg.content.slice(0, 40) + "..." : (agent.deployments?.[0]?.project?.name || "No messages yet")}
                </p>
              </div>
              {agentMsgs.length > 0 && (
                <span className="text-[9px] text-muted-foreground">L{agent.autonomyLevel}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Middle: Chat */}
      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardHeader className="flex flex-row items-center gap-3 pb-3 border-b border-border flex-shrink-0">
          {activeAgent ? (
            <>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
                style={{ background: activeAgent.gradient || "#6366F1" }}>{activeAgent.name[0]}</div>
              <div className="flex-1">
                <p className="text-sm font-semibold">Agent {activeAgent.name}</p>
                <p className="text-[10px] text-muted-foreground">L{activeAgent.autonomyLevel} · {activeAgent.deployments?.[0]?.project?.name || "No project"}</p>
              </div>
              <span className={`w-2 h-2 rounded-full ${activeAgent.status === "ACTIVE" ? "bg-green-400 animate-pulse" : "bg-amber-400"}`} />
            </>
          ) : <p className="text-sm text-muted-foreground">Select an agent</p>}
        </CardHeader>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && activeAgent && (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl font-bold text-white"
                style={{ background: activeAgent.gradient || "#6366F1" }}>{activeAgent.name[0]}</div>
              <h3 className="text-base font-bold mb-1">Chat with Agent {activeAgent.name}</h3>
              <p className="text-sm text-muted-foreground mb-2">
                {activeAgent.deployments?.[0]?.project?.name
                  ? `Managing ${activeAgent.deployments[0].project.name} (${activeAgent.deployments[0].project.methodology})`
                  : "No project assigned"}
              </p>
              <p className="text-xs text-muted-foreground mb-6">Ask questions or use quick actions below. Each agent only knows about their assigned project.</p>
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
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} gap-2`}>
              {msg.role === "agent" && activeAgent && (
                <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-1"
                  style={{ background: activeAgent.gradient || "#6366F1" }}>{activeAgent.name[0]}</div>
              )}
              <div className={`max-w-[70%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-line ${
                msg.role === "user" ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted rounded-bl-md"
              }`}>{msg.content}</div>
            </div>
          ))}
          {sending && (
            <div className="flex gap-2">
              {activeAgent && <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white mt-1" style={{ background: activeAgent.gradient || "#6366F1" }}>{activeAgent.name[0]}</div>}
              <div className="bg-muted px-4 py-3 rounded-2xl rounded-bl-md flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-4 border-t border-border flex-shrink-0">
          <form onSubmit={e => { e.preventDefault(); sendMessage(); }} className="flex gap-2">
            <Button variant="ghost" size="sm" type="button" className="flex-shrink-0"><Paperclip className="w-4 h-4" /></Button>
            <input value={input} onChange={e => setInput(e.target.value)}
              placeholder={activeAgent ? `Message Agent ${activeAgent.name}...` : "Select an agent"}
              disabled={!activeAgent || sending}
              className="flex-1 px-3 py-2 rounded-lg text-sm bg-muted border border-border outline-none focus:border-primary transition-colors" />
            <Button type="submit" disabled={!input.trim() || !activeAgent || sending} size="sm"><Send className="w-4 h-4" /></Button>
          </form>
        </div>
      </Card>

      {/* Right: Context panel */}
      {activeAgent && (
        <div className="w-[240px] flex-shrink-0 space-y-3 overflow-y-auto">
          <Card>
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
                  style={{ background: activeAgent.gradient || "#6366F1" }}>{activeAgent.name[0]}</div>
                <div>
                  <p className="text-xs font-semibold">{activeAgent.name}</p>
                  <p className="text-[10px] text-muted-foreground">{activeAgent.codename}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {[1,2,3,4,5].map(i => <div key={i} className="w-2 h-2 rounded-full" style={{ background: i <= activeAgent.autonomyLevel ? "var(--primary)" : "var(--border)" }} />)}
                <span className="text-[9px] ml-1 text-muted-foreground">L{activeAgent.autonomyLevel}</span>
              </div>
            </CardContent>
          </Card>

          {activeAgent.deployments?.[0]?.project && (
            <Card>
              <CardContent className="pt-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Project Context</p>
                <p className="text-xs font-semibold">{activeAgent.deployments[0].project.name}</p>
                <Badge variant="outline" className="text-[9px] mt-1">{activeAgent.deployments[0].project.methodology}</Badge>
                <p className="text-[10px] text-muted-foreground mt-2">This agent exclusively manages this project. All responses are based on this project&apos;s data.</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="pt-4 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Stats</p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Actions</span>
                <span className="font-semibold">{activeAgent._count?.activities || 0}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Decisions</span>
                <span className="font-semibold">{activeAgent._count?.decisions || 0}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Credits Used</span>
                <span className="font-semibold">{activeAgent.creditsUsed || 0}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Quick Actions</p>
              <div className="space-y-1">
                {QUICK_ACTIONS.map(qa => (
                  <button key={qa.label} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs hover:bg-muted/50 transition-colors text-left"
                    onClick={() => sendMessage(qa.prompt)}>
                    <qa.icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: qa.color }} />
                    <span className="text-muted-foreground">{qa.label}</span>
                    <ChevronRight className="w-3 h-3 text-muted-foreground ml-auto" />
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
