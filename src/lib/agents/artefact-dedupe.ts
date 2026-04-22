/**
 * Artefact Deduplication Helper
 *
 * Prevents duplicate artefacts from being created across multiple paths:
 *   - lifecycle-init generatePhaseArtefacts
 *   - chat stream create_artefact tool
 *   - action-executor artefact creation
 *   - procurement-engine, web-research
 *
 * Matches on fuzzy name comparison — "Burndown Chart", "burndown chart",
 * "Sprint Burndown", etc. all count as the same artefact.
 */

import { db } from "@/lib/db";

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns true if an artefact with a similar name already exists for this
 * project (optionally scoped to phase).
 */
export async function artefactExists(
  projectId: string,
  agentId: string,
  name: string,
  phaseId?: string | null,
): Promise<{ exists: boolean; existingId?: string; existingName?: string }> {
  const existing = await db.agentArtefact.findMany({
    where: {
      projectId,
      agentId,
      ...(phaseId ? { phaseId } : {}),
    },
    select: { id: true, name: true },
  });

  const target = normalize(name);
  const targetWords = new Set(target.split(" ").filter((w) => w.length > 3));

  for (const item of existing) {
    const existing = normalize(item.name);
    // Exact match
    if (existing === target) {
      return { exists: true, existingId: item.id, existingName: item.name };
    }
    // Substring match (either direction)
    if (existing.includes(target) || target.includes(existing)) {
      return { exists: true, existingId: item.id, existingName: item.name };
    }
    // Significant word overlap (>=2 words of 4+ chars)
    const existingWords = new Set(existing.split(" ").filter((w) => w.length > 3));
    const overlap = [...targetWords].filter((w) => existingWords.has(w)).length;
    if (overlap >= 2 && targetWords.size > 0) {
      return { exists: true, existingId: item.id, existingName: item.name };
    }
  }

  return { exists: false };
}
