"use client";
// @ts-nocheck

import { cn } from "@/lib/utils";
import { useProjects } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
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
  const { data: apiProjects, isLoading } = useProjects();
  const [showExecReport, setShowExecReport] = useState(false);
  const [hoveredCell, setHoveredCell] = useState<{ r: number; c: number } | null>(null);

  const projects = useMemo(() => {
    if (!apiProjects || !Array.isArray(apiProjects)) return [];
    return apiProjects;
  }, [apiProjects]);

  const totalBudget = projects.reduce((s: number, p: any) => s + (p.budget || 0), 0);
  const totalSpent = projects.reduce((s: number, p: any) => s + (p.spent || 0), 0);
  const onTrack = projects.filter((p: any) => p.health === "green" || p.status === "ON_TRACK").length;
  const atRisk = projects.length - onTrack;

  const budgetData = projects.map((p: any) => ({
    name: (p.name || "").split(" ").slice(0, 2).join(" "),
    budget: (p.budget || 0) / 1000,
    spent: (p.spent || 0) / 1000,
    forecast: (p.forecast || p.budget || 0) / 1000,
  }));

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Health overview */}
      <div className="flex items-center justify-between">
        <div className="flex gap-4">
          {[
            { label: "Projects", value: projects.length, color: "var(--foreground)" },
            { label: "On Track", value: `${projects.length > 0 ? Math.round((onTrack / projects.length) * 100) : 0}%`, color: "#10B981" },
            { label: "At Risk", value: atRisk, color: "#EF4444" },
            { label: "Total Budget", value: `£${(totalBudget / 1000).toFixed(0)}K`, color: "var(--primary)" },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-2 px-3 py-2 rounded-[8px]" style={{ backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
              <span className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>{s.label}:</span>
              <span className="text-[13px] font-bold" style={{ color: s.color }}>{s.value}</span>
            </div>
          ))}
        </div>
        {projects.length > 0 && <Button variant="default" size="sm" onClick={() => setShowExecReport(true)}>Generate Executive Report</Button>}
      </div>

      {/* Project mini cards or empty state */}
      {projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <p className="text-sm text-muted-foreground mb-2">No projects in your portfolio yet</p>
            <p className="text-xs text-muted-foreground/60">Create projects and deploy agents to see your portfolio dashboard here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {projects.map((p: any) => (
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
                      stroke={p.status === "ON_TRACK" ? "#10B981" : p.status === "AT_RISK" ? "#F59E0B" : "#EF4444"}
                      strokeDasharray={`${p.progress || 0} ${100 - (p.progress || 0)}`} />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold" style={{ color: "var(--foreground)" }}>{p.progress || 0}%</span>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                <span>{p.methodology || ""}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Timeline */}
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Portfolio Timeline</CardTitle></CardHeader><CardContent>
        <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
          {projects.length === 0 ? "No projects to display" : "Timeline visualization requires project schedule data"}
        </div>
      </CardContent></Card>

      <div className="grid grid-cols-2 gap-5">
        {/* Resource Heatmap */}
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Resource Allocation Heatmap</CardTitle></CardHeader><CardContent>
          <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
            No resource allocation data available
          </div>
        </CardContent></Card>

        {/* Risk Matrix */}
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Cross-Project Risk Matrix</CardTitle></CardHeader><CardContent>
          <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
            No risks recorded yet
          </div>
        </CardContent></Card>
      </div>

      {/* Budget */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Budget Overview</CardTitle>
            {totalBudget > 0 && (
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground">Total Burn Rate:</span>
                <span className="text-[13px] font-bold" style={{ color: totalSpent / totalBudget > 0.7 ? "#EF4444" : "#10B981" }}>
                  {Math.round((totalSpent / totalBudget) * 100)}%
                </span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
        {budgetData.some((b: any) => b.budget > 0) ? (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={budgetData} barGap={4}>
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
        ) : (
          <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
            No budget data available
          </div>
        )}
      </CardContent></Card>

      {/* Exec report modal */}
      {showExecReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.6)" }} onClick={() => setShowExecReport(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-[600px] max-h-[80vh] overflow-y-auto rounded-[16px] p-6" style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}>
            <h3 className="text-[18px] font-bold mb-4" style={{ color: "var(--foreground)" }}>Executive Portfolio Report</h3>
            <div className="space-y-3 mb-5 text-[13px] leading-relaxed" style={{ color: "var(--muted-foreground)" }}>
              <p><strong style={{ color: "var(--foreground)" }}>Portfolio Health:</strong> {projects.length} active project{projects.length !== 1 ? "s" : ""}. {onTrack} on track, {atRisk} requiring attention.</p>
              <p><strong style={{ color: "var(--foreground)" }}>Budget:</strong> Total portfolio budget £{(totalBudget / 1000).toFixed(0)}K with £{(totalSpent / 1000).toFixed(0)}K spent ({totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0}%).</p>
            </div>
            <div className="flex gap-3">
              <Button variant="ghost" size="sm" onClick={() => setShowExecReport(false)}>Close</Button>
              <Button variant="default" size="sm" disabled title="Coming soon">Export PDF</Button>
              <Button variant="default" size="sm">Email to Stakeholders</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
