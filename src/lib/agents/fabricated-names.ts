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

// Pure detector lives in fabricated-names-pure.ts so it can be unit-tested
// without pulling in the Prisma client. Re-exported here for back-compat
// with all the call sites that import `looksLikeFabricatedName` from this
// file.
export { looksLikeFabricatedName } from "./fabricated-names-pure";
import { looksLikeFabricatedName } from "./fabricated-names-pure";

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
