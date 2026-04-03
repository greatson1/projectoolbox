"use client";
// @ts-nocheck

import { cn } from "@/lib/utils";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

/**
 * Portfolio Dashboard — Cross-project views, timeline, heatmap, risk matrix, budget.
 */


import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ScatterChart, Scatter, ZAxis, Cell } from "recharts";


// ================================================================
// DATA
// ================================================================

const PROJECTS = [
  { id: "p1", name: "CRM Migration", health: "secondary" as const, progress: 32, agent: "Maya", milestone: "Data Migration Start — 12 days", budget: 850000, spent: 247000, forecast: 890000, start: 0, duration: 9, phases: [{ name: "Init", w: 1, color: "#34D399" }, { name: "Plan", w: 2, color: "#6366F1" }, { name: "Exec", w: 5, color: "#22D3EE" }, { name: "Close", w: 1, color: "#F59E0B" }] },
  { id: "p2", name: "Office Renovation", health: "destructive" as const, progress: 67, agent: "Jordan", milestone: "Structural Complete — 5 days", budget: 420000, spent: 327000, forecast: 465000, start: 1, duration: 7, phases: [{ name: "Plan", w: 1, color: "#6366F1" }, { name: "Exec", w: 5, color: "#22D3EE" }, { name: "Close", w: 1, color: "#F59E0B" }] },
  { id: "p3", name: "Mobile App MVP", health: "default" as const, progress: 45, agent: "Alex", milestone: "Sprint 4 Demo — 8 days", budget: 280000, spent: 112000, forecast: 270000, start: 2, duration: 6, phases: [{ name: "S0", w: 1, color: "#34D399" }, { name: "Sprints", w: 4, color: "#6366F1" }, { name: "Release", w: 1, color: "#F59E0B" }] },
];

const TEAM = [
  { name: "Sarah Chen", allocations: [80, 90, 70, 60, 80, 100, 90, 110, 85, 75, 60, 50] },
  { name: "Dave Wilson", allocations: [100, 110, 120, 100, 80, 60, 70, 80, 90, 100, 110, 100] },
  { name: "Tom Harris", allocations: [60, 70, 80, 90, 100, 100, 90, 80, 70, 60, 50, 40] },
  { name: "Lisa Park", allocations: [40, 50, 60, 70, 80, 90, 100, 110, 120, 100, 80, 60] },
  { name: "James Park", allocations: [20, 30, 40, 50, 60, 60, 50, 40, 30, 20, 10, 10] },
];

const WEEKS = ["W14", "W15", "W16", "W17", "W18", "W19", "W20", "W21", "W22", "W23", "W24", "W25"];

const RISKS_SCATTER = [
  { prob: 4, impact: 5, size: 16, name: "Contract expiry penalty", project: "CRM Migration", color: "#6366F1" },
  { prob: 3, impact: 4, size: 12, name: "Data quality issues", project: "CRM Migration", color: "#6366F1" },
  { prob: 4, impact: 3, size: 10, name: "Structural delays", project: "Office Renovation", color: "#F87171" },
  { prob: 2, impact: 4, size: 8, name: "Budget overrun", project: "Office Renovation", color: "#F87171" },
  { prob: 3, impact: 3, size: 9, name: "API dependency", project: "Mobile App", color: "#22D3EE" },
  { prob: 2, impact: 2, size: 6, name: "Resource conflict", project: "CRM Migration", color: "#6366F1" },
  { prob: 4, impact: 2, size: 7, name: "Vendor delays", project: "Office Renovation", color: "#F87171" },
];

const TOP_RISKS = RISKS_SCATTER.sort((a, b) => (b.prob * b.impact) - (a.prob * a.impact)).slice(0, 5);

const BUDGET_DATA = PROJECTS.map((p) => ({
  name: p.name.split(" ").slice(0, 2).join(" "),
  budget: p.budget / 1000,
  spent: p.spent / 1000,
  forecast: p.forecast / 1000,
}));

const MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ================================================================
// COMPONENT
// ================================================================

export default function PortfolioPage() {
  const mode = "dark";
  const [showExecReport, setShowExecReport] = useState(false);
  const [hoveredCell, setHoveredCell] = useState<{ r: number; c: number } | null>(null);

  const totalBudget = PROJECTS.reduce((s, p) => s + p.budget, 0);
  const totalSpent = PROJECTS.reduce((s, p) => s + p.spent, 0);
  const onTrack = PROJECTS.filter((p) => p.health === "green").length;
  const atRisk = PROJECTS.filter((p) => p.health !== "green").length;

  function heatColor(pct: number): string {
    if (pct > 100) return true ? "rgba(248,113,113,0.5)" : "rgba(239,68,68,0.3)";
    if (pct > 80) return true ? "rgba(251,191,36,0.4)" : "rgba(245,158,11,0.2)";
    if (pct > 50) return true ? "rgba(99,102,241,0.3)" : "rgba(99,102,241,0.15)";
    if (pct > 20) return true ? "rgba(99,102,241,0.15)" : "rgba(99,102,241,0.07)";
    return "transparent";
  }

  return (
    <div className="space-y-6">
      {/* Health overview */}
      <div className="flex items-center justify-between">
        <div className="flex gap-4">
          {[
            { label: "Projects", value: PROJECTS.length, color: "var(--foreground)" },
            { label: "On Track", value: `${Math.round((onTrack / PROJECTS.length) * 100)}%`, color: "#10B981" },
            { label: "At Risk", value: atRisk, color: "#EF4444" },
            { label: "Total Budget", value: `£${(totalBudget / 1000).toFixed(0)}K`, color: "var(--primary)" },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-2 px-3 py-2 rounded-[8px]" style={{ backgroundColor: true ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", border: `1px solid ${"var(--border)"}` }}>
              <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{s.label}:</span>
              <span className="text-[13px] font-bold" style={{ color: s.color }}>{s.value}</span>
            </div>
          ))}
        </div>
        <Button variant="default" size="sm" onClick={() => setShowExecReport(true)}>Generate Executive Report</Button>
      </div>

      {/* Project mini cards */}
      <div className="grid grid-cols-3 gap-4">
        {PROJECTS.map((p) => (
          <Card key={p.id}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>{p.name}</span>
              </div>
              <div className="relative w-10 h-10">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                  <circle cx="18" cy="18" r="14" fill="none" stroke={"var(--border)"} strokeWidth="3" />
                  <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3" strokeLinecap="round"
                    stroke={p.health === "green" ? "#10B981" : p.health === "amber" ? "#F59E0B" : "#EF4444"}
                    strokeDasharray={`${p.progress} ${100 - p.progress}`} />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold" style={{ color: "var(--foreground)" }}>{p.progress}%</span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[9px] font-bold text-white">A</div>
              <span>{p.agent}</span>
              <span className="ml-auto">{p.milestone}</span>
            </div>
          </Card>
        ))}
      </div>

      {/* Timeline */}
      <Card header={<span className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>Portfolio Timeline</span>}>
        <div className="overflow-x-auto">
          <div style={{ minWidth: 700 }}>
            {/* Month headers */}
            <div className="flex mb-2" style={{ paddingLeft: 140 }}>
              {MONTHS.map((m) => (
                <div key={m} className="flex-1 text-[10px] font-semibold text-center" style={{ color: "var(--muted-foreground)" }}>{m}</div>
              ))}
            </div>
            {/* Bars */}
            {PROJECTS.map((p) => (
              <div key={p.id} className="flex items-center h-10 mb-1.5">
                <div className="w-[140px] flex-shrink-0 flex items-center gap-2 pr-3">
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-[11px] font-medium truncate" style={{ color: "var(--foreground)" }}>{p.name}</span>
                </div>
                <div className="flex-1 relative h-7">
                  {/* Project bar */}
                  <div className="absolute h-full flex rounded-[4px] overflow-hidden"
                    style={{ left: `${(p.start / 9) * 100}%`, width: `${(p.duration / 9) * 100}%` }}>
                    {p.phases.map((ph, i) => (
                      <div key={i} className="h-full" style={{ width: `${(ph.w / p.duration) * 100}%`, backgroundColor: ph.color, opacity: 0.7 }}
                        title={ph.name} />
                    ))}
                  </div>
                  {/* Today marker ~month 1 */}
                  <div className="absolute top-0 bottom-0 w-px" style={{ left: `${(0.5 / 9) * 100}%`, borderLeft: `2px dashed ${"#EF4444"}` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-5">
        {/* Resource Heatmap */}
        <Card header={<span className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>Resource Allocation Heatmap</span>}>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--muted-foreground)" }}>Team Member</th>
                  {WEEKS.map((w) => <th key={w} className="px-1 py-2 text-center font-semibold" style={{ color: "var(--muted-foreground)" }}>{w}</th>)}
                </tr>
              </thead>
              <tbody>
                {TEAM.map((m, ri) => (
                  <tr key={m.name}>
                    <td className="px-3 py-1.5 font-medium" style={{ color: "var(--foreground)" }}>{m.name}</td>
                    {m.allocations.map((pct, ci) => (
                      <td key={ci} className="px-1 py-1 text-center"
                        onMouseEnter={() => setHoveredCell({ r: ri, c: ci })}
                        onMouseLeave={() => setHoveredCell(null)}>
                        <div className={cn("w-full h-7 rounded-[3px] flex items-center justify-center text-[9px] font-bold transition-all",
                          hoveredCell?.r === ri && hoveredCell?.c === ci && "ring-2 ring-white scale-110")}
                          style={{
                            backgroundColor: heatColor(pct),
                            color: pct > 100 ? "#EF4444" : pct > 50 ? "var(--foreground)" : "var(--muted-foreground)",
                          }}>
                          {pct}%
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Risk Matrix */}
        <Card header={<span className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>Cross-Project Risk Matrix</span>}>
          <ResponsiveContainer width="100%" height={220}>
            <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
              <CartesianGrid stroke={"var(--border)"} strokeDasharray="3 3" />
              <XAxis type="number" dataKey="prob" domain={[0, 5]} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} name="Probability" label={{ value: "Probability →", position: "bottom", fill: "var(--muted-foreground)", fontSize: 10 }} />
              <YAxis type="number" dataKey="impact" domain={[0, 5]} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} name="Impact" label={{ value: "Impact →", angle: -90, position: "left", fill: "var(--muted-foreground)", fontSize: 10 }} />
              <ZAxis type="number" dataKey="size" range={[40, 300]} />
              <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: `1px solid ${"var(--border)"}`, borderRadius: 10, color: "var(--foreground)", fontSize: 11 }}
                formatter={(_: any, name: string, props: any) => [props.payload.name, props.payload.project]} />
              <Scatter data={RISKS_SCATTER}>
                {RISKS_SCATTER.map((r, i) => <Cell key={i} fill={r.color} opacity={0.7} />)}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <div className="mt-3 space-y-1.5">
            {TOP_RISKS.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-[11px] py-1" style={{ borderBottom: `1px solid ${"var(--border)"}` }}>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                  <span style={{ color: "var(--foreground)" }}>{r.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{r.project.split(" ")[0]}</Badge>
                  <Badge variant={r.prob * r.impact >= 12 ? "destructive" : "secondary"}>{r.prob * r.impact}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Budget */}
      <Card header={
        <div className="flex items-center justify-between">
          <span className="text-[14px] font-semibold" style={{ color: "var(--foreground)" }}>Budget Overview</span>
          <div className="flex items-center gap-3">
            <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>Total Burn Rate:</span>
            <span className="text-[13px] font-bold" style={{ color: totalSpent / totalBudget > 0.7 ? "#EF4444" : "#10B981" }}>
              {Math.round((totalSpent / totalBudget) * 100)}%
            </span>
          </div>
        </div>
      }>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={BUDGET_DATA} barGap={4}>
            <CartesianGrid stroke={"var(--border)"} strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `£${v}K`} />
            <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: `1px solid ${"var(--border)"}`, borderRadius: 10, color: "var(--foreground)", fontSize: 12 }}
              formatter={(v: number) => [`£${v}K`]} />
            <Legend wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }} />
            <Bar dataKey="budget" name="Budget" fill={"var(--primary)"} opacity={0.3} radius={[4, 4, 0, 0]} />
            <Bar dataKey="spent" name="Actual" fill={"var(--primary)"} radius={[4, 4, 0, 0]} />
            <Bar dataKey="forecast" name="Forecast" fill={"#F59E0B"} opacity={0.6} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Exec report modal */}
      {showExecReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.6)" }} onClick={() => setShowExecReport(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-[600px] max-h-[80vh] overflow-y-auto rounded-[16px] p-6" style={{ backgroundColor: "var(--card)", border: `1px solid ${"var(--border)"}` }}>
            <h3 className="text-[18px] font-bold mb-4" style={{ color: "var(--foreground)" }}>Executive Portfolio Report</h3>
            <div className="space-y-3 mb-5 text-[13px] leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
              <p><strong style={{ color: "var(--foreground)" }}>Portfolio Health:</strong> {PROJECTS.length} active projects. {onTrack} on track, {atRisk} requiring attention. Overall portfolio health is <strong style={{ color: "#F59E0B" }}>AMBER</strong>.</p>
              <p><strong style={{ color: "var(--foreground)" }}>Budget:</strong> Total portfolio budget £{(totalBudget / 1000).toFixed(0)}K with £{(totalSpent / 1000).toFixed(0)}K spent ({Math.round((totalSpent / totalBudget) * 100)}%). Office Renovation is over forecast by £45K — recommend budget review.</p>
              <p><strong style={{ color: "var(--foreground)" }}>Key Risks:</strong> {TOP_RISKS.length} high-severity risks across the portfolio. Critical: Legacy CRM contract expiry penalty (£50K/month) if migration not complete by July. Structural delays on Office Renovation threatening practical completion date.</p>
              <p><strong style={{ color: "var(--foreground)" }}>Resource:</strong> Dave Wilson over-allocated at 120% in weeks 16-17. Recommend rebalancing with Lisa Park who has 40% capacity.</p>
            </div>
            <div className="flex gap-3">
              <Button variant="ghost" size="sm" onClick={() => setShowExecReport(false)}>Close</Button>
              <Button variant="default" size="sm">Export PDF</Button>
              <Button variant="default" size="sm">Email to Stakeholders</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
