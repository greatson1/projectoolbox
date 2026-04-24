/**
 * KB → Artefact propagation.
 *
 * When a user-confirmed fact is added or updated in the knowledge base, this
 * module looks for DRAFT artefacts that still contain [TBC — ...] markers
 * and uses Haiku to decide whether the new fact resolves any of them. If
 * matches are found, the [TBC] is replaced in-place and the artefact is
 * re-saved as DRAFT (so the user can still review).
 *
 * Only touches DRAFT artefacts — APPROVED ones are never modified.
 *
 * Trigger points:
 *   - storeFactToKB (clarification answers)
 *   - POST /api/agents/[id]/knowledge (manual KB additions)
 *   - chat/stream/route.ts record_assumption tool
 *
 * The propagation is best-effort and fire-and-forget — failures are logged
 * but never block the upstream write.
 */

import { db } from "@/lib/db";

interface KBFact {
  title: string;
  content: string;
}

/** Extract all "[TBC — description]" markers from an artefact body. */
function extractTBCMarkers(content: string): string[] {
  const re = /\[TBC[^\]]*\]/gi;
  const matches = content.match(re) || [];
  return [...new Set(matches.map(m => m.trim()))];
}

/**
 * Main entry point. Finds DRAFT artefacts with [TBC] markers, asks Haiku if
 * the new fact resolves any of them, applies the replacements, and saves.
 */
export async function propagateKBToArtefacts(
  agentId: string,
  projectId: string,
  fact: KBFact,
): Promise<{ artefactsUpdated: number; replacements: number }> {
  if (!process.env.ANTHROPIC_API_KEY) return { artefactsUpdated: 0, replacements: 0 };

  // Only touch DRAFT artefacts — approved work is sacred
  const drafts = await db.agentArtefact.findMany({
    where: { projectId, agentId, status: "DRAFT" },
    select: { id: true, name: true, content: true, version: true },
  });
  if (drafts.length === 0) return { artefactsUpdated: 0, replacements: 0 };

  let artefactsUpdated = 0;
  let replacements = 0;

  for (const artefact of drafts) {
    const markers = extractTBCMarkers(artefact.content);
    if (markers.length === 0) continue;

    const prompt = `You are updating a project document. A new fact has just been confirmed:

TITLE: ${fact.title}
CONTENT: ${fact.content}

The document below contains [TBC — ...] placeholders. For EACH placeholder, decide if the new fact resolves it. If yes, return the exact placeholder text and the replacement text. If no placeholder is resolved, return an empty array.

DOCUMENT: ${artefact.name}
PLACEHOLDERS IN DOCUMENT:
${markers.map((m, i) => `${i + 1}. ${m}`).join("\n")}

Return ONLY a JSON array like this. Each "find" MUST be the exact placeholder text (including the brackets and the "TBC — " prefix) so a string replace will work:
[
  { "find": "[TBC — hotel name]", "replace": "Atlantis The Palm, Palm Jumeirah" }
]

If nothing matches, return []. Be strict — only propose replacements when the new fact directly answers the placeholder.`;

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5",
          max_tokens: 512,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!response.ok) continue;
      const data = await response.json();
      const text = (data.content?.[0]?.text || "").trim();
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) continue;

      const pairs = JSON.parse(match[0]) as Array<{ find: string; replace: string }>;
      if (!Array.isArray(pairs) || pairs.length === 0) continue;

      let newContent = artefact.content;
      let artefactReplacements = 0;
      for (const { find, replace } of pairs) {
        if (typeof find !== "string" || typeof replace !== "string") continue;
        if (!newContent.includes(find)) continue;
        newContent = newContent.split(find).join(replace);
        artefactReplacements++;
      }
      if (artefactReplacements === 0) continue;

      await db.agentArtefact.update({
        where: { id: artefact.id },
        data: {
          content: newContent,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      await db.agentActivity.create({
        data: {
          agentId,
          type: "document",
          summary: `Auto-updated "${artefact.name}" — resolved ${artefactReplacements} [TBC] marker(s) from new fact: ${fact.title}`,
        },
      }).catch(() => {});
      artefactsUpdated++;
      replacements += artefactReplacements;
    } catch (e) {
      console.error(`[kb-to-artefact-sync] failed on artefact ${artefact.name}:`, e);
    }
  }

  return { artefactsUpdated, replacements };
}
