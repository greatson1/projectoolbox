"use client";
// @ts-nocheck

import { useState, useMemo, useRef, useEffect, useCallback } from "react";

import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

/**
 * Change Control Board — Kanban pipeline, impact analysis, statistics, decision log.
 */


import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from "recharts";


// ================================================================
// DATA
// ================================================================

interface CR {
  id: string; title: string; category: "scope" | "schedule" | "budget" | "technical" | "resource";
  priority: "critical" | "high" | "medium" | "low"; requester: string; date: string;
  status: string; impactScore: number; decisionDate: string; approver: string;
  scopeImpact: string; scheduleDays: number; costImpact: number; riskDelta: string;
  resourceHours: number; aiSummary: string;
}

const CRS: CR[] = [
  { id: "CR-001", title: "Add underground parking level B2", category: "scope", priority: "critical", requester: "Sarah Chen", date: "28 Mar", status: "Impact Assessment", impactScore: 9, decisionDate: "", approver: "", scopeImpact: "Adds entire B2 parking level including structural reinforcement, drainage, and ventilation systems", scheduleDays: 45, costImpact: 320000, riskDelta: "2 new structural risks, ground stability assessment required", resourceHours: 2400, aiSummary: "Critical scope expansion. Adding B2 level extends timeline by 45 days and adds £320K. Recommend phased approach — complete B1 first, B2 as separate work package with dedicated structural team." },
  { id: "CR-002", title: "Switch to sustainable steel supplier", category: "budget", priority: "high", requester: "Mark Thompson", date: "25 Mar", status: "CCB Decision", impactScore: 6, decisionDate: "", approver: "", scopeImpact: "Replace primary steel supplier with ESG-certified alternative", scheduleDays: 14, costImpact: 85000, riskDelta: "Supply chain transition risk for 3-week period", resourceHours: 120, aiSummary: "Sustainability initiative with moderate cost impact. 14-day delay for supplier transition. Recommend approval with phased procurement to maintain schedule buffer." },
  { id: "CR-003", title: "Extend working hours to 7pm", category: "schedule", priority: "high", requester: "Tom Harris", date: "22 Mar", status: "Implementation", impactScore: 4, decisionDate: "26 Mar", approver: "Sarah Chen", scopeImpact: "Extend daily working window from 5pm to 7pm for 8 weeks", scheduleDays: -21, costImpact: 42000, riskDelta: "Noise complaints from adjacent properties, overtime fatigue risk", resourceHours: 0, aiSummary: "Schedule recovery measure. Saves 21 days but costs £42K in overtime. Already approved — monitor noise complaints and worker fatigue indicators." },
  { id: "CR-004", title: "Replace glass facade spec from double to triple glazing", category: "technical", priority: "medium", requester: "Raj Patel", date: "20 Mar", status: "Under Review", impactScore: 5, decisionDate: "", approver: "", scopeImpact: "Upgrade all external glazing from double to triple pane for improved thermal performance", scheduleDays: 7, costImpact: 67000, riskDelta: "Weight increase may require structural review of curtain wall fixings", resourceHours: 180, aiSummary: "Technical improvement with energy certification benefits. Moderate cost and schedule impact. Structural review needed before approval." },
  { id: "CR-005", title: "Add EV charging infrastructure to car park", category: "scope", priority: "medium", requester: "Emma Roberts", date: "18 Mar", status: "Submitted", impactScore: 3, decisionDate: "", approver: "", scopeImpact: "Install 24 EV charging points with electrical infrastructure in B1 car park", scheduleDays: 10, costImpact: 48000, riskDelta: "Electrical capacity assessment required", resourceHours: 320, aiSummary: "Future-proofing measure aligned with building regulations trajectory. Can be implemented in parallel with B1 fit-out to minimise schedule impact." },
  { id: "CR-006", title: "Reduce office floor count from 8 to 7", category: "scope", priority: "low", requester: "Lisa Park", date: "15 Mar", status: "Closed", impactScore: 8, decisionDate: "20 Mar", approver: "Board", scopeImpact: "Remove floor 8, reduce total lettable area by 12%", scheduleDays: -30, costImpact: -180000, riskDelta: "Revenue reduction from reduced lettable space", resourceHours: -600, aiSummary: "Descoping measure to manage budget. Saves £180K and 30 days but reduces revenue potential. Board rejected — maintaining 8 floors." },
  { id: "CR-007", title: "Add rooftop terrace amenity space", category: "scope", priority: "medium", requester: "Mark Thompson", date: "12 Mar", status: "Under Review", impactScore: 5, decisionDate: "", approver: "", scopeImpact: "Convert roof area to landscaped terrace with seating and amenity facilities", scheduleDays: 18, costImpact: 95000, riskDelta: "Waterproofing complexity, wind loading assessment needed", resourceHours: 640, aiSummary: "Amenity enhancement that improves building attractiveness. Moderate impact. Can be scheduled after main structure complete to avoid critical path interference." },
  { id: "CR-008", title: "Engage additional structural engineer", category: "resource", priority: "high", requester: "Tom Harris", date: "10 Mar", status: "Implementation", impactScore: 2, decisionDate: "12 Mar", approver: "Sarah Chen", scopeImpact: "Hire senior structural engineer for 6 months to support B1 foundation work", scheduleDays: 0, costImpact: 54000, riskDelta: "None — reduces existing resource concentration risk", resourceHours: 960, aiSummary: "De-risking measure. Approved and in implementation. Engineer starts next Monday." },
];

const COLUMNS = ["Submitted", "Under Review", "Impact Assessment", "CCB Decision", "Implementation", "Closed"];
const CAT_ICONS: Record<string, string> = { scope: "📐", schedule: "📅", budget: "💰", technical: "🔧", resource: "👷" };
const CAT_PIE = [
  { name: "Scope", value: 4, color: "#6366F1" }, { name: "Schedule", value: 1, color: "#22D3EE" },
  { name: "Budget", value: 1, color: "#F59E0B" }, { name: "Technical", value: 1, color: "#8B5CF6" },
  { name: "Resource", value: 1, color: "#34D399" },
];
const PRIORITY_BAR = [
  { name: "Critical", count: 1, fill: "#EF4444" }, { name: "High", count: 3, fill: "#F59E0B" },
  { name: "Medium", count: 3, fill: "#6366F1" }, { name: "Low", count: 1, fill: "#94A3B8" },
];
const TREND = [
  { month: "Jan", crs: 2 }, { month: "Feb", crs: 3 }, { month: "Mar", crs: 5 }, { month: "Apr", crs: 3 },
];
const DECISIONS = [
  { cr: "CR-003", title: "Extend working hours to 7pm", decision: "approved" as const, rationale: "Schedule recovery outweighs overtime cost", votes: { for: 4, against: 1, abstain: 0 }, date: "26 Mar" },
  { cr: "CR-006", title: "Reduce floor count from 8 to 7", decision: "rejected" as const, rationale: "Revenue impact too significant despite cost savings", votes: { for: 1, against: 4, abstain: 0 }, date: "20 Mar" },
  { cr: "CR-008", title: "Additional structural engineer", decision: "approved" as const, rationale: "Critical resource gap poses delivery risk", votes: { for: 5, against: 0, abstain: 0 }, date: "12 Mar" },
];

// ================================================================
// COMPONENT
// ================================================================

export default function ChangeControlPage() {
  const mode = "dark";
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [selectedCR, setSelectedCR] = useState<CR | null>(null);
  const [search, setSearch] = useState("");

  const filtered = CRS.filter((cr) => !search || cr.title.toLowerCase().includes(search.toLowerCase()) || cr.id.toLowerCase().includes(search.toLowerCase()));
  const pending = CRS.filter((cr) => !["Implementation", "Closed"].includes(cr.status)).length;
  const approved = DECISIONS.filter((d) => d.decision === "approved").length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[24px] font-bold" style={{ color: "var(--foreground)" }}>Change Control Board</h1>
          <div className="flex gap-4 mt-1">
            {[{ l: "Total CRs", v: CRS.length }, { l: "Pending", v: pending }, { l: "Approval Rate", v: `${Math.round((approved / DECISIONS.length) * 100)}%` }].map((s) => (
              <span key={s.l} className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>{s.l}: <strong style={{ color: "var(--foreground)" }}>{s.v}</strong></span>
            ))}
          </div>
        </div>
        <div className="flex gap-3">
          <div className="w-[220px]"><input className="w-full px-3 py-1.5 rounded-lg text-xs bg-background border border-input" placeholder="Search CRs..." value={search} onChange={(e: any) => setSearch(e.target.value)} /></div>
          <div className="flex gap-1 p-0.5 rounded-[8px]" style={{ backgroundColor: true ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)" }}>
            {(["kanban", "table"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className="px-3 py-1.5 rounded-[6px] text-[11px] font-semibold capitalize"
                style={{ backgroundColor: view === v ? (true ? "var(--card)" : "white") : "transparent", color: view === v ? "var(--foreground)" : "var(--muted-foreground)" }}>{v}</button>
            ))}
          </div>
          <Button variant="default" size="sm">New Change Request</Button>
        </div>
      </div>

      {/* Kanban */}
      {view === "kanban" && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {COLUMNS.map((col) => {
            const colCRs = filtered.filter((cr) => cr.status === col);
            return (
              <div key={col} className="flex-shrink-0 w-[220px]">
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{col}</span>
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: "rgba(99,102,241,0.12)", color: "var(--primary)" }}>{colCRs.length}</span>
                </div>
                <div className="space-y-2 min-h-[200px]">
                  {colCRs.map((cr) => (
                    <div key={cr.id} onClick={() => setSelectedCR(cr)}
                      className="p-3 rounded-[10px] cursor-pointer transition-all hover:translate-y-[-1px]"
                      style={{ backgroundColor: "var(--card)", border: `1px solid ${"var(--border)"}`, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Badge variant={cr.priority}>{cr.priority}</Badge>
                        <span className="text-[10px] font-mono" style={{ color: "var(--muted-foreground)" }}>{cr.id}</span>
                      </div>
                      <p className="text-[12px] font-medium mb-1.5 line-clamp-2" style={{ color: "var(--foreground)" }}>{cr.title}</p>
                      <div className="flex items-center justify-between text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                        <span>{CAT_ICONS[cr.category]} {cr.category}</span>
                        <span>{cr.date}</span>
                      </div>
                    </div>
                  ))}
                  {colCRs.length === 0 && (
                    <div className="h-[100px] rounded-[10px] flex items-center justify-center" style={{ border: `2px dashed ${"var(--border)"}` }}>
                      <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>No CRs</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table */}
      {view === "table" && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr style={{ borderBottom: `1px solid ${"var(--border)"}` }}>
                  {["CR ID", "Title", "Category", "Priority", "Requester", "Status", "Impact", "Date"].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((cr) => (
                  <tr key={cr.id} onClick={() => setSelectedCR(cr)} className="cursor-pointer transition-colors"
                    style={{ borderBottom: `1px solid ${"var(--border)"}` }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = true ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.01)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}>
                    <td className="px-3 py-2.5 font-mono" style={{ color: "var(--primary)" }}>{cr.id}</td>
                    <td className="px-3 py-2.5 font-medium max-w-[200px] truncate" style={{ color: "var(--foreground)" }}>{cr.title}</td>
                    <td className="px-3 py-2.5">{CAT_ICONS[cr.category]} <span className="capitalize" style={{ color: "var(--muted-foreground)" }}>{cr.category}</span></td>
                    <td className="px-3 py-2.5"><Badge variant={cr.priority}>{cr.priority}</Badge></td>
                    <td className="px-3 py-2.5" style={{ color: "var(--muted-foreground)" }}>{cr.requester}</td>
                    <td className="px-3 py-2.5"><Badge variant="outline">{cr.status}</Badge></td>
                    <td className="px-3 py-2.5">
                      <span className="px-2 py-0.5 rounded-[4px] text-[10px] font-bold"
                        style={{ backgroundColor: cr.impactScore >= 7 ? "rgba(239,68,68,0.12)" : cr.impactScore >= 4 ? "rgba(245,158,11,0.12)" : "rgba(16,185,129,0.12)", color: cr.impactScore >= 7 ? "#EF4444" : cr.impactScore >= 4 ? "#F59E0B" : "#10B981" }}>
                        {cr.impactScore}/10
                      </span>
                    </td>
                    <td className="px-3 py-2.5" style={{ color: "var(--muted-foreground)" }}>{cr.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Stats */}
        <div className="space-y-4">
          <Card>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>CRs by Category</p>
            <ResponsiveContainer width="100%" height={130}>
              <PieChart><Pie data={CAT_PIE} dataKey="value" cx="50%" cy="50%" outerRadius={50} innerRadius={25}>
                {CAT_PIE.map((e, i) => <Cell key={i} fill={e.color} />)}
              </Pie></PieChart>
            </ResponsiveContainer>
            <div className="space-y-1 mt-1">{CAT_PIE.map((c) => (
              <div key={c.name} className="flex items-center justify-between text-[10px]">
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} /><span style={{ color: "var(--muted-foreground)" }}>{c.name}</span></div>
                <span style={{ color: "var(--foreground)" }}>{c.value}</span>
              </div>
            ))}</div>
          </Card>
          <Card>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>CRs by Priority</p>
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={PRIORITY_BAR} layout="vertical" barSize={14}>
                <XAxis type="number" hide /><YAxis type="category" dataKey="name" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} width={50} axisLine={false} tickLine={false} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>{PRIORITY_BAR.map((e, i) => <Cell key={i} fill={e.fill} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <Card>
            <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>Approval Rate</p>
            <div className="flex justify-center">
              <div className="relative w-[80px] h-[80px]">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                  <circle cx="18" cy="18" r="14" fill="none" stroke={"var(--border)"} strokeWidth="3" />
                  <circle cx="18" cy="18" r="14" fill="none" stroke={"#10B981"} strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={`${Math.round((approved / DECISIONS.length) * 100)} ${100 - Math.round((approved / DECISIONS.length) * 100)}`} />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[14px] font-bold" style={{ color: "var(--foreground)" }}>{Math.round((approved / DECISIONS.length) * 100)}%</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Decision history */}
        <div className="xl:col-span-2 space-y-4">
          {/* Impact panel */}
          {selectedCR && (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant={selectedCR.priority}>{selectedCR.priority}</Badge>
                    <span className="text-[12px] font-mono" style={{ color: "var(--muted-foreground)" }}>{selectedCR.id}</span>
                  </div>
                  <h3 className="text-[16px] font-bold mt-1" style={{ color: "var(--foreground)" }}>{selectedCR.title}</h3>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedCR(null)}>Close</Button>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {[
                  { l: "Schedule Impact", v: `${selectedCR.scheduleDays > 0 ? "+" : ""}${selectedCR.scheduleDays} days`, c: selectedCR.scheduleDays > 0 ? "#EF4444" : "#10B981" },
                  { l: "Cost Impact", v: `${selectedCR.costImpact >= 0 ? "+" : ""}£${Math.abs(selectedCR.costImpact).toLocaleString()}`, c: selectedCR.costImpact > 0 ? "#EF4444" : "#10B981" },
                  { l: "Impact Score", v: `${selectedCR.impactScore}/10`, c: selectedCR.impactScore >= 7 ? "#EF4444" : "#F59E0B" },
                  { l: "Resource Hours", v: `${selectedCR.resourceHours > 0 ? "+" : ""}${selectedCR.resourceHours}h`, c: "var(--muted-foreground)" },
                ].map((m) => (
                  <div key={m.l} className="p-3 rounded-[8px]" style={{ backgroundColor: true ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.02)" }}>
                    <p className="text-[10px]" style={{ color: "var(--muted-foreground)" }}>{m.l}</p>
                    <p className="text-[16px] font-bold" style={{ color: m.c }}>{m.v}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-3 text-[12px]">
                <div><p className="font-semibold mb-0.5" style={{ color: "var(--foreground)" }}>Scope Impact</p><p style={{ color: "var(--muted-foreground)" }}>{selectedCR.scopeImpact}</p></div>
                <div><p className="font-semibold mb-0.5" style={{ color: "var(--foreground)" }}>Risk Delta</p><p style={{ color: "var(--muted-foreground)" }}>{selectedCR.riskDelta}</p></div>
              </div>
              <div className="mt-4 p-3 rounded-[10px]" style={{ backgroundColor: "rgba(99,102,241,0.12)", border: `1px solid rgba(99,102,241,0.15)` }}>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--primary)" }}>AI Impact Summary</p>
                <p className="text-[12px]" style={{ color: "var(--foreground)" }}>{selectedCR.aiSummary}</p>
              </div>
              <div className="flex gap-2 mt-4">
                <Button variant="ghost" size="sm">Request AI Re-analysis</Button>
                <Button variant="ghost" size="sm">View Full Document</Button>
              </div>
            </Card>
          )}

          {/* Decision log */}
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">CCB Decision History</CardTitle></CardHeader><CardContent>
            <div className="space-y-3">
              {DECISIONS.map((d, i) => (
                <div key={i} className="flex gap-3 pb-3" style={{ borderBottom: i < DECISIONS.length - 1 ? `1px solid ${"var(--border)"}` : undefined }}>
                  <div className="w-8 h-8 rounded-[8px] flex items-center justify-center text-[12px] flex-shrink-0"
                    style={{ backgroundColor: d.decision === "approved" ? "rgba(16,185,129,0.12)" : d.decision === "rejected" ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)" }}>
                    {d.decision === "approved" ? "✓" : d.decision === "rejected" ? "✗" : "⏸"}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[11px] font-mono" style={{ color: "var(--muted-foreground)" }}>{d.cr}</span>
                      <span className="text-[12px] font-medium" style={{ color: "var(--foreground)" }}>{d.title}</span>
                      <Badge variant={d.decision === "approved" ? "default" : d.decision === "rejected" ? "destructive" : "secondary"} className="ml-auto">{d.decision}</Badge>
                    </div>
                    <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{d.rationale}</p>
                    <div className="flex items-center gap-3 mt-1 text-[10px]" style={{ color: "var(--muted-foreground)" }}>
                      <span>For: <strong style={{ color: "#10B981" }}>{d.votes.for}</strong></span>
                      <span>Against: <strong style={{ color: "#EF4444" }}>{d.votes.against}</strong></span>
                      <span>Abstain: {d.votes.abstain}</span>
                      <span className="ml-auto">{d.date}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent></Card>

          {/* Trend */}
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">CR Submission Trend</CardTitle></CardHeader><CardContent>
            <ResponsiveContainer width="100%" height={130}>
              <AreaChart data={TREND}>
                <defs><linearGradient id="crGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={"var(--primary)"} stopOpacity={0.3} /><stop offset="95%" stopColor={"var(--primary)"} stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke={"var(--border)"} strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <Area type="monotone" dataKey="crs" stroke={"var(--primary)"} fill="url(#crGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent></Card>
        </div>
      </div>
    </div>
  );
}
