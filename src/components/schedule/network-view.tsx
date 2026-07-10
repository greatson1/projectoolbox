"use client";

// Activity-network diagram (precedence diagram method) driven by the
// computed CPM layer from /api/projects/:id/gantt. Nodes are leaf tasks,
// columns are dependency depth (phases push columns right), red chain is
// the computed critical path. Ported from the Pilot reference NetworkView.

import { useMemo } from "react";

interface GanttTask {
  id: string;
  title: string;
  status: string;
  phaseId?: string | null;
  parentId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  progress?: number | null;
  floatDays?: number | null;
  isCriticalPath?: boolean;
  dependsOnResolved?: string[];
}

interface GanttPhase {
  id: string;
  name: string;
}

interface CpmSummary {
  criticalIds: string[];
  forecastFinishDate: string;
  targetDate: string | null;
  slipDays: number | null;
  resolvedDependencies: number;
}

const NODE_W = 172;
const NODE_H = 60;
const GAP_X = 64;
const GAP_Y = 16;
const DAY_MS = 86_400_000;

export function NetworkView({
  tasks,
  phases,
  cpm,
}: {
  tasks: GanttTask[];
  phases: GanttPhase[];
  cpm: CpmSummary | null;
}) {
  const layout = useMemo(() => {
    const parentIds = new Set(tasks.map((t) => t.parentId).filter(Boolean) as string[]);
    const leaves = tasks.filter((t) => !parentIds.has(t.id) && t.status !== "CANCELLED");
    const byId = new Map(leaves.map((t) => [t.id, t]));

    const phaseOrder = new Map<string, number>();
    phases.forEach((p, i) => {
      phaseOrder.set(p.id, i);
      phaseOrder.set(p.name.trim().toLowerCase(), i);
    });
    const phaseOf = (t: GanttTask) =>
      t.phaseId ? phaseOrder.get(t.phaseId) ?? phaseOrder.get(t.phaseId.trim().toLowerCase()) ?? 0 : 0;

    // Rank = dependency depth; phases keep their tasks visually ordered
    // left-to-right even without explicit cross-phase edges.
    const rank = new Map<string, number>();
    const maxRankOfPhase = new Map<number, number>();
    const depth = (id: string, seen: Set<string>): number => {
      if (rank.has(id)) return rank.get(id)!;
      if (seen.has(id)) return 0;
      seen.add(id);
      const t = byId.get(id);
      if (!t) return 0;
      const deps = (t.dependsOnResolved ?? []).filter((d) => byId.has(d));
      const d = deps.length === 0 ? 0 : Math.max(...deps.map((x) => depth(x, seen) + 1));
      const po = phaseOf(t);
      const r = Math.max(d, po === 0 ? 0 : (maxRankOfPhase.get(po - 1) ?? -1) + 1);
      rank.set(id, r);
      maxRankOfPhase.set(po, Math.max(maxRankOfPhase.get(po) ?? 0, r));
      return r;
    };
    const orders = [...new Set(leaves.map(phaseOf))].sort((a, b) => a - b);
    for (const po of orders) for (const t of leaves.filter((x) => phaseOf(x) === po)) depth(t.id, new Set());

    const cols = new Map<number, string[]>();
    for (const t of leaves) {
      const r = rank.get(t.id) ?? 0;
      cols.set(r, [...(cols.get(r) ?? []), t.id]);
    }
    const colKeys = [...cols.keys()].sort((a, b) => a - b);
    const pos = new Map<string, { x: number; y: number }>();
    colKeys.forEach((k, ci) => {
      cols.get(k)!.forEach((id, ri) => {
        pos.set(id, { x: 20 + ci * (NODE_W + GAP_X), y: 30 + ri * (NODE_H + GAP_Y) });
      });
    });
    const width = Math.max(1, colKeys.length) * (NODE_W + GAP_X) + 40;
    const height = Math.max(1, ...colKeys.map((k) => cols.get(k)!.length)) * (NODE_H + GAP_Y) + 60;
    return { leaves, byId, pos, width, height };
  }, [tasks, phases]);

  if (layout.leaves.length === 0) {
    return (
      <div className="rounded-xl border p-8 text-center text-[13px]" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
        The network appears once the project has tasks.
      </div>
    );
  }

  // Per-task computed flags — cpm.criticalIds is one traced chain, but
  // parallel tasks can all be critical.
  const criticalSet = new Set(layout.leaves.filter((t) => t.isCriticalPath).map((t) => t.id));
  const durationDays = (t: GanttTask) => {
    const s = t.startDate ? Date.parse(t.startDate) : NaN;
    const e = t.endDate ? Date.parse(t.endDate) : NaN;
    return Number.isFinite(s) && Number.isFinite(e) && e > s ? Math.round((e - s) / DAY_MS) : 1;
  };
  const nodeColor = (t: GanttTask) => {
    const s = (t.status || "").toUpperCase();
    if (s === "DONE") return { fill: "rgba(16,185,129,0.10)", stroke: "#10B981" };
    if (s === "BLOCKED" || s === "AT_RISK") return { fill: "rgba(239,68,68,0.12)", stroke: "#EF4444" };
    if (s === "IN_PROGRESS") return { fill: "rgba(56,189,248,0.10)", stroke: "#38BDF8" };
    return { fill: "rgba(255,255,255,0.02)", stroke: "var(--border)" };
  };

  return (
    <div className="rounded-xl border p-5 overflow-auto" style={{ borderColor: "var(--border)", background: "rgba(255,255,255,0.01)" }}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-[13px] font-bold" style={{ color: "var(--foreground)" }}>Network diagram</p>
        {cpm && (
          <p className="text-[11px]" style={{ color: "var(--muted-foreground)" }}>
            {criticalSet.size} tasks on the critical path · {cpm.resolvedDependencies} dependency link{cpm.resolvedDependencies === 1 ? "" : "s"} · forecast finish{" "}
            {new Date(cpm.forecastFinishDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            {cpm.targetDate && cpm.slipDays !== null ? (cpm.slipDays > 0 ? ` (${cpm.slipDays}d past target)` : " (within target)") : ""}
          </p>
        )}
      </div>
      <svg width={layout.width} height={layout.height} className="min-w-full">
        <defs>
          <marker id="net-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748B" />
          </marker>
          <marker id="net-arrow-crit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#EF4444" />
          </marker>
        </defs>
        {/* edges */}
        {layout.leaves.map((t) =>
          (t.dependsOnResolved ?? []).map((d) => {
            const from = layout.pos.get(d);
            const to = layout.pos.get(t.id);
            if (!from || !to) return null;
            const x1 = from.x + NODE_W;
            const y1 = from.y + NODE_H / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_H / 2;
            const onCrit = criticalSet.has(t.id) && criticalSet.has(d);
            return (
              <path
                key={`${d}-${t.id}`}
                d={`M ${x1} ${y1} C ${x1 + GAP_X / 2} ${y1}, ${x2 - GAP_X / 2} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={onCrit ? "#EF4444" : "#64748B"}
                strokeWidth={onCrit ? 2.5 : 1.2}
                opacity={onCrit ? 0.95 : 0.55}
                markerEnd={onCrit ? "url(#net-arrow-crit)" : "url(#net-arrow)"}
              />
            );
          }),
        )}
        {/* nodes */}
        {layout.leaves.map((t) => {
          const xy = layout.pos.get(t.id);
          if (!xy) return null;
          const c = nodeColor(t);
          const crit = criticalSet.has(t.id);
          return (
            <g key={t.id}>
              <rect
                x={xy.x}
                y={xy.y}
                width={NODE_W}
                height={NODE_H}
                rx={10}
                fill={c.fill}
                stroke={crit ? "#EF4444" : c.stroke}
                strokeWidth={crit ? 2.5 : 1.2}
              />
              <text x={xy.x + 10} y={xy.y + 17} fill="#818CF8" fontSize="9.5" fontFamily="monospace" fontWeight="700">
                {durationDays(t)}d
              </text>
              <text x={xy.x + 44} y={xy.y + 17} fill="#94A3B8" fontSize="9">
                {t.floatDays !== null && t.floatDays !== undefined ? `float ${t.floatDays}d` : ""}
                {crit ? " · critical" : ""}
              </text>
              <text x={xy.x + 10} y={xy.y + 35} fill="var(--foreground)" fontSize="10.5" fontWeight="600">
                {t.title.slice(0, 27)}
              </text>
              <text x={xy.x + 10} y={xy.y + 50} fill="#64748B" fontSize="9">
                {t.title.length > 27 ? t.title.slice(27, 55) : (t.status || "").toLowerCase().replace(/_/g, " ")}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex items-center gap-5 mt-3 pt-3 border-t text-[11px] flex-wrap" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
        <span className="flex items-center gap-2"><span className="w-4 h-3 rounded border-2 inline-block" style={{ borderColor: "#EF4444" }} /> Critical path</span>
        <span className="flex items-center gap-2"><span className="w-4 h-3 rounded border inline-block" style={{ borderColor: "#10B981", background: "rgba(16,185,129,0.2)" }} /> Done</span>
        <span className="flex items-center gap-2"><span className="w-4 h-3 rounded border inline-block" style={{ borderColor: "#38BDF8", background: "rgba(56,189,248,0.2)" }} /> In progress</span>
        <span className="flex items-center gap-2"><span className="w-4 h-3 rounded border inline-block" style={{ borderColor: "#EF4444", background: "rgba(239,68,68,0.2)" }} /> Blocked / at risk</span>
        <span>Float per node — zero float means no slack before the finish date moves.</span>
      </div>
    </div>
  );
}
