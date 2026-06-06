/**
 * Shared Kanban Class of Service helpers.
 *
 * Used by:
 *   - /class-of-service page (renders one card per class with canonical
 *     icons + tinting based on the bucket).
 *   - /agile board (groups swimlanes by class when the user selects
 *     "By Class of Service", colours the swimlane header using the
 *     bucket palette, and orders the lanes Expedite → Fixed → Standard
 *     → Intangible → Other so the most urgent work renders at the top).
 *
 * Classification is heuristic — Sonnet (or the user) can name a class
 * anything, but the canonical four cover the vast majority of real
 * Kanban implementations and are what the Kanban Method literature uses.
 */

export type ClassOfServiceBucket = "expedite" | "fixed" | "standard" | "intangible" | "other";

export interface ClassOfServiceStyle {
  bucket: ClassOfServiceBucket;
  color: string;
  bg: string;
  /** Sort weight — lower renders first (top of board / left of dropdown). */
  order: number;
}

const BUCKET_STYLES: Record<ClassOfServiceBucket, ClassOfServiceStyle> = {
  expedite:   { bucket: "expedite",   color: "#EF4444", bg: "bg-red-500/5",     order: 0 },
  fixed:      { bucket: "fixed",      color: "#F59E0B", bg: "bg-amber-500/5",   order: 1 },
  standard:   { bucket: "standard",   color: "#6366F1", bg: "bg-indigo-500/5",  order: 2 },
  intangible: { bucket: "intangible", color: "#64748B", bg: "bg-slate-500/5",   order: 3 },
  other:      { bucket: "other",      color: "#8B5CF6", bg: "bg-purple-500/5",  order: 4 },
};

/**
 * Classify a class-of-service label into one of the canonical buckets.
 * Case-insensitive substring match — handles "Expedite", "Urgent",
 * "Fixed Date", "Standard", "Intangible / Tech Debt", and falls
 * through to "other" for project-specific custom classes.
 */
export function classifyClassOfService(label: string | null | undefined): ClassOfServiceBucket {
  if (!label) return "other";
  const n = label.toLowerCase();
  if (n.includes("expedite") || n.includes("urgent") || n.includes("blocker")) return "expedite";
  if (n.includes("fixed") || n.includes("date") || n.includes("deadline")) return "fixed";
  if (n.includes("intangible") || n.includes("tech debt") || n.includes("improvement")) return "intangible";
  if (n.includes("standard") || n.includes("normal") || n.includes("default")) return "standard";
  return "other";
}

/** Get the visual style for a class-of-service label. */
export function classOfServiceStyle(label: string | null | undefined): ClassOfServiceStyle {
  return BUCKET_STYLES[classifyClassOfService(label)];
}
