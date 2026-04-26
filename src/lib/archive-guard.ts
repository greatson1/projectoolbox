import { db } from "@/lib/db";

/**
 * Returns null if the entity is mutable, or a `{ error, status }` payload
 * the caller can return directly to the client when archived.
 *
 * `archivedAt` is the canonical signal — we never trust status alone, because
 * legacy rows or a half-applied migration could have one without the other.
 */

export type ArchiveBlock = { error: string; status: number; reason?: string | null };

export async function ensureProjectMutable(projectId: string): Promise<ArchiveBlock | null> {
  const p = await db.project.findUnique({
    where: { id: projectId },
    select: { archivedAt: true, archiveReason: true },
  });
  if (p?.archivedAt) {
    return {
      error: "Project is archived (read-only)",
      reason: p.archiveReason,
      status: 423, // Locked
    };
  }
  return null;
}

export async function ensureAgentMutable(agentId: string): Promise<ArchiveBlock | null> {
  const a = await db.agent.findUnique({
    where: { id: agentId },
    select: { archivedAt: true, archiveReason: true },
  });
  if (a?.archivedAt) {
    return {
      error: "Agent is archived (read-only)",
      reason: a.archiveReason,
      status: 423,
    };
  }
  return null;
}
