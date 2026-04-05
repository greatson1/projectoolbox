// @ts-nocheck
"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { usePageTitle } from "@/hooks/use-page-title";
import { useProject, useProjectMetrics } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, TrendingUp, PoundSterling, Plus, ArrowUpRight, ArrowDownRight } from "lucide-react";

function fmt(v: number): string {
  if (Math.abs(v) >= 1000000) return `£${(v / 1000000).toFixed(2)}M`;
  if (Math.abs(v) >= 1000) return `£${(v / 1000).toFixed(0)}K`;
  return `£${v.toLocaleString()}`;
}

export default function CostManagementPage() {
  usePageTitle("Cost Management");
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading } = useProject(projectId);
  const { data: metrics } = useProjectMetrics(projectId);
  const [costs, setCosts] = useState<any[]>([]);

  useEffect(() => {
    if (projectId) {
      fetch(`/api/projects/${projectId}/costs`).then(r => r.json()).then(d => setCosts(d.data?.entries || [])).catch(() => {});
    }
  }, [projectId]);

  if (isLoading) return (
    <div className="space-y-6 max-w-[1400px]">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-4 gap-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-24" />)}</div>
    </div>
  );

  const budget = project?.budget || 0;
  const evm = metrics?.evm || {};
  const ev = evm.ev || 0;
  const ac = evm.ac || 0;
  const cpi = evm.cpi || (ac > 0 ? ev / ac : 1);
  const spi = evm.spi || 1;
  const eac = cpi > 0 ? Math.round(budget / cpi) : budget;
  const vac = budget - eac;
  const etc = eac - ac;

  const cpiColor = cpi >= 1.0 ? "text-emerald-500" : cpi >= 0.9 ? "text-amber-500" : "text-red-500";
  const spiColor = spi >= 1.0 ? "text-emerald-500" : spi >= 0.9 ? "text-amber-500" : "text-red-500";

  return (
    <div className="space-y-6 max-w-[1400px] animate-page-enter">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cost Management</h1>
        {budget > 0 && <Badge variant="secondary">Budget: {fmt(budget)}</Badge>}
      </div>

      {/* EVM Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Total Budget (BAC)</p>
            <p className="text-2xl font-bold">{budget > 0 ? fmt(budget) : "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Earned Value (EV)</p>
            <p className="text-2xl font-bold text-emerald-500">{ev > 0 ? fmt(ev) : "—"}</p>
            {budget > 0 && <p className="text-xs text-muted-foreground">{Math.round((ev / budget) * 100)}% of budget earned</p>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Actual Cost (AC)</p>
            <p className="text-2xl font-bold text-red-500">{ac > 0 ? fmt(ac) : "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Forecast (EAC)</p>
            <p className="text-2xl font-bold">{budget > 0 ? fmt(eac) : "—"}</p>
            {vac !== 0 && budget > 0 && (
              <p className={`text-xs flex items-center gap-1 ${vac >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                {vac >= 0 ? <ArrowDownRight className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                {fmt(Math.abs(vac))} {vac >= 0 ? "under budget" : "over budget"}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Performance Indices */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "CPI", value: cpi.toFixed(2), desc: "Cost Performance", color: cpiColor, detail: cpi >= 1 ? "Under budget" : "Over budget" },
          { label: "SPI", value: spi.toFixed(2), desc: "Schedule Performance", color: spiColor, detail: spi >= 1 ? "Ahead of schedule" : "Behind schedule" },
          { label: "ETC", value: budget > 0 ? fmt(etc) : "—", desc: "Estimate to Complete", color: "text-foreground", detail: "Remaining cost" },
          { label: "VAC", value: budget > 0 ? fmt(vac) : "—", desc: "Variance at Completion", color: vac >= 0 ? "text-emerald-500" : "text-red-500", detail: vac >= 0 ? "Surplus" : "Deficit" },
        ].map(m => (
          <Card key={m.label}>
            <CardContent className="pt-5 text-center">
              <p className={`text-3xl font-bold ${m.color}`}>{m.value}</p>
              <p className="text-xs font-medium mt-1">{m.desc}</p>
              <p className="text-[10px] text-muted-foreground">{m.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Cost Entries */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-sm">Cost Entries</CardTitle>
          <Button variant="outline" size="sm" onClick={() => {
            const desc = prompt("Cost description:");
            const amount = prompt("Amount (£):");
            const type = prompt("Type (ESTIMATE/ACTUAL/FORECAST):", "ACTUAL");
            if (desc && amount) {
              fetch(`/api/projects/${projectId}/costs`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ description: desc, amount: parseFloat(amount), entryType: type || "ACTUAL", recordedAt: new Date().toISOString().slice(0, 10) }),
              }).then(() => window.location.reload());
            }
          }}><Plus className="h-3.5 w-3.5 mr-1" />Log Cost</Button>
        </CardHeader>
        <CardContent>
          {costs.length === 0 ? (
            <div className="text-center py-12">
              <PoundSterling className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No cost entries yet</p>
              <p className="text-xs text-muted-foreground mt-1">Cost tracking begins when the agent logs estimates and actuals</p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50">
                  {["Date", "Description", "Type", "Amount"].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-[10px] font-semibold uppercase text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {costs.map((c: any) => (
                  <tr key={c.id} className="border-b border-border/10 hover:bg-muted/20">
                    <td className="py-2 px-3 text-muted-foreground">{new Date(c.recordedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</td>
                    <td className="py-2 px-3">{c.description}</td>
                    <td className="py-2 px-3"><Badge variant={c.entryType === "ACTUAL" ? "default" : "secondary"} className="text-[9px]">{c.entryType}</Badge></td>
                    <td className="py-2 px-3 font-mono font-medium">{fmt(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
