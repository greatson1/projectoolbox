"use client";
// @ts-nocheck

import { useState, useMemo, useRef, useEffect, useCallback } from "react";

import { useParams } from "next/navigation";
import { useProject } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

/**
 * EVM Dashboard — Earned Value Management with S-curve, gauges, variance, forecasting.
 */

import { ComposedChart, Line, Area, Bar, BarChart, LineChart, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Legend, Cell } from "recharts";


// ================================================================
// DATA — £2.45M construction project, 18 months
// ================================================================

const BAC = 2450000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan'27", "Feb", "Mar", "Apr", "May", "Jun"];

const S_CURVE = MONTHS.map((m, i) => {
  const pct = (i + 1) / 18;
  const sPct = 3 * pct * pct - 2 * pct * pct * pct; // S-curve formula
  const pvVal = Math.round(BAC * sPct);
  // Deterministic variation using sin (no Math.random — prevents hydration mismatch)
  const evFactor = i < 10 ? 0.92 + Math.abs(Math.sin(i * 3.7)) * 0.06 : 0.85 + Math.abs(Math.sin(i * 2.3)) * 0.05;
  const acFactor = i < 10 ? 1.0 + Math.abs(Math.sin(i * 5.1)) * 0.08 : 1.05 + Math.abs(Math.sin(i * 4.2)) * 0.1;
  const evVal = Math.round(pvVal * evFactor);
  const acVal = Math.round(evVal * acFactor);
  return {
    month: m,
    PV: i <= 9 ? pvVal : null,
    EV: i <= 9 ? evVal : null,
    AC: i <= 9 ? acVal : null,
    pvFull: pvVal,
    eacProj: i >= 9 ? Math.round(pvVal * 1.12) : null,
  };
});

// Current period values (month 10 = October)
const currentPV = S_CURVE[9].PV!;
const currentEV = S_CURVE[9].EV!;
const currentAC = S_CURVE[9].AC!;
const SV = currentEV - currentPV;
const CV = currentEV - currentAC;
const SPI = +(currentEV / currentPV).toFixed(2);
const CPI = +(currentEV / currentAC).toFixed(2);
const EAC = Math.round(BAC / CPI);
const ETC = EAC - currentAC;
const VAC = BAC - EAC;
const TCPI = +((BAC - currentEV) / (BAC - currentAC)).toFixed(2);

const WORK_PACKAGES = [
  { name: "Foundation", bac: 380000, pv: 380000, ev: 365000, ac: 392000 },
  { name: "Steel Structure", bac: 520000, pv: 480000, ev: 445000, ac: 468000 },
  { name: "MEP Systems", bac: 410000, pv: 280000, ev: 255000, ac: 278000 },
  { name: "Facade", bac: 350000, pv: 120000, ev: 108000, ac: 115000 },
  { name: "Interior Fit-out", bac: 480000, pv: 40000, ev: 32000, ac: 38000 },
  { name: "Commissioning", bac: 310000, pv: 0, ev: 0, ac: 0 },
];

const VARIANCE_DATA = WORK_PACKAGES.filter((wp) => wp.pv > 0).map((wp) => ({
  name: wp.name.length > 10 ? wp.name.slice(0, 10) + "…" : wp.name,
  SV: Math.round((wp.ev - wp.pv) / 1000),
  CV: Math.round((wp.ev - wp.ac) / 1000),
}));

const EAC_TREND = [
  { period: "P5", eac: 2520 }, { period: "P6", eac: 2560 },
  { period: "P7", eac: 2590 }, { period: "P8", eac: 2620 },
  { period: "P9", eac: 2650 }, { period: "P10", eac: Math.round(EAC / 1000) },
];

const SCENARIOS = [
  { label: "Optimistic", value: Math.round(EAC * 0.95), desc: "CPI improves to 0.98 for remaining work", color: "success" as const },
  { label: "Most Likely", value: EAC, desc: "Current CPI continues for remaining work", color: "warning" as const },
  { label: "Pessimistic", value: Math.round(EAC * 1.08), desc: "CPI degrades to 0.82 due to winter weather delays", color: "danger" as const },
];

// ================================================================
// HELPERS
// ================================================================

function fmt(v: number): string {
  if (Math.abs(v) >= 1000000) return `£${(v / 1000000).toFixed(2)}M`;
  if (Math.abs(v) >= 1000) return `£${(v / 1000).toFixed(0)}K`;
  return `£${v.toLocaleString()}`;
}

function evmColor(metric: string, value: number): string {
  if (metric === "SPI" || metric === "CPI") return value >= 1.0 ? "#10B981" : value >= 0.9 ? "#F59E0B" : "#EF4444";
  if (metric === "SV" || metric === "CV" || metric === "VAC") return value >= 0 ? "#10B981" : value >= -50000 ? "#F59E0B" : "#EF4444";
  if (metric === "TCPI") return value <= 1.05 ? "#10B981" : value <= 1.15 ? "#F59E0B" : "#EF4444";
  return "var(--foreground)";
}

// ================================================================
// GAUGE COMPONENT
// ================================================================

function Gauge({ value, label, min = 0, max = 1.5}: { value: number; label: string; min?: number; max?: number;  }) {
  const pct = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const angle = pct * 180;
  const color = value >= 1.0 ? "#10B981" : value >= 0.9 ? "#F59E0B" : "#EF4444";

  return (
    <div className="text-center">
      <div className="relative w-[140px] h-[80px] mx-auto overflow-hidden">
        <svg viewBox="0 0 140 80" className="w-full h-full">
          {/* Background arc */}
          <path d="M 10 75 A 60 60 0 0 1 130 75" fill="none" stroke={"var(--border)"} strokeWidth="10" strokeLinecap="round" />
          {/* Red zone */}
          <path d="M 10 75 A 60 60 0 0 1 46 22" fill="none" stroke={"#EF4444"} strokeWidth="10" strokeLinecap="round" opacity="0.2" />
          {/* Amber zone */}
          <path d="M 46 22 A 60 60 0 0 1 70 15" fill="none" stroke={"#F59E0B"} strokeWidth="10" strokeLinecap="round" opacity="0.2" />
          {/* Green zone */}
          <path d="M 70 15 A 60 60 0 0 1 130 75" fill="none" stroke={"#10B981"} strokeWidth="10" strokeLinecap="round" opacity="0.2" />
          {/* Needle */}
          <line x1="70" y1="75" x2={70 + 50 * Math.cos(Math.PI - (angle * Math.PI) / 180)} y2={75 - 50 * Math.sin(Math.PI - (angle * Math.PI) / 180)}
            stroke={color} strokeWidth="3" strokeLinecap="round" />
          <circle cx="70" cy="75" r="5" fill={color} />
        </svg>
      </div>
      <p className="text-[24px] font-bold mt-1" style={{ color }}>{value.toFixed(2)}</p>
      <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{label}</p>
    </div>
  );
}

// ================================================================
// COMPONENT
// ================================================================

export default function EVMDashboardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: apiProject } = useProject(projectId);

  // Use project budget from API when available, fall back to mock BAC
  const projectBudget = (apiProject && apiProject.budget) ? apiProject.budget : BAC;

  const mode = "dark";

  const metrics = [
    { label: "BAC", value: fmt(BAC), sub: "Budget at Completion", color: "var(--foreground)" },
    { label: "PV", value: fmt(currentPV), sub: "Planned Value", color: "var(--primary)" },
    { label: "EV", value: fmt(currentEV), sub: "Earned Value", color: "#10B981" },
    { label: "AC", value: fmt(currentAC), sub: "Actual Cost", color: "#EF4444" },
    { label: "SV", value: fmt(SV), sub: "Schedule Variance", color: evmColor("SV", SV), trend: SV >= 0 ? "up" as const : "down" as const },
    { label: "CV", value: fmt(CV), sub: "Cost Variance", color: evmColor("CV", CV), trend: CV >= 0 ? "up" as const : "down" as const },
    { label: "SPI", value: SPI.toFixed(2), sub: "Schedule Performance", color: evmColor("SPI", SPI), trend: SPI >= 1 ? "up" as const : "down" as const },
    { label: "CPI", value: CPI.toFixed(2), sub: "Cost Performance", color: evmColor("CPI", CPI), trend: CPI >= 1 ? "up" as const : "down" as const },
    { label: "EAC", value: fmt(EAC), sub: "Estimate at Completion", color: evmColor("CV", VAC) },
    { label: "ETC", value: fmt(ETC), sub: "Estimate to Complete", color: "var(--muted-foreground)" },
    { label: "VAC", value: fmt(VAC), sub: "Variance at Completion", color: evmColor("VAC", VAC) },
    { label: "TCPI", value: TCPI.toFixed(2), sub: "To-Complete Performance", color: evmColor("TCPI", TCPI) },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-[24px] font-bold" style={{ color: "var(--foreground)" }}>Earned Value Management</h1>
        <div className="flex gap-2">
          <select className="px-3 py-1.5 rounded-[8px] text-[12px]" style={{ backgroundColor: "var(--card)", border: `1px solid ${"var(--border)"}`, color: "var(--foreground)" }}>
            <option>Office Renovation Phase 2</option><option>CRM Migration</option>
          </select>
          <select className="px-3 py-1.5 rounded-[8px] text-[12px]" style={{ backgroundColor: "var(--card)", border: `1px solid ${"var(--border)"}`, color: "var(--foreground)" }}>
            <option>Period 10 (Oct 2026)</option><option>Period 9</option>
          </select>
        </div>
      </div>

      {/* Metrics cards */}
      <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
        {metrics.map((m) => (
          <div key={m.label} className="p-3 rounded-[10px]" style={{ backgroundColor: "var(--card)", border: `1px solid ${"var(--border)"}` }}>
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{m.label}</p>
            <div className="flex items-center gap-1 mt-1">
              <p className="text-[16px] font-bold" style={{ color: m.color }}>{m.value}</p>
              {(m as any).trend && <span className="text-[10px]" style={{ color: m.color }}>{(m as any).trend === "up" ? "↑" : "↓"}</span>}
            </div>
            <p className="text-[9px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>{m.sub}</p>
          </div>
        ))}
      </div>

      {/* S-Curve + Gauges */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-5 items-start">
        <div className="xl:col-span-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">S-Curve — Cumulative Performance</CardTitle></CardHeader><CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={S_CURVE} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
                <defs>
                  <linearGradient id="cvArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={"#EF4444"} stopOpacity={0.1} />
                    <stop offset="95%" stopColor={"#EF4444"} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={"var(--border)"} strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => v >= 1000000 ? `£${(v / 1000000).toFixed(1)}M` : `£${(v / 1000).toFixed(0)}K`} />
                <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: `1px solid ${"var(--border)"}`, borderRadius: 10, color: "var(--foreground)", fontSize: 11 }}
                  formatter={(v: number) => [v ? fmt(v) : "—"]} />
                <ReferenceLine y={BAC} stroke={"var(--muted-foreground)"} strokeDasharray="8 4" label={{ value: `BAC ${fmt(BAC)}`, fill: "var(--muted-foreground)", fontSize: 10, position: "right" }} />
                {/* Full PV line (planned) */}
                <Line type="monotone" dataKey="pvFull" stroke={"var(--primary)"} strokeWidth={1.5} strokeDasharray="6 3" dot={false} name="Planned (full)" />
                {/* Actual lines */}
                <Line type="monotone" dataKey="PV" stroke={"var(--primary)"} strokeWidth={2} dot={{ r: 3, fill: "var(--primary)" }} name="PV" connectNulls={false} />
                <Line type="monotone" dataKey="EV" stroke={"#10B981"} strokeWidth={2.5} dot={{ r: 3, fill: "#10B981" }} name="EV" connectNulls={false} />
                <Line type="monotone" dataKey="AC" stroke={"#EF4444"} strokeWidth={2} dot={{ r: 3, fill: "#EF4444" }} name="AC" connectNulls={false} />
                {/* EAC projection */}
                <Line type="monotone" dataKey="eacProj" stroke={"#F59E0B"} strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="EAC Projection" connectNulls={false} />
                <Legend wrapperStyle={{ fontSize: 10, color: "var(--muted-foreground)" }} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent></Card>
        </div>

        {/* Gauges */}
        <div className="space-y-4">
          <Card>
            <Gauge value={SPI} label="Schedule Performance (SPI)" />
          </Card>
          <Card>
            <Gauge value={CPI} label="Cost Performance (CPI)" />
          </Card>
          {/* TCPI bar */}
          <Card>
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted-foreground)" }}>TCPI Analysis</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span style={{ color: "var(--muted-foreground)" }}>Current CPI</span>
                <span className="font-bold" style={{ color: evmColor("CPI", CPI) }}>{CPI}</span>
              </div>
              <div className="h-3 rounded-full overflow-hidden flex" style={{ backgroundColor: "var(--border)" }}>
                <div style={{ width: `${(CPI / 1.5) * 100}%`, backgroundColor: evmColor("CPI", CPI) }} className="rounded-full" />
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span style={{ color: "var(--muted-foreground)" }}>Required TCPI</span>
                <span className="font-bold" style={{ color: evmColor("TCPI", TCPI) }}>{TCPI}</span>
              </div>
              <div className="h-3 rounded-full overflow-hidden flex" style={{ backgroundColor: "var(--border)" }}>
                <div style={{ width: `${(TCPI / 1.5) * 100}%`, backgroundColor: evmColor("TCPI", TCPI) }} className="rounded-full" />
              </div>
              <p className="text-[10px] p-2 rounded-[6px]" style={{ backgroundColor: "rgba(245,158,11,0.12)", color: "#F59E0B" }}>
                Team must perform at {TCPI}x efficiency (vs current {CPI}x) to finish within budget — {Math.round(((TCPI / CPI) - 1) * 100)}% improvement needed.
              </p>
            </div>
          </Card>
        </div>
      </div>

      {/* Variance + Forecasting */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Variance */}
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Variance by Work Package (£K)</CardTitle></CardHeader><CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={VARIANCE_DATA} barGap={2}>
              <CartesianGrid stroke={"var(--border)"} strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `£${v}K`} />
              <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: `1px solid ${"var(--border)"}`, borderRadius: 10, color: "var(--foreground)", fontSize: 11 }} formatter={(v: number) => [`£${v}K`]} />
              <ReferenceLine y={0} stroke={"var(--muted-foreground)"} />
              <Bar dataKey="SV" name="Schedule Variance" radius={[3, 3, 0, 0]}>
                {VARIANCE_DATA.map((e, i) => <Cell key={i} fill={e.SV >= 0 ? "#10B981" : "#EF4444"} opacity={0.7} />)}
              </Bar>
              <Bar dataKey="CV" name="Cost Variance" radius={[3, 3, 0, 0]}>
                {VARIANCE_DATA.map((e, i) => <Cell key={i} fill={e.CV >= 0 ? "#10B981" : "#EF4444"} />)}
              </Bar>
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent></Card>

        {/* Forecasting */}
        <div className="space-y-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm">EAC Trend</CardTitle></CardHeader><CardContent>
            <ResponsiveContainer width="100%" height={130}>
              <LineChart data={EAC_TREND}>
                <CartesianGrid stroke={"var(--border)"} strokeDasharray="3 3" />
                <XAxis dataKey="period" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis domain={["dataMin - 30", "dataMax + 30"]} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `£${v}K`} />
                <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: `1px solid ${"var(--border)"}`, borderRadius: 10, color: "var(--foreground)", fontSize: 11 }} formatter={(v: number) => [`£${v}K`]} />
                <ReferenceLine y={BAC / 1000} stroke={"#10B981"} strokeDasharray="4 4" label={{ value: "BAC", fill: "var(--muted-foreground)", fontSize: 9 }} />
                <Line type="monotone" dataKey="eac" stroke={"#F59E0B"} strokeWidth={2} dot={{ r: 4, fill: "#F59E0B" }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent></Card>
          <div className="grid grid-cols-3 gap-2">
            {SCENARIOS.map((s) => (
              <div key={s.label} className="p-3 rounded-[10px] text-center" style={{ backgroundColor: "rgba(99,102,241,0.08)", border: `1px solid ${"var(--border)"}` }}>
                <p className="text-[10px] font-semibold uppercase" style={{ color: "var(--primary)" }}>{s.label}</p>
                <p className="text-[16px] font-bold mt-1" style={{ color: "var(--primary)" }}>{fmt(s.value)}</p>
                <p className="text-[9px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>{s.desc}</p>
              </div>
            ))}
          </div>
          {/* AI narrative */}
          <div className="p-3 rounded-[10px]" style={{ backgroundColor: "rgba(99,102,241,0.12)", border: `1px solid rgba(99,102,241,0.15)` }}>
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--primary)" }}>AI Forecast Analysis</p>
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--foreground)" }}>
              EAC trending upward over 6 periods from £2.52M to {fmt(EAC)}. Primary driver: MEP installation running 8% over estimate due to material price escalation. Steel Structure work package also showing £23K cost overrun. Recommend: (1) Negotiate fixed-price MEP sub-contract for remaining phases. (2) Review Interior Fit-out estimates before work begins to avoid further variance. (3) Current TCPI of {TCPI} requires {Math.round(((TCPI / CPI) - 1) * 100)}% efficiency improvement — achievable if MEP issues are contained.
            </p>
          </div>
        </div>
      </div>

      {/* Data table */}
      <Card><CardHeader className="pb-2"><CardTitle className="text-sm">EVM Data by Work Package</CardTitle></CardHeader><CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr style={{ borderBottom: `1px solid ${"var(--border)"}` }}>
                {["WBS", "Work Package", "BAC", "PV", "EV", "AC", "SV", "CV", "SPI", "CPI"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left text-[9px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted-foreground)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WORK_PACKAGES.map((wp, i) => {
                const sv = wp.ev - wp.pv; const cv = wp.ev - wp.ac;
                const spi = wp.pv > 0 ? +(wp.ev / wp.pv).toFixed(2) : 0;
                const cpi = wp.ac > 0 ? +(wp.ev / wp.ac).toFixed(2) : 0;
                return (
                  <tr key={i} style={{ borderBottom: `1px solid ${"var(--border)"}` }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = true ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.01)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}>
                    <td className="px-3 py-2 font-mono" style={{ color: "var(--muted-foreground)" }}>{`1.${i + 1}`}</td>
                    <td className="px-3 py-2 font-medium" style={{ color: "var(--foreground)" }}>{wp.name}</td>
                    <td className="px-3 py-2" style={{ color: "var(--muted-foreground)" }}>{fmt(wp.bac)}</td>
                    <td className="px-3 py-2" style={{ color: "var(--primary)" }}>{fmt(wp.pv)}</td>
                    <td className="px-3 py-2" style={{ color: "#10B981" }}>{fmt(wp.ev)}</td>
                    <td className="px-3 py-2" style={{ color: "#EF4444" }}>{fmt(wp.ac)}</td>
                    <td className="px-3 py-2 font-medium" style={{ color: sv >= 0 ? "#10B981" : "#EF4444" }}>{fmt(sv)}</td>
                    <td className="px-3 py-2 font-medium" style={{ color: cv >= 0 ? "#10B981" : "#EF4444" }}>{fmt(cv)}</td>
                    <td className="px-3 py-2 font-bold" style={{ color: wp.pv > 0 ? evmColor("SPI", spi) : "var(--muted-foreground)" }}>{wp.pv > 0 ? spi.toFixed(2) : "—"}</td>
                    <td className="px-3 py-2 font-bold" style={{ color: wp.ac > 0 ? evmColor("CPI", cpi) : "var(--muted-foreground)" }}>{wp.ac > 0 ? cpi.toFixed(2) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent></Card>
    </div>
  );
}
