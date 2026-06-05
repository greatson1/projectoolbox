/**
 * Definition of Done / Definition of Ready / Initial Product Backlog
 * ingestion. Called from the artefact PATCH handler when one of these
 * artefacts transitions to APPROVED (or its content is edited after
 * approval).
 *
 *   - Definition of Done   → Project.definitionOfDone  = { criteria, sourceArtefactId, approvedAt }
 *   - Definition of Ready  → Project.definitionOfReady = same shape
 *   - Initial Product Backlog → Task rows with type=story, sprintId=null,
 *                               createdBy=agent:<id>, description tagged
 *                               [source:initial-backlog] for idempotent
 *                               re-runs.
 *
 * Idempotent — running twice on the same artefact reaches the same final
 * state. Edits to an already-approved artefact re-run the ingest and
 * overwrite the previous criteria / replace the previously seeded backlog
 * Task rows.
 */

import { db } from "@/lib/db";
import { parseCriteria } from "./criteria-parser";

export async function ingestCriteriaArtefact(
  artefact: { id: string; name: string; content: string; projectId: string },
  _agentId: string,
): Promise<{ kind: string; criteria?: number; tasks?: number }> {
  const lname = artefact.name.toLowerCase();

  // ── Definition of Done ──────────────────────────────────────────────
  if (lname.includes("definition of done")) {
    const parsed = parseCriteria(artefact.content || "");
    await db.project.update({
      where: { id: artefact.projectId },
      data: {
        definitionOfDone: {
          criteria: parsed.criteria,
          sourceArtefactId: artefact.id,
          approvedAt: new Date().toISOString(),
          emptyListsDetected: parsed.emptyListsDetected,
        } as any,
      },
    });
    return { kind: "definitionOfDone", criteria: parsed.criteria.length };
  }

  // ── Definition of Ready ─────────────────────────────────────────────
  if (lname.includes("definition of ready")) {
    const parsed = parseCriteria(artefact.content || "");
    await db.project.update({
      where: { id: artefact.projectId },
      data: {
        definitionOfReady: {
          criteria: parsed.criteria,
          sourceArtefactId: artefact.id,
          approvedAt: new Date().toISOString(),
          emptyListsDetected: parsed.emptyListsDetected,
        } as any,
      },
    });
    return { kind: "definitionOfReady", criteria: parsed.criteria.length };
  }

  // ── Initial Product Backlog → Task rows ─────────────────────────────
  // Parses the artefact's bulleted items into story-typed Task rows.
  // Tagged [source:initial-backlog] in the description so re-runs can
  // wipe and re-seed without touching tasks created by other paths.
  if (lname.includes("initial product backlog") || lname.includes("product backlog")) {
    const parsed = parseCriteria(artefact.content || "");
    if (parsed.criteria.length === 0) {
      return { kind: "initialProductBacklog", tasks: 0 };
    }
    const SOURCE_TAG = "[source:initial-backlog]";

    // Delete previously seeded backlog tasks for this project so re-runs
    // don't duplicate. Scoped by createdBy=agent:* AND description tag so
    // we never touch user-created tasks.
    await db.task.deleteMany({
      where: {
        projectId: artefact.projectId,
        description: { contains: SOURCE_TAG },
        createdBy: { startsWith: "agent:" },
      },
    });

    // Find active deployment for createdBy attribution.
    const activeDep = await db.agentDeployment.findFirst({
      where: { projectId: artefact.projectId, isActive: true },
      select: { agentId: true, currentPhase: true },
    });
    const agentId = activeDep?.agentId ?? _agentId;
    const phaseId = activeDep?.currentPhase ?? null;

    let created = 0;
    for (const title of parsed.criteria) {
      // Lightweight MoSCoW hint from the item prose. We only set Must
      // when the line carries strong language — Should/Could/Wont are
      // left null so the user can prioritise after triage.
      const moscow = /\bmust\b/i.test(title) ? "MUST"
        : /\bshould\b/i.test(title) ? "SHOULD"
        : /\bcould\b/i.test(title) ? "COULD"
        : /\bwon[' ]?t\b|\bwont\b/i.test(title) ? "WONT"
        : null;

      try {
        await db.task.create({
          data: {
            projectId: artefact.projectId,
            title: title.slice(0, 255),
            description: `${SOURCE_TAG} Seeded from Initial Product Backlog artefact.`,
            status: "TODO",
            priority: "MEDIUM",
            type: "story",
            moscow,
            sprintId: null,
            phaseId,
            createdBy: `agent:${agentId}`,
            progress: 0,
          },
        });
        created++;
      } catch (e) {
        console.error("[criteria-ingest] backlog task create failed:", title, e);
      }
    }
    return { kind: "initialProductBacklog", tasks: created };
  }

  return { kind: "skipped" };
}
