"use client";

/**
 * AgentResponseCards — Rich visual cards rendered in the agent chat.
 *
 * AgentQuestionCard  — interactive question the agent asks mid-conversation.
 *                      Answer is sent as a chat message so the dialogue continues naturally.
 *
 * ProjectStatusCard  — visual snapshot of project state shown after a status query.
 *                      Built from real DB data, never from Claude's inference.
 */

import { useState, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ChevronRight, SkipForward, CheckCircle2, MessageSquare,
  AlertCircle, FileText, ArrowRight, Sparkles, Clock,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentQuestion {
  id: string;
  question: string;
  type: "text" | "choice" | "multi" | "yesno" | "number" | "date";
  options?: string[];
}

export interface AgentQuestionCardProps {
  question: AgentQuestion;
  onAnswered: (answer: string) => void;
  isSubmitting?: boolean;
  /**
   * If this question was already answered in a previous session, the chat
   * page passes the prior answer here. The card then renders in the
   * "answered" state on first paint instead of looking like an open
   * question — fixes the "did my answer get lost?" feeling on chat reload
   * and stops the open-questions counter from over-counting.
   */
  priorAnswer?: string | null;
}

interface StatusPhase {
  name: string;
  status: string; // "ACTIVE" | "COMPLETED" | "PENDING"
}

export interface ProjectStatusCardProps {
  projectName: string;
  phase: string | null;
  phases: StatusPhase[];
  nextPhase: string | null;
  pendingApprovals: number;
  pendingArtefacts: number;
  pendingQuestions: number;
  risks: number;
  /**
   * Incomplete delivery + scaffolded PM tasks for the current phase. When > 0
   * the card refuses to surface "Generate $nextPhase" as the call-to-action —
   * the current phase still has open work, so suggesting we move on would
   * mislead the user into thinking they can advance. We push them to finish
   * the current phase first instead.
   */
  incompleteTasks?: number;
}

// ─── Option Pills ─────────────────────────────────────────────────────────────

function OptionPills({
  options, multi, onSelect, disabled,
}: { options: string[]; multi: boolean; onSelect: (v: string[]) => void; disabled: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (opt: string) => {
    if (disabled) return;
    const next = multi
      ? selected.includes(opt) ? selected.filter(o => o !== opt) : [...selected, opt]
      : [opt];
    setSelected(next);
    onSelect(next);
  };
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {options.map(opt => (
        <button key={opt} onClick={() => toggle(opt)} disabled={disabled}
          className={[
            "px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
            "focus:outline-none focus:ring-2 focus:ring-violet-400/40",
            selected.includes(opt)
              ? "bg-violet-600 text-white border-violet-600 shadow-sm"
              : "bg-muted/40 text-muted-foreground border-border hover:border-violet-400/50 hover:text-foreground hover:bg-muted/70",
            disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
          ].join(" ")}>
          {opt}
        </button>
      ))}
    </div>
  );
}

// ─── Yes / No / Not Sure ─────────────────────────────────────────────────────

function YesNoButtons({ onSelect, disabled }: { onSelect: (v: string) => void; disabled: boolean }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const pick = (v: string) => { if (disabled) return; setChosen(v); onSelect(v); };
  return (
    <div className="flex gap-3 mt-3">
      {[
        { label: "Yes", active: "bg-emerald-600 hover:bg-emerald-700 border-emerald-600" },
        { label: "No", active: "bg-red-600 hover:bg-red-700 border-red-600" },
        { label: "Not sure", active: "" },
      ].map(({ label, active }) => (
        <Button key={label} size="sm" disabled={disabled}
          variant={chosen === label ? "default" : "outline"}
          onClick={() => pick(label)}
          className={["flex-1 text-sm font-medium transition-all", chosen === label ? active : ""].join(" ")}>
          {label}
        </Button>
      ))}
    </div>
  );
}

// ─── AgentQuestionCard ────────────────────────────────────────────────────────

export function AgentQuestionCard({ question, onAnswered, isSubmitting = false, priorAnswer = null }: AgentQuestionCardProps) {
  const [textValue, setTextValue] = useState("");
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  // Seed pendingAnswer from priorAnswer so the card renders pre-answered
  // when the user reopens chat for a question they already responded to.
  const [pendingAnswer, setPendingAnswer] = useState<string | null>(priorAnswer);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (answer: string) => {
    if (!answer.trim() || isSubmitting || pendingAnswer !== null) return;
    setPendingAnswer(answer);
    onAnswered(answer);
  };

  const handleOptionSelect = (values: string[]) => {
    setSelectedOptions(values);
    if (question.type === "choice" || question.type === "yesno") {
      setTimeout(() => submit(values.join(", ")), 160);
    }
  };

  const isAnswered = pendingAnswer !== null;

  return (
    <div className={[
      "rounded-xl border transition-all",
      isAnswered ? "opacity-60 border-border/40 bg-card" : "border-violet-500/25 bg-card shadow-sm shadow-violet-500/5",
    ].join(" ")}>
      {/* Header */}
      <div className="px-4 pt-3 pb-2.5 border-b border-border/30 flex items-center gap-2">
        <MessageSquare className="w-3.5 h-3.5 text-violet-400 shrink-0" />
        <span className="text-[11px] font-semibold text-violet-400 uppercase tracking-wide">
          Your agent has a question
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <p className="text-sm font-medium text-foreground leading-snug mb-1">
          {question.question}
        </p>

        {isAnswered ? (
          <div className="flex items-center gap-1.5 mt-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span className="text-xs text-muted-foreground italic">
              Answered: {pendingAnswer}
            </span>
          </div>
        ) : (
          <>
            {/* Choice / Multi */}
            {(question.type === "choice" || question.type === "multi") && question.options && (
              <OptionPills options={question.options} multi={question.type === "multi"}
                onSelect={handleOptionSelect} disabled={isSubmitting} />
            )}
            {question.type === "multi" && selectedOptions.length > 0 && (
              <div className="mt-3">
                <Button size="sm" className="h-7 text-xs" disabled={isSubmitting}
                  onClick={() => submit(selectedOptions.join(", "))}>
                  Confirm <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            )}

            {/* Yes / No */}
            {question.type === "yesno" && (
              <YesNoButtons onSelect={v => submit(v)} disabled={isSubmitting} />
            )}

            {/* Number */}
            {question.type === "number" && (
              <div className="flex gap-2 mt-3">
                <Input ref={inputRef} type="number" min={0} placeholder="Enter a number…"
                  className="h-8 text-sm w-36" disabled={isSubmitting}
                  onKeyDown={e => e.key === "Enter" && submit(inputRef.current?.value || "")}
                  onChange={e => setTextValue(e.target.value)} />
                <Button size="sm" className="h-8 text-xs" disabled={isSubmitting || !textValue.trim()}
                  onClick={() => submit(inputRef.current?.value || "")}>
                  Send <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            )}

            {/* Date */}
            {question.type === "date" && (
              <div className="flex gap-2 mt-3">
                <Input ref={inputRef} type="date" className="h-8 text-sm w-44" disabled={isSubmitting}
                  onKeyDown={e => e.key === "Enter" && submit(inputRef.current?.value || "")} />
                <Button size="sm" className="h-8 text-xs" disabled={isSubmitting}
                  onClick={() => submit(inputRef.current?.value || "")}>
                  Send <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            )}

            {/* Text */}
            {question.type === "text" && (
              <div className="mt-3 space-y-2">
                <Input placeholder="Type your answer…" className="h-8 text-sm"
                  disabled={isSubmitting} value={textValue}
                  onChange={e => setTextValue(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && submit(textValue)} />
                <Button size="sm" className="h-7 text-xs" disabled={isSubmitting || !textValue.trim()}
                  onClick={() => submit(textValue)}>
                  Send <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            )}

            {/* Skip — not for yesno */}
            {question.type !== "yesno" && (
              <button
                className="mt-2.5 text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                onClick={() => submit("Not sure")} disabled={isSubmitting}>
                <SkipForward className="w-3 h-3" /> Skip for now
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── ProjectStatusCard ────────────────────────────────────────────────────────

export function ProjectStatusCard({
  projectName, phase, phases, nextPhase,
  pendingApprovals, pendingArtefacts, pendingQuestions, risks,
  incompleteTasks = 0,
}: ProjectStatusCardProps) {
  // Priority order — tightest gate first. Critically: the "Generate next
  // phase" CTA only appears when the current phase has nothing outstanding
  // (no unanswered clarification, no unapproved drafts, no PM/delivery tasks
  // left). Otherwise we'd be inviting the user to advance prematurely — the
  // server-side phase-next-action resolver would refuse, but the click would
  // still feel like a broken promise.
  const phaseHasOpenWork = pendingQuestions > 0 || pendingApprovals > 0 || pendingArtefacts > 0 || incompleteTasks > 0;
  const urgentAction =
    pendingQuestions > 0 ? { label: `Answer ${pendingQuestions} question${pendingQuestions === 1 ? "" : "s"}`, href: "#", color: "#F97316", icon: <MessageSquare size={11} /> } :
    pendingApprovals > 0 ? { label: `Review ${pendingApprovals} approval${pendingApprovals > 1 ? "s" : ""}`, href: "/approvals", color: "#F59E0B", icon: <AlertCircle size={11} /> } :
    pendingArtefacts > 0 ? { label: `Review ${pendingArtefacts} document${pendingArtefacts > 1 ? "s" : ""}`, href: "#artefacts", color: "#6366F1", icon: <FileText size={11} /> } :
    incompleteTasks > 0 ? { label: `Finish ${incompleteTasks} task${incompleteTasks === 1 ? "" : "s"} in ${phase || "current phase"}`, href: "#tasks", color: "#F59E0B", icon: <CheckCircle2 size={11} /> } :
    nextPhase && !phaseHasOpenWork ? { label: `Generate ${nextPhase}`, href: "#artefacts", color: "#10B981", icon: <Sparkles size={11} /> } :
    null;

  const stats = [
    { label: "Pending review", value: pendingArtefacts, color: "#6366F1", icon: <FileText size={12} />, nonZeroOnly: false },
    { label: "Awaiting approval", value: pendingApprovals, color: "#F59E0B", icon: <AlertCircle size={12} />, nonZeroOnly: false },
    { label: "Open questions", value: pendingQuestions, color: "#F97316", icon: <MessageSquare size={12} />, nonZeroOnly: false },
    { label: "Open risks", value: risks, color: "#EF4444", icon: <AlertCircle size={12} />, nonZeroOnly: false },
  ];

  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center">
            <Clock size={12} className="text-primary" />
          </div>
          <div>
            <p className="text-[12px] font-bold text-foreground leading-none">{projectName}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Project status · right now</p>
          </div>
        </div>
        {phase && (
          <Badge variant="outline" className="text-[10px] font-medium">
            {phase}
          </Badge>
        )}
      </div>

      {/* Phase timeline */}
      {phases.length > 0 && (
        <div className="px-4 py-3 border-b border-border/20">
          <p className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground mb-2">Phase Progress</p>
          <div className="flex items-center gap-1 flex-wrap">
            {phases.map((ph, i) => {
              const status = ph.status?.toUpperCase();
              const isActive = status === "ACTIVE";
              const isDone = status === "COMPLETED";
              return (
                <div key={i} className="flex items-center gap-1">
                  <span
                    className="text-[9px] font-semibold px-2 py-0.5 rounded-full transition-all"
                    style={{
                      background: isDone ? "rgba(16,185,129,0.15)" : isActive ? "rgba(99,102,241,0.15)" : "hsl(var(--muted)/0.5)",
                      color: isDone ? "#10B981" : isActive ? "#6366F1" : "hsl(var(--muted-foreground))",
                      boxShadow: isActive ? "0 0 0 1px #6366F155" : undefined,
                    }}>
                    {isDone ? "✓ " : ""}{ph.name}
                  </span>
                  {i < phases.length - 1 && <ArrowRight size={8} className="text-muted-foreground/30 shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border/20">
        {stats.map(s => (
          <div key={s.label} className="bg-card px-3 py-2.5 text-center">
            <div className="flex items-center justify-center gap-1 mb-1" style={{ color: s.value > 0 ? s.color : "hsl(var(--muted-foreground))" }}>
              {s.icon}
            </div>
            <p className="text-[18px] font-bold leading-none"
              style={{ color: s.value > 0 ? s.color : "hsl(var(--muted-foreground))" }}>
              {s.value}
            </p>
            <p className="text-[9px] text-muted-foreground mt-0.5 leading-tight">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Next action */}
      {urgentAction && (
        <div className="px-4 py-2.5 flex items-center justify-between"
          style={{ background: `${urgentAction.color}08`, borderTop: `1px solid ${urgentAction.color}22` }}>
          <p className="text-[11px] font-medium" style={{ color: urgentAction.color }}>
            Next action required
          </p>
          {urgentAction.href === "#" ? (
            <button
              onClick={() => {
                const el = document.querySelector<HTMLElement>("[data-agent-questions]");
                if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
                const container = document.querySelector("[data-chat-scroll]");
                container?.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
              }}
              className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1 rounded-lg border transition-all cursor-pointer"
              style={{ color: urgentAction.color, borderColor: `${urgentAction.color}44`, background: `${urgentAction.color}10` }}>
              {urgentAction.icon}
              {urgentAction.label}
              <ArrowRight size={10} />
            </button>
          ) : (
            <Link href={urgentAction.href}
              className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1 rounded-lg border transition-all"
              style={{ color: urgentAction.color, borderColor: `${urgentAction.color}44`, background: `${urgentAction.color}10` }}>
              {urgentAction.icon}
              {urgentAction.label}
              <ArrowRight size={10} />
            </Link>
          )}
        </div>
      )}

      {/* All clear */}
      {!urgentAction && (
        <div className="px-4 py-2.5 flex items-center gap-2 border-t border-border/20">
          <CheckCircle2 size={12} className="text-emerald-500" />
          <p className="text-[11px] text-muted-foreground">No immediate action required — all clear</p>
        </div>
      )}
    </div>
  );
}
