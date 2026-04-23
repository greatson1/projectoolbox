"use client";

import { useEffect, useState } from "react";
import { Sparkles, TrendingUp, TrendingDown, Info } from "lucide-react";

/** Badge showing an ML-learned probability with hover tooltip explaining the reasoning. */
export function MLProbabilityBadge({
  probability,
  confidence,
  label,
  reasoning,
  inverse = false, // true if higher = worse (e.g. risk materialisation)
}: {
  probability: number;
  confidence: number;
  label: string;
  reasoning?: string | string[];
  inverse?: boolean;
}) {
  const [showTip, setShowTip] = useState(false);

  if (confidence < 0.05) return null; // not enough data — don't show noise

  const pct = Math.round(probability * 100);
  const isHigh = inverse ? pct >= 60 : pct >= 70;
  const isLow = inverse ? pct <= 20 : pct <= 30;
  const color = isHigh && inverse ? "text-red-500 bg-red-500/10 border-red-500/20"
    : isLow && inverse ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20"
    : isHigh ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20"
    : isLow ? "text-amber-500 bg-amber-500/10 border-amber-500/20"
    : "text-primary bg-primary/10 border-primary/20";

  const Icon = isHigh ? TrendingUp : isLow ? TrendingDown : Sparkles;
  const reasoningLines = Array.isArray(reasoning) ? reasoning : reasoning ? [reasoning] : [];

  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium ${color}`}
      >
        <Icon className="w-3 h-3" />
        <span>{label}: {pct}%</span>
      </button>
      {showTip && reasoningLines.length > 0 && (
        <div className="absolute z-50 top-full left-0 mt-1 w-72 p-3 rounded-lg bg-popover border border-border shadow-lg text-xs text-popover-foreground">
          <div className="flex items-center gap-1.5 mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="w-3 h-3" /> ML Insight · {Math.round(confidence * 100)}% confidence
          </div>
          <ul className="space-y-1 text-[11px] leading-relaxed">
            {reasoningLines.slice(0, 4).map((line, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-muted-foreground flex-shrink-0">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Hook to fetch an ML prediction. */
export function useMLPrediction<T = any>(kind: string, params: Record<string, string | undefined>, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);

  const query = new URLSearchParams({ kind, ...(Object.fromEntries(Object.entries(params).filter(([_, v]) => v))) as Record<string, string> }).toString();

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    fetch(`/api/ml/predictions?${query}`)
      .then((r) => r.json())
      .then((json) => setData(json.data || null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [query, enabled]);

  return { data, loading };
}

/** Compact indicator with info tooltip — for list rows. */
export function MLInlineInsight({ text, tooltip, tone = "info" }: {
  text: string;
  tooltip?: string;
  tone?: "info" | "warn" | "good";
}) {
  const [show, setShow] = useState(false);
  const color = tone === "warn" ? "text-amber-500" : tone === "good" ? "text-emerald-500" : "text-primary";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] ${color} cursor-help relative`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <Sparkles className="w-3 h-3" />
      <span>{text}</span>
      {show && tooltip && (
        <span className="absolute z-50 top-full left-0 mt-1 p-2 rounded bg-popover border border-border shadow text-[10px] text-popover-foreground whitespace-nowrap max-w-xs">
          {tooltip}
        </span>
      )}
    </span>
  );
}
