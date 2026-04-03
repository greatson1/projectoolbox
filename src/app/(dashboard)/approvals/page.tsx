"use client";
// @ts-nocheck

import { cn } from "@/lib/utils";
import { useApprovals, useApprovalAction } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

/**
 * Approval Queue — HITL governance screen with expandable cards.
 */




// ================================================================
// TYPES & DATA
// ================================================================

interface ApprovalItem {
  id: string;
  type: "artefact" | "gate" | "email";
  title: string;
  priority: "high" | "medium" | "low";
  project: string;
  agent: string;
  timestamp: string;
  description: string;
  changes: Array<{ type: "added" | "modified" | "info" | "passed" | "concern"; text: string }>;
  sources: string[];
  confidence: number;
  confidenceLabel: string;
}

const ITEMS: ApprovalItem[] = [
  {
    id: "APR-001", type: "gate", title: "Phase Gate: Initiation → Planning", priority: "high",
    project: "CRM Migration", agent: "Maya", timestamp: "12 min ago",
    description: "All initiation artefacts have been completed and are ready for review. The agent recommends advancing to the Planning phase based on 6 approved artefacts and zero outstanding blockers.",
    changes: [
      { type: "passed", text: "Project Charter — approved by Sarah Chen on 28 Mar" },
      { type: "passed", text: "Business Case — approved, ROI projected at 340% over 3 years" },
      { type: "passed", text: "Stakeholder Register — 14 stakeholders mapped with engagement strategies" },
      { type: "concern", text: "Budget contingency at 5% — below recommended 10% for hybrid projects" },
      { type: "info", text: "Next phase will generate 8 planning artefacts (WBS, schedule, risk plan, etc.)" },
    ],
    sources: ["Project Charter v1.0", "Business Case v1.0", "Sprint Planning transcript (28 Mar)", "PMO governance framework"],
    confidence: 92, confidenceLabel: "High confidence",
  },
  {
    id: "APR-002", type: "artefact", title: "Risk Register v2", priority: "high",
    project: "CRM Migration", agent: "Maya", timestamp: "28 min ago",
    description: "Updated risk register incorporating 3 new risks identified during yesterday's sprint planning session. Total active risks: 14. Includes critical contract expiry penalty risk (score: 16).",
    changes: [
      { type: "added", text: "RISK-014: Legacy CRM contract expiry — £50K/month penalty if migration not complete by July" },
      { type: "added", text: "RISK-015: Salesforce admin unavailable for 2 weeks in May (annual leave)" },
      { type: "added", text: "RISK-016: Data quality issues affecting 15% of 2M records (300K records)" },
      { type: "modified", text: "RISK-008: Probability upgraded from Medium to High — vendor confirmed delayed API documentation" },
    ],
    sources: ["Sprint Planning transcript (28 Mar)", "Dave Wilson verbal confirmation", "Legacy CRM vendor contract review"],
    confidence: 96, confidenceLabel: "High confidence",
  },
  {
    id: "APR-003", type: "artefact", title: "Scope Management Plan & WBS", priority: "medium",
    project: "CRM Migration", agent: "Maya", timestamp: "1h ago",
    description: "Comprehensive scope management plan with 3-level WBS covering 47 work packages across 6 deliverables. Includes acceptance criteria per deliverable.",
    changes: [
      { type: "added", text: "6 deliverables defined: Discovery, Data Migration, Configuration, Integration, Training, Cutover" },
      { type: "added", text: "47 work packages with estimated effort and dependencies" },
      { type: "info", text: "WBS follows PRINCE2 product-based planning approach adapted for hybrid delivery" },
      { type: "modified", text: "Training deliverable expanded to include 3 business units (previously only Sales)" },
    ],
    sources: ["Project Charter", "Requirements workshop notes", "Salesforce implementation best practices"],
    confidence: 88, confidenceLabel: "Review recommended",
  },
  {
    id: "APR-004", type: "email", title: "Weekly Stakeholder Update — Draft", priority: "low",
    project: "CRM Migration", agent: "Maya", timestamp: "2h ago",
    description: "Weekly status update email drafted for the steering committee. Covers progress, upcoming milestones, and one escalation item (budget contingency).",
    changes: [
      { type: "info", text: "Recipients: Steering Committee (6 members) + Project Board (3 members)" },
      { type: "added", text: "Escalation: Budget contingency below threshold — requesting increase from 5% to 10% (£42.5K)" },
      { type: "info", text: "RAG status: AMBER — driven by low budget contingency and approaching contract deadline" },
    ],
    sources: ["Project status data", "Budget tracking module", "Risk register v2"],
    confidence: 94, confidenceLabel: "High confidence",
  },
  {
    id: "APR-005", type: "artefact", title: "Quality Management Plan", priority: "low",
    project: "Office Renovation", agent: "Jordan", timestamp: "3h ago",
    description: "Quality management plan defining QA processes, quality metrics, and acceptance criteria for the office renovation project.",
    changes: [
      { type: "added", text: "Quality standards: BS EN ISO 9001, CDM 2015 compliance requirements" },
      { type: "added", text: "Inspection schedule: 12 quality checkpoints aligned with construction milestones" },
      { type: "info", text: "Auto-generated from methodology template with project-specific customisation" },
    ],
    sources: ["Project scope statement", "CDM 2015 regulations", "PRINCE2 quality theme"],
    confidence: 91, confidenceLabel: "High confidence",
  },
];

const FILTERS = ["All", "High Priority", "Artefacts", "Phase Gates", "Communications"];

// ================================================================
// COMPONENT
// ================================================================

export default function ApprovalsPage() {
  const mode = "dark";
  const [items, setItems] = useState(ITEMS);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState("All");
  const [removing, setRemoving] = useState<string | null>(null);

  const typeIcons: Record<string, { icon: string; color: string; bg: string }> = {
    artefact: { icon: "📄", color: "var(--primary)", bg: "rgba(99,102,241,0.12)" },
    gate: { icon: "🏁", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
    email: { icon: "📧", color: "#22D3EE", bg: true ? "rgba(34,211,238,0.1)" : "rgba(14,165,233,0.1)" },
  };

  const changeIcons: Record<string, { prefix: string; bg: string; color: string }> = {
    added: { prefix: "+", bg: "rgba(16,185,129,0.12)", color: "#10B981" },
    modified: { prefix: "~", bg: "rgba(245,158,11,0.12)", color: "#F59E0B" },
    info: { prefix: "i", bg: "rgba(99,102,241,0.12)", color: "var(--primary)" },
    passed: { prefix: "✓", bg: "rgba(16,185,129,0.12)", color: "#10B981" },
    concern: { prefix: "!", bg: "rgba(245,158,11,0.12)", color: "#F59E0B" },
  };

  const highCount = items.filter((i) => i.priority === "high").length;

  const filtered = items.filter((item) => {
    if (filter === "All") return true;
    if (filter === "High Priority") return item.priority === "high";
    if (filter === "Artefacts") return item.type === "artefact";
    if (filter === "Phase Gates") return item.type === "gate";
    if (filter === "Communications") return item.type === "email";
    return true;
  });

  function removeItem(id: string) {
    setRemoving(id);
    setTimeout(() => { setItems((prev) => prev.filter((i) => i.id !== id)); setRemoving(null); setExpanded(null); }, 300);
  }

  return (
    <div className="max-w-[1000px] space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[24px] font-bold" style={{ color: "var(--foreground)" }}>Approval Queue</h1>
            <span className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold text-white" style={{ backgroundColor: "var(--primary)" }}>{items.length}</span>
          </div>
          <p className="text-[13px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>Human-in-the-Loop Governance</p>
        </div>
        <div className="flex items-center gap-3">
          {highCount > 0 && <Badge variant="destructive">{highCount} high priority</Badge>}
          <Button variant="ghost" size="sm">Approve All Low Risk</Button>
        </div>
      </div>

      {/* Governance banner */}
      <div className="flex items-center justify-between px-4 py-3 rounded-[12px]"
        style={{ backgroundColor: "rgba(99,102,241,0.12)", border: `1px solid rgba(99,102,241,0.15)` }}>
        <div className="flex items-center gap-3">
          <span className="text-[18px]">🛡️</span>
          <div>
            <span className="text-[13px] font-semibold" style={{ color: "var(--primary)" }}>Governance Mode Active</span>
            <span className="text-[12px] ml-2" style={{ color: "var(--muted-foreground)" }}>All agent outputs require human approval before becoming official</span>
          </div>
        </div>
        <button className="text-[12px] font-medium" style={{ color: "var(--primary)" }}>Configure</button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 rounded-[10px]" style={{ backgroundColor: true ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)" }}>
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-4 py-2 rounded-[8px] text-[12px] font-semibold transition-all"
            style={{
              backgroundColor: filter === f ? (true ? "var(--card)" : "white") : "transparent",
              color: filter === f ? "var(--foreground)" : "var(--muted-foreground)",
              boxShadow: filter === f ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
            }}>
            {f}
          </button>
        ))}
      </div>

      {/* Approval cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-[28px]" style={{ backgroundColor: "rgba(16,185,129,0.12)" }}>✓</div>
          <p className="text-[18px] font-semibold" style={{ color: "var(--foreground)" }}>All clear</p>
          <p className="text-[13px] mt-1" style={{ color: "var(--muted-foreground)" }}>No pending approvals — your agents are running smoothly</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const isExpanded = expanded === item.id;
            const isRemoving = removing === item.id;
            const ti = typeIcons[item.type];

            return (
              <div key={item.id}
                className={cn("rounded-[14px] transition-all duration-300 overflow-hidden", isRemoving && "opacity-0 translate-x-8 scale-[0.98]")}
                style={{ backgroundColor: "var(--card)", border: `1px solid ${"var(--border)"}`, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>

                {/* Collapsed row */}
                <div className="flex items-center gap-4 px-5 py-4 cursor-pointer"
                  onClick={() => setExpanded(isExpanded ? null : item.id)}>
                  <div className="w-10 h-10 rounded-[10px] flex items-center justify-center text-[18px] flex-shrink-0" style={{ backgroundColor: ti.bg }}>
                    {ti.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[14px] font-semibold truncate" style={{ color: "var(--foreground)" }}>{item.title}</span>
                      <Badge variant={item.type === "gate" ? "secondary" : item.type === "email" ? "outline" : "secondary"}>
                        {item.type === "gate" ? "Phase Gate" : item.type === "email" ? "Email" : "Artefact"}
                      </Badge>
                      <Badge variant={item.priority}>{item.priority}</Badge>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                      <span>{item.project}</span>
                      <span>·</span>
                      <span style={{ color: "#22D3EE" }}>{item.agent}</span>
                      <span>·</span>
                      <span>{item.timestamp}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button variant="default" size="sm" onClick={() => removeItem(item.id)} style={{ backgroundColor: "#10B981" }}>Approve</Button>
                    <Button variant="ghost" size="sm">Changes</Button>
                  </div>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={"var(--muted-foreground)"} strokeWidth="2"
                    className={cn("transition-transform duration-200 flex-shrink-0", isExpanded && "rotate-180")}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>

                {/* Expanded content */}
                <div className={cn("transition-all duration-300 overflow-hidden", isExpanded ? "max-h-[800px] opacity-100" : "max-h-0 opacity-0")}>
                  <div className="px-5 pb-5 space-y-4" style={{ borderTop: `1px solid ${"var(--border)"}` }}>
                    <div className="pt-4">
                      <p className="text-[13px] leading-relaxed" style={{ color: "var(--muted-foreground)" }}>{item.description}</p>
                    </div>

                    {/* Changes */}
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Changes</p>
                      <div className="space-y-1.5">
                        {item.changes.map((c, i) => {
                          const ci = changeIcons[c.type];
                          return (
                            <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-[8px]" style={{ backgroundColor: ci.bg }}>
                              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5" style={{ color: ci.color, backgroundColor: true ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.6)" }}>
                                {ci.prefix}
                              </span>
                              <span className="text-[12px]" style={{ color: "var(--foreground)" }}>{c.text}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Sources + Confidence */}
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Sources</p>
                        <div className="space-y-1.5">
                          {item.sources.map((s, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: "#22D3EE" }} />
                              <span className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>{s}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Confidence indicator */}
                      <div className="flex flex-col items-center justify-center w-[100px]">
                        <div className="relative w-16 h-16">
                          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                            <circle cx="18" cy="18" r="15.5" fill="none" stroke={"var(--border)"} strokeWidth="3" />
                            <circle cx="18" cy="18" r="15.5" fill="none" stroke={item.confidence >= 90 ? "#10B981" : "#F59E0B"} strokeWidth="3"
                              strokeDasharray={`${item.confidence} ${100 - item.confidence}`} strokeLinecap="round" />
                          </svg>
                          <span className="absolute inset-0 flex items-center justify-center text-[14px] font-bold" style={{ color: "var(--foreground)" }}>{item.confidence}%</span>
                        </div>
                        <span className="text-[10px] font-medium mt-1 text-center" style={{ color: item.confidence >= 90 ? "#10B981" : "#F59E0B" }}>
                          {item.confidenceLabel}
                        </span>
                      </div>
                    </div>

                    {/* Action bar */}
                    <div className="flex items-center justify-between pt-3" style={{ borderTop: `1px solid ${"var(--border)"}` }}>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm">View Full Document</Button>
                        <Button variant="ghost" size="sm">Compare Previous</Button>
                        <Button variant="ghost" size="sm">Ask Agent</Button>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="default" size="sm" style={{ backgroundColor: "#EF4444" }}>Reject</Button>
                        <Button variant="default" size="sm" style={{ backgroundColor: "#F59E0B" }}>Request Changes</Button>
                        <Button variant="default" size="sm" onClick={() => removeItem(item.id)} style={{ background: `linear-gradient(135deg, ${"#10B981"}, #059669)` }}>Approve</Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
