"use client";
// @ts-nocheck

import { usePageTitle } from "@/hooks/use-page-title";
import { cn } from "@/lib/utils";
import { useProjects } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

/**
 * Portfolio Dashboard — Cross-project views, timeline, heatmap, risk matrix, budget.
 */


import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { PageHeader } from "@/components/layout/page-header";


// ================================================================
// COMPONENT
// ================================================================


export default function PortfolioPage() {
  const { data: apiProjects, isLoading } = useProjects();
  usePageTitle("Portfolio");
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
      <PageHeader
        title="Portfolio"
        subtitle="Cross-project health and resource overview"
        actions={projects.length > 0 ? <Button variant="default" size="sm" onClick={() => setShowExecReport(true)}>Generate Executive Report</Button> : undefined}
      />
      {/* Health overview */}
      <div className="flex gap-4 flex-wrap">
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
              <Button variant="default" size="sm" onClick={() => { window.print(); toast.success("Print dialog opened"); }}>Export PDF</Button>
              <Button variant="default" size="sm" onClick={async () => { const emails = prompt("Enter recipient emails (comma-separated):"); if (!emails) return; try { await fetch("/api/portfolio/email", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ recipients: emails.split(",").map((e: string) => e.trim()), subject: "Portfolio Report" }) }); toast.success("Report emailed"); } catch { toast.error("Email failed"); } }}>Email to Stakeholders</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
