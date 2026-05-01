/**
 * Promote KB-recorded issues to the canonical Issue table.
 *
 * Research, chat, and meeting transcripts often surface real, specific
 * issues — "Permit application stuck in council review", "Vendor X went
 * into administration last week", "GDPR review required before launch".
 * They land in KB tagged "issue" / "blocker" / "concern" but never reach
 * the Issues page (which reads db.issue only).
 *
 * Mirrors risk-extractor.ts. Idempotent — promoted KB items get an
 * "issue_promoted" tag so subsequent runs skip them.
 */

import { db } from "@/lib/db";

export interface PromoteIssuesResult {
  scanned: number;
  created: number;
}

/**
 * Same blob-splitter as the risk-extractor (lists / numbered / commas /
 * one-per-line) — issue blobs from research come in similar shapes.
 */
function splitIssueBlob(content: string): string[] {
  if (!content) return [];
  const stripped = content
    .replace(/^\[(research|user confirmed|meeting)[^\]]*\]\s*/i, "")
    .replace(/^q:[\s\S]*?\na:\s*/i, "")
    .trim();

  const lines = stripped
    .split(/\r?\n|;|·|•/)
    .map(s => s.replace(/^\s*[-*•]\s*/, "").replace(/^\s*\d+[.)]\s+/, "").trim())
    .filter(Boolean);

  let candidates: string[];
  if (lines.length >= 2) {
    candidates = lines;
  } else {
    const commaCount = (stripped.match(/,/g) || []).length;
    candidates = commaCount >= 2 && stripped.length < 600
      ? stripped.split(/,/).map(s => s.trim()).filter(Boolean)
      : [stripped];
  }

  return candidates
    .map(c => c.split(/[.—:]/)[0].trim())
    .map(c => c.replace(/^(and|or|plus|also|including|such as|like)\s+/i, "").trim())
    .map(c => c.length > 0 ? c[0].toUpperCase() + c.slice(1) : c)
    .filter(c => c.length >= 6 && c.length <= 200);
}

function inferPriority(title: string): string {
  const t = title.toLowerCase();
  if (/\b(critical|severe|catastrophic|blocker|stuck|cancel|fail|breach|breach)\b/.test(t)) return "CRITICAL";
  if (/\b(major|urgent|escalat)\b/.test(t)) return "HIGH";
  if (/\b(minor|cosmetic|low priority)\b/.test(t)) return "LOW";
  return "MEDIUM";
}

/**
 * Issues are intentionally narrower than risks — only items the agent /
 * user explicitly flagged as currently blocking, not generic "things to
 * watch out for". The filter looks for keyword evidence the issue is
 * happening NOW, not a future possibility.
 */
const ACTIVE_ISSUE_KEYWORDS = [
  "stuck", "blocked", "blocker", "delayed", "outstanding",
  "unresolved", "awaiting", "pending review", "escalated",
  "critical", "broken", "down", "cancelled", "withdrew",
];

function looksLikeActiveIssue(title: string): boolean {
  const t = title.toLowerCase();
  return ACTIVE_ISSUE_KEYWORDS.some(k => t.includes(k));
}

export async function promoteKBIssuesToCanonical(projectId: string): Promise<PromoteIssuesResult> {
  // Same Prisma OR-then-filter dance as risk-extractor — combining OR + NOT
  // in one where clause silently returns 0 rows.
  const all = await db.knowledgeBaseItem.findMany({
    where: {
      projectId,
      OR: [
        { title: { contains: "issue", mode: "insensitive" } },
        { title: { contains: "blocker", mode: "insensitive" } },
        { title: { contains: "stuck", mode: "insensitive" } },
        { title: { contains: "outstanding", mode: "insensitive" } },
        { tags: { hasSome: ["issue", "blocker", "concern"] } },
      ],
    },
    select: { id: true, title: true, content: true, tags: true },
    take: 50,
  });
  const items = all.filter(i =>
    !i.title.startsWith("__") &&
    !i.tags.includes("issue_promoted"),
  );

  let created = 0;
  for (const item of items) {
    const titles = splitIssueBlob(item.content);
    for (const title of titles) {
      // Only promote when the title looks like a present-tense issue.
      // "Awaiting GDPR sign-off" → yes; "GDPR considerations" → no.
      if (!looksLikeActiveIssue(title)) continue;

      const exists = await db.issue.findFirst({
        where: { projectId, title },
        select: { id: true },
      });
      if (exists) continue;

      try {
        await db.issue.create({
          data: {
            projectId,
            title: title.slice(0, 255),
            description: `Surfaced from ${item.tags.includes("meeting") ? "meeting transcript" : item.tags.includes("research") ? "feasibility research" : "user input"}: ${title}`,
            priority: inferPriority(title),
            status: "OPEN",
          },
        });
        created++;
      } catch (e) {
        console.error("[issue-extractor] create failed:", title, e);
      }
    }
    await db.knowledgeBaseItem.update({
      where: { id: item.id },
      data: { tags: Array.from(new Set([...item.tags, "issue_promoted"])) },
    }).catch(() => {});
  }

  return { scanned: items.length, created };
}
