"use client";

/**
 * ClarificationCard — interactive question widget rendered inside the agent chat.
 *
 * Replaces the old markdown text dump. One question at a time, with purpose-built
 * input widgets per question type. Zero credits consumed.
 */

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ChevronRight, SkipForward, FileText, ExternalLink } from "lucide-react";
// Inlined from clarification-session.ts to avoid importing server-only module (db) into client component
type QuestionType = "text" | "choice" | "multi" | "yesno" | "number" | "date";
interface ClarificationQuestion {
  id: string;
  artefact: string;
  field: string;
  question: string;
  type: QuestionType;
  options?: string[];
  answered: boolean;
  answer?: string;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuestionProgress {
  current: number;   // 0-indexed answered count
  total: number;
  artefactNames: string[];
}

interface ClarificationCardProps {
  agentId: string;
  question: ClarificationQuestion;
  progress: QuestionProgress;
  questionIndex: number;   // 0-based display index
  intro?: boolean;         // show intro text on the first card
  onAnswered: (answer: string) => void;
  isSubmitting?: boolean;
}

interface ClarificationCompleteCardProps {
  agentId: string;
  artefactNames: string[];
  answeredCount: number;
  totalCount: number;
  projectId?: string;
  onGenerate: () => void;
  isGenerating?: boolean;
}

// ─── Choice / Multi widget ────────────────────────────────────────────────────

function OptionPills({
  options,
  multi,
  onSelect,
  disabled,
}: {
  options: string[];
  multi: boolean;
  onSelect: (values: string[]) => void;
  disabled: boolean;
}) {
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
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            onClick={() => toggle(opt)}
            disabled={disabled}
            className={[
              "px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150",
              "focus:outline-none focus:ring-2 focus:ring-primary/40",
              active
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-muted/40 text-muted-foreground border-border hover:border-primary/50 hover:text-foreground hover:bg-muted/70",
              disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
            ].join(" ")}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ─── Yes / No widget ──────────────────────────────────────────────────────────

function YesNoButtons({
  onSelect,
  disabled,
}: {
  onSelect: (v: string) => void;
  disabled: boolean;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const pick = (v: string) => {
    if (disabled) return;
    setChosen(v);
    onSelect(v);
  };
  return (
    <div className="flex gap-3 mt-3">
      {["Yes", "No", "TBC"].map((v) => (
        <Button
          key={v}
          variant={chosen === v ? "default" : "outline"}
          size="sm"
          disabled={disabled}
          onClick={() => pick(v)}
          className={[
            "flex-1 text-sm font-medium transition-all",
            v === "Yes" && chosen === "Yes" ? "bg-emerald-600 hover:bg-emerald-700 border-emerald-600" : "",
            v === "No" && chosen === "No" ? "bg-red-600 hover:bg-red-700 border-red-600" : "",
          ].join(" ")}
        >
          {v}
        </Button>
      ))}
    </div>
  );
}

// ─── Main ClarificationCard ───────────────────────────────────────────────────

export function ClarificationCard({
  agentId,
  question,
  progress,
  questionIndex,
  intro = false,
  onAnswered,
  isSubmitting = false,
}: ClarificationCardProps) {
  const [textValue, setTextValue] = useState("");
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [pendingAnswer, setPendingAnswer] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayNumber = questionIndex + 1;
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  const handleSubmit = (answer: string) => {
    if (!answer.trim() || isSubmitting) return;
    setPendingAnswer(answer);
    onAnswered(answer);
  };

  const handleOptionSelect = (values: string[]) => {
    setSelectedOptions(values);
    // Auto-submit for single choice and yesno (immediate feel)
    if (question.type === "choice" || question.type === "yesno") {
      setTimeout(() => handleSubmit(values.join(", ")), 180);
    }
  };

  const handleTextSubmit = () => handleSubmit(textValue || "TBC");

  const isAnswered = pendingAnswer !== null;

  return (
    <div className={[
      "rounded-xl border bg-card transition-all",
      isAnswered ? "opacity-60 border-border/40" : "border-primary/20 shadow-sm shadow-primary/5",
    ].join(" ")}>

      {/* ── Header / progress ── */}
      <div className="px-4 pt-3 pb-2 border-b border-border/30">
        {intro && (
          <p className="text-xs text-muted-foreground mb-2">
            Before generating your {progress.artefactNames.length > 1
              ? `${progress.artefactNames.length} documents`
              : `"${progress.artefactNames[0]}"`},
            I have a few quick questions. You can skip any you don't know yet.
          </p>
        )}
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <span className="text-[11px] text-muted-foreground font-medium tracking-wide uppercase">
            Question {displayNumber} of {progress.total}
          </span>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal">
            {question.artefact}
          </Badge>
        </div>
        <Progress value={pct} className="h-1" />
      </div>

      {/* ── Question body ── */}
      <div className="px-4 py-3">
        <p className="text-sm font-medium text-foreground leading-snug mb-1">
          {question.question}
        </p>

        {isAnswered ? (
          <div className="flex items-center gap-1.5 mt-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
            <span className="text-xs text-muted-foreground italic">
              {pendingAnswer === "TBC" ? "Marked as TBC — you can fill this in later" : `Answer recorded: ${pendingAnswer}`}
            </span>
          </div>
        ) : (
          <>
            {/* ── Choice widget ── */}
            {(question.type === "choice" || question.type === "multi") && question.options && (
              <OptionPills
                options={question.options}
                multi={question.type === "multi"}
                onSelect={handleOptionSelect}
                disabled={isSubmitting}
              />
            )}

            {/* ── For multi: explicit submit ── */}
            {question.type === "multi" && selectedOptions.length > 0 && (
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  disabled={isSubmitting || selectedOptions.length === 0}
                  onClick={() => handleSubmit(selectedOptions.join(", "))}
                  className="h-7 text-xs"
                >
                  Confirm selection <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            )}

            {/* ── Yes/No widget ── */}
            {question.type === "yesno" && (
              <YesNoButtons onSelect={v => handleSubmit(v)} disabled={isSubmitting} />
            )}

            {/* ── Number widget ── */}
            {question.type === "number" && (
              <div className="flex gap-2 mt-3">
                <Input
                  ref={inputRef}
                  type="number"
                  min={0}
                  placeholder="Enter a number…"
                  className="h-8 text-sm w-36"
                  disabled={isSubmitting}
                  onKeyDown={e => e.key === "Enter" && handleSubmit(inputRef.current?.value || "TBC")}
                  onChange={e => setTextValue(e.target.value)}
                />
                <Button size="sm" disabled={isSubmitting} onClick={() => handleSubmit(inputRef.current?.value || "TBC")} className="h-8 text-xs">
                  Confirm <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            )}

            {/* ── Date widget ── */}
            {question.type === "date" && (
              <div className="flex gap-2 mt-3">
                <Input
                  ref={inputRef}
                  type="date"
                  className="h-8 text-sm w-44"
                  disabled={isSubmitting}
                  onKeyDown={e => e.key === "Enter" && handleSubmit(inputRef.current?.value || "TBC")}
                />
                <Button size="sm" disabled={isSubmitting} onClick={() => handleSubmit(inputRef.current?.value || "TBC")} className="h-8 text-xs">
                  Confirm <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            )}

            {/* ── Text widget ── */}
            {question.type === "text" && (
              <div className="mt-3 space-y-2">
                <Input
                  placeholder="Type your answer…"
                  className="h-8 text-sm"
                  disabled={isSubmitting}
                  value={textValue}
                  onChange={e => setTextValue(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleTextSubmit()}
                />
                <Button size="sm" disabled={isSubmitting || !textValue.trim()} onClick={handleTextSubmit} className="h-7 text-xs">
                  Confirm <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            )}

            {/* ── Skip option (all types except yesno which has TBC built in) ── */}
            {question.type !== "yesno" && (
              <button
                className="mt-2.5 text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                onClick={() => handleSubmit("TBC")}
                disabled={isSubmitting}
              >
                <SkipForward className="w-3 h-3" />
                Skip — I'll fill this in later
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Completion card ──────────────────────────────────────────────────────────

export function ClarificationCompleteCard({
  agentId,
  artefactNames,
  answeredCount,
  totalCount,
  onGenerate,
  isGenerating = false,
}: ClarificationCompleteCardProps) {
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 shadow-sm">
      <div className="px-4 pt-3 pb-2 border-b border-emerald-500/20 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        <span className="text-sm font-semibold text-emerald-300">
          All done — {answeredCount} of {totalCount} questions answered
        </span>
      </div>
      <div className="px-4 py-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          Everything you confirmed has been saved to the knowledge base. Ready to generate:
        </p>
        <div className="space-y-1">
          {artefactNames.map(name => (
            <div key={name} className="flex items-center gap-1.5 text-xs text-foreground/80">
              <FileText className="w-3 h-3 text-primary/60 flex-shrink-0" />
              {name}
            </div>
          ))}
        </div>
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            disabled={isGenerating}
            onClick={onGenerate}
            className="h-8 text-xs gap-1.5"
          >
            {isGenerating ? (
              <>
                <span className="animate-pulse">Generating…</span>
              </>
            ) : (
              <>
                Generate {artefactNames.length} document{artefactNames.length !== 1 ? "s" : ""}
                <ChevronRight className="w-3 h-3" />
              </>
            )}
          </Button>
          <a href={`/agents/${agentId}?tab=artefacts`}
            className="inline-flex items-center gap-1 h-8 px-3 text-xs rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors">
            Go to Artefacts
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
