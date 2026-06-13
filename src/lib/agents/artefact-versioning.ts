/**
 * Shared versioned-update helper for artefact content.
 *
 * Every programmatic content rewrite (sync engine, chat edits, KB/TBC
 * propagation) should go through updateArtefactContentVersioned so that:
 *   1. the replaced content is preserved as an ArtefactVersion snapshot
 *      (otherwise the version history sidebar has gaps and "restore"
 *      can't recover what was overwritten), and
 *   2. the artefact's version counter is bumped consistently.
 *
 * The artefact PATCH API route keeps its own inline equivalent — its
 * snapshot is interwoven with status/feedback/metadata handling and the
 * edit-after-approval guard.
 */

import { db } from "@/lib/db";

export async function updateArtefactContentVersioned(
  artefactId: string,
  newContent: string,
  opts: { editedBy?: string; comment?: string; status?: string; feedback?: string } = {},
): Promise<void> {
  const existing = await db.agentArtefact.findUnique({
    where: { id: artefactId },
    select: { version: true, content: true, status: true },
  });
  if (!existing) return;

  // Best-effort, like the background writers that call this: a snapshot
  // failure is logged but never blocks the content update itself.
  try {
    await db.artefactVersion.create({
      data: {
        artefactId,
        version: existing.version,
        content: existing.content,
        status: existing.status,
        editedBy: opts.editedBy || "system",
        comment: opts.comment || "Automated content update",
      },
    });
  } catch (e) {
    console.error("[artefact-versioning] snapshot failed (non-blocking):", e);
  }

  await db.agentArtefact.update({
    where: { id: artefactId },
    data: {
      content: newContent,
      version: { increment: 1 },
      ...(opts.status && { status: opts.status }),
      ...(opts.feedback !== undefined && { feedback: opts.feedback }),
    },
  });
}
