"use client";

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play, RotateCcw, BarChart3, Target } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface SimParam {
  id: string;
  task: string;
  optimistic: number;
  likely: number;
  pessimistic: number;
}

const initialParams: SimParam[] = [
  { id: "1", task: "Requirements Analysis", optimistic: 10, likely: 15, pessimistic: 25 },
  { id: "2", task: "System Design", optimistic: 15, likely: 20, pessimistic: 35 },
  { id: "3", task: "Development", optimistic: 30, likely: 45, pessimistic: 70 },
  { id: "4", task: "Testing", optimistic: 10, likely: 18, pessimistic: 30 },
  { id: "5", task: "Deployment", optimistic: 3, likely: 5, pessimistic: 12 },
];

function triangularRandom(a: number, b: number, c: number): number {
  const u = Math.random();
  const fc = (b - a) / (c - a);
  if (u < fc) return a + Math.sqrt(u * (c - a) * (b - a));
  return c - Math.sqrt((1 - u) * (c - a) * (c - b));
}

function buildHistogram(results: number[], bins: number) {
  const min = Math.min(...results);
  const max = Math.max(...results);
  const binWidth = (max - min) / bins;
  const histogram = Array.from({ length: bins }, (_, i) => ({
    range: `${Math.round(min + i * binWidth)}-${Math.round(min + (i + 1) * binWidth)}`,
    midpoint: Math.round(min + (i + 0.5) * binWidth),
    count: 0,
  }));
  results.forEach((v) => {
    const idx = Math.min(Math.floor((v - min) / binWidth), bins - 1);
    histogram[idx].count++;
  });
  return histogram;
}

export default function MonteCarloPage() {
  const [params, setParams] = useState(initialParams);
  const [iterations, setIterations] = useState(1000);
  const [results, setResults] = useState<number[] | null>(null);

  const updateParam = (id: string, field: keyof SimParam, value: number) => {
    setParams((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const runSimulation = useCallback(() => {
    const sims: number[] = [];
    for (let i = 0; i < iterations; i++) {
      let total = 0;
      for (const p of params) {
        total += triangularRandom(p.optimistic, p.likely, p.pessimistic);
      }
      sims.push(Math.round(total));
    }
    sims.sort((a, b) => a - b);
    setResults(sims);
  }, [params, iterations]);

  const mean = results ? Math.round(results.reduce((a, b) => a + b, 0) / results.length) : 0;
  const p10 = results ? results[Math.floor(results.length * 0.1)] : 0;
  const p50 = results ? results[Math.floor(results.length * 0.5)] : 0;
  const p75 = results ? results[Math.floor(results.length * 0.75)] : 0;
  const p90 = results ? results[Math.floor(results.length * 0.9)] : 0;
  const histogram = results ? buildHistogram(results, 15) : [];

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Monte Carlo Simulation</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">Iterations:</label>
          <select
            value={iterations}
            onChange={(e) => setIterations(Number(e.target.value))}
            className="border rounded px-2 py-1 text-sm bg-background"
          >
            <option value={500}>500</option>
            <option value={1000}>1,000</option>
            <option value={5000}>5,000</option>
            <option value={10000}>10,000</option>
          </select>
          <Button size="sm" onClick={runSimulation}><Play className="h-4 w-4 mr-2" />Run</Button>
          <Button variant="outline" size="sm" onClick={() => { setResults(null); setParams(initialParams); }}>
            <RotateCcw className="h-4 w-4 mr-2" />Reset
          </Button>
        </div>
      </div>

      {/* Input Parameters */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Input Parameters (days)</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">Task</th>
                  <th className="py-2 pr-4 text-right">Optimistic</th>
                  <th className="py-2 pr-4 text-right">Most Likely</th>
                  <th className="py-2 text-right">Pessimistic</th>
                </tr>
              </thead>
              <tbody>
                {params.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{p.task}</td>
                    <td className="py-2 pr-4 text-right">
                      <input type="number" value={p.optimistic} onChange={(e) => updateParam(p.id, "optimistic", +e.target.value)}
                        className="w-16 text-right border rounded px-2 py-1 bg-background tabular-nums" />
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <input type="number" value={p.likely} onChange={(e) => updateParam(p.id, "likely", +e.target.value)}
                        className="w-16 text-right border rounded px-2 py-1 bg-background tabular-nums" />
                    </td>
                    <td className="py-2 text-right">
                      <input type="number" value={p.pessimistic} onChange={(e) => updateParam(p.id, "pessimistic", +e.target.value)}
                        className="w-16 text-right border rounded px-2 py-1 bg-background tabular-nums" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {results && (
        <>
          {/* Confidence Levels */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: "P10 (Optimistic)", value: `${p10} days` },
              { label: "P50 (Median)", value: `${p50} days` },
              { label: "P75", value: `${p75} days` },
              { label: "P90 (Conservative)", value: `${p90} days` },
              { label: "Mean", value: `${mean} days` },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="pt-6">
                  <p className="text-2xl font-bold tabular-nums">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Histogram */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Distribution ({iterations.toLocaleString()} iterations)</CardTitle>
                <Badge variant="secondary">{results.length} samples</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={histogram}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="range" fontSize={10} angle={-30} textAnchor="end" height={60} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--primary))" name="Frequency" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}

      {!results && (
        <Card>
          <CardContent className="py-12 text-center">
            <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">Configure parameters above and click <strong>Run</strong> to generate simulation results.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
