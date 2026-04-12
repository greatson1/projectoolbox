"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { usePageTitle } from "@/hooks/use-page-title";
import { useProject, useProjectMetrics } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PoundSterling, Plus, ArrowUpRight, ArrowDownRight } from "lucide-react";

function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}£${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}£${(abs / 1_000).toFixed(0)}K`;
  return `${sign}£${abs.toLocaleString("en-GB")}`;
}

function fmtIndex(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(v)) return "N/A";
  return v.toFixed(2);
}

interface CostSummary {
  estimated: number;
  actual: number;
  committed: number;
}

interface CostEntry {
  id: string;
  description: string | null;
  entryType: string;
  category: string | null;
  amount: number;
  recordedAt: string;
  vendorName: string | null;
  invoiceRef: string | null;
}

export default function CostManagementPage() {
  usePageTitle("Cost Management");
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading } = useProject(projectId);
  const { data: metrics } = useProjectMetrics(projectId);
  const [costs, setCosts] = useState<CostEntry[]>([]);
  const [byCategory, setByCategory] = useState<Record<string, CostSummary>>({});
  const [costSummary, setCostSummary] = useState<CostSummary>({ estimated: 0, actual: 0, committed: 0 });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/costs`)
      .then(r => r.json())
      .then(d => {
        setCosts(d.data?.entries || []);
        setByCategory(d.data?.byCategory || {});
        setCostSummary(d.data?.summary || { estimated: 0, actual: 0, committed: 0 });
      })
      .catch(() => {});
  }, [projectId]);

  if (isLoading) return (
    <div className="space-y-6 max-w-[1400px]">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}</div>
    </div>
  );

  const budget = project?.budget || 0;
  const evm = (metrics as any)?.evm || {};

  // EVM values — respect null (means no real data yet)
  const ev: number = evm.ev ?? 0;
  const ac: number | null = evm.ac ?? null;          // null = no real cost entries
  const cpi: number | null = evm.cpi ?? null;        // null = no CPI data
  const spi: number | null = evm.spi ?? null;        // null = project hasn't started
  const hasRealEvm: boolean = evm.hasRealEvm ?? false;

  // Forecast — only when CPI is real
  const eac: number | null = cpi !== null && cpi > 0 ? Math.round(budget / cpi) : null;
  const vac: number | null = eac !== null ? budget - eac : null;
  const etc: number | null = eac !== null && ac !== null ? eac - ac : null;

  const cpiColor = cpi === null ? "text-muted-foreground"
    : cpi >= 1.0 ? "text-emerald-500" : cpi >= 0.9 ? "text-amber-500" : "text-red-500";
  const spiColor = spi === null ? "text-muted-foreground"
    : spi >= 1.0 ? "text-emerald-500" : spi >= 0.9 ? "text-amber-500" : "text-red-500";

  async function handleAddCost() {
    const desc = prompt("Cost description:");
    if (!desc) return;
    const amountStr = prompt("Amount (£):");
    if (!amountStr) return;
    const amount = parseFloat(amountStr);
    if (isNaN(amount)) { alert("Invalid amount"); return; }
    const entryType = prompt("Type (ESTIMATE/ACTUAL/COMMITMENT):", "ACTUAL") || "ACTUAL";
    const category = prompt("Category (LABOUR/MATERIALS/EQUIPMENT/SUBCONTRACTOR/OTHER):", "OTHER") || "OTHER";

    setAdding(true);
    try {
      await fetch(`/api/projects/${projectId}/costs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: desc,
          amount,
          entryType: entryType.toUpperCase(),
          category: category.toUpperCase(),
          recordedAt: new Date().toISOString().slice(0, 10),
        }),
      });
      // Reload cost data
      const r = await fetch(`/api/projects/${projectId}/costs`);
      const d = await r.json();
      setCosts(d.data?.entries || []);
      setByCategory(d.data?.byCategory || {});
      setCostSummary(d.data?.summary || { estimated: 0, actual: 0, committed: 0 });
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-6 max-w-[1400px] animate-page-enter">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cost Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Budget tracking, cost entries, and performance indices</p>
        </div>
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
            {budget > 0 && ev > 0 && (
              <p className="text-xs text-muted-foreground">{Math.round((ev / budget) * 100)}% of budget earned</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Actual Cost (AC)</p>
            <p className="text-2xl font-bold text-red-500">{ac !== null && ac > 0 ? fmt(ac) : "—"}</p>
            {ac === null && (
              <p className="text-xs text-muted-foreground">No cost entries yet</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Forecast (EAC)</p>
            <p className="text-2xl font-bold">{eac !== null ? fmt(eac) : "—"}</p>
            {vac !== null && (
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
          {
            label: "CPI",
            value: fmtIndex(cpi),
            desc: "Cost Performance Index",
            color: cpiColor,
            detail: cpi === null ? "No cost data yet" : cpi >= 1 ? "Under budget" : "Over budget",
          },
          {
            label: "SPI",
            value: fmtIndex(spi),
            desc: "Schedule Performance Index",
            color: spiColor,
            detail: spi === null ? "Project not started" : spi >= 1 ? "Ahead of schedule" : "Behind schedule",
          },
          {
            label: "ETC",
            value: etc !== null ? fmt(etc) : "—",
            desc: "Estimate to Complete",
            color: "text-foreground",
            detail: "Remaining cost forecast",
          },
          {
            label: "VAC",
            value: vac !== null ? fmt(vac) : "—",
            desc: "Variance at Completion",
            color: vac === null ? "text-muted-foreground" : vac >= 0 ? "text-emerald-500" : "text-red-500",
            detail: vac === null ? "Awaiting cost data" : vac >= 0 ? "Surplus" : "Deficit",
          },
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

      {/* No EVM data notice */}
      {!hasRealEvm && (
        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-blue-400 font-medium">Performance indices will appear once the project has started and cost entries are logged.</p>
            <p className="text-xs text-muted-foreground mt-1">CPI requires at least one Actual cost entry. SPI requires a project start date in the past.</p>
          </CardContent>
        </Card>
      )}

      {/* Category Breakdown */}
      {Object.keys(byCategory).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Cost by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(byCategory).map(([cat, vals]) => {
                const totalForCat = vals.estimated + vals.actual + vals.committed;
                const pct = budget > 0 ? Math.round((totalForCat / budget) * 100) : 0;
                return (
                  <div key={cat} className="flex items-center gap-4">
                    <span className="text-xs font-medium min-w-[120px]">{cat}</span>
                    <div className="flex-1 h-2 bg-muted/30 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500/70 rounded-full"
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <div className="flex gap-3 min-w-[240px] justify-end">
                      {vals.estimated > 0 && (
                        <span className="text-[10px] text-muted-foreground">Est: {fmt(vals.estimated)}</span>
                      )}
                      {vals.actual > 0 && (
                        <span className="text-[10px] text-emerald-500">Act: {fmt(vals.actual)}</span>
                      )}
                      {vals.committed > 0 && (
                        <span className="text-[10px] text-amber-500">Cmtd: {fmt(vals.committed)}</span>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground min-w-[36px] text-right">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cost Entries */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-sm">Cost Entries</CardTitle>
            {costSummary.actual > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {fmt(costSummary.actual)} actual · {fmt(costSummary.estimated)} estimated
                {costSummary.committed > 0 ? ` · ${fmt(costSummary.committed)} committed` : ""}
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={handleAddCost} disabled={adding}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {adding ? "Adding…" : "Log Cost"}
          </Button>
        </CardHeader>
        <CardContent>
          {costs.length === 0 ? (
            <div className="text-center py-12">
              <PoundSterling className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No cost entries yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Use &quot;Log Cost&quot; to record estimates, actuals, and commitments
              </p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50">
                  {["Date", "Description", "Category", "Type", "Amount"].map(h => (
                    <th key={h} className="text-left py-2 px-3 text-[10px] font-semibold uppercase text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {costs.map((c) => (
                  <tr key={c.id} className="border-b border-border/10 hover:bg-muted/20">
                    <td className="py-2 px-3 text-muted-foreground">
                      {new Date(c.recordedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}
                    </td>
                    <td className="py-2 px-3">
                      <span>{c.description || "—"}</span>
                      {c.vendorName && <span className="text-muted-foreground ml-1">· {c.vendorName}</span>}
                    </td>
                    <td className="py-2 px-3">
                      <Badge variant="outline" className="text-[9px]">{c.category || "OTHER"}</Badge>
                    </td>
                    <td className="py-2 px-3">
                      <Badge
                        variant={c.entryType === "ACTUAL" ? "default" : "secondary"}
                        className="text-[9px]"
                      >
                        {c.entryType}
                      </Badge>
                    </td>
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
