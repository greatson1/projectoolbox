"use client";
// @ts-nocheck

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useNotifications, useMarkAllRead } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

/**
 * Notifications Centre — Filterable notification list with detail panel & preferences.
 */



// ═══════════════════════════════════════════════════════════════════
// TYPES & DATA
// ═══════════════════════════════════════════════════════════════════

type NType = "approval" | "risk" | "document" | "meeting" | "billing" | "system";
type Priority = "high" | "medium" | "none";

interface Notification {
  id: number;
  type: NType;
  agentId: string;
  agentName: string;
  agentInitials: string;
  agentColor: string;
  project: string;
  title: string;
  description: string;
  detail: string;
  time: string;
  minutesAgo: number;
  priority: Priority;
  read: boolean;
  actions: string[];
  related?: string[];
}

const AGENTS = [
  { id: "alpha", name: "Alpha", initials: "A", color: "#6366F1", status: "active" as const },
  { id: "bravo", name: "Bravo", initials: "B", color: "#22D3EE", status: "active" as const },
  { id: "charlie", name: "Charlie", initials: "C", color: "#10B981", status: "active" as const },
  { id: "delta", name: "Delta", initials: "D", color: "#F97316", status: "paused" as const },
  { id: "echo", name: "Echo", initials: "E", color: "#EC4899", status: "active" as const },
];

const NOTIFS: Notification[] = [
  {
    id: 1, type: "approval", agentId: "alpha", agentName: "Alpha", agentInitials: "A", agentColor: "#6366F1",
    project: "Project Atlas", title: "Phase Gate Approval Required — Execution",
    description: "All 7 prerequisites verified. Risk Register v3 and Budget Reforecast attached. Awaiting your sign-off to proceed.",
    detail: "Agent Alpha has completed the Execution phase gate checklist for Project Atlas. All 7 mandatory prerequisites have been verified:\n\n✓ Scope Management Plan (approved)\n✓ Schedule Baseline (approved)\n✓ Cost Baseline (approved)\n✓ Risk Management Plan (approved)\n✓ Quality Management Plan (approved)\n✓ Communications Plan (approved)\n✓ Stakeholder Register (updated)\n\nThe Risk Register v3 contains 12 risks — 2 rated red (vendor delay, resource conflict). Budget reforecast shows CPI of 0.97, within tolerance.\n\nRecommendation: Approve with condition to review red risks weekly.",
    time: "5 min ago", minutesAgo: 5, priority: "high", read: false,
    actions: ["Approve", "Reject", "Request Changes"],
    related: ["Risk Register v3", "Budget Reforecast", "Phase Gate Checklist"],
  },
  {
    id: 2, type: "risk", agentId: "charlie", agentName: "Charlie", agentInitials: "C", agentColor: "#10B981",
    project: "Riverside Development", title: "Critical Risk Escalation — Supplier Delay",
    description: "Phase 3 materials supplier has notified a 3-week delay. Impact: £45K additional cost, 15-day schedule slip.",
    detail: "Risk ID: R-047\nProbability: 85% (confirmed by supplier)\nImpact: High (£45K cost, 15-day schedule)\nRisk Score: 20 (Critical)\n\nThe concrete supplier for Phase 3 foundations has confirmed a 3-week delivery delay due to production issues at their Birmingham plant. This affects:\n- Foundation works (delayed start)\n- Structural steel erection (knock-on)\n- Electrical rough-in (dependent)\n\nMitigation options:\n1. Source from alternative supplier (Hanson) — +£8K premium, saves 2 weeks\n2. Re-sequence Phase 3B works to run in parallel — saves 1 week, no cost\n3. Accept delay and negotiate liquidated damages waiver with client\n\nAgent recommendation: Option 1+2 combined. Net cost +£8K but recovers 3 weeks.",
    time: "12 min ago", minutesAgo: 12, priority: "high", read: false,
    actions: ["Accept Mitigation", "Escalate to Sponsor", "Review Options"],
    related: ["Risk Register", "Schedule Impact Analysis", "Supplier Contract"],
  },
  {
    id: 3, type: "approval", agentId: "bravo", agentName: "Bravo", agentInitials: "B", agentColor: "#22D3EE",
    project: "SprintForge", title: "Sprint 7 Scope Change — +2 Story Points",
    description: "PTX-113 (timezone fix, 2 SP) added mid-sprint. Total commitment now 57 SP. Velocity at 89% of target.",
    detail: "A critical bug (PTX-113: timezone handling in sprint dates) was discovered during testing and needs to be addressed this sprint.\n\nImpact: +2 SP to Sprint 7 commitment (55→57 SP)\nCurrent velocity: 34/57 SP completed (Day 6 of 10)\nProjected completion: 52 SP at current pace\n\nRisk: Sprint goal may not be fully met. The timezone fix is critical for correct date calculations across all dashboards.\n\nRecommendation: Approve the addition but defer PTX-109 (plan comparison, 5 SP) to Sprint 8 to maintain capacity.",
    time: "18 min ago", minutesAgo: 18, priority: "medium", read: false,
    actions: ["Approve", "Reject", "Defer Other Item"],
  },
  {
    id: 4, type: "document", agentId: "alpha", agentName: "Alpha", agentInitials: "A", agentColor: "#6366F1",
    project: "Project Atlas", title: "Risk Register v3 Ready for Review",
    description: "12 risks identified, 2 red-rated. Mitigation strategies drafted for all. Requires PM review before gate submission.",
    detail: "Risk Register v3 has been generated with the following summary:\n\n🔴 Red (2): Vendor API deprecation (Q3), Resource conflict on critical path\n🟡 Amber (4): Budget variance trending, Stakeholder availability, Test environment, Integration complexity\n🟢 Green (6): Routine risks with active mitigations\n\nAll risks have assigned owners, probability/impact scores, and mitigation strategies. The register is ready for your review before submission to the Execution phase gate.",
    time: "35 min ago", minutesAgo: 35, priority: "medium", read: false,
    actions: ["Review Document", "Approve", "Request Changes"],
  },
  {
    id: 5, type: "risk", agentId: "echo", agentName: "Echo", agentInitials: "E", agentColor: "#EC4899",
    project: "Brand Refresh", title: "Brand Inconsistency Detected Across Deliverables",
    description: "3 deliverables using outdated colour values (#4A90D9 instead of #6366F1). Auto-fix available.",
    detail: "During routine quality scan, Agent Echo detected brand guideline violations:\n\n1. Marketing brochure (page 3, 7) — using old primary blue\n2. Social media templates — header gradient incorrect\n3. Email signature template — logo using deprecated version\n\nAll instances can be automatically corrected. No manual intervention needed if you approve the auto-fix.",
    time: "1h ago", minutesAgo: 60, priority: "medium", read: false,
    actions: ["Auto-Fix All", "Review Manually"],
  },
  {
    id: 6, type: "meeting", agentId: "bravo", agentName: "Bravo", agentInitials: "B", agentColor: "#22D3EE",
    project: "SprintForge", title: "Sprint 7 Retro Summary Available",
    description: "45-min retrospective processed. 5 action items extracted, 3 improvements identified, team sentiment: positive.",
    detail: "Meeting: Sprint 7 Retrospective\nDuration: 45 minutes\nAttendees: 5 team members\n\nKey takeaways:\n✅ What went well: Pair programming on PTX-125 was effective, daily standups are more focused\n⚠️ What to improve: PR review turnaround (avg 6h → target 2h), test coverage on billing module\n🔄 Actions:\n1. Implement PR review SLA (2h max) — Owner: James\n2. Add billing module test coverage to Sprint 8 — Owner: Liam\n3. Schedule knowledge sharing session on Stripe webhooks — Owner: Priya\n4. Update Definition of Done to include test coverage threshold — Owner: Sarah\n5. Investigate CI pipeline optimisation — Owner: James",
    time: "2h ago", minutesAgo: 120, priority: "none", read: true,
    actions: ["View Full Transcript", "Open Actions"],
  },
  {
    id: 7, type: "approval", agentId: "charlie", agentName: "Charlie", agentInitials: "C", agentColor: "#10B981",
    project: "Riverside Development", title: "Procurement Authorisation — £28,500",
    description: "Steel reinforcement order for Phase 3. Above £10K threshold. Supplier: Barrett Steel. Delivery: 3 weeks.",
    detail: "Procurement Request PR-089\nItem: Steel reinforcement bars (16mm, 20mm) for Phase 3 foundations\nSupplier: Barrett Steel Ltd (preferred supplier)\nAmount: £28,500 + VAT\nDelivery: 3 weeks from order\n\nThis exceeds the £10,000 HITL budget threshold. Agent Charlie has verified:\n- 3 quotes obtained (Barrett £28.5K, Tata £31.2K, ArcelorMittal £29.8K)\n- Barrett is preferred supplier with existing framework agreement\n- Specification matches structural engineer's requirements\n- Budget allocation confirmed in Phase 3 cost plan",
    time: "3h ago", minutesAgo: 180, priority: "high", read: false,
    actions: ["Approve", "Reject", "Request Quotes"],
  },
  {
    id: 8, type: "risk", agentId: "alpha", agentName: "Alpha", agentInitials: "A", agentColor: "#6366F1",
    project: "Project Atlas", title: "Budget Variance Alert — CPI Below 0.95",
    description: "Current CPI: 0.93. PRINCE2 exception threshold breached. EAC revised to £268,000 (budget: £250,000).",
    detail: "Earned Value Alert\nCPI: 0.93 (threshold: 0.95)\nSPI: 1.02 (on track)\nEAC: £268,000 (BAC: £250,000)\nVariance: £18,000 over budget\n\nRoot cause: Unplanned vendor consultation fees (£12,000) and extended testing cycle (£6,000).\n\nPRINCE2 Exception Process triggered. An exception report is required for the Project Board.\n\nAgent Alpha has drafted the exception report with three recovery options for your review.",
    time: "4h ago", minutesAgo: 240, priority: "high", read: false,
    actions: ["Review Exception Report", "Escalate to Board"],
  },
  {
    id: 9, type: "document", agentId: "echo", agentName: "Echo", agentInitials: "E", agentColor: "#EC4899",
    project: "Brand Refresh", title: "Design Asset Handoff Checklist Complete",
    description: "38-item checklist compiled for development team. All assets verified, specs documented, Figma links attached.",
    detail: "The design-to-development handoff checklist for the Brand Refresh project is complete:\n\n📦 38 assets total\n✅ 38 verified and export-ready\n🔗 Figma links attached for all components\n📐 Responsive specifications documented\n🎨 Colour tokens mapped to design system\n\nThe checklist has been shared with the development team via Slack and is available in the project knowledge base.",
    time: "5h ago", minutesAgo: 300, priority: "none", read: true,
    actions: ["View Checklist", "Share"],
  },
  {
    id: 10, type: "approval", agentId: "bravo", agentName: "Bravo", agentInitials: "B", agentColor: "#22D3EE",
    project: "SprintForge", title: "Sprint 8 Planning — Backlog Ready",
    description: "28 items groomed and estimated. Recommended commitment: 52 SP based on velocity trend. Ready for planning session.",
    detail: "Sprint 8 backlog has been prepared:\n\n📋 28 items groomed\n📊 Total estimates: 124 SP available\n🎯 Recommended commitment: 52 SP (based on 3-sprint velocity average)\n\nTop priority items:\n1. PTX-109: Subscription plan comparison (5 SP) — carried over\n2. PTX-135: Billing integration tests (3 SP)\n3. PTX-136: Dashboard widget customisation (8 SP)\n\nPlanning session scheduled: Monday 6 Apr at 10:00.",
    time: "6h ago", minutesAgo: 360, priority: "none", read: true,
    actions: ["Review Backlog", "Adjust Commitment"],
  },
  {
    id: 11, type: "billing", agentId: "alpha", agentName: "Alpha", agentInitials: "A", agentColor: "#6366F1",
    project: "System", title: "Credit Balance Alert — 753 Remaining",
    description: "At current burn rate (84/day), credits will deplete in 9 days — 20 days before reset. Consider top-up.",
    detail: "Credit Usage Alert\n\nBalance: 753 / 2,000 credits\nBurn rate: ~84 credits/day\nProjected depletion: 11 April (9 days)\nNext reset: 1 May (29 days)\n\nTop consumers:\n- Alpha: 33% (412 credits)\n- Bravo: 28% (356 credits)\n- Charlie: 23% (289 credits)\n\nRecommendation: Purchase a 500-credit top-up (£30) or enable auto top-up to prevent agent interruption.",
    time: "8h ago", minutesAgo: 480, priority: "medium", read: true,
    actions: ["Top Up Credits", "Enable Auto Top-Up", "View Usage"],
  },
  {
    id: 12, type: "system", agentId: "delta", agentName: "Delta", agentInitials: "D", agentColor: "#F97316",
    project: "Cloud Migration", title: "Agent Delta Paused — Awaiting Input",
    description: "Paused for 6 hours. Migration sequence proposal requires stakeholder approval before agent can proceed.",
    detail: "Agent Delta has been paused since 04:00 today.\n\nReason: The migration sequence proposal (Wave 2: Database → Application → DNS) requires stakeholder approval before execution planning can begin.\n\nThe proposal was submitted 2 days ago. SLA for stakeholder response is 48 hours — now exceeded.\n\nOptions:\n1. Resume agent with approved sequence\n2. Escalate to programme manager\n3. Reassign agent to different project temporarily",
    time: "6h ago", minutesAgo: 360, priority: "medium", read: false,
    actions: ["Resume Agent", "Escalate", "Reassign"],
  },
];

const TYPE_CONFIG: Record<NType, { icon: string; color: string; label: string }> = {
  approval: { icon: "✅", color: "#6366F1", label: "Approvals" },
  risk: { icon: "⚠️", color: "#EF4444", label: "Risks" },
  document: { icon: "📄", color: "#22D3EE", label: "Documents" },
  meeting: { icon: "🎙️", color: "#10B981", label: "Meetings" },
  billing: { icon: "💳", color: "#F59E0B", label: "Billing" },
  system: { icon: "⚙️", color: "#64748B", label: "System" },
};

const FILTER_TABS: (NType | "all")[] = ["all", "approval", "risk", "document", "meeting", "billing", "system"];

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function NotificationsPage() {
  const mode = "dark";
  const { data: apiNotifs } = useNotifications();
  const initialNotifs = apiNotifs && apiNotifs.length > 0
    ? apiNotifs.map((n: any, i: number) => ({
        id: n.id || i, type: (n.type || "system") as NType,
        agentId: "", agentName: "System", agentInitials: "S", agentColor: "#6366F1",
        project: n.project || "", title: n.title || "", description: n.message || "",
        detail: n.message || "", time: new Date(n.createdAt).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit" }),
        minutesAgo: Math.round((Date.now() - new Date(n.createdAt).getTime()) / 60000),
        priority: (n.priority === "high" ? "high" : "none") as Priority,
        read: n.isRead || false, actions: ["Acknowledge"],
      }))
    : [];
  const [notifications, setNotifications] = useState(initialNotifs);
  const [activeTab, setActiveTab] = useState<NType | "all">("all");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [highPriorityOnly, setHighPriorityOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);

  // Prefs state
  const [prefToggles, setPrefToggles] = useState<Record<NType, "always" | "digest" | "off">>({
    approval: "always", risk: "always", document: "digest", meeting: "digest", billing: "always", system: "off",
  });
  const [deliveryEmail, setDeliveryEmail] = useState(true);
  const [deliverySlack, setDeliverySlack] = useState(true);
  const [deliveryPush, setDeliveryPush] = useState(false);
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("07:00");

  const unreadCount = notifications.filter(n => !n.read).length;

  const filtered = useMemo(() => {
    let result = [...notifications];
    if (activeTab !== "all") result = result.filter(n => n.type === activeTab);
    if (agentFilter) result = result.filter(n => n.agentId === agentFilter);
    if (highPriorityOnly) result = result.filter(n => n.priority === "high");
    return result;
  }, [notifications, activeTab, agentFilter, highPriorityOnly]);

  const selected = selectedId ? notifications.find(n => n.id === selectedId) : null;

  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  const markRead = (id: number) => setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));

  const typeCounts: Record<NType, number> = { approval: 0, risk: 0, document: 0, meeting: 0, billing: 0, system: 0 };
  notifications.filter(n => !n.read).forEach(n => typeCounts[n.type]++);

  // Empty state
  if (filtered.length === 0 && activeTab === "all" && !agentFilter && !highPriorityOnly) {
    return (
      <div className="max-w-[600px] mx-auto text-center py-20">
        <div className="text-[48px] mb-4">🎉</div>
        <h2 className="text-[22px] font-bold mb-2" style={{ color: "var(--foreground)" }}>All caught up!</h2>
        <p className="text-[14px] mb-6" style={{ color: "var(--muted-foreground)" }}>No new notifications. Your agents are working smoothly.</p>
        <Button variant="default" size="sm">View Agent Fleet</Button>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px]">
      {/* ═══ 1. HEADER ═══ */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-[24px] font-bold" style={{ color: "var(--foreground)" }}>Notifications</h1>
          {unreadCount > 0 && (
            <span className="text-[12px] font-bold px-2.5 py-1 rounded-full text-white" style={{ background: "var(--primary)" }}>
              {unreadCount} unread
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={markAllRead}>Mark All Read</Button>
          <Button variant="ghost" size="sm" onClick={() => setShowPrefs(!showPrefs)}>⚙ Preferences</Button>
        </div>
      </div>

      {/* ═══ 2. STATS BAR ═══ */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {(Object.keys(TYPE_CONFIG) as NType[]).map(type => {
          const cfg = TYPE_CONFIG[type];
          const count = typeCounts[type];
          return (
            <div key={type} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px]"
              style={{ background: count > 0 ? `${cfg.color}12` : "transparent", border: `1px solid ${count > 0 ? cfg.color + "33" : "var(--border)" + "22"}` }}>
              <span className="text-[12px]">{cfg.icon}</span>
              <span className="text-[11px] font-semibold" style={{ color: count > 0 ? cfg.color : "var(--muted-foreground)" }}>{cfg.label}</span>
              {count > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: cfg.color }}>{count}</span>}
            </div>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>High priority only</span>
          <Toggle checked={highPriorityOnly} onChange={setHighPriorityOnly} color={"#EF4444"} />
        </div>
      </div>

      {/* ═══ 3. FILTER TABS ═══ */}
      <div className="flex gap-1 mb-3" style={{ borderBottom: `1px solid ${"var(--border)"}22` }}>
        {FILTER_TABS.map(tab => {
          const active = activeTab === tab;
          const label = tab === "all" ? "All" : TYPE_CONFIG[tab].label;
          return (
            <button key={tab} className="px-3 py-2 text-[12px] font-semibold transition-all"
              onClick={() => setActiveTab(tab)}
              style={{
                color: active ? "var(--primary)" : "var(--muted-foreground)",
                borderBottom: active ? `2px solid ${"var(--primary)"}` : "2px solid transparent",
              }}>{label}</button>
          );
        })}
      </div>

      {/* ═══ 4. AGENT FILTER PILLS ═══ */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[10px] font-semibold" style={{ color: "var(--muted-foreground)" }}>Agent:</span>
        <button className="px-2 py-1 rounded-[6px] text-[10px] font-semibold transition-all"
          onClick={() => setAgentFilter(null)}
          style={{ background: !agentFilter ? `${"var(--primary)"}22` : "transparent", color: !agentFilter ? "var(--primary)" : "var(--muted-foreground)", border: `1px solid ${!agentFilter ? "var(--primary)" + "44" : "transparent"}` }}>
          All
        </button>
        {AGENTS.map(a => (
          <button key={a.id} className="flex items-center gap-1 px-2 py-1 rounded-full transition-all"
            onClick={() => setAgentFilter(agentFilter === a.id ? null : a.id)}
            style={{
              background: agentFilter === a.id ? `${a.color}22` : "transparent",
              border: `1px solid ${agentFilter === a.id ? a.color + "44" : "var(--border)" + "33"}`,
              opacity: a.status === "paused" ? 0.5 : 1,
            }}>
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white" style={{ background: a.color }}>{a.initials}</div>
            <span className="text-[10px] font-semibold" style={{ color: agentFilter === a.id ? a.color : "var(--muted-foreground)" }}>{a.name}</span>
            {a.status === "paused" && <span className="text-[8px]" style={{ color: "#F59E0B" }}>⏸</span>}
          </button>
        ))}
      </div>

      {/* ═══ 5 + 6. NOTIFICATION LIST + DETAIL PANEL ═══ */}
      <div className="flex gap-4">
        {/* List */}
        <div className="flex-1 space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-[14px]" style={{ color: "var(--muted-foreground)" }}>No notifications matching your filters.</p>
              <button className="text-[12px] font-semibold mt-2" style={{ color: "var(--primary)" }}
                onClick={() => { setActiveTab("all"); setAgentFilter(null); setHighPriorityOnly(false); }}>
                Clear filters
              </button>
            </div>
          ) : (
            filtered.map(n => {
              const cfg = TYPE_CONFIG[n.type];
              const isSelected = selectedId === n.id;
              return (
                <div key={n.id} className="rounded-[12px] p-3.5 cursor-pointer transition-all duration-150 hover:translate-y-[-1px]"
                  onClick={() => { setSelectedId(n.id); markRead(n.id); }}
                  style={{
                    background: isSelected ? `${cfg.color}08` : "var(--card)",
                    border: isSelected ? `1.5px solid ${cfg.color}33` : `1px solid ${"var(--border)"}`,
                    boxShadow: isSelected ? `0 2px 12px ${cfg.color}12` : "0 1px 3px rgba(0,0,0,0.08)",
                  }}>
                  <div className="flex items-start gap-3">
                    {/* Type icon */}
                    <div className="w-9 h-9 rounded-[8px] flex items-center justify-center text-[16px] flex-shrink-0"
                      style={{ background: `${cfg.color}15` }}>{cfg.icon}</div>

                    <div className="flex-1 min-w-0">
                      {/* Top row */}
                      <div className="flex items-center gap-2 mb-0.5">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                          style={{ background: n.agentColor }}>{n.agentInitials}</div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-[4px] font-semibold"
                          style={{ background: `${n.agentColor}12`, color: n.agentColor }}>{n.project}</span>
                        <span className="text-[10px] ml-auto flex-shrink-0" style={{ color: "var(--muted-foreground)" }}>{n.time}</span>
                        {/* Priority + unread dots */}
                        {n.priority === "high" && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#EF4444" }} />}
                        {n.priority === "medium" && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#F59E0B" }} />}
                        {!n.read && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "var(--primary)" }} />}
                      </div>

                      {/* Title + desc */}
                      <p className="text-[13px] font-semibold leading-snug" style={{ color: n.read ? "var(--muted-foreground)" : "var(--foreground)" }}>{n.title}</p>
                      <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: "var(--muted-foreground)" }}>{n.description}</p>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 mt-2">
                        {n.actions.slice(0, 2).map(a => (
                          <button key={a} className="px-2.5 py-1 rounded-[6px] text-[10px] font-semibold transition-all hover:opacity-80"
                            onClick={e => e.stopPropagation()}
                            style={{
                              background: a === n.actions[0] ? cfg.color : "transparent",
                              color: a === n.actions[0] ? "#FFF" : "var(--muted-foreground)",
                              border: a === n.actions[0] ? "none" : `1px solid ${"var(--border)"}44`,
                            }}>{a}</button>
                        ))}
                        {n.actions.length > 2 && (
                          <span className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>+{n.actions.length - 2} more</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ═══ 6. DETAIL PANEL ═══ */}
        {selected && (
          <div className="w-[400px] flex-shrink-0 rounded-[14px] overflow-hidden sticky top-4"
            style={{ background: "var(--card)", border: `1px solid ${"var(--border)"}`, boxShadow: "0 10px 15px rgba(0,0,0,0.08)", maxHeight: "calc(100vh - 200px)", overflowY: "auto" }}>
            {/* Header */}
            <div className="px-5 py-4 flex items-start justify-between" style={{ borderBottom: `1px solid ${"var(--border)"}` }}>
              <div className="flex items-center gap-2">
                <span className="text-[18px]">{TYPE_CONFIG[selected.type].icon}</span>
                <Badge variant={selected.priority === "high" ? "destructive" : selected.priority === "medium" ? "secondary" : "outline"}>{selected.priority || "info"}</Badge>
              </div>
              <button onClick={() => setSelectedId(null)} className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[16px]"
                style={{ color: "var(--muted-foreground)", background: `${"var(--border)"}22` }}>×</button>
            </div>

            {/* Content */}
            <div className="px-5 py-4">
              {/* Agent + Project */}
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ background: selected.agentColor }}>{selected.agentInitials}</div>
                <span className="text-[12px] font-semibold" style={{ color: selected.agentColor }}>Agent {selected.agentName}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-[4px]" style={{ background: `${"var(--border)"}22`, color: "var(--muted-foreground)" }}>{selected.project}</span>
              </div>

              <h3 className="text-[15px] font-bold mb-3 leading-snug" style={{ color: "var(--foreground)" }}>{selected.title}</h3>

              {/* Detail text */}
              <div className="text-[12px] leading-relaxed whitespace-pre-line mb-4" style={{ color: "var(--muted-foreground)" }}>
                {selected.detail}
              </div>

              {/* Related items */}
              {selected.related && (
                <div className="mb-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--muted-foreground)" }}>Related Items</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.related.map(r => (
                      <span key={r} className="text-[10px] px-2 py-1 rounded-[6px] font-medium cursor-pointer hover:opacity-80"
                        style={{ background: `${"var(--primary)"}12`, color: "var(--primary)", border: `1px solid ${"var(--primary)"}22` }}>{r}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-2 mb-4">
                {selected.actions.map((a, i) => (
                  <button key={a} className="w-full py-2 rounded-[8px] text-[12px] font-semibold transition-all hover:opacity-90"
                    style={{
                      background: i === 0 ? TYPE_CONFIG[selected.type].color : "transparent",
                      color: i === 0 ? "#FFF" : "var(--muted-foreground)",
                      border: i === 0 ? "none" : `1px solid ${"var(--border)"}`,
                    }}>{a}</button>
                ))}
              </div>

              {/* Quick links */}
              <div className="flex gap-2 pt-3" style={{ borderTop: `1px solid ${"var(--border)"}22` }}>
                <button className="flex-1 py-2 rounded-[8px] text-[11px] font-semibold" style={{ color: "var(--primary)", background: `${"var(--primary)"}08`, border: `1px solid ${"var(--primary)"}22` }}>
                  Open in Project
                </button>
                <button className="flex-1 py-2 rounded-[8px] text-[11px] font-semibold" style={{ color: selected.agentColor, background: `${selected.agentColor}08`, border: `1px solid ${selected.agentColor}22` }}>
                  💬 Chat with {selected.agentName}
                </button>
              </div>

              <p className="text-[10px] text-center mt-3" style={{ color: "var(--muted-foreground)" }}>{selected.time}</p>
            </div>
          </div>
        )}
      </div>

      {/* ═══ 7. PREFERENCES (expandable) ═══ */}
      {showPrefs && (
        <Card className="mt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>Notification Preferences</h3>
            <Button variant="ghost" size="sm" onClick={() => setShowPrefs(false)}>Close</Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Per-type toggles */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Notification Types</p>
              <div className="space-y-2">
                {(Object.keys(TYPE_CONFIG) as NType[]).map(type => {
                  const cfg = TYPE_CONFIG[type];
                  return (
                    <div key={type} className="flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px]">{cfg.icon}</span>
                        <span className="text-[12px]" style={{ color: "var(--foreground)" }}>{cfg.label}</span>
                      </div>
                      <select className="px-2 py-1 rounded-[6px] text-[10px] font-semibold"
                        value={prefToggles[type]}
                        onChange={e => setPrefToggles({ ...prefToggles, [type]: e.target.value as any })}
                        style={{ background: "var(--card)", color: "var(--foreground)", border: `1px solid ${"var(--border)"}` }}>
                        <option value="always">Always</option>
                        <option value="digest">Digest</option>
                        <option value="off">Off</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Delivery channels */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Delivery Channels</p>
              <div className="space-y-2">
                <ToggleRow label="📧 Email" checked={deliveryEmail} onChange={setDeliveryEmail} />
                <ToggleRow label="💬 Slack" checked={deliverySlack} onChange={setDeliverySlack} />
                <ToggleRow label="🔔 Push" checked={deliveryPush} onChange={setDeliveryPush} />
              </div>

              <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${"var(--border)"}22` }}>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Quiet Hours</p>
                <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  <input type="time" value={quietStart} onChange={e => setQuietStart(e.target.value)}
                    className="px-2 py-1 rounded-[6px]" style={{ background: "var(--card)", color: "var(--foreground)", border: `1px solid ${"var(--border)"}` }} />
                  <span>to</span>
                  <input type="time" value={quietEnd} onChange={e => setQuietEnd(e.target.value)}
                    className="px-2 py-1 rounded-[6px]" style={{ background: "var(--card)", color: "var(--foreground)", border: `1px solid ${"var(--border)"}` }} />
                </div>
              </div>
            </div>

            {/* Per-agent mute */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Agent Mute</p>
              <div className="space-y-2">
                {AGENTS.map(a => (
                  <div key={a.id} className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white" style={{ background: a.color }}>{a.initials}</div>
                      <span className="text-[12px]" style={{ color: "var(--foreground)" }}>{a.name}</span>
                    </div>
                    <Toggle checked={true} onChange={() => {}} color={a.color} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <Button variant="default" size="sm" className="mt-4">Save Preferences</Button>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function Toggle({ checked, onChange, color}: { checked: boolean; onChange: (v: boolean) => void; color: string;  }) {
  return (
    <button className="w-9 h-[20px] rounded-full relative transition-all flex-shrink-0" onClick={() => onChange(!checked)}
      style={{ background: checked ? color : `${"var(--border)"}66` }}>
      <div className="absolute top-[2px] w-4 h-4 rounded-full bg-white transition-all shadow-sm" style={{ left: checked ? 18 : 2 }} />
    </button>
  );
}

function ToggleRow({ label, checked, onChange}: { label: string; checked: boolean; onChange: (v: boolean) => void;  }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[12px]" style={{ color: "var(--foreground)" }}>{label}</span>
      <Toggle checked={checked} onChange={onChange} color={"var(--primary)"} />
    </div>
  );
}
