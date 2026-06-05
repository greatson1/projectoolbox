/**
 * MoSCoW prioritisation — utility constants + helpers.
 *
 * Used across:
 *   - Product Backlog page (filter + sort)
 *   - Sprint Planning page (chip + bulk-edit + sort within backlog/sprint cards)
 *   - Sprint Tracker (per-MoSCoW done/total breakdown card)
 *   - Schedule (Gantt task-bar stripe colour)
 *   - Delivery Plan (swimlanes within each sprint)
 *
 * Single source of truth so a future tweak (extra category, recolouring,
 * ordering swap) ripples to every surface instead of drifting.
 */

export const MOSCOW_VALUES = ["MUST", "SHOULD", "COULD", "WONT"] as const;

export type Moscow = typeof MOSCOW_VALUES[number];

export const MOSCOW_LABELS: Record<Moscow, string> = {
  MUST:   "Must have",
  SHOULD: "Should have",
  COULD:  "Could have",
  WONT:   "Won't have",
};

/** Short labels for compact chips (10-12 chars max). */
export const MOSCOW_SHORT: Record<Moscow, string> = {
  MUST:   "Must",
  SHOULD: "Should",
  COULD:  "Could",
  WONT:   "Won't",
};

/**
 * Colour map. Hex for inline-style consumers (Gantt stripe, recharts);
 * Tailwind classes for badge backgrounds + text inside React components.
 *
 * Red = MUST (blocking), Amber = SHOULD, Blue = COULD, Slate = WONT.
 * Matches conventions used in commercial agile tools (Jira, Azure Boards).
 */
export const MOSCOW_HEX: Record<Moscow, string> = {
  MUST:   "#EF4444", // red-500
  SHOULD: "#F59E0B", // amber-500
  COULD:  "#3B82F6", // blue-500
  WONT:   "#64748B", // slate-500
};

export const MOSCOW_CHIP: Record<Moscow, { bg: string; text: string; border: string }> = {
  MUST:   { bg: "bg-red-500/10",    text: "text-red-600 dark:text-red-400",       border: "border-red-500/30" },
  SHOULD: { bg: "bg-amber-500/10",  text: "text-amber-600 dark:text-amber-400",   border: "border-amber-500/30" },
  COULD:  { bg: "bg-blue-500/10",   text: "text-blue-600 dark:text-blue-400",     border: "border-blue-500/30" },
  WONT:   { bg: "bg-slate-500/10",  text: "text-slate-600 dark:text-slate-400",   border: "border-slate-500/30" },
};

/** Sort key — lower = higher priority. Uncategorised (null) sorts last. */
export function moscowSortKey(value: string | null | undefined): number {
  if (!value) return 99;
  const idx = MOSCOW_VALUES.indexOf(value as Moscow);
  return idx === -1 ? 99 : idx;
}

/** Comparator for `.sort()` — useful on task arrays. */
export function compareByMoscow<T extends { moscow?: string | null }>(a: T, b: T): number {
  return moscowSortKey(a.moscow) - moscowSortKey(b.moscow);
}

/** Group + count an array of items by MoSCoW. Returns {MUST: {done, total}, ...}. */
export function summariseByMoscow<T extends { moscow?: string | null; status?: string | null }>(items: T[]): Record<Moscow | "UNSET", { total: number; done: number }> {
  const bucket: Record<Moscow | "UNSET", { total: number; done: number }> = {
    MUST:   { total: 0, done: 0 },
    SHOULD: { total: 0, done: 0 },
    COULD:  { total: 0, done: 0 },
    WONT:   { total: 0, done: 0 },
    UNSET:  { total: 0, done: 0 },
  };
  for (const item of items) {
    const key: Moscow | "UNSET" = (item.moscow && MOSCOW_VALUES.includes(item.moscow as Moscow))
      ? (item.moscow as Moscow)
      : "UNSET";
    bucket[key].total += 1;
    const s = (item.status || "").toUpperCase();
    if (s === "DONE" || s === "COMPLETED") bucket[key].done += 1;
  }
  return bucket;
}

/** True iff string is a recognised MoSCoW value. Used to validate API payloads. */
export function isMoscow(value: unknown): value is Moscow {
  return typeof value === "string" && (MOSCOW_VALUES as readonly string[]).includes(value);
}
