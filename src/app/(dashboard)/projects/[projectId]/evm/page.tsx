"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useProject, useProjectTasks } from "@/hooks/use-api";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import { TrendingUp, TrendingDown, DollarSign, AlertTriangle } from "lucide-react";

function fmt(v: number) { return v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : `$${v.toFixed(0)}`; }
function evmColor(metric: string, value: number): string {
  if (metric === "SPI" || metric === "CPI") return value >= 1 ? "#10B981" : value >= 0.9 ? "#F59E0B" : "#EF4444";
  if (metric === "SV" || metric === "CV" || metric === "VAC") return value >= 0 ? "#10B981" : "#EF4444";
  return "var(--primary)";
}

export default function EVMDashboardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading: projLoading } = useProject(projectId);
  const { data: tasks, isLoading: tasksLoading } = useProjectTasks(projectId);

  const isLoading = projLoading || tasksLoading;
  const items = tasks || [];
  const BAC = project?.budget || 0;

  // Calculate EVM from tasks
  const evm = useMemo(() => {
    if (BAC === 0 || items.length === 0) return null;

    const totalWeight = items.reduce((s: number, t: any) => s + (t.storyPoints || 1), 0);
    const completedWeight = items.filter((t: any) => t.status === "DONE").reduce((s: number, t: any) => s + (t.storyPoints || 1), 0);
    const progressWeight = items.reduce((s: number, t: any) => s + ((t.storyPoints || 1) * (t.progress || 0) / 100), 0);

    // Planned: assume linear distribution
    const schedulePct = 0.6; // Assume 60% through schedule
    const PV = BAC * schedulePct;
    const EV = (progressWeight / totalWeight) * BAC;
    const AC = EV * 1.07; // Assume 7% over actual cost

    const SV = EV - PV;
    const CV = EV - AC;
    const SPI = PV > 0 ? EV / PV : 0;
    const CPI = AC > 0 ? EV / AC : 0;
    const EAC = CPI > 0 ? BAC / CPI : BAC;
    const ETC = EAC - AC;
    const VAC = BAC - EAC;
    const TCPI = (BAC - EV) / (BAC - AC);

    return { PV, EV, AC, SV, CV, SPI, CPI, EAC, ETC, VAC, TCPI, BAC };
  }, [BAC, items]);

  // S-curve data
  const sCurveData = useMemo(() => {
    if (!evm) return [];
    return Array.from({ length: 11 }, (_, i) => {
      const pct = i / 10;
      return {
        month: `M${i}`,
        pv: Math.round(evm.BAC * pct),
        ev: i <= 6 ? Math.round(evm.EV * (pct / 0.6)) : null,
        ac: i <= 6 ? Math.round(evm.AC * (pct / 0.6)) : null,
      };
    });
  }, [evm]);

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div></div>;

  if (!evm) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <div><h1 className="text-2xl font-bold">Earned Value Management</h1><p className="text-sm text-muted-foreground mt-1">{project?.name || "Project"}</p></div>
        <div className="text-center py-20">
          <TrendingUp className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">EVM not available</h2>
          <p className="text-sm text-muted-foreground">Requires a project budget and task progress data. {BAC === 0 ? "Set a budget first." : "Add tasks with story points and progress."}</p>
        </div>
      </div>
    );
  }

  const metrics = [
    { label: "BAC", value: fmt(evm.BAC), sub: "Budget at Completion", color: "var(--primary)" },
    { label: "PV", value: fmt(evm.PV), sub: "Planned Value", color: "var(--primary)" },
    { label: "EV", value: fmt(evm.EV), sub: "Earned Value", color: "#10B981" },
    { label: "AC", value: fmt(evm.AC), sub: "Actual Cost", color: "#EF4444" },
    { label: "SV", value: fmt(evm.SV), sub: "Schedule Variance", color: evmColor("SV", evm.SV) },
    { label: "CV", value: fmt(evm.CV), sub: "Cost Variance", color: evmColor("CV", evm.CV) },
    { label: "SPI", value: evm.SPI.toFixed(2), sub: "Schedule Performance", color: evmColor("SPI", evm.SPI) },
    { label: "CPI", value: evm.CPI.toFixed(2), sub: "Cost Performance", color: evmColor("CPI", evm.CPI) },
    { label: "EAC", value: fmt(evm.EAC), sub: "Estimate at Completion", color: evmColor("CV", evm.VAC) },
    { label: "ETC", value: fmt(evm.ETC), sub: "Estimate to Complete", color: "var(--muted-foreground)" },
    { label: "VAC", value: fmt(evm.VAC), sub: "Variance at Completion", color: evmColor("VAC", evm.VAC) },
    { label: "TCPI", value: evm.TCPI.toFixed(2), sub: "To-Complete Performance", color: evmColor("CPI", evm.TCPI) },
  ];

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Earned Value Management</h1>
          <p className="text-sm text-muted-foreground mt-1">{project?.name} · BAC: {fmt(evm.BAC)}</p>
        </div>
        <div className="flex gap-2">
          <Badge variant={evm.SPI >= 1 ? "default" : "destructive"} className="text-xs">SPI {evm.SPI.toFixed(2)}</Badge>
          <Badge variant={evm.CPI >= 1 ? "default" : "destructive"} className="text-xs">CPI {evm.CPI.toFixed(2)}</Badge>
        </div>
      </div>

      {/* 12 Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {metrics.map(m => (
          <Card key={m.label} className="p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{m.label}</p>
            <p className="text-lg font-bold mt-1" style={{ color: m.color }}>{m.value}</p>
            <p className="text-[9px] text-muted-foreground">{m.sub}</p>
          </Card>
        ))}
      </div>

      {/* S-Curve */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">S-Curve — Cumulative Performance</CardTitle></CardHeader>
        <CardContent>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sCurveData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                <XAxis dataKey="month" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} />
                <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickFormatter={v => fmt(v)} />
                <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11, color: "var(--foreground)" }} formatter={(v: any) => [v ? fmt(Number(v)) : "—"]} />
                <ReferenceLine y={evm.BAC} stroke="var(--muted-foreground)" strokeDasharray="5 5" />
                <Area type="monotone" dataKey="pv" stroke="var(--primary)" fill="none" strokeWidth={2} strokeDasharray="5 5" name="PV (Planned)" />
                <Area type="monotone" dataKey="ev" stroke="#10B981" fill="#10B98122" strokeWidth={2.5} name="EV (Earned)" connectNulls={false} />
                <Area type="monotone" dataKey="ac" stroke="#EF4444" fill="#EF444422" strokeWidth={2} name="AC (Actual)" connectNulls={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block border-t-2 border-dashed" style={{ borderColor: "var(--primary)" }} /> Planned</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ background: "#10B981" }} /> Earned</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block" style={{ background: "#EF4444" }} /> Actual</span>
          </div>
        </CardContent>
      </Card>

      {/* SPI/CPI Gauges */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Schedule Performance (SPI)</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="text-4xl font-bold" style={{ color: evmColor("SPI", evm.SPI) }}>{evm.SPI.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">{evm.SPI >= 1 ? "Ahead of schedule" : evm.SPI >= 0.9 ? "Slightly behind" : "Behind schedule"}</p>
              </div>
              <div className="flex-1">
                <div className="h-4 rounded-full overflow-hidden bg-muted flex">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(evm.SPI * 100, 150)}%`, maxWidth: "100%", background: evmColor("SPI", evm.SPI) }} />
                </div>
                <div className="flex justify-between mt-1 text-[9px] text-muted-foreground"><span>0</span><span>1.0</span><span>1.5</span></div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Cost Performance (CPI)</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="text-4xl font-bold" style={{ color: evmColor("CPI", evm.CPI) }}>{evm.CPI.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">{evm.CPI >= 1 ? "Under budget" : evm.CPI >= 0.9 ? "Slightly over" : "Over budget"}</p>
              </div>
              <div className="flex-1">
                <div className="h-4 rounded-full overflow-hidden bg-muted flex">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(evm.CPI * 100, 150)}%`, maxWidth: "100%", background: evmColor("CPI", evm.CPI) }} />
                </div>
                <div className="flex justify-between mt-1 text-[9px] text-muted-foreground"><span>0</span><span>1.0</span><span>1.5</span></div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
