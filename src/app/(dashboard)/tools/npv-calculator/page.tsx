"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calculator, TrendingUp, RotateCcw } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";

interface CashFlow {
  year: number;
  amount: number;
}

const initialFlows: CashFlow[] = [
  { year: 0, amount: -250000 },
  { year: 1, amount: 60000 },
  { year: 2, amount: 80000 },
  { year: 3, amount: 95000 },
  { year: 4, amount: 85000 },
  { year: 5, amount: 70000 },
];

function calcNPV(flows: CashFlow[], rate: number): number {
  return flows.reduce((npv, cf) => npv + cf.amount / Math.pow(1 + rate / 100, cf.year), 0);
}

function calcIRR(flows: CashFlow[]): number | null {
  let low = -50, high = 200;
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    const npv = calcNPV(flows, mid);
    if (Math.abs(npv) < 0.01) return mid;
    if (npv > 0) low = mid;
    else high = mid;
  }
  const result = (low + high) / 2;
  return Math.abs(calcNPV(flows, result)) < 1000 ? result : null;
}

function calcPayback(flows: CashFlow[]): number | null {
  let cumulative = 0;
  for (const cf of flows) {
    cumulative += cf.amount;
    if (cumulative >= 0) return cf.year;
  }
  return null;
}

export default function NPVCalculatorPage() {
  const [flows, setFlows] = useState(initialFlows);
  const [discountRate, setDiscountRate] = useState(10);

  const updateAmount = (year: number, amount: number) => {
    setFlows((prev) => prev.map((f) => (f.year === year ? { ...f, amount } : f)));
  };

  const npv = calcNPV(flows, discountRate);
  const irr = calcIRR(flows);
  const payback = calcPayback(flows);
  const totalInflow = flows.filter((f) => f.amount > 0).reduce((a, b) => a + b.amount, 0);
  const totalOutflow = Math.abs(flows.filter((f) => f.amount < 0).reduce((a, b) => a + b.amount, 0));
  const roi = totalOutflow > 0 ? ((totalInflow - totalOutflow) / totalOutflow) * 100 : 0;

  const chartData = flows.map((f) => {
    const discounted = f.amount / Math.pow(1 + discountRate / 100, f.year);
    return { year: `Year ${f.year}`, nominal: f.amount, discounted: Math.round(discounted) };
  });

  const cumulativeData = flows.reduce<{ year: string; cumulative: number; discountedCum: number }[]>((acc, f) => {
    const prev = acc.length > 0 ? acc[acc.length - 1] : { cumulative: 0, discountedCum: 0 };
    const discounted = f.amount / Math.pow(1 + discountRate / 100, f.year);
    acc.push({
      year: `Year ${f.year}`,
      cumulative: Math.round(prev.cumulative + f.amount),
      discountedCum: Math.round(prev.discountedCum + discounted),
    });
    return acc;
  }, []);

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">NPV Calculator</h1>
        <Button variant="outline" size="sm" onClick={() => { setFlows(initialFlows); setDiscountRate(10); }}>
          <RotateCcw className="h-4 w-4 mr-2" />Reset
        </Button>
      </div>

      {/* Results */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Net Present Value", value: `£${Math.round(npv).toLocaleString()}`, positive: npv >= 0 },
          { label: "IRR", value: irr !== null ? `${irr.toFixed(1)}%` : "N/A", positive: irr !== null && irr > discountRate },
          { label: "Payback Period", value: payback !== null ? `${payback} years` : "N/A", positive: payback !== null },
          { label: "ROI", value: `${roi.toFixed(1)}%`, positive: roi > 0 },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Calculator className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className={`text-2xl font-bold tabular-nums ${s.positive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    {s.value}
                  </p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Cash Flow Inputs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Cash Flow Inputs</CardTitle>
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground">Discount Rate (%):</label>
              <input
                type="number" min={0} max={50} step={0.5}
                value={discountRate}
                onChange={(e) => setDiscountRate(parseFloat(e.target.value) || 0)}
                className="w-20 text-sm border rounded px-2 py-1 bg-background tabular-nums"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">Year</th>
                  <th className="py-2 pr-4 text-right">Cash Flow (£)</th>
                  <th className="py-2 pr-4 text-right">Discounted (£)</th>
                  <th className="py-2 text-right">Cumulative PV (£)</th>
                </tr>
              </thead>
              <tbody>
                {flows.map((f, i) => {
                  const discounted = f.amount / Math.pow(1 + discountRate / 100, f.year);
                  return (
                    <tr key={f.year} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">
                        {f.year === 0 ? "Year 0 (Investment)" : `Year ${f.year}`}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        <input
                          type="number" step={5000}
                          value={f.amount}
                          onChange={(e) => updateAmount(f.year, parseFloat(e.target.value) || 0)}
                          className="w-32 text-right border rounded px-2 py-1 bg-background tabular-nums"
                        />
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                        £{Math.round(discounted).toLocaleString()}
                      </td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">
                        £{cumulativeData[i]?.discountedCum.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-sm">Cash Flows: Nominal vs Discounted</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => `£${Number(v).toLocaleString()}`} />
                <Legend />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="nominal" stroke="hsl(var(--primary))" name="Nominal" strokeWidth={2} />
                <Line type="monotone" dataKey="discounted" stroke="hsl(var(--muted-foreground))" name="Discounted" strokeWidth={2} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Cumulative Cash Flow</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={cumulativeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => `£${Number(v).toLocaleString()}`} />
                <Legend />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="cumulative" stroke="hsl(var(--primary))" name="Cumulative Nominal" strokeWidth={2} />
                <Line type="monotone" dataKey="discountedCum" stroke="hsl(var(--muted-foreground))" name="Cumulative PV" strokeWidth={2} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
