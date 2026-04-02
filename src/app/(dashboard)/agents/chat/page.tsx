"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ChatPageWrapper() {
  return <Suspense fallback={null}><AgentChatPage /></Suspense>;
}
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAgents } from "@/hooks/use-api";
import { Send, Bot, Loader2, BarChart3, FileText, AlertTriangle, Calendar, Search } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: Date;
}

const QUICK_ACTIONS = [
  { label: "Status Update", icon: BarChart3, prompt: "Give me a status update on the current project including progress, risks, and blockers." },
  { label: "Generate Artefact", icon: FileText, prompt: "Generate a status report for the current project phase." },
  { label: "Check Risks", icon: AlertTriangle, prompt: "Analyse current project risks. Flag any new risks and update existing scores." },
  { label: "Schedule", icon: Calendar, prompt: "What meetings and deadlines are coming up this week?" },
  { label: "Research", icon: Search, prompt: "Research best practices for our current project methodology." },
];

function AgentChatPage() {
  const searchParams = useSearchParams();
  const { data: agentData, isLoading: agentsLoading } = useAgents();
  const agents = agentData?.agents || [];

  const [activeAgentId, setActiveAgentId] = useState<string | null>(searchParams.get("agent"));
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Set first agent as active if none selected
  useEffect(() => {
    if (!activeAgentId && agents.length > 0) setActiveAgentId(agents[0].id);
  }, [agents, activeAgentId]);

  const activeAgent = agents.find((a: any) => a.id === activeAgentId);

  const scrollToBottom = () => {
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 100);
  };

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || !activeAgentId) return;

    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: msg, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
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
          id: data.data.agentMessage.id,
          role: "agent",
          content: data.data.agentMessage.content,
          timestamp: new Date(data.data.agentMessage.createdAt),
        };
        setMessages(prev => [...prev, agentMsg]);
      } else {
        setMessages(prev => [...prev, {
          id: `err-${Date.now()}`, role: "agent",
          content: data.error || "Sorry, I encountered an error. Please try again.",
          timestamp: new Date(),
        }]);
      }
    } catch {
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`, role: "agent",
        content: "Connection error. Please check your network and try again.",
        timestamp: new Date(),
      }]);
    }

    setSending(false);
    scrollToBottom();
  };

  if (agentsLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-[500px] rounded-xl" /></div>;
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-140px)] max-w-[1400px]">
      {/* Agent list */}
      <div className="w-[240px] flex-shrink-0 space-y-2">
        <h2 className="text-sm font-bold px-2">Agents</h2>
        {agents.length === 0 ? (
          <div className="p-4 text-center">
            <Bot className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">No agents deployed</p>
          </div>
        ) : agents.map((agent: any) => (
          <button key={agent.id}
            className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${activeAgentId === agent.id ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/30"}`}
            onClick={() => { setActiveAgentId(agent.id); setMessages([]); }}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
              style={{ background: agent.gradient || "#6366F1" }}>{agent.name[0]}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{agent.name}</p>
              <p className="text-[10px] text-muted-foreground">
                {agent.deployments?.[0]?.project?.name || "Unassigned"}
              </p>
            </div>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${agent.status === "ACTIVE" ? "bg-green-400 animate-pulse" : "bg-amber-400"}`} />
          </button>
        ))}
      </div>

      {/* Chat area */}
      <Card className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <CardHeader className="flex flex-row items-center gap-3 pb-3 border-b border-border flex-shrink-0">
          {activeAgent ? (
            <>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
                style={{ background: activeAgent.gradient || "#6366F1" }}>{activeAgent.name[0]}</div>
              <div>
                <p className="text-sm font-semibold">Agent {activeAgent.name}</p>
                <p className="text-[10px] text-muted-foreground">L{activeAgent.autonomyLevel} · {activeAgent.status}</p>
              </div>
              <span className={`w-2 h-2 rounded-full ${activeAgent.status === "ACTIVE" ? "bg-green-400 animate-pulse" : "bg-amber-400"}`} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Select an agent to start chatting</p>
          )}
        </CardHeader>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && activeAgent && (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl font-bold text-white"
                style={{ background: activeAgent.gradient || "#6366F1" }}>{activeAgent.name[0]}</div>
              <h3 className="text-base font-bold mb-1">Chat with Agent {activeAgent.name}</h3>
              <p className="text-sm text-muted-foreground mb-6">Ask questions, request updates, or use the quick actions below.</p>

              {/* Quick actions */}
              <div className="flex flex-wrap justify-center gap-2">
                {QUICK_ACTIONS.map(qa => (
                  <Button key={qa.label} variant="outline" size="sm" className="text-xs gap-1.5"
                    onClick={() => sendMessage(qa.prompt)}>
                    <qa.icon className="w-3.5 h-3.5" /> {qa.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-md"
                  : "bg-muted rounded-bl-md"
              }`}>
                {msg.content}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="bg-muted px-4 py-3 rounded-2xl rounded-bl-md">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-4 border-t border-border flex-shrink-0">
          <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} className="flex gap-2">
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={activeAgent ? `Message Agent ${activeAgent.name}...` : "Select an agent first"}
              disabled={!activeAgent || sending}
              className="flex-1"
            />
            <Button type="submit" disabled={!input.trim() || !activeAgent || sending} size="sm">
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
