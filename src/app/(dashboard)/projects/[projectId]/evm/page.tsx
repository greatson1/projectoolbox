"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

// ─── Theme tokens ────────────────────────────────────────────────────────────
const T = {
  bg:      "#0B0F1A",
  card:    "#151D2E",
  border:  "#1E293B",
  text:    "#F1F5F9",
  muted:   "#94A3B8",
  primary: "#6366F1",
  success: "#34D399",
  warning: "#FBBF24",
  danger:  "#F87171",
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────
interface SCurvePoint {
  month: string;
  pv:   number;
  ev:   number | null;
  ac:   number | null;
  eac:  number | null;
}

interface EVMData {
  budget:   number;
  pv:       number;
  ev:       number;
  ac:       number;
  spi:      number;
  cpi:      number;
  eac:      number;
  etc:      number;
  vac:      number;
  tcpi:     number;
  ragStatus?: "GREEN" | "AMBER" | "RED";
  tasksTotal?:    number;
  tasksComplete?: number;
  tasksOverdue?:  number;
  sCurve?: SCurvePoint[];
  forecastEndDate?:       string | null;
  onBudgetProbability?:   number | null;
  risksOpen?:             number | null;
  risksCritical?:         number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(v)) return "N/A";
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}£${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}£${(abs / 1_000).toFixed(0)}K`;
  return `${sign}£${abs.toLocaleString("en-GB")}`;
}

function fmtRatio(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(v)) return "N/A";
  return v.toFixed(2);
}

function indexColor(metric: "SPI" | "CPI", v: number): string {
  if (v >= 1.0) return T.success;
  if (v >= 0.9) return T.warning;
  return T.danger;
}

function varianceColor(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(v)) return T.muted;
  if (v >= 0) return T.success;
  return T.danger;
}

function tcpiColor(v: number): string {
  if (v <= 1.05) return T.success;
  if (v <= 1.15) return T.warning;
  return T.danger;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton({ w = "100%", h = 20, radius = 6 }: { w?: string | number; h?: number; radius?: number }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: radius,
        background: `linear-gradient(90deg, ${T.card} 25%, #1E293B 50%, ${T.card} 75%)`,
        backgroundSize: "400% 100%",
        animation: "shimmer 1.4s ease-in-out infinite",
      }}
    />
  );
}

function LoadingSkeleton() {
  return (
    <div style={{ backgroundColor: T.bg, minHeight: "100vh", padding: "24px", color: T.text }}>
      <style>{`@keyframes shimmer { 0%{background-position:100% 50%} 100%{background-position:0% 50%} }`}</style>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
        <Skeleton w={260} h={28} />
        <Skeleton w={120} h={28} />
      </div>
      {/* Row 1 — 4 cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 12 }}>
        {[...Array(4)].map((_, i) => <Skeleton key={i} h={88} radius={10} />)}
      </div>
      {/* Row 2 — 2 cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, marginBottom: 12 }}>
        {[...Array(2)].map((_, i) => <Skeleton key={i} h={88} radius={10} />)}
      </div>
      {/* Row 3 — 2 cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, marginBottom: 12 }}>
        {[...Array(2)].map((_, i) => <Skeleton key={i} h={88} radius={10} />)}
      </div>
      {/* Row 4 — 4 cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 }}>
        {[...Array(4)].map((_, i) => <Skeleton key={i} h={88} radius={10} />)}
      </div>
      {/* Chart */}
      <Skeleton h={340} radius={12} />
    </div>
  );
}

// ─── Metric Card ──────────────────────────────────────────────────────────────
interface MetricCardProps {
  label:    string;
  value:    string;
  sub:      string;
  color:    string;
  trend?:   "up" | "down" | null;
  badge?:   string;
  badgeColor?: string;
}

function MetricCard({ label, value, sub, color, trend, badge, badgeColor }: MetricCardProps) {
  return (
    <div
      style={{
        backgroundColor: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: T.muted, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {label}
        </span>
        {badge && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 4,
              backgroundColor: `${badgeColor ?? color}22`,
              color: badgeColor ?? color,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {badge}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ color, fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>{value}</span>
        {trend && (
          <span style={{ color, fontSize: 12, fontWeight: 600 }}>{trend === "up" ? "▲" : "▼"}</span>
        )}
      </div>
      <span style={{ color: T.muted, fontSize: 10, marginTop: 1 }}>{sub}</span>
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        color: T.muted,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        marginBottom: 8,
      }}
    >
      {children}
    </h2>
  );
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        backgroundColor: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 11,
        color: T.text,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      <p style={{ color: T.muted, marginBottom: 6, fontWeight: 600 }}>{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 3 }}>
          <span style={{ color: p.color }}>{p.name}</span>
          <span style={{ fontWeight: 700 }}>{p.value !== null ? fmt(p.value) : "—"}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Scenario Card ────────────────────────────────────────────────────────────
interface ScenarioProps {
  label:      string;
  value:      string;
  desc:       string;
  accentColor: string;
  eac:        number | null | undefined;
  bac:        number | null | undefined;
}

function ScenarioCard({ label, value, desc, accentColor, eac, bac }: ScenarioProps) {
  const overrun = eac !== null && eac !== undefined && bac !== null && bac !== undefined && !isNaN(eac) && !isNaN(bac)
    ? eac - bac
    : null;
  return (
    <div
      style={{
        backgroundColor: T.card,
        border: `1px solid ${accentColor}44`,
        borderRadius: 10,
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: accentColor, flexShrink: 0 }} />
        <span style={{ color: accentColor, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>
          {label}
        </span>
      </div>
      <span style={{ color: T.text, fontSize: 22, fontWeight: 800 }}>{value}</span>
      {overrun !== null && (
        <span style={{ fontSize: 11, color: overrun > 0 ? T.danger : T.success, fontWeight: 600 }}>
          {overrun > 0 ? `+${fmt(overrun)} over budget` : `${fmt(Math.abs(overrun))} under budget`}
        </span>
      )}
      <p style={{ color: T.muted, fontSize: 11, lineHeight: 1.5, marginTop: 2 }}>{desc}</p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function EVMDashboardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [data, setData]       = useState<EVMData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/projects/${projectId}/evm`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        setData(json?.data ?? null);
      })
      .catch((e) => setError(e.message ?? "Failed to load EVM data"))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return <LoadingSkeleton />;

  if (error || !data) {
    return (
      <div
        style={{
          backgroundColor: T.bg,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: T.text,
          gap: 12,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            backgroundColor: `${T.danger}22`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
          }}
        >
          ⚠
        </div>
        <p style={{ fontSize: 16, fontWeight: 600 }}>Unable to load EVM data</p>
        <p style={{ color: T.muted, fontSize: 13 }}>{error ?? "No data returned for this project"}</p>
      </div>
    );
  }

  // ── Derived values ──────────────────────────────────────────────────────────
  const bac  = data.budget  ?? null;
  const pv   = data.pv      ?? null;
  const ev   = data.ev      ?? null;
  const ac   = data.ac      ?? null;
  const spi  = data.spi     ?? null;
  const cpi  = data.cpi     ?? null;
  const eac  = data.eac     ?? null;
  const etc  = data.etc     ?? null;
  const vac  = data.vac     ?? null;
  const tcpi = data.tcpi    ?? null;

  const sv = ev !== null && pv !== null ? ev - pv : null;
  const cv = ev !== null && ac !== null ? ev - ac : null;

  // Forecast scenarios
  const optimisticEac  = eac !== null ? Math.round(eac * 0.95)  : null;
  const pessimisticEac = eac !== null ? Math.round(eac * 1.08) : null;

  const cpiNum  = cpi  ?? 1;
  const tcpiNum = tcpi ?? 1;

  const percentComplete = bac && ev ? Math.round((ev / bac) * 100) : null;
  const taskPct = data.tasksTotal && data.tasksTotal > 0
    ? Math.round(((data.tasksComplete ?? 0) / data.tasksTotal) * 100)
    : null;

  // ── S-Curve data ─────────────────────────────────────────────────────────────
  const sCurveData = data.sCurve ?? [];

  // Confidence band: extrapolate from last known AC to optimistic/pessimistic EAC
  const enrichedSCurve = useMemo(() => {
    if (!sCurveData.length || eac === null || optimisticEac === null || pessimisticEac === null) return sCurveData;
    const lastAcIdx = sCurveData.reduce((best: number, d: any, i: number) => ((d.ac ?? 0) > 0 ? i : best), -1);
    if (lastAcIdx < 0 || lastAcIdx >= sCurveData.length - 1) return sCurveData;
    const lastAc: number = sCurveData[lastAcIdx].ac ?? 0;
    const remaining = sCurveData.length - 1 - lastAcIdx;
    return sCurveData.map((d: any, i: number) => {
      if (i <= lastAcIdx) return d;
      const t = (i - lastAcIdx) / Math.max(remaining, 1);
      return { ...d, eacLow: Math.round(lastAc + (optimisticEac - lastAc) * t), eacHigh: Math.round(lastAc + (pessimisticEac - lastAc) * t) };
    });
  }, [sCurveData, eac, optimisticEac, pessimisticEac]);

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        backgroundColor: T.bg,
        minHeight: "100vh",
        padding: "24px",
        color: T.text,
        fontFamily: "inherit",
      }}
    >
      <style>{`
        @keyframes shimmer {
          0%   { background-position: 100% 50%; }
          100% { background-position:   0% 50%; }
        }
        * { box-sizing: border-box; }
      `}</style>

      {/* ── Page Header ────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 28,
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: T.text, margin: 0 }}>
            Earned Value Management
          </h1>
          <p style={{ color: T.muted, fontSize: 13, marginTop: 4 }}>
            Performance metrics, S-curve analysis, and completion forecasts
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {/* RAG pill */}
          {data.ragStatus && (
            <div
              style={{
                padding: "4px 12px",
                borderRadius: 20,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                backgroundColor:
                  data.ragStatus === "GREEN" ? `${T.success}22` :
                  data.ragStatus === "AMBER" ? `${T.warning}22` : `${T.danger}22`,
                color:
                  data.ragStatus === "GREEN" ? T.success :
                  data.ragStatus === "AMBER" ? T.warning  : T.danger,
                border: `1px solid ${
                  data.ragStatus === "GREEN" ? `${T.success}44` :
                  data.ragStatus === "AMBER" ? `${T.warning}44` : `${T.danger}44`
                }`,
              }}
            >
              {data.ragStatus === "GREEN" ? "● On Track" : data.ragStatus === "AMBER" ? "● At Risk" : "● Critical"}
            </div>
          )}

          {/* Task progress pill */}
          {taskPct !== null && (
            <div
              style={{
                padding: "4px 12px",
                borderRadius: 20,
                fontSize: 11,
                fontWeight: 600,
                backgroundColor: `${T.primary}22`,
                color: T.primary,
                border: `1px solid ${T.primary}44`,
              }}
            >
              {data.tasksComplete ?? 0} / {data.tasksTotal ?? 0} tasks complete
            </div>
          )}

          {/* Overdue tasks */}
          {(data.tasksOverdue ?? 0) > 0 && (
            <div
              style={{
                padding: "4px 12px",
                borderRadius: 20,
                fontSize: 11,
                fontWeight: 600,
                backgroundColor: `${T.danger}22`,
                color: T.danger,
                border: `1px solid ${T.danger}44`,
              }}
            >
              {data.tasksOverdue} overdue
            </div>
          )}
        </div>
      </div>

      {/* ── Row 1: BAC · PV · EV · AC ──────────────────────────────────────── */}
      <SectionLabel>Budget Baseline</SectionLabel>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10,
          marginBottom: 20,
        }}
      >
        <MetricCard
          label="BAC"
          value={fmt(bac)}
          sub="Budget at Completion"
          color={T.text}
          badge={percentComplete !== null ? `${percentComplete}% earned` : undefined}
          badgeColor={T.primary}
        />
        <MetricCard
          label="PV"
          value={fmt(pv)}
          sub="Planned Value"
          color={T.primary}
        />
        <MetricCard
          label="EV"
          value={fmt(ev)}
          sub="Earned Value"
          color={T.success}
        />
        <MetricCard
          label="AC"
          value={fmt(ac)}
          sub="Actual Cost"
          color={cv !== null && cv >= 0 ? T.success : T.danger}
        />
      </div>

      {/* ── Row 2: SV · CV ─────────────────────────────────────────────────── */}
      <SectionLabel>Variance</SectionLabel>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 10,
          marginBottom: 20,
        }}
      >
        <MetricCard
          label="SV"
          value={fmt(sv)}
          sub="Schedule Variance (EV − PV)"
          color={varianceColor(sv)}
          trend={sv !== null ? (sv >= 0 ? "up" : "down") : null}
          badge={sv !== null ? (sv >= 0 ? "Ahead" : "Behind") : undefined}
          badgeColor={varianceColor(sv)}
        />
        <MetricCard
          label="CV"
          value={fmt(cv)}
          sub="Cost Variance (EV − AC)"
          color={varianceColor(cv)}
          trend={cv !== null ? (cv >= 0 ? "up" : "down") : null}
          badge={cv !== null ? (cv >= 0 ? "Under Budget" : "Over Budget") : undefined}
          badgeColor={varianceColor(cv)}
        />
      </div>

      {/* ── Row 3: SPI · CPI ───────────────────────────────────────────────── */}
      <SectionLabel>Performance Indices</SectionLabel>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 10,
          marginBottom: 20,
        }}
      >
        <MetricCard
          label="SPI"
          value={fmtRatio(spi)}
          sub="Schedule Performance Index"
          color={spi !== null ? indexColor("SPI", spi) : T.muted}
          trend={spi !== null ? (spi >= 1 ? "up" : "down") : null}
          badge={
            spi === null ? undefined :
            spi >= 1.0  ? "On Schedule" :
            spi >= 0.9  ? "Slight Delay" : "Behind Schedule"
          }
          badgeColor={spi !== null ? indexColor("SPI", spi) : T.muted}
        />
        <MetricCard
          label="CPI"
          value={fmtRatio(cpi)}
          sub="Cost Performance Index"
          color={cpi !== null ? indexColor("CPI", cpi) : T.muted}
          trend={cpi !== null ? (cpi >= 1 ? "up" : "down") : null}
          badge={
            cpi === null ? undefined :
            cpi >= 1.0  ? "Under Budget" :
            cpi >= 0.9  ? "Slight Overrun" : "Over Budget"
          }
          badgeColor={cpi !== null ? indexColor("CPI", cpi) : T.muted}
        />
      </div>

      {/* ── Row 4: EAC · ETC · VAC · TCPI ─────────────────────────────────── */}
      <SectionLabel>Forecast</SectionLabel>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10,
          marginBottom: 32,
        }}
      >
        <MetricCard
          label="EAC"
          value={fmt(eac)}
          sub="Estimate at Completion"
          color={vac !== null && vac >= 0 ? T.success : T.danger}
        />
        <MetricCard
          label="ETC"
          value={fmt(etc)}
          sub="Estimate to Complete"
          color={T.muted}
        />
        <MetricCard
          label="VAC"
          value={fmt(vac)}
          sub="Variance at Completion"
          color={varianceColor(vac)}
          trend={vac !== null ? (vac >= 0 ? "up" : "down") : null}
        />
        <MetricCard
          label="TCPI"
          value={fmtRatio(tcpi)}
          sub="To-Complete Performance Index"
          color={tcpi !== null ? tcpiColor(tcpi) : T.muted}
          badge={
            tcpi === null ? undefined :
            tcpi <= 1.05 ? "Achievable" :
            tcpi <= 1.15 ? "Challenging" : "Unlikely"
          }
          badgeColor={tcpi !== null ? tcpiColor(tcpi) : T.muted}
        />
      </div>

      {/* ── S-Curve ─────────────────────────────────────────────────────────── */}
      <SectionLabel>S-Curve — Cumulative Performance</SectionLabel>
      <div
        style={{
          backgroundColor: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: "20px 16px 12px",
          marginBottom: 32,
        }}
      >
        {enrichedSCurve.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={enrichedSCurve} margin={{ top: 10, right: 24, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="gradPV" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={T.primary} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={T.primary} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="gradEV" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={T.success} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={T.success} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="gradAC" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={T.danger} stopOpacity={0.20} />
                  <stop offset="95%" stopColor={T.danger} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={T.border} strokeDasharray="4 4" />
              <XAxis
                dataKey="month"
                tick={{ fill: T.muted, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: T.muted, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) =>
                  v >= 1_000_000 ? `£${(v / 1_000_000).toFixed(1)}M` :
                  v >= 1_000     ? `£${(v / 1_000).toFixed(0)}K` : `£${v}`
                }
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 11, color: T.muted, paddingTop: 8 }}
                iconType="circle"
                iconSize={8}
              />
              <Area
                type="monotone"
                dataKey="pv"
                name="PV — Planned"
                stroke={T.primary}
                strokeWidth={2}
                fill="url(#gradPV)"
                dot={false}
                connectNulls={false}
              />
              <Area
                type="monotone"
                dataKey="ev"
                name="EV — Earned"
                stroke={T.success}
                strokeWidth={2.5}
                fill="url(#gradEV)"
                dot={false}
                connectNulls={false}
              />
              <Area
                type="monotone"
                dataKey="ac"
                name="AC — Actual"
                stroke={T.danger}
                strokeWidth={2}
                fill="url(#gradAC)"
                dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="eacLow"
                name="EAC Optimistic"
                stroke={T.success}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                connectNulls={false}
                legendType="none"
              />
              <Line
                type="monotone"
                dataKey="eacHigh"
                name="EAC Pessimistic"
                stroke={T.danger}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                connectNulls={false}
                legendType="none"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div
            style={{
              height: 320,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: T.muted,
              gap: 8,
            }}
          >
            <span style={{ fontSize: 28 }}>📊</span>
            <p style={{ fontSize: 13 }}>No S-curve data available yet</p>
          </div>
        )}
      </div>

      {/* ── Forecast Scenarios ───────────────────────────────────────────────── */}
      <SectionLabel>Forecast Scenarios</SectionLabel>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
          marginBottom: 32,
        }}
      >
        <ScenarioCard
          label="Optimistic"
          value={fmt(optimisticEac)}
          desc={`CPI improves to ~0.98 for remaining work. Efficiency gains offset current overrun.`}
          accentColor={T.success}
          eac={optimisticEac}
          bac={bac}
        />
        <ScenarioCard
          label="Most Likely"
          value={fmt(eac)}
          desc={`Current CPI of ${fmtRatio(cpi)} continues unchanged through project completion.`}
          accentColor={T.warning}
          eac={eac}
          bac={bac}
        />
        <ScenarioCard
          label="Pessimistic"
          value={fmt(pessimisticEac)}
          desc={`CPI degrades further to ~0.82. Risk materialisation or scope growth drives additional cost.`}
          accentColor={T.danger}
          eac={pessimisticEac}
          bac={bac}
        />
      </div>

      {/* ── Snapshot extras (conditional) ───────────────────────────────────── */}
      {(data.forecastEndDate || data.onBudgetProbability !== null || data.risksOpen !== null) && (
        <>
          <SectionLabel>Additional Indicators</SectionLabel>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 10,
              marginBottom: 32,
            }}
          >
            {data.forecastEndDate && (
              <MetricCard
                label="Forecast End Date"
                value={new Date(data.forecastEndDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                sub="Projected completion date"
                color={T.warning}
              />
            )}
            {data.onBudgetProbability !== null && data.onBudgetProbability !== undefined && (
              <MetricCard
                label="On-Budget Probability"
                value={`${Math.round(data.onBudgetProbability * 100)}%`}
                sub="Likelihood of completing within BAC"
                color={
                  data.onBudgetProbability >= 0.7 ? T.success :
                  data.onBudgetProbability >= 0.5 ? T.warning : T.danger
                }
              />
            )}
            {data.risksOpen !== null && data.risksOpen !== undefined && (
              <MetricCard
                label="Open Risks"
                value={String(data.risksOpen)}
                sub={`${data.risksCritical ?? 0} critical`}
                color={data.risksCritical && data.risksCritical > 0 ? T.danger : T.warning}
              />
            )}
          </div>
        </>
      )}

      {/* ── TCPI vs CPI callout ───────────────────────────────────────────── */}
      {tcpi !== null && cpi !== null && (
        <div
          style={{
            backgroundColor: T.card,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: "16px 20px",
            display: "flex",
            gap: 16,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          {/* TCPI bar */}
          <div style={{ flex: "1 1 260px" }}>
            <p
              style={{
                color: T.muted,
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 10,
              }}
            >
              TCPI vs CPI — Efficiency Gap
            </p>
            {/* CPI bar */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ color: T.muted, fontSize: 11 }}>Current CPI</span>
                <span style={{ color: indexColor("CPI", cpi), fontWeight: 700, fontSize: 11 }}>{fmtRatio(cpi)}</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, backgroundColor: T.border, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, (cpi / 1.5) * 100)}%`,
                    backgroundColor: indexColor("CPI", cpi),
                    borderRadius: 4,
                    transition: "width 0.6s ease",
                  }}
                />
              </div>
            </div>
            {/* TCPI bar */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ color: T.muted, fontSize: 11 }}>Required TCPI</span>
                <span style={{ color: tcpiColor(tcpi), fontWeight: 700, fontSize: 11 }}>{fmtRatio(tcpi)}</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, backgroundColor: T.border, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, (tcpi / 1.5) * 100)}%`,
                    backgroundColor: tcpiColor(tcpi),
                    borderRadius: 4,
                    transition: "width 0.6s ease",
                  }}
                />
              </div>
            </div>
          </div>
          {/* Narrative */}
          <div
            style={{
              flex: "1 1 260px",
              backgroundColor: `${T.warning}11`,
              border: `1px solid ${T.warning}33`,
              borderRadius: 8,
              padding: "12px 14px",
            }}
          >
            <p style={{ color: T.warning, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
              Forecast Insight
            </p>
            <p style={{ color: T.text, fontSize: 12, lineHeight: 1.6 }}>
              {tcpi > cpi
                ? `The team must achieve a TCPI of ${fmtRatio(tcpi)} to finish within budget — a ${Math.round(((tcpi / cpi) - 1) * 100)}% improvement over the current CPI of ${fmtRatio(cpi)}. Without corrective action, the project is tracking to complete at ${fmt(eac)}.`
                : `Current CPI of ${fmtRatio(cpi)} exceeds the required TCPI of ${fmtRatio(tcpi)}. The project is performing better than the minimum needed to stay within budget.`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
