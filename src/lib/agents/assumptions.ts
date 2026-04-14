/**
 * Assumptions Tracker
 *
 * Every agent decision or artefact content that isn't backed by confirmed
 * user input is tracked as an ASSUMPTION. Assumptions:
 *
 *   1. Are stored as KnowledgeBaseItem (type: "ASSUMPTION", trustLevel: "REFERENCE_ONLY")
 *   2. Are visible in the Knowledge Base with a distinct badge
 *   3. Can be confirmed (→ HIGH_TRUST fact) or rejected (→ triggers artefact revision)
 *   4. Are injected into the agent's system prompt so it knows what's assumed vs confirmed
 *   5. When changed, flag affected artefacts as stale
 *
 * The agent MUST:
 *   - Declare assumptions when generating artefacts
 *   - Not present assumptions as facts
 *   - Ask for confirmation when autonomy level allows
 *   - Mark content derived from assumptions with [ASSUMPTION] tags
 */

import { db } from "@/lib/db";

export interface Assumption {
  id: string;
  title: string;
  value: string;
  source: string; // "agent_inference" | "industry_standard" | "default_value" | "similar_project"
  confidence: "high" | "medium" | "low";
  affectedArtefacts: string[]; // artefact names that depend on this assumption
  status: "assumed" | "confirmed" | "rejected" | "revised";
  confirmedValue?: string; // what the user corrected it to
}

/**
 * Record an assumption the agent made during artefact generation or decision-making.
 */
export async function recordAssumption(
  agentId: string,
  projectId: string,
  orgId: string,
  assumption: {
    title: string;
    value: string;
    source: string;
    confidence: string;
    affectedArtefacts: string[];
    reasoning: string;
  },
): Promise<string> {
  // Check if this assumption already exists (by title)
  const existing = await db.knowledgeBaseItem.findFirst({
    where: { agentId, projectId, title: `[ASSUMPTION] ${assumption.title}`, type: "ASSUMPTION" as any },
  });

  const content = [
    `**Assumed Value:** ${assumption.value}`,
    `**Source:** ${assumption.source}`,
    `**Confidence:** ${assumption.confidence}`,
    `**Reasoning:** ${assumption.reasoning}`,
    `**Affected Artefacts:** ${assumption.affectedArtefacts.join(", ")}`,
    `**Status:** assumed — awaiting confirmation`,
  ].join("\n");

  if (existing) {
    await db.knowledgeBaseItem.update({
      where: { id: existing.id },
      data: { content, updatedAt: new Date() },
    });
    return existing.id;
  }

  const item = await db.knowledgeBaseItem.create({
    data: {
      orgId,
      agentId,
      projectId,
      layer: "PROJECT",
      type: "ASSUMPTION" as any,
      title: `[ASSUMPTION] ${assumption.title}`,
      content,
      trustLevel: "REFERENCE_ONLY",
      tags: ["assumption", assumption.confidence, ...assumption.affectedArtefacts.map(a => a.toLowerCase().replace(/\s+/g, "_"))],
    },
  });

  return item.id;
}

/**
 * Confirm an assumption — converts it to a HIGH_TRUST fact.
 * If the confirmed value differs from the assumed value, flags affected artefacts as stale.
 */
export async function confirmAssumption(
  assumptionId: string,
  confirmedValue: string,
): Promise<{ changed: boolean; affectedArtefacts: string[] }> {
  const item = await db.knowledgeBaseItem.findUnique({ where: { id: assumptionId } });
  if (!item) return { changed: false, affectedArtefacts: [] };

  // Extract the assumed value and affected artefacts from content
  const assumedMatch = item.content.match(/\*\*Assumed Value:\*\*\s*(.+)/);
  const assumedValue = assumedMatch?.[1]?.trim() || "";
  const artefactsMatch = item.content.match(/\*\*Affected Artefacts:\*\*\s*(.+)/);
  const affectedArtefacts = artefactsMatch?.[1]?.split(",").map(s => s.trim()).filter(Boolean) || [];

  const valueChanged = confirmedValue.toLowerCase() !== assumedValue.toLowerCase();

  // Update the KB item
  const newContent = item.content
    .replace(/\*\*Assumed Value:\*\*.*/, `**Confirmed Value:** ${confirmedValue}`)
    .replace(/\*\*Status:\*\*.*/, `**Status:** ${valueChanged ? "revised" : "confirmed"} by user`);

  await db.knowledgeBaseItem.update({
    where: { id: assumptionId },
    data: {
      title: item.title.replace("[ASSUMPTION]", "[CONFIRMED]"),
      content: newContent,
      trustLevel: "HIGH_TRUST",
      tags: [...(item.tags || []).filter(t => t !== "assumption"), "confirmed", valueChanged ? "revised" : "verified"],
      updatedAt: new Date(),
    },
  });

  // If value changed, flag affected artefacts as stale
  if (valueChanged && item.projectId) {
    try {
      const { flagDependentsStale } = await import("@/lib/agents/artefact-sync");
      for (const artName of affectedArtefacts) {
        const artefact = await db.agentArtefact.findFirst({
          where: { projectId: item.projectId, name: { contains: artName.split(" ")[0], mode: "insensitive" as any } },
        });
        if (artefact) {
          const meta = (artefact.metadata as any) || {};
          await db.agentArtefact.update({
            where: { id: artefact.id },
            data: {
              metadata: {
                ...meta,
                stale: true,
                staleReason: `Assumption "${item.title.replace("[ASSUMPTION] ", "")}" was revised: "${assumedValue}" → "${confirmedValue}"`,
                staleSince: new Date().toISOString(),
              } as any,
            },
          });
        }
      }
    } catch {}
  }

  return { changed: valueChanged, affectedArtefacts };
}

/**
 * Reject an assumption — marks it as rejected and flags affected artefacts.
 */
export async function rejectAssumption(
  assumptionId: string,
  reason: string,
): Promise<void> {
  const item = await db.knowledgeBaseItem.findUnique({ where: { id: assumptionId } });
  if (!item) return;

  await db.knowledgeBaseItem.update({
    where: { id: assumptionId },
    data: {
      title: item.title.replace("[ASSUMPTION]", "[REJECTED]"),
      content: item.content.replace(/\*\*Status:\*\*.*/, `**Status:** REJECTED — ${reason}`),
      tags: [...(item.tags || []).filter(t => t !== "assumption"), "rejected"],
      updatedAt: new Date(),
    },
  });

  // Flag affected artefacts
  if (item.projectId) {
    const artefactsMatch = item.content.match(/\*\*Affected Artefacts:\*\*\s*(.+)/);
    const affected = artefactsMatch?.[1]?.split(",").map(s => s.trim()).filter(Boolean) || [];
    for (const artName of affected) {
      const artefact = await db.agentArtefact.findFirst({
        where: { projectId: item.projectId, name: { contains: artName.split(" ")[0], mode: "insensitive" as any } },
      });
      if (artefact) {
        const meta = (artefact.metadata as any) || {};
        await db.agentArtefact.update({
          where: { id: artefact.id },
          data: {
            metadata: {
              ...meta, stale: true,
              staleReason: `Assumption "${item.title.replace("[ASSUMPTION] ", "")}" was rejected: ${reason}`,
              staleSince: new Date().toISOString(),
            } as any,
          },
        });
      }
    }
  }
}

/**
 * Get all assumptions for a project — used in system prompt injection.
 */
export async function getProjectAssumptions(
  agentId: string,
  projectId: string,
): Promise<string> {
  const items = await db.knowledgeBaseItem.findMany({
    where: {
      agentId,
      projectId,
      title: { startsWith: "[ASSUMPTION]" },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { title: true, content: true },
  });

  if (items.length === 0) return "";

  return items.map(i => {
    const title = i.title.replace("[ASSUMPTION] ", "");
    return `- ASSUMPTION: ${title}\n  ${i.content.split("\n").slice(0, 3).join(" | ")}`;
  }).join("\n");
}
