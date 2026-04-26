"use client";

/**
 * Source-prefix parsing + rendering — shared across project pages
 * (Cost, Risks, Stakeholders, …) so every page that surfaces an
 * agent-generated row can show the same "Why this number / why this
 * row?" expansion.
 *
 * The agent embeds a source prefix in the Notes / Comments column at
 * generation time (see the UNIVERSAL SOURCE-PREFIX RULE in
 * `src/lib/agents/lifecycle-init.ts`). This module parses it out at
 * render time so we don't need a schema column.
 */

import { Microscope, UserCheck, Percent, AlertCircle, Lock, ChevronDown, ChevronRight } from "lucide-react";

export type SourceKind =
  | "research"
  | "user_confirmed"
  | "default_template"
  | "research_thin"
  | "reserved"
  | "unknown";

export interface ParsedSource {
  kind: SourceKind;
  reasoning: string | null;     // text after the prefix, with the alternatives clause stripped
  alternatives: string[];        // entries inside "(also considered: …)"
  raw: string;                   // original Notes/description for fallback
}

const PREFIX_RE = /(Research-anchored|User-confirmed|Default-template|Default-percentage|Research-thin|Reserved)\s*[—:-]\s*/i;

/**
 * Parse a Notes/Comments/Description string to extract the source prefix.
 * Tolerant — strings without a recognised prefix return kind: "unknown" and
 * the reasoning falls back to the raw text so existing data still renders.
 */
export function parseSource(text: string | null | undefined): ParsedSource {
  const raw = (text || "").trim();
  if (!raw) {
    return { kind: "unknown", reasoning: null, alternatives: [], raw };
  }

  const m = raw.match(PREFIX_RE);
  if (!m) {
    return { kind: "unknown", reasoning: raw, alternatives: [], raw };
  }

  // Find the prefix position; everything before it is unrelated; everything after it is the source body
  const prefixPos = raw.search(PREFIX_RE);
  const body = raw.slice(prefixPos).replace(PREFIX_RE, "");
  const prefix = (m[1] || "").toLowerCase();

  const kind: SourceKind =
    prefix === "research-anchored" ? "research" :
    prefix === "user-confirmed" ? "user_confirmed" :
    prefix === "default-template" || prefix === "default-percentage" ? "default_template" :
    prefix === "research-thin" ? "research_thin" :
    prefix === "reserved" ? "reserved" : "unknown";

  const altMatch = body.match(/\(also considered:\s*([^)]+)\)/i);
  const alternatives = altMatch
    ? altMatch[1].split(/,\s*/).map(s => s.trim()).filter(Boolean)
    : [];
  const reasoning = altMatch
    ? body.replace(altMatch[0], "").trim().replace(/\s+\.$/, "")
    : body.trim();

  return { kind, reasoning: reasoning || null, alternatives, raw };
}

/**
 * Compact coloured pill showing the source kind. Drop next to the row
 * label/title in any table.
 */
export function SourceBadge({ kind, className = "" }: { kind: SourceKind; className?: string }) {
  const cfg: Record<SourceKind, { label: string; cls: string; Icon: any }> = {
    research:         { label: "Research", cls: "text-indigo-400 border-indigo-400/30 bg-indigo-400/5", Icon: Microscope },
    user_confirmed:   { label: "User",     cls: "text-emerald-400 border-emerald-400/30 bg-emerald-400/5", Icon: UserCheck },
    default_template: { label: "Default",  cls: "text-amber-400 border-amber-400/30 bg-amber-400/5", Icon: Percent },
    research_thin:    { label: "Thin",     cls: "text-orange-400 border-orange-400/30 bg-orange-400/5", Icon: AlertCircle },
    reserved:         { label: "Reserved", cls: "text-slate-400 border-slate-400/30 bg-slate-400/5", Icon: Lock },
    unknown:          { label: "—",        cls: "text-muted-foreground/60 border-border", Icon: ChevronRight },
  };
  const c = cfg[kind];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[9px] font-semibold uppercase tracking-wide ${c.cls} ${className}`}>
      <c.Icon className="size-2.5" />
      {c.label}
    </span>
  );
}

/**
 * Expandable "Why this row?" block — shows the agent's reasoning + the
 * alternatives it considered. Place inside an expanded table row OR
 * inside a card body.
 */
export function RowReasoning({ source, label = "Why this row?" }: { source: ParsedSource; label?: string }) {
  const hasContent = !!source.reasoning || source.alternatives.length > 0;
  if (!hasContent) return null;

  return (
    <div className="space-y-2 max-w-3xl">
      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</p>
      {source.reasoning && (
        <p className="text-xs text-foreground/90 leading-relaxed">{source.reasoning}</p>
      )}
      {source.alternatives.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mt-2 mb-1">Alternatives the agent considered</p>
          <ul className="space-y-0.5 text-xs">
            {source.alternatives.map((alt, i) => (
              <li key={i} className="text-foreground/70 flex items-start gap-1.5">
                <span className="text-muted-foreground/50 mt-0.5">•</span>
                <span>{alt}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {source.kind === "default_template" && (
        <p className="text-[11px] text-amber-500/80 italic">
          This is a template placeholder, not a researched figure. Confirm specifics in chat to refine.
        </p>
      )}
      {source.kind === "research_thin" && (
        <p className="text-[11px] text-orange-500/80 italic">
          Research couldn&apos;t surface a concrete value for this row. Worth confirming with the user.
        </p>
      )}
    </div>
  );
}

/**
 * Expand/collapse chevron — convenience wrapper for table rows that toggle
 * an expanded reasoning panel.
 */
export function ExpandChevron({ expanded }: { expanded: boolean }) {
  return expanded
    ? <ChevronDown className="size-3 text-muted-foreground shrink-0" />
    : <ChevronRight className="size-3 text-muted-foreground shrink-0" />;
}
