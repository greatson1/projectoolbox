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
import { parseCriteria, parseBacklogItems } from "./criteria-parser";
import { classifyExecutor } from "./executor-classify";

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
  // Parses the artefact's items into story-typed Task rows. parseBacklogItems
  // handles the formats the generator actually produces (`#### PBI-NNN:`
  // headings, markdown tables, bullets), so this no longer no-ops when the
  // artefact uses the richer document layout. Tagged [source:initial-backlog]
  // in the description so re-runs can wipe and re-seed without touching
  // tasks created by other paths.
  if (lname.includes("initial product backlog") || lname.includes("product backlog")) {
    const items = parseBacklogItems(artefact.content || "");
    if (items.length === 0) {
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
    for (const item of items) {
      // Lightweight MoSCoW hint from the item prose. We only set Must
      // when the line carries strong language — Should/Could/Wont are
      // left null so the user can prioritise after triage.
      const moscow = /\bmust\b/i.test(item.title) ? "MUST"
        : /\bshould\b/i.test(item.title) ? "SHOULD"
        : /\bcould\b/i.test(item.title) ? "COULD"
        : /\bwon[' ]?t\b|\bwont\b/i.test(item.title) ? "WONT"
        : null;

      // Description carries the source tag (so re-runs can find and replace
      // these rows) plus the PBI reference for traceability back to the
      // artefact, where the full acceptance criteria live.
      const description = item.pbiRef
        ? `${SOURCE_TAG} Seeded from Initial Product Backlog artefact (${item.pbiRef}).`
        : `${SOURCE_TAG} Seeded from Initial Product Backlog artefact.`;

      try {
        await db.task.create({
          data: {
            projectId: artefact.projectId,
            title: item.title.slice(0, 255),
            description,
            status: "TODO",
            priority: "MEDIUM",
            type: "story",
            moscow,
            // Inherit the artefact's epic grouping when the parser found
            // one. Closes the consistency gap where agent-seeded backlog
            // tasks would land with epic=null while manually-created tasks
            // carry user-typed epic strings — the Agile Board swimlane
            // would then show "(no epic)" for seeded rows alongside the
            // user's epics. Truncated to 80 chars so a verbose Epic
            // heading doesn't blow out the swimlane width.
            epic: item.epic ? item.epic.slice(0, 80) : null,
            sprintId: null,
            phaseId,
            createdBy: `agent:${agentId}`,
            progress: 0,
            executor: classifyExecutor(item.title),
          },
        });
        created++;
      } catch (e) {
        console.error("[criteria-ingest] backlog task create failed:", item.title, e);
      }
    }
    return { kind: "initialProductBacklog", tasks: created };
  }

  return { kind: "skipped" };
}
