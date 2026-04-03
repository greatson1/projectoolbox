"use client";
// @ts-nocheck

import { cn } from "@/lib/utils";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

/**
 * Agent Chat — 3-panel chat interface with rich message types.
 */




// ================================================================
// TYPES
// ================================================================

type MessageType = "text" | "status" | "artefact" | "risk" | "actions";

interface ChatMessage {
  id: string;
  role: "agent" | "user";
  type: MessageType;
  content: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

interface Conversation {
  id: string;
  projectName: string;
  agentName: string;
  lastMessage: string;
  timestamp: string;
  unread: number;
  online: boolean;
}

// ================================================================
// SAMPLE DATA
// ================================================================

const CONVERSATIONS: Conversation[] = [
  { id: "1", projectName: "CRM Migration", agentName: "Maya", lastMessage: "Risk Register v2 is ready for your review", timestamp: "2m", unread: 2, online: true },
  { id: "2", projectName: "Office Renovation", agentName: "Jordan", lastMessage: "Budget alert: 78% spent with 45% work remaining", timestamp: "18m", unread: 0, online: true },
  { id: "3", projectName: "Mobile App MVP", agentName: "Alex", lastMessage: "Sprint 3 planning complete. 8 stories committed.", timestamp: "1h", unread: 1, online: true },
];

const MESSAGES: ChatMessage[] = [
  { id: "1", role: "agent", type: "text", content: "Good morning. I've completed the overnight analysis of Project Atlas. Here's the current status:", timestamp: "9:02 AM" },
  { id: "2", role: "agent", type: "status", content: "", timestamp: "9:02 AM", data: {
    items: [
      { label: "Health", value: "Amber", variant: "secondary" },
      { label: "Completion", value: "32%", variant: "outline" },
      { label: "Open Risks", value: "4 high", variant: "destructive" },
      { label: "Blocked Tasks", value: "2", variant: "destructive" },
      { label: "Next Milestone", value: "Data Migration Start — 12 days", variant: "outline" },
      { label: "Budget", value: "£247K / £850K (29%)", variant: "default" },
    ],
  }},
  { id: "3", role: "agent", type: "artefact", content: "", timestamp: "9:03 AM", data: {
    title: "Risk Register v2", description: "Updated with 3 new risks from yesterday's sprint planning session. Includes contract expiry penalty risk (score: 16).",
    status: "Awaiting Approval", phase: "Planning",
  }},
  { id: "4", role: "user", type: "text", content: "What's the biggest risk right now?", timestamp: "9:05 AM" },
  { id: "5", role: "agent", type: "risk", content: "", timestamp: "9:05 AM", data: {
    riskId: "RISK-014", title: "Legacy CRM contract expiry penalty",
    probability: "High", impact: "Very High", score: 16,
    source: "Sprint Planning meeting — flagged by Dave Wilson",
    mitigation: "Complete data migration by July to avoid £50K/month extension fee. Current forecast shows 14-day buffer which is insufficient given 15% data quality issues.",
  }},
  { id: "6", role: "agent", type: "actions", content: "", timestamp: "9:06 AM", data: {
    title: "Actions I've taken this morning",
    items: [
      { text: "Rescheduled 3 overdue tasks with cascading dependencies", done: true },
      { text: "Generated stakeholder update email (draft in outbox)", done: true },
      { text: "Flagged resource conflict: Dave allocated to 2 projects", done: true },
      { text: "Awaiting your approval on Risk Register v2", done: false },
      { text: "Awaiting security sign-off for production API access", done: false },
    ],
  }},
];

const CONTEXT = {
  methodology: "Hybrid (PRINCE2 + Scrum)",
  phase: "Planning & Feasibility",
  sprint: "Sprint 1 — Data Discovery",
  dueDate: "31 December 2026",
  budget: "£850,000",
  artefacts: [
    { name: "Project Charter", status: "approved" as const },
    { name: "Business Case", status: "approved" as const },
    { name: "Risk Register v2", status: "outline" as const },
    { name: "Scope Management Plan", status: "outline" as const },
  ],
  team: [
    { name: "Sarah Chen", role: "Sponsor" },
    { name: "Dave Wilson", role: "Data Lead" },
    { name: "Tom Harris", role: "Tech Lead" },
    { name: "Maya", role: "AI PM Agent" },
  ],
};

const QUICK_ACTIONS = [
  { label: "Status Update", icon: "📊" },
  { label: "Generate Artefact", icon: "📄" },
  { label: "Check Risks", icon: "⚠️" },
  { label: "Schedule Meeting", icon: "📅" },
  { label: "Research", icon: "🔍" },
];

// ================================================================
// COMPONENT
// ================================================================

export default function AgentChatPage() {
  const mode = "dark";
  const [activeConv, setActiveConv] = useState("1");
  const [messages, setMessages] = useState(MESSAGES);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [searchConv, setSearchConv] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, typing]);

  function send() {
    if (!input.trim()) return;
    const msg: ChatMessage = { id: `u-${Date.now()}`, role: "user", type: "text", content: input.trim(), timestamp: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) };
    setMessages((prev) => [...prev, msg]);
    setInput("");
    setTyping(true);
    // Simulate agent response
    setTimeout(() => {
      setTyping(false);
      setMessages((prev) => [...prev, {
        id: `a-${Date.now()}`, role: "agent", type: "text",
        content: "I'll look into that right away. Let me check the project data and get back to you with a detailed analysis.",
        timestamp: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      }]);
    }, 2000);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  const filteredConvs = CONVERSATIONS.filter((c) => !searchConv || c.projectName.toLowerCase().includes(searchConv.toLowerCase()));

  return (
    <div className="flex h-[calc(100vh-140px)] rounded-[14px] overflow-hidden" style={{ border: `1px solid ${"var(--border)"}` }}>
      {/* ── LEFT PANEL: Conversations ── */}
      <div className="w-[300px] flex-shrink-0 flex flex-col" style={{ backgroundColor: "var(--card)", borderRight: `1px solid ${"var(--border)"}` }}>
        <div className="p-3">
          <input className="w-full px-3 py-1.5 rounded-lg text-xs bg-background border border-input" placeholder="Search conversations..." value={searchConv} onChange={(e: any) => setSearchConv(e.target.value)} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredConvs.map((conv) => {
            const active = conv.id === activeConv;
            return (
              <div key={conv.id} onClick={() => setActiveConv(conv.id)}
                className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-all relative"
                style={{
                  backgroundColor: active ? "rgba(99,102,241,0.12)" : "transparent",
                  borderLeft: active ? `3px solid ${"var(--primary)"}` : "3px solid transparent",
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = true ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)"; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = "transparent"; }}>
                <div className="relative flex-shrink-0">
                  <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[9px] font-bold text-white">A</div>
                  {conv.online && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2" style={{ backgroundColor: "#10B981", borderColor: "var(--card)" }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold truncate" style={{ color: "var(--foreground)" }}>{conv.projectName}</span>
                    <span className="text-[10px] flex-shrink-0" style={{ color: "var(--muted-foreground)" }}>{conv.timestamp}</span>
                  </div>
                  <p className="text-[12px] font-medium" style={{ color: "#22D3EE" }}>{conv.agentName}</p>
                  <p className="text-[11px] truncate" style={{ color: "var(--muted-foreground)" }}>{conv.lastMessage}</p>
                </div>
                {conv.unread > 0 && (
                  <span className="w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "var(--primary)" }}>{conv.unread}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── CENTRE: Chat ── */}
      <div className="flex-1 flex flex-col" style={{ backgroundColor: "var(--background)" }}>
        {/* Chat header */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: `1px solid ${"var(--border)"}`, backgroundColor: "var(--card)" }}>
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center text-[9px] font-bold text-white shadow-primary/30">Maya</div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>Agent Maya</span>
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>managing CRM Migration</span>
              </div>
              <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Autonomy Level 3 (Co-pilot)</p>
            </div>
          </div>
          <div className="flex gap-2">
            {["Phase Gates", "Artefacts", "Knowledge"].map((label) => (
              <Button key={label} variant="ghost" size="sm">{label}</Button>
            ))}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.map((msg, i) => (
            <div key={msg.id} className={cn("flex gap-3 animate-[fadeUp_0.3s_ease-out]", msg.role === "user" ? "justify-end" : "justify-start")}
              style={{ animationDelay: `${i * 50}ms` }}>
              {msg.role === "agent" && <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[9px] font-bold text-white">Maya</div>}
              <div className={cn("max-w-[70%]", msg.role === "user" && "max-w-[60%]")}>
                {/* Text */}
                {msg.type === "text" && (
                  <div className="px-4 py-2.5 text-[13px] leading-relaxed"
                    style={{
                      backgroundColor: msg.role === "user" ? "var(--primary)" : "var(--card)",
                      color: msg.role === "user" ? "white" : "var(--foreground)",
                      borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                      border: msg.role === "agent" ? `1px solid ${"var(--border)"}` : undefined,
                    }}>
                    {msg.content}
                  </div>
                )}

                {/* Status Card */}
                {msg.type === "status" && (
                  <div className="rounded-[12px] p-4" style={{ backgroundColor: "rgba(99,102,241,0.12)", border: `1px solid rgba(99,102,241,0.2)` }}>
                    <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--primary)" }}>Project Status</p>
                    <div className="grid grid-cols-2 gap-2.5">
                      {((msg.data?.items as any[]) || []).map((item: any, j: number) => (
                        <div key={j} className="flex items-center justify-between px-3 py-2 rounded-[8px]" style={{ backgroundColor: true ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.7)" }}>
                          <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{item.label}</span>
                          <Badge variant={item.variant}>{item.value}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Artefact Card */}
                {msg.type === "artefact" && (
                  <div className="rounded-[12px] p-4" style={{ backgroundColor: "var(--card)", border: `1px solid ${"var(--border)"}` }}>
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-10 h-10 rounded-[8px] flex items-center justify-center" style={{ background: "rgba(99,102,241,0.12)" }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={"var(--primary)"} strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      </div>
                      <div className="flex-1">
                        <p className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>{(msg.data as any)?.title}</p>
                        <p className="text-[12px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>{(msg.data as any)?.description}</p>
                      </div>
                      <Badge variant="secondary">{(msg.data as any)?.status}</Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="default" size="sm">Review</Button>
                      <Button variant="default" size="sm">Approve</Button>
                      <Button variant="ghost" size="sm">Request Changes</Button>
                    </div>
                  </div>
                )}

                {/* Risk Card */}
                {msg.type === "risk" && (
                  <div className="rounded-[12px] p-4" style={{ backgroundColor: "var(--card)", border: `1px solid ${"var(--border)"}` }}>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="destructive">{(msg.data as any)?.riskId}</Badge>
                      <span className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>{(msg.data as any)?.title}</span>
                    </div>
                    <div className="flex gap-4 mb-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Probability:</span>
                        <Badge variant="destructive">{(msg.data as any)?.probability}</Badge>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Impact:</span>
                        <Badge variant="destructive">{(msg.data as any)?.impact}</Badge>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Score:</span>
                        <Badge variant="destructive">{(msg.data as any)?.score}</Badge>
                      </div>
                    </div>
                    <p className="text-[11px] italic mb-3 px-3 py-1.5 rounded-[6px]" style={{ backgroundColor: true ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", color: "var(--muted-foreground)" }}>
                      Source: {(msg.data as any)?.source}
                    </p>
                    <div className="p-3 rounded-[8px]" style={{ backgroundColor: "rgba(245,158,11,0.12)", border: `1px solid rgba(251,191,36,0.2)` }}>
                      <p className="text-[11px] font-semibold mb-1" style={{ color: "#F59E0B" }}>Mitigation Recommendation</p>
                      <p className="text-[12px]" style={{ color: "var(--foreground)" }}>{(msg.data as any)?.mitigation}</p>
                    </div>
                  </div>
                )}

                {/* Action Card */}
                {msg.type === "actions" && (
                  <div className="rounded-[12px] p-4" style={{ backgroundColor: "var(--card)", border: `1px solid ${"var(--border)"}` }}>
                    <p className="text-[13px] font-semibold mb-3" style={{ color: "var(--foreground)" }}>{(msg.data as any)?.title}</p>
                    <div className="space-y-2">
                      {((msg.data as any)?.items || []).map((item: any, j: number) => (
                        <div key={j} className="flex items-center gap-2.5">
                          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                            style={{ backgroundColor: item.done ? "#10B981" : true ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)", color: item.done ? "white" : "var(--muted-foreground)" }}>
                            {item.done ? "✓" : "○"}
                          </div>
                          <span className="text-[12px]" style={{ color: item.done ? "var(--foreground)" : "var(--muted-foreground)" }}>{item.text}</span>
                          <Badge variant={item.done ? "default" : "secondary"} className="ml-auto">{item.done ? "Done" : "Pending"}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-[10px] mt-1 px-1" style={{ color: "var(--muted-foreground)" }}>{msg.timestamp}</p>
              </div>
              {msg.role === "user" && (
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ background: "var(--primary)" }}>U</div>
              )}
            </div>
          ))}

          {/* Typing indicator */}
          {typing && (
            <div className="flex gap-3 animate-[fadeUp_0.2s_ease-out]">
              <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[9px] font-bold text-white">Maya</div>
              <div className="px-4 py-3 rounded-[14px_14px_14px_4px] flex gap-1.5" style={{ backgroundColor: "var(--card)", border: `1px solid ${"var(--border)"}` }}>
                <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: "var(--primary)", animationDelay: "0ms" }} />
                <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: "var(--primary)", animationDelay: "150ms" }} />
                <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: "var(--primary)", animationDelay: "300ms" }} />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Quick actions */}
        <div className="px-5 pt-2 flex gap-2 overflow-x-auto">
          {QUICK_ACTIONS.map((a) => (
            <button key={a.label} onClick={() => setInput(a.label)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[11px] font-medium whitespace-nowrap transition-colors"
              style={{ backgroundColor: true ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", color: "var(--muted-foreground)", border: `1px solid ${"var(--border)"}` }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--primary)"; e.currentTarget.style.color = "var(--primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--muted-foreground)"; }}>
              <span>{a.icon}</span> {a.label}
            </button>
          ))}
        </div>

        {/* Input area */}
        <div className="px-5 py-3">
          <div className="flex items-end gap-2 rounded-[12px] p-2" style={{ backgroundColor: "var(--card)", border: `1px solid ${"var(--border)"}` }}>
            <button className="p-2 rounded-[8px] transition-colors" style={{ color: "var(--muted-foreground)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--primary)"; }} onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted-foreground)"; }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            </button>
            <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKey}
              placeholder="Message Maya..."
              className="flex-1 resize-none outline-none text-[13px] bg-transparent min-h-[24px] max-h-[120px] py-1"
              style={{ color: "var(--foreground)" }} rows={1} />
            <button className="p-2 rounded-[8px] transition-colors" style={{ color: "var(--muted-foreground)" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--primary)"; }} onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted-foreground)"; }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
            </button>
            <button onClick={send} disabled={!input.trim()}
              className="p-2 rounded-[10px] text-white transition-all disabled:opacity-30"
              style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
          <div className="flex items-center justify-between mt-1.5 px-1">
            <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>1 credit per message</span>
            <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>1,247 credits remaining</span>
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL: Context ── */}
      <div className="w-[280px] flex-shrink-0 overflow-y-auto p-4 space-y-5" style={{ backgroundColor: "var(--card)", borderLeft: `1px solid ${"var(--border)"}` }}>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>Project Context</p>
          <div className="space-y-2.5">
            {Object.entries({ Methodology: CONTEXT.methodology, Phase: CONTEXT.phase, Sprint: CONTEXT.sprint, "Due Date": CONTEXT.dueDate, Budget: CONTEXT.budget }).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>{k}</span>
                <span className="text-[12px] font-medium text-right" style={{ color: "var(--foreground)" }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${"var(--border)"}`, paddingTop: 16 }}>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>Recent Artefacts</p>
          <div className="space-y-2">
            {CONTEXT.artefacts.map((a, i) => (
              <div key={i} className="flex items-center justify-between py-1">
                <span className="text-[12px] font-medium truncate" style={{ color: "var(--foreground)" }}>{a.name}</span>
                <Badge variant={a.status === "approved" ? "default" : "outline"}>{a.status}</Badge>
              </div>
            ))}
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${"var(--border)"}`, paddingTop: 16 }}>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--muted-foreground)" }}>Team</p>
          <div className="space-y-2.5">
            {CONTEXT.team.map((m, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[9px] font-bold text-white">A</div>
                <div>
                  <p className="text-[12px] font-medium" style={{ color: "var(--foreground)" }}>{m.name}</p>
                  <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{m.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
