/**
 * KnowledgeBaseItem write helper.
 *
 * KnowledgeBaseItem.orgId is a REQUIRED column, but it isn't derivable from
 * the fields a caller naturally has (agentId / projectId / title / content),
 * so every raw `db.knowledgeBaseItem.create({...})` is one forgotten `orgId`
 * away from a typecheck break — which has recurred repeatedly in the seeders.
 *
 * createKbItem() owns that resolution: pass everything EXCEPT orgId (with
 * projectId required) and it fills orgId from the project. Callers can't
 * forget it because the input type doesn't accept it. Returns the created
 * row, or null when the project/org can't be resolved (the seeders treat a
 * missing org as "skip", never as a hard error).
 */

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/** KnowledgeBaseItem create data minus orgId (resolved internally), with
 *  projectId required so the org lookup always has a key. */
export type KbItemInput =
  Omit<Prisma.KnowledgeBaseItemUncheckedCreateInput, "orgId" | "projectId"> & {
    projectId: string;
  };

/**
 * Create a KnowledgeBaseItem, resolving the required orgId from the project.
 * Returns null (without throwing) when the project or its org can't be found.
 */
export async function createKbItem(data: KbItemInput) {
  const project = await db.project.findUnique({
    where: { id: data.projectId },
    select: { orgId: true },
  });
  if (!project?.orgId) return null;
  return db.knowledgeBaseItem.create({
    data: { ...data, orgId: project.orgId },
  });
}
