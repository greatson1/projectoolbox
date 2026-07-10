// Critical-path engine. Pure, deterministic, client- and server-safe.
// Ported from the Pilot reference implementation (pt-pilot src/lib/cpm.ts)
// and adapted to Projectoolbox's Task shape.
//
// Two schedules are computed:
// - BASELINE: forward/backward pass from the project anchor using full
//   durations — this is where float/critical flags come from. Stored task
//   dates act as start-no-earlier-than (SNET) constraints so the computed
//   schedule respects the plan the tasks were laid out on.
// - FORECAST: re-schedule from "now" using REMAINING duration
//   (duration × (1 − reported progress)); DONE tasks constrain nothing.
//   Projected finish vs target end is the real-time schedule impact.
//
// Phase order is an implicit constraint: a task cannot start before every
// task in earlier phases has finished (phase gates gate the plan).
//
// The LLM proposes dependencies (schedule artefact CSV); THIS module owns
// the math. Task.isCriticalPath is a computed output here, never an input.

export interface CpmTaskInput {
  id: string;
  phaseOrder: number;
  durationDays: number;
  status: string; // DONE / CANCELLED handled specially in forecasting
  progressPct: number;
  dependsOn: string[]; // predecessor task ids (already resolved to db ids)
  /** Start-no-earlier-than, in days from the schedule anchor. */
  earliestStartDays?: number;
}

export interface CpmTaskResult {
  id: string;
  es: number; // earliest start (days from anchor)
  ef: number; // earliest finish
  ls: number; // latest start
  lf: number; // latest finish
  float: number; // total float in days
  critical: boolean;
}

export interface CpmResult {
  tasks: Map<string, CpmTaskResult>;
  finishDays: number; // project duration in days from anchor
  criticalIds: string[]; // one critical chain, in order
}

const EPS = 0.01;
const DAY_MS = 86_400_000;

function topoOrder(tasks: CpmTaskInput[]): CpmTaskInput[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const out: CpmTaskInput[] = [];
  function visit(t: CpmTaskInput) {
    if (visited.has(t.id)) return;
    if (inStack.has(t.id)) return; // cycle — ignore the back edge
    inStack.add(t.id);
    for (const d of t.dependsOn) {
      const dep = byId.get(d);
      if (dep) visit(dep);
    }
    inStack.delete(t.id);
    visited.add(t.id);
    out.push(t);
  }
  for (const t of tasks) visit(t);
  return out;
}

function run(tasks: CpmTaskInput[], duration: (t: CpmTaskInput) => number): CpmResult {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ordered = topoOrder(tasks);

  // Phase-order constraint: earliest finish of everything in earlier phases.
  const phases = [...new Set(tasks.map((t) => t.phaseOrder))].sort((a, b) => a - b);
  const phaseFloor = new Map<number, number>(); // phaseOrder → min start

  const es = new Map<string, number>();
  const ef = new Map<string, number>();

  for (const ph of phases) {
    const prevMax = phaseFloor.get(ph) ?? 0;
    for (const t of ordered.filter((x) => x.phaseOrder === ph)) {
      let start = Math.max(prevMax, t.earliestStartDays ?? 0);
      for (const d of t.dependsOn) {
        if (byId.has(d)) start = Math.max(start, ef.get(d) ?? 0);
      }
      es.set(t.id, start);
      ef.set(t.id, start + duration(t));
    }
    const phEnd = Math.max(prevMax, ...tasks.filter((x) => x.phaseOrder === ph).map((x) => ef.get(x.id) ?? 0));
    const nextIdx = phases.indexOf(ph) + 1;
    if (nextIdx < phases.length) phaseFloor.set(phases[nextIdx], phEnd);
  }

  const finish = Math.max(0, ...tasks.map((t) => ef.get(t.id) ?? 0));

  // Backward pass.
  const successors = new Map<string, string[]>();
  for (const t of tasks) for (const d of t.dependsOn) successors.set(d, [...(successors.get(d) ?? []), t.id]);
  // phase ceilings: latest a phase may end = min start of anything in later phases
  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  const phaseCeil = new Map<number, number>();
  for (let i = phases.length - 1; i >= 0; i--) {
    const ph = phases[i];
    const ceil = phaseCeil.get(ph) ?? finish;
    for (const t of [...ordered].reverse().filter((x) => x.phaseOrder === ph)) {
      let late = ceil;
      for (const sid of successors.get(t.id) ?? []) {
        late = Math.min(late, ls.get(sid) ?? finish);
      }
      lf.set(t.id, late);
      ls.set(t.id, late - duration(t));
    }
    if (i > 0) {
      const minLs = Math.min(ceil, ...tasks.filter((x) => x.phaseOrder === ph).map((x) => ls.get(x.id) ?? finish));
      phaseCeil.set(phases[i - 1], minLs);
    }
  }

  const results = new Map<string, CpmTaskResult>();
  for (const t of tasks) {
    const fl = (ls.get(t.id) ?? 0) - (es.get(t.id) ?? 0);
    results.set(t.id, {
      id: t.id,
      es: es.get(t.id) ?? 0,
      ef: ef.get(t.id) ?? 0,
      ls: ls.get(t.id) ?? 0,
      lf: lf.get(t.id) ?? 0,
      float: Math.max(0, fl),
      critical: fl <= EPS && duration(t) > 0,
    });
  }

  // Trace one critical chain from the earliest critical task forward.
  const criticalIds: string[] = [];
  const critical = tasks.filter((t) => results.get(t.id)?.critical).sort((a, b) => (es.get(a.id) ?? 0) - (es.get(b.id) ?? 0));
  let cursor = -1;
  for (const t of critical) {
    const s = es.get(t.id) ?? 0;
    if (s >= cursor - EPS) {
      criticalIds.push(t.id);
      cursor = ef.get(t.id) ?? 0;
    }
  }

  return { tasks: results, finishDays: finish, criticalIds };
}

/** Baseline schedule from the anchor using full durations. */
export function baselineCpm(tasks: CpmTaskInput[]): CpmResult {
  const live = tasks.filter((t) => t.status !== "CANCELLED");
  return run(live, (t) => Math.max(t.durationDays, 0.25));
}

/**
 * Forecast from "now": DONE work has zero remaining duration, in-flight
 * work carries duration × (1 − reported progress). finishDays is therefore
 * "days from today until everything remaining completes". Inputs must be
 * built with a "now" anchor (earliestStartDays relative to today).
 */
export function forecastCpm(tasks: CpmTaskInput[]): CpmResult {
  const live = tasks.filter((t) => t.status !== "CANCELLED");
  return run(live, (t) => {
    if (t.status === "DONE") return 0;
    const remaining = Math.max(t.durationDays, 0.25) * (1 - Math.min(100, Math.max(0, t.progressPct)) / 100);
    return Math.max(remaining, 0.1);
  });
}

// ── Adapter: Projectoolbox Task rows → CPM input ─────────────────────────

export interface CpmSourceTask {
  id: string;
  title: string;
  status: string;
  startDate: Date | string | null;
  endDate: Date | string | null;
  progress: number | null;
  parentId?: string | null;
  phaseId?: string | null; // Phase CUID OR phase name (both occur in the wild)
  dependencies?: unknown; // Prisma Json — expected string[] of ids / titles / WBS source ids
}

export interface CpmSourcePhase {
  id: string;
  name: string;
}

export interface BuiltCpm {
  input: CpmTaskInput[];
  anchorMs: number;
  /** resolved dependency edges as db-id pairs (for network rendering) */
  edges: { from: string; to: string }[];
  /** dependency strings that could not be matched to a task */
  unresolvedDeps: string[];
}

const toMs = (d: Date | string | null | undefined): number | null => {
  if (!d) return null;
  const ms = typeof d === "string" ? Date.parse(d) : d.getTime();
  return Number.isFinite(ms) ? ms : null;
};

const normTitle = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Build CPM input from live Task rows.
 * - Parent/container rows (anything referenced as another task's parentId)
 *   are excluded — packages are containers, not activities.
 * - Dependencies resolve tolerantly: db id first, then exact title. Raw WBS
 *   source ids from old artefact syncs that match nothing are reported in
 *   unresolvedDeps rather than silently dropped.
 * - anchorMs defaults to the earliest task start (fallback: now). Pass
 *   { anchorMs: Date.now() } and dates in the past clamp to 0 — that is the
 *   forecast framing.
 */
export function buildCpmInput(
  tasks: CpmSourceTask[],
  phases: CpmSourcePhase[],
  opts?: { anchorMs?: number },
): BuiltCpm {
  const parentIds = new Set(tasks.map((t) => t.parentId).filter(Boolean) as string[]);
  const leaves = tasks.filter((t) => !parentIds.has(t.id) && t.status !== "CANCELLED");

  const phaseOrderByKey = new Map<string, number>();
  phases.forEach((p, i) => {
    phaseOrderByKey.set(p.id, i);
    phaseOrderByKey.set(normTitle(p.name), i);
  });

  const byId = new Map(leaves.map((t) => [t.id, t]));
  const byTitle = new Map(leaves.map((t) => [normTitle(t.title), t]));

  const starts = leaves.map((t) => toMs(t.startDate)).filter((x): x is number => x !== null);
  const anchorMs = opts?.anchorMs ?? (starts.length > 0 ? Math.min(...starts) : Date.now());

  const edges: { from: string; to: string }[] = [];
  const unresolvedDeps: string[] = [];

  const input: CpmTaskInput[] = leaves.map((t) => {
    const startMs = toMs(t.startDate);
    const endMs = toMs(t.endDate);
    const durationDays =
      startMs !== null && endMs !== null && endMs > startMs ? (endMs - startMs) / DAY_MS : 1;

    const rawDeps: string[] = Array.isArray(t.dependencies)
      ? (t.dependencies as unknown[]).filter((d): d is string => typeof d === "string")
      : [];
    const dependsOn: string[] = [];
    for (const raw of rawDeps) {
      const hit = byId.get(raw) ?? byTitle.get(normTitle(raw));
      if (hit && hit.id !== t.id) {
        dependsOn.push(hit.id);
        edges.push({ from: hit.id, to: t.id });
      } else if (!hit) {
        unresolvedDeps.push(raw);
      }
    }

    const phaseOrder = t.phaseId
      ? phaseOrderByKey.get(t.phaseId) ?? phaseOrderByKey.get(normTitle(t.phaseId)) ?? 0
      : 0;

    return {
      id: t.id,
      phaseOrder,
      durationDays,
      status: (t.status || "TODO").toUpperCase(),
      progressPct: Math.min(100, Math.max(0, t.progress ?? 0)),
      dependsOn,
      earliestStartDays: startMs !== null ? Math.max(0, (startMs - anchorMs) / DAY_MS) : 0,
    };
  });

  return { input, anchorMs, edges, unresolvedDeps };
}

// ── Monte Carlo ──────────────────────────────────────────────────────────
// Seeded, reproducible. Each run samples every remaining task's duration
// from a triangular distribution (0.75d, d, 1.5d) and re-runs the forward
// pass; the P50/P85 finish comes from the run distribution.

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Triangular sample on [lo, hi] with mode m, via inverse CDF. */
function triangular(u: number, lo: number, m: number, hi: number): number {
  if (hi <= lo) return m;
  const f = (m - lo) / (hi - lo);
  return u < f ? lo + Math.sqrt(u * (hi - lo) * (m - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - m));
}

export interface MonteCarloResult {
  runs: number;
  p50Days: number;
  p85Days: number;
  minDays: number;
  maxDays: number;
  onTargetProb: number | null; // share of runs finishing by target (if target given)
}

/**
 * Inputs must be forecast-framed (earliestStartDays relative to now).
 * Returns days-from-now quantiles for the remaining work.
 */
export function monteCarloForecast(
  cpmInput: CpmTaskInput[],
  targetDaysFromNow: number | null,
  runs = 500,
  seed = 42,
): MonteCarloResult | null {
  const remaining = cpmInput.filter((t) => t.status !== "CANCELLED");
  if (remaining.length === 0 || remaining.every((t) => t.status === "DONE")) return null;
  const rand = mulberry32(seed);
  const finishes: number[] = [];
  for (let i = 0; i < runs; i++) {
    const durations = new Map<string, number>();
    for (const t of remaining) {
      if (t.status === "DONE") {
        durations.set(t.id, 0);
        continue;
      }
      const base = Math.max(t.durationDays, 0.25) * (1 - Math.min(100, Math.max(0, t.progressPct)) / 100);
      durations.set(t.id, base <= 0 ? 0 : triangular(rand(), base * 0.75, base, base * 1.5));
    }
    const res = run(remaining, (t) => durations.get(t.id) ?? 0);
    finishes.push(res.finishDays);
  }
  finishes.sort((a, b) => a - b);
  const q = (p: number) => finishes[Math.min(finishes.length - 1, Math.floor(p * finishes.length))];
  return {
    runs,
    p50Days: Math.round(q(0.5)),
    p85Days: Math.round(q(0.85)),
    minDays: Math.round(finishes[0]),
    maxDays: Math.round(finishes[finishes.length - 1]),
    onTargetProb:
      targetDaysFromNow === null ? null : finishes.filter((f) => f <= targetDaysFromNow).length / finishes.length,
  };
}
