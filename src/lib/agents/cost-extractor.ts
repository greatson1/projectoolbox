/**
 * Promote cost figures discovered in research to the Cost table as
 * ESTIMATE entries.
 *
 * Feasibility research returns hard numbers — "venue costs ~£500-£1,500",
 * "catering ~£40 per head", "freelance trainer day rate £400-£800". They
 * inform the agent's prompt context but never become CostEntry rows, so
 * the Cost page stays empty until the user types figures manually or an
 * AI-generated Budget Breakdown gets approved.
 *
 * This module scans research-tagged KB items for £ figures (or ranges),
 * picks one representative number per finding, and creates a CostEntry of
 * type ESTIMATE tagged "from_research" so the user can see where it came
 * from.
 *
 * Idempotent — promoted KB items get a "cost_promoted" tag.
 */

import { db } from "@/lib/db";

export interface PromoteCostsResult {
  scanned: number;
  created: number;
}

interface CostFinding {
  title: string;
  amount: number;          // single representative number; ranges → midpoint
  category: string;        // mapped to CostEntry.category enum
  description: string;
  sourceItemId: string;
}

/**
 * Map keywords in the title/content to a CostEntry category. The schema's
 * enum is LABOUR | MATERIALS | SERVICES | TRAVEL | CONTINGENCY | OTHER.
 */
function inferCategory(text: string): string {
  const t = text.toLowerCase();
  if (/\b(salary|wage|fee|day\s*rate|hourly|trainer|consultant|developer|contractor)\b/.test(t)) return "LABOUR";
  if (/\b(equipment|hardware|software|licen[cs]e|material|supplies|stationery)\b/.test(t)) return "MATERIALS";
  if (/\b(venue|catering|hire|service|subscription|insurance|legal|accounting|hosting|cloud)\b/.test(t)) return "SERVICES";
  if (/\b(flight|hotel|travel|accommodation|transport|taxi|train|airfare|visa)\b/.test(t)) return "TRAVEL";
  if (/\b(contingency|reserve|buffer)\b/.test(t)) return "CONTINGENCY";
  return "OTHER";
}

/**
 * Extract every £-prefixed amount from a string. Handles:
 *   £500           → 500
 *   £1,500         → 1500
 *   £1.5k          → 1500
 *   £500-£1,500    → midpoint 1000 (range)
 *   £500–£1.5k     → midpoint 1000 (en-dash range)
 *   £40 per head   → 40 (kept as-is; multiplier handled separately if needed)
 *
 * Returns an array — caller picks the most representative figure (usually
 * the largest, since research tends to give a range and the upper bound
 * captures worst-case planning).
 */
function extractAmounts(text: string): number[] {
  const out: number[] = [];
  // Match £X[,XXX][.XX][k|m] possibly followed by a dash and another £Y
  const RE = /£\s*([\d,]+(?:\.\d+)?)\s*([kKmM]?)(?:\s*[-–]\s*£?\s*([\d,]+(?:\.\d+)?)\s*([kKmM]?))?/g;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(text)) !== null) {
    const lo = parseAmount(m[1], m[2]);
    if (lo === null) continue;
    if (m[3]) {
      // Range: midpoint
      const hi = parseAmount(m[3], m[4]);
      if (hi !== null) {
        out.push(Math.round((lo + hi) / 2));
        continue;
      }
    }
    out.push(lo);
  }
  return out;
}

function parseAmount(numStr: string, suffix: string | undefined): number | null {
  let n = parseFloat(numStr.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (suffix === "k" || suffix === "K") n *= 1_000;
  if (suffix === "m" || suffix === "M") n *= 1_000_000;
  return Math.round(n);
}

/**
 * Main entry. Scans research-tagged KB items for cost figures and creates
 * one ESTIMATE entry per item (using the largest amount found in that
 * item's content as the representative figure).
 */
export async function promoteResearchCostsToCanonical(projectId: string): Promise<PromoteCostsResult> {
  const all = await db.knowledgeBaseItem.findMany({
    where: {
      projectId,
      tags: { hasSome: ["research", "feasibility"] },
    },
    select: { id: true, title: true, content: true, tags: true },
    take: 80,
  });
  const items = all.filter(i =>
    !i.title.startsWith("__") &&
    !i.tags.includes("cost_promoted"),
  );

  // Project currency for the entry — fall back to GBP if the org has none
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { org: { select: { currency: true } } },
  });
  const currency = project?.org?.currency || "GBP";

  const findings: CostFinding[] = [];
  for (const item of items) {
    const amounts = extractAmounts(item.content);
    if (amounts.length === 0) continue;
    // Pick the largest — research tends to be cited as ranges and the
    // upper end is what budget planning should account for.
    const amount = Math.max(...amounts);
    if (amount < 1) continue;
    findings.push({
      title: item.title.slice(0, 200),
      amount,
      category: inferCategory(item.title + " " + item.content),
      description: item.content.slice(0, 500),
      sourceItemId: item.id,
    });
  }

  let created = 0;
  for (const f of findings) {
    // De-dupe — never two entries with the same title + amount
    const exists = await db.costEntry.findFirst({
      where: { projectId, description: f.title, amount: f.amount, entryType: "ESTIMATE" },
      select: { id: true },
    });
    if (exists) continue;
    try {
      await db.costEntry.create({
        data: {
          projectId,
          entryType: "ESTIMATE",
          category: f.category,
          amount: f.amount,
          currency,
          description: f.title,
          createdBy: "agent:research-extractor",
        },
      });
      created++;
    } catch (e) {
      console.error("[cost-extractor] create failed:", f.title, e);
    }
  }

  // Tag promoted items even when no cost was created — re-running is a no-op
  for (const item of items) {
    await db.knowledgeBaseItem.update({
      where: { id: item.id },
      data: { tags: Array.from(new Set([...item.tags, "cost_promoted"])) },
    }).catch(() => {});
  }

  return { scanned: items.length, created };
}
