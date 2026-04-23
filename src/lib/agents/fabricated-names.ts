/**
 * Shared heuristic for detecting fabricated personal names in agent output.
 *
 * Used by:
 *   - artefact-seeders.ts (block fabricated stakeholders at seed time)
 *   - sprint-planner.ts (don't propagate fabricated names to task.assigneeName)
 *   - resources API route (defensive filter at read time)
 *   - regenerate route (null out existing fabricated assigneeNames on cleanup)
 *
 * A name is considered fabricated when it's 2–4 capitalised words with no role
 * keyword, organisation suffix, or presence in the user-confirmed KB.
 */

import { db } from "@/lib/db";

const ROLE_KEYWORDS =
  /\b(manager|lead|director|sponsor|owner|team|member|representative|analyst|head|officer|coordinator|chair|agent|provider|supplier|contractor|partner|client|user|stakeholder|body|department|commission|authority|board|council|ministry|traveller|family|spouse|child|parent|guardian|companion|host|contact|emergency|insurance|airline|hotel|agency|primary|secondary|self|tbd|unassigned)\b/i;

const ORG_KEYWORDS =
  /\b(ltd|inc|corp|llc|plc|gmbh|airlines?|hotel|resort|clinic|hospital|bank|airways|ventures?|group|services?|solutions?|systems?|consultancy|consulting|agency|centre|center|commission|embassy|high commission|authority|department|ministry)\b/i;

/**
 * Pure synchronous check — does NOT consult the KB. Use this when you just
 * want a defensive read-time filter.
 */
export function looksLikeFabricatedName(s: string | null | undefined): boolean {
  if (!s) return false;
  const trimmed = s.trim();
  if (!trimmed) return false;
  if (ROLE_KEYWORDS.test(trimmed)) return false;
  if (ORG_KEYWORDS.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every(w => /^[A-Z][a-z]+/.test(w));
}

/**
 * KB-aware version: returns false if the user confirmed this exact name during
 * clarification. Use this in seeders where preserving user-provided names matters.
 */
export async function isFabricatedUnlessConfirmed(
  name: string,
  projectId: string,
): Promise<boolean> {
  if (!looksLikeFabricatedName(name)) return false;
  const facts = await db.knowledgeBaseItem.findMany({
    where: {
      projectId,
      tags: { hasSome: ["user_confirmed", "user_answer"] },
    },
    select: { content: true, title: true },
  }).catch(() => []);
  const confirmed = facts.map(f => `${f.title}\n${f.content}`).join("\n").toLowerCase();
  return !confirmed.includes(name.trim().toLowerCase());
}
