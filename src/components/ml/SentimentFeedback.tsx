"use client";

import { useState } from "react";
import { Smile, Meh, AlertTriangle, Frown, Check, Pencil } from "lucide-react";
import { toast } from "sonner";

type SentimentLabel = "positive" | "neutral" | "concerned" | "negative";

const LABELS: { value: SentimentLabel; label: string; icon: any; color: string }[] = [
  { value: "positive",  label: "Positive",  icon: Smile,          color: "text-emerald-500" },
  { value: "neutral",   label: "Neutral",   icon: Meh,            color: "text-muted-foreground" },
  { value: "concerned", label: "Concerned", icon: AlertTriangle,  color: "text-amber-500" },
  { value: "negative",  label: "Negative",  icon: Frown,          color: "text-red-500" },
];

/**
 * Inline sentiment badge + correction menu.
 * Shows the current detected sentiment; clicking opens a popover to correct it.
 */
export function SentimentFeedback({
  sourceType,
  sourceId,
  sentiment,
  confidence,
  onCorrected,
  compact = false,
}: {
  sourceType: "approval" | "chat" | "email";
  sourceId: string;
  sentiment: SentimentLabel | string | null | undefined;
  confidence?: number;
  onCorrected?: (newLabel: SentimentLabel) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [current, setCurrent] = useState<SentimentLabel | null>(sentiment as SentimentLabel | null);

  const currentConfig = LABELS.find(l => l.value === current) || LABELS[1];
  const CurrentIcon = currentConfig.icon;

  if (!current) return null;

  const submit = async (newLabel: SentimentLabel) => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/sentiment/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceType, sourceId, correctedLabel: newLabel }),
      });
      if (!res.ok) throw new Error("Correction failed");
      setCurrent(newLabel);
      setOpen(false);
      toast.success(`Sentiment corrected to ${newLabel}`);
      onCorrected?.(newLabel);
    } catch (e: any) {
      toast.error(e.message || "Failed to correct sentiment");
    }
    setSubmitting(false);
  };

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className={`inline-flex items-center gap-1 rounded-md border border-border/40 hover:border-border transition-all ${compact ? "px-1 py-0.5" : "px-1.5 py-0.5"}`}
        title={`Detected sentiment: ${currentConfig.label}${confidence ? ` (${Math.round(confidence * 100)}% confidence)` : ""}. Click to correct.`}
      >
        <CurrentIcon className={`${compact ? "w-2.5 h-2.5" : "w-3 h-3"} ${currentConfig.color}`} />
        {!compact && (
          <span className={`text-[9px] font-medium ${currentConfig.color}`}>
            {currentConfig.label}
          </span>
        )}
        <Pencil className={`${compact ? "w-2 h-2" : "w-2.5 h-2.5"} text-muted-foreground/60 ml-0.5`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="absolute z-50 top-full left-0 mt-1 w-44 p-1.5 rounded-lg bg-popover border border-border shadow-lg"
               onClick={(e) => e.stopPropagation()}>
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground px-2 py-1">
              Correct sentiment to:
            </p>
            {LABELS.map((l) => {
              const Icon = l.icon;
              const isCurrent = l.value === current;
              return (
                <button
                  key={l.value}
                  type="button"
                  disabled={isCurrent || submitting}
                  onClick={() => submit(l.value)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px] font-medium transition-colors ${
                    isCurrent ? "bg-muted/50 cursor-default" : "hover:bg-muted"
                  } ${submitting ? "opacity-50" : ""}`}
                >
                  <Icon className={`w-3.5 h-3.5 ${l.color}`} />
                  <span className={l.color}>{l.label}</span>
                  {isCurrent && <Check className="w-3 h-3 text-muted-foreground ml-auto" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
