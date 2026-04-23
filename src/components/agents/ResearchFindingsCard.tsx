"use client";

/**
 * ResearchFindingsCard — enterprise-grade visual display of feasibility
 * research findings in the agent chat. Shown after the agent completes
 * its Perplexity AI research before asking clarification questions.
 *
 * Sections: Key Facts, Research Areas (expandable), Confidence Assessment
 */

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Search, ChevronDown, ChevronRight, CheckCircle2,
  AlertTriangle, BookOpen, Globe, Shield, Lightbulb,
  BarChart3, FileText, ExternalLink,
} from "lucide-react";

const RESEARCH_MD_COMPONENTS: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  h1: ({ children }) => <h4 className="text-[12px] font-bold mt-2 mb-1 text-foreground">{children}</h4>,
  h2: ({ children }) => <h4 className="text-[12px] font-bold mt-2 mb-1 text-foreground">{children}</h4>,
  h3: ({ children }) => <h5 className="text-[11px] font-semibold mt-2 mb-1 text-foreground uppercase tracking-wide">{children}</h5>,
  h4: ({ children }) => <h5 className="text-[11px] font-semibold mt-2 mb-1 text-foreground">{children}</h5>,
  p: ({ children }) => <p className="text-[11px] text-muted-foreground leading-relaxed mb-1.5 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="mb-1.5 space-y-0.5 ml-1">{children}</ul>,
  ol: ({ children }) => <ol className="mb-1.5 space-y-0.5 ml-3 list-decimal">{children}</ol>,
  li: ({ children }) => <li className="text-[11px] text-muted-foreground leading-relaxed flex gap-1.5"><span className="text-primary/70 flex-shrink-0">•</span><span className="flex-1">{children}</span></li>,
  hr: () => <hr className="my-2 border-border/40" />,
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{children}</a>,
  code: ({ children, className }) => {
    const isBlock = className?.includes("language-");
    return isBlock
      ? <pre className="bg-muted/50 rounded p-2 text-[10px] font-mono overflow-x-auto my-1.5"><code>{children}</code></pre>
      : <code className="bg-muted/50 px-1 rounded text-[10px] font-mono">{children}</code>;
  },
  table: ({ children }) => (
    <div className="overflow-x-auto my-2 rounded border border-border/30">
      <table className="w-full text-[10px] border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="px-2 py-1 text-left font-semibold text-foreground bg-muted/40">{children}</th>,
  td: ({ children }) => <td className="px-2 py-1 text-muted-foreground border-t border-border/20">{children}</td>,
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ResearchFindingsProps {
  projectName: string;
  factsCount: number;
  sections: Array<{ label: string; content: string }>;
  facts: Array<{ title: string; content: string }>;
  onAcknowledge?: () => void;
  phase?: string; // Optional phase name to filter KB by
}

// ─── Section icons ───────────────────────────────────────────────────────────

const SECTION_ICONS: Record<string, typeof Search> = {
  "Core feasibility": BarChart3,
  "Domain-specific research": Lightbulb,
  "Regulatory & compliance": Shield,
};

const SECTION_COLOURS: Record<string, string> = {
  "Core feasibility": "#6366F1",
  "Domain-specific research": "#10B981",
  "Regulatory & compliance": "#F59E0B",
};

// ─── Fact categoriser ────────────────────────────────────────────────────────

function categorizeFact(title: string): { icon: typeof Search; colour: string; category: string } {
  const t = title.toLowerCase();
  if (t.includes("cost") || t.includes("price") || t.includes("budget") || t.includes("fee") || t.includes("£"))
    return { icon: BarChart3, colour: "#10B981", category: "Costs & Budget" };
  if (t.includes("risk") || t.includes("danger") || t.includes("warning") || t.includes("safety"))
    return { icon: AlertTriangle, colour: "#EF4444", category: "Risks & Safety" };
  if (t.includes("regulation") || t.includes("compliance") || t.includes("legal") || t.includes("permit") || t.includes("licence") || t.includes("law"))
    return { icon: Shield, colour: "#F59E0B", category: "Regulatory" };
  if (t.includes("timeline") || t.includes("duration") || t.includes("schedule") || t.includes("deadline"))
    return { icon: FileText, colour: "#8B5CF6", category: "Timeline" };
  return { icon: BookOpen, colour: "#6366F1", category: "Key Information" };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ResearchFindingsCard({
  projectName, factsCount, sections, facts, onAcknowledge, phase,
}: ResearchFindingsProps) {
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [showAllFacts, setShowAllFacts] = useState(false);

  const toggleSection = (idx: number) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  // Group facts by category
  const grouped = new Map<string, Array<{ title: string; content: string; icon: typeof Search; colour: string }>>();
  for (const fact of facts) {
    const { icon, colour, category } = categorizeFact(fact.title);
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category)!.push({ ...fact, icon, colour });
  }

  const visibleFacts = showAllFacts ? facts : facts.slice(0, 8);

  return (
    <div className="rounded-xl border border-indigo-500/20 bg-card overflow-hidden shadow-sm">
      {/* ── Header ── */}
      <div className="px-5 py-4 bg-gradient-to-r from-indigo-500/10 via-violet-500/5 to-transparent border-b border-border/30">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/15 flex items-center justify-center">
            <Globe className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-[13px] font-bold text-foreground">
              {phase ? `${phase} Research Complete` : "Feasibility Research Complete"}
            </h3>
            <p className="text-[10px] text-muted-foreground">Powered by Perplexity AI · {projectName}</p>
          </div>
          <Badge className="border-indigo-500/30 bg-indigo-500/10 text-indigo-600 text-[10px]">
            {factsCount} facts → KB
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {factsCount} facts extracted and stored to the Knowledge Base{phase ? ` for the ${phase} phase` : ""}.
          These will be used to inform artefact generation and clarification questions.
        </p>
      </div>

      {/* ── Key Facts (categorised) ── */}
      <div className="px-5 py-4 border-b border-border/20">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Key Facts Discovered</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {visibleFacts.map((fact, i) => {
            const { icon: Icon, colour } = categorizeFact(fact.title);
            return (
              <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: `${colour}15` }}>
                  <Icon className="w-3 h-3" style={{ color: colour }} />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-foreground leading-snug">{fact.title}</p>
                  <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2 mt-0.5">{fact.content}</p>
                </div>
              </div>
            );
          })}
        </div>
        {facts.length > 8 && (
          <button onClick={() => setShowAllFacts(!showAllFacts)}
            className="mt-2 text-[10px] font-medium text-indigo-500 hover:text-indigo-600 transition-colors">
            {showAllFacts ? "Show less" : `Show all ${facts.length} facts`}
          </button>
        )}
      </div>

      {/* ── Research Sections (expandable) ── */}
      {sections.length > 0 && (
        <div className="px-5 py-3 border-b border-border/20">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Detailed Research</h4>
          <div className="space-y-1">
            {sections.map((section, i) => {
              const isExpanded = expandedSections.has(i);
              const Icon = SECTION_ICONS[section.label] || BookOpen;
              const colour = SECTION_COLOURS[section.label] || "#6366F1";

              return (
                <div key={i}>
                  <button onClick={() => toggleSection(i)}
                    className="w-full flex items-center gap-2.5 py-2 px-2 rounded-lg hover:bg-muted/30 transition-colors text-left">
                    <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
                      style={{ background: `${colour}12` }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: colour }} />
                    </div>
                    <span className="text-[12px] font-semibold text-foreground flex-1">{section.label}</span>
                    {isExpanded
                      ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                      : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                  </button>
                  {isExpanded && (
                    <div className="ml-8 mr-2 mb-2 px-3 py-2.5 rounded-lg bg-muted/20 border border-border/20">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={RESEARCH_MD_COMPONENTS}>
                        {section.content.length > 2000
                          ? section.content.slice(0, 2000) + "\n\n..."
                          : section.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Confidence + Category summary ── */}
      <div className="px-5 py-3 border-b border-border/20">
        <div className="flex flex-wrap gap-2">
          {[...grouped.entries()].map(([category, items]) => {
            const { colour, icon: Icon } = items[0];
            return (
              <div key={category} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium"
                style={{ background: `${colour}10`, color: colour, border: `1px solid ${colour}25` }}>
                <Icon className="w-3 h-3" />
                {category} ({items.length})
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Footer / CTA ── */}
      <div className="px-5 py-3 flex items-center justify-between gap-3 bg-muted/20 flex-wrap">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />
          <span>
            <strong className="text-foreground">{factsCount} facts</strong> stored to Knowledge Base
            {phase ? ` · tagged as "${phase.toLowerCase()}"` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/knowledge"
            className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
          >
            View in KB <ExternalLink className="w-2.5 h-2.5" />
          </a>
          {onAcknowledge && (
            <Button size="sm" variant="default" className="text-xs h-7" onClick={onAcknowledge}>
              Continue to Questions
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
