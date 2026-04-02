"use client";

import { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Search, FileText, Network } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ================================================================
// TYPES & DATA
// ================================================================

interface KnowledgeItem {
  id: string;
  title: string;
  type: "meeting" | "decision" | "risk" | "artefact" | "note" | "daily";
  content: string;
  date: string;
  tags: string[];
  source: string;
  backlinks: string[];
  linkCount: number;
  snippet: string;
}

const TYPE_META: Record<string, { icon: string; color: string; label: string }> = {
  meeting: { icon: "\u{1F91D}", color: "#22D3EE", label: "Meeting" },
  decision: { icon: "\u{1F537}", color: "#8B5CF6", label: "Decision" },
  risk: { icon: "\u26A0\uFE0F", color: "#F87171", label: "Risk" },
  artefact: { icon: "\u{1F4C4}", color: "#6366F1", label: "Artefact" },
  note: { icon: "\u{1F4DD}", color: "#94A3B8", label: "Note" },
  daily: { icon: "\u{1F4C5}", color: "#34D399", label: "Daily" },
};

const ITEMS: KnowledgeItem[] = [
  {
    id: "k1",
    title: "Sprint Planning \u2014 Data Migration",
    type: "meeting",
    date: "2026-04-02",
    tags: ["sprint-1", "data", "planning"],
    source: "Meeting transcript (auto-captured)",
    linkCount: 8,
    backlinks: ["k2", "k3", "k5", "k6"],
    snippet: "Discussed 2M record migration strategy. Dave flagged 15% data quality issues...",
    content: `# Sprint Planning \u2014 Data Migration\n\n**Date:** 2 April 2026 \u00B7 **Attendees:** Sarah Chen, Dave Wilson, Tom Harris, Maya PM\n\n## Key Discussion Points\n\n- 2 million customer records require migration to Salesforce\n- 15% of records (300,000) have quality issues: missing emails, duplicates, outdated phone numbers\n- Data cleansing estimated at 3 weeks with current team, reducible to 2 weeks with additional data analyst\n- Legacy CRM vendor contract expires August \u2014 migration must complete by July\n\n## Decisions Made\n\n1. **Sprint goal set:** Complete data cleansing framework and test environment setup\n2. **Resource request approved:** Additional data analyst for cleansing sprint\n3. **Deadline confirmed as non-negotiable** due to \u00A350K/month contract penalty\n\n## Action Items\n\n| Action | Owner | Due |\n|--------|-------|-----|\n| Prepare headcount business case | Dave Wilson | Friday |\n| Set up test environment | Tom Harris | Next Wednesday |\n| Get security approval for prod API | Sarah Chen | Next week |\n| Data migration tool comparison | Dave Wilson | Monday |`,
  },
  {
    id: "k2",
    title: "Legacy CRM contract expiry penalty",
    type: "risk",
    date: "2026-04-02",
    tags: ["risk", "budget", "critical"],
    source: "Sprint Planning meeting \u2014 Dave Wilson",
    linkCount: 5,
    backlinks: ["k1", "k4"],
    snippet: "\u00A350K/month penalty if migration not complete by July. Score: 16 (High/Very High).",
    content: `# RISK-014: Legacy CRM Contract Expiry Penalty\n\n**Score:** 16 \u00B7 **Probability:** High \u00B7 **Impact:** Very High\n\n## Description\n\nThe legacy CRM vendor contract expires in August 2026. If the Salesforce migration is not completed by July, the organisation must extend the contract at \u00A350,000 per month.\n\n## Mitigation\n\nComplete data migration by July to avoid penalty. Current forecast shows 14-day buffer which is insufficient given 15% data quality issues.\n\n## Source\n\nFlagged by [[Sprint Planning \u2014 Data Migration|Dave Wilson]] during sprint planning on 2 April 2026.`,
  },
  {
    id: "k3",
    title: "Additional data analyst approved",
    type: "decision",
    date: "2026-04-02",
    tags: ["decision", "resource", "sprint-1"],
    source: "Sprint Planning \u2014 Sarah Chen",
    linkCount: 3,
    backlinks: ["k1"],
    snippet: "Sarah Chen approved request for additional data analyst to reduce cleansing from 3 to 2 weeks.",
    content: `# Decision: Additional Data Analyst Resource\n\n**Decided by:** Sarah Chen \u00B7 **Date:** 2 April 2026\n\n## Context\n\nData cleansing for 300,000 records estimated at 3 weeks with current team. Additional analyst reduces this to 2 weeks.\n\n## Decision\n\nApproved. Dave Wilson to prepare formal business case by Friday.\n\n## Impact\n\n- Schedule: Saves 1 week on cleansing phase\n- Budget: Estimated \u00A38,000 additional cost\n- Risk: Reduces schedule risk for July deadline`,
  },
  {
    id: "k4",
    title: "Project Charter",
    type: "artefact",
    date: "2026-03-28",
    tags: ["artefact", "initiation", "approved"],
    source: "Agent-generated, approved by Sarah Chen",
    linkCount: 6,
    backlinks: ["k1", "k2", "k5"],
    snippet: "CRM Migration to Salesforce Lightning. 450 users, 3 BUs, \u00A3850K budget, 9 months.",
    content: `# Project Charter \u2014 CRM Migration to Salesforce\n\n**Status:** Approved \u00B7 **Version:** 1.0\n\n## Purpose\n\nMigrate legacy CRM to Salesforce Lightning to improve sales efficiency, data quality, and customer insights across 3 business units.\n\n## Objectives\n\n1. Migrate 2M customer records with zero data loss\n2. Train 450 users across Sales, Marketing, and Support\n3. Complete within 9 months (April\u2013December 2026)\n4. Budget: \u00A3850,000 including contingency`,
  },
  {
    id: "k5",
    title: "Daily Log \u2014 2 April 2026",
    type: "daily",
    date: "2026-04-02",
    tags: ["daily", "auto-generated"],
    source: "Auto-generated by Maya PM",
    linkCount: 4,
    backlinks: [],
    snippet: "5 artefacts generated, 2 gates approved, sprint planning processed, 4 actions created.",
    content: `# Daily Log \u2014 2 April 2026\n\n- 09:02 \u23E9 Phase advanced: Initiation \u2192 Planning\n- 09:15 \u{1F4C4} Generated: Scope Management Plan & WBS\n- 09:28 \u{1F4C4} Generated: Project Schedule (77 tasks)\n- 10:00 \u{1F91D} Sprint Planning transcript processed\n- 10:01 \u2705 5 tasks created from meeting actions\n- 10:01 \u26A0\uFE0F 3 risks logged from meeting\n- 10:02 \u{1F537} 3 decisions recorded\n- 14:00 \u{1F4CA} Auto status report generated\n- 16:30 \u{1F6A6} Health updated: green \u2192 amber (low budget contingency)`,
  },
  {
    id: "k6",
    title: "James Park \u2014 IT Security sign-off required",
    type: "note",
    date: "2026-04-02",
    tags: ["stakeholder", "blocker"],
    source: "Sprint Planning meeting",
    linkCount: 2,
    backlinks: ["k1"],
    snippet: "James Park needs to authorize production API access for data migration.",
    content: `# Stakeholder Note: James Park\n\n**Role:** IT Security Lead\n\n## Context\n\nProduction API credentials needed for legacy CRM data sync. James Park must authorize access.\n\nRaised in [[Sprint Planning \u2014 Data Migration]] by Tom Harris.\n\n## Status\n\nSarah Chen escalating \u2014 awaiting response.`,
  },
];

const FILTERS = ["All", "Meetings", "Decisions", "Risks", "Artefacts", "Notes"];

// ================================================================
// GRAPH VIEW (Simple SVG force layout)
// ================================================================

function GraphView({
  items,
  onSelect,
}: {
  items: KnowledgeItem[];
  onSelect: (id: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const cx = 400,
    cy = 280;
  const positions = items.map((_, i) => {
    const angle = (i / items.length) * 2 * Math.PI - Math.PI / 2;
    const r = 140 + (items[i].linkCount > 4 ? 0 : 40);
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });

  const edges: Array<{ from: number; to: number }> = [];
  items.forEach((item, i) => {
    item.backlinks.forEach((blId) => {
      const j = items.findIndex((it) => it.id === blId);
      if (j >= 0 && j > i) edges.push({ from: i, to: j });
    });
  });

  return (
    <div className="w-full h-[500px] rounded-xl overflow-hidden relative bg-black/[0.02] dark:bg-black/30">
      <svg ref={svgRef} viewBox="0 0 800 560" className="w-full h-full">
        {edges.map((e, i) => (
          <line
            key={i}
            x1={positions[e.from].x}
            y1={positions[e.from].y}
            x2={positions[e.to].x}
            y2={positions[e.to].y}
            className="stroke-border"
            strokeWidth="1"
            opacity="0.5"
          />
        ))}
        {items.map((item, i) => {
          const p = positions[i];
          const meta = TYPE_META[item.type];
          const size = 8 + item.linkCount * 2;
          const isHovered = hovered === item.id;
          return (
            <g
              key={item.id}
              onClick={() => onSelect(item.id)}
              onMouseEnter={() => setHovered(item.id)}
              onMouseLeave={() => setHovered(null)}
              className="cursor-pointer"
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={size + (isHovered ? 4 : 0)}
                fill={meta.color}
                opacity={isHovered ? 0.3 : 0.15}
                className="transition-all duration-150"
              />
              <circle
                cx={p.x}
                cy={p.y}
                r={size}
                fill={meta.color}
                opacity={0.9}
                stroke={isHovered ? "white" : "none"}
                strokeWidth={2}
                className="transition-all duration-150"
              />
              <text
                x={p.x}
                y={p.y + size + 14}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px] font-medium"
              >
                {item.title.length > 20
                  ? item.title.slice(0, 18) + "\u2026"
                  : item.title}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="absolute bottom-3 left-3 flex gap-3">
        {Object.entries(TYPE_META)
          .filter(([k]) => k !== "daily")
          .map(([key, meta]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: meta.color }}
              />
              <span className="text-[10px] text-muted-foreground">
                {meta.label}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

// ================================================================
// MAIN COMPONENT
// ================================================================

export default function KnowledgeBasePage() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [selected, setSelected] = useState<string | null>("k1");
  const [rightTab, setRightTab] = useState<"document" | "graph">("document");

  const filtered = ITEMS.filter((item) => {
    if (
      search &&
      !item.title.toLowerCase().includes(search.toLowerCase()) &&
      !item.snippet.toLowerCase().includes(search.toLowerCase())
    )
      return false;
    if (filter === "All") return true;
    if (filter === "Meetings") return item.type === "meeting";
    if (filter === "Decisions") return item.type === "decision";
    if (filter === "Risks") return item.type === "risk";
    if (filter === "Artefacts") return item.type === "artefact";
    if (filter === "Notes")
      return item.type === "note" || item.type === "daily";
    return true;
  });

  const selectedItem = ITEMS.find((i) => i.id === selected);

  const totalLinks = ITEMS.reduce((s, i) => s + i.linkCount, 0);
  const mostConnected = [...ITEMS].sort((a, b) => b.linkCount - a.linkCount)[0];

  return (
    <div className="space-y-5">
      {/* Stats bar */}
      <div className="flex gap-4 flex-wrap">
        {[
          { label: "Documents", value: ITEMS.length },
          { label: "Total Links", value: totalLinks },
          { label: "Added This Week", value: 4 },
          {
            label: "Most Connected",
            value: mostConnected?.title.slice(0, 20) || "-",
          },
          { label: "Coverage", value: "78%" },
        ].map((s) => (
          <div
            key={s.label}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border"
          >
            <span className="text-[11px] text-muted-foreground">
              {s.label}:
            </span>
            <span className="text-[12px] font-semibold text-foreground">
              {s.value}
            </span>
          </div>
        ))}
      </div>

      {/* Split view */}
      <div className="flex gap-5 h-[calc(100vh-260px)]">
        {/* LEFT: List */}
        <div className="w-[35%] flex flex-col min-w-[300px]">
          <div className="mb-3 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Search knowledge base..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-background border border-border text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex gap-1 mb-3 overflow-x-auto">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-[11px] font-semibold whitespace-nowrap transition-all",
                  filter === f
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Daily journal */}
          {filter === "All" && (
            <div className="mb-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2 text-muted-foreground">
                Daily Journal
              </p>
              {ITEMS.filter((i) => i.type === "daily")
                .slice(0, 2)
                .map((item) => (
                  <div
                    key={item.id}
                    onClick={() => {
                      setSelected(item.id);
                      setRightTab("document");
                    }}
                    className={cn(
                      "px-3 py-2 rounded-lg mb-1 cursor-pointer transition-colors",
                      selected === item.id
                        ? "bg-primary/10 border border-primary/30"
                        : "border border-transparent hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[14px]">{"\u{1F4C5}"}</span>
                      <span className="text-[12px] font-semibold text-foreground">
                        {item.date}
                      </span>
                      <span className="text-[10px] ml-auto text-muted-foreground">
                        {item.linkCount} links
                      </span>
                    </div>
                    <p className="text-[11px] mt-0.5 truncate text-muted-foreground">
                      {item.snippet}
                    </p>
                  </div>
                ))}
            </div>
          )}

          {/* Document list */}
          <div className="flex-1 overflow-y-auto space-y-1">
            {filtered
              .filter((i) => i.type !== "daily" || filter !== "All")
              .map((item) => {
                const meta = TYPE_META[item.type];
                const isActive = selected === item.id;
                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      setSelected(item.id);
                      setRightTab("document");
                    }}
                    className={cn(
                      "px-3 py-2.5 rounded-[10px] cursor-pointer transition-all",
                      isActive
                        ? "bg-primary/10 border border-primary/30"
                        : "border border-transparent hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-[16px]">{meta.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium truncate text-foreground">
                          {item.title}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-muted-foreground">
                            {item.date}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {"\u00B7"} {item.linkCount} links
                          </span>
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] mt-1 line-clamp-2 text-muted-foreground">
                      {item.snippet}
                    </p>
                    <div className="flex gap-1 mt-1.5">
                      {item.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-muted text-muted-foreground"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* RIGHT: Content/Graph */}
        <Card className="flex-1 flex flex-col rounded-xl overflow-hidden !py-0 !gap-0">
          {/* Tabs */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex gap-1">
              {(["document", "graph"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setRightTab(tab)}
                  className={cn(
                    "px-4 py-1.5 rounded-lg text-[12px] font-semibold transition-all capitalize",
                    rightTab === tab
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab === "graph" ? (
                    <span className="flex items-center gap-1.5">
                      <Network className="h-3.5 w-3.5" /> Graph View
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5" /> Document
                    </span>
                  )}
                </button>
              ))}
            </div>
            <Button variant="default" size="sm">
              Ask Agent About This
            </Button>
          </div>

          {/* Document view */}
          {rightTab === "document" && selectedItem && (
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {/* Header */}
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-[20px]">
                  {TYPE_META[selectedItem.type].icon}
                </span>
                <Badge
                  variant={
                    selectedItem.type === "risk"
                      ? "destructive"
                      : selectedItem.type === "decision"
                        ? "default"
                        : selectedItem.type === "meeting"
                          ? "secondary"
                          : "outline"
                  }
                >
                  {TYPE_META[selectedItem.type].label}
                </Badge>
                {selectedItem.tags.map((t) => (
                  <span
                    key={t}
                    className="px-2 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <p className="text-[11px] mb-5 text-muted-foreground">
                Source: {selectedItem.source} {"\u00B7"} {selectedItem.date}
              </p>

              {/* Markdown content */}
              <div
                className={cn(
                  "text-foreground",
                  "[&_h1]:text-[20px] [&_h1]:font-bold [&_h1]:mb-3 [&_h1]:mt-5",
                  "[&_h2]:text-[16px] [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:pb-1",
                  "[&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:mb-2 [&_h3]:mt-3",
                  "[&_p]:text-[13px] [&_p]:leading-relaxed [&_p]:mb-2",
                  "[&_strong]:font-semibold [&_li]:text-[13px] [&_li]:mb-0.5",
                  "[&_ul]:pl-5 [&_ul]:mb-3 [&_ol]:pl-5 [&_ol]:mb-3",
                  "[&_table]:w-full [&_table]:text-[12px] [&_table]:mb-3",
                  "[&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold",
                  "[&_td]:px-3 [&_td]:py-1.5"
                )}
              >
                <Markdown remarkPlugins={[remarkGfm]}>
                  {selectedItem.content}
                </Markdown>
              </div>

              {/* Backlinks */}
              {selectedItem.backlinks.length > 0 && (
                <div className="mt-6 pt-4 border-t border-border">
                  <p className="text-[11px] font-semibold uppercase tracking-wider mb-3 text-muted-foreground">
                    Referenced by ({selectedItem.backlinks.length})
                  </p>
                  <div className="space-y-1.5">
                    {selectedItem.backlinks.map((blId) => {
                      const bl = ITEMS.find((i) => i.id === blId);
                      if (!bl) return null;
                      return (
                        <div
                          key={blId}
                          onClick={() => setSelected(blId)}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors bg-muted/30 hover:bg-primary/10"
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{
                              backgroundColor: TYPE_META[bl.type].color,
                            }}
                          />
                          <span className="text-[12px] font-medium text-primary">
                            {bl.title}
                          </span>
                          <Badge
                            variant={
                              bl.type === "risk" ? "destructive" : "outline"
                            }
                            className="ml-auto"
                          >
                            {TYPE_META[bl.type].label}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Graph view */}
          {rightTab === "graph" && (
            <div className="flex-1 p-5">
              <GraphView
                items={ITEMS}
                onSelect={(id) => {
                  setSelected(id);
                  setRightTab("document");
                }}
              />
            </div>
          )}

          {/* No selection */}
          {rightTab === "document" && !selectedItem && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-[14px] text-muted-foreground">
                Select a document to view
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
