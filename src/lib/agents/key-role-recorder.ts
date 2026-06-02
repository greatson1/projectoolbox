/**
 * Single-source-of-truth recorder for KEY PROJECT ROLES (Sponsor, PM, etc).
 *
 * Background — the bug this exists to stop:
 *
 * There are four input surfaces that can capture a sponsor (or PM, or
 * client) on a project: the deploy wizard's Stakeholder array, the
 * deploy wizard's single sponsor field, the chat agent's Haiku-backed
 * extract-answer-from-reply backstop, and direct add/edit via the
 * People page. Until this helper, each surface wrote to ONE store and
 * not the others:
 *
 *   - Deploy wizard array       → Stakeholder table only
 *   - Deploy wizard single      → Stakeholder table only (also dead code)
 *   - Chat backstop             → KnowledgeBaseItem (user_confirmed) only
 *   - People page add/update    → Stakeholder table only
 *
 * The phase-prerequisite evaluator reads BOTH stores
 * (phase-prerequisites.ts:172-184): a Stakeholder row with role
 * matching "sponsor" OR a confirmed-fact KB item with title containing
 * "sponsor" both tick the "Sponsor identified and confirmed" prereq.
 * So whichever surface the user used, the prereq auto-tick worked
 * IFF that surface happened to write to one of the two stores. But:
 *
 *  (a) Edits on one surface didn't propagate to the other, so a fact
 *      added in chat was invisible to anything looking at the
 *      Stakeholder page, and vice versa.
 *  (b) The system felt non-deterministic to users — "I said the sponsor
 *      was X via chat, why isn't there a Sponsor row?" or "I added a
 *      sponsor via the wizard, why doesn't the agent mention them?".
 *
 * Every key-role write now goes through `recordKeyRole`, which:
 *   1. Upserts a Stakeholder row (matches by case-insensitive name).
 *   2. Upserts a KnowledgeBaseItem with HIGH_TRUST + user_confirmed
 *      tags (matches by title).
 *   3. Logs an agentActivity entry citing the source so we have a
 *      paper trail when the same role is set twice from different
 *      surfaces.
 *
 * Use `classifyKeyRole(roleString)` first to canonicalise free-text
 * role strings ("PM", "sponsor", "ProjectSponsor", "Client") into
 * the canonical title. Returns null when the string doesn't map to a
 * key role — in that case, fall back to the normal stakeholder /
 * KB write path.
 */

import { db } from "@/lib/db";
// classifyKeyRole lives in its own file so it can be unit-tested
// without dragging in Prisma. Re-exported here so existing callers
// have a single import surface.
export { classifyKeyRole } from "./classify-key-role";
import { classifyKeyRole } from "./classify-key-role";

export type KeyRoleSource =
  | "wizard-stakeholders"   // deploy wizard's stakeholders[] array
  | "wizard-key-fields"     // deploy wizard's single sponsor / pm / client fields
  | "chat-backstop"         // chat-stream Haiku extracted fact
  | "people-page"           // direct add/edit on /projects/:id/stakeholders
  | "artefact-extracted";   // pulled from an approved Stakeholder Register CSV

export interface RecordKeyRoleArgs {
  projectId: string;
  orgId: string;
  /** Canonical role title from classifyKeyRole(). */
  role: string;
  name: string;
  source: KeyRoleSource;
  /** Optional. If omitted, the active deployment's agentId is used. */
  agentId?: string;
}

export interface RecordKeyRoleResult {
  stakeholderId: string;
  kbItemId: string | null;
  /** True when a Stakeholder row was created (false = updated existing). */
  stakeholderCreated: boolean;
  /** True when a KB item was created. False = updated existing or no agent. */
  kbItemCreated: boolean;
}

/**
 * Record a key-role assignment to ALL relevant stores. Idempotent —
 * safe to call repeatedly with the same {projectId, role, name} triple.
 *
 * The phase-prerequisite evaluator (phase-prerequisites.ts) reads both
 * Stakeholder.role AND KnowledgeBaseItem.title for sponsor-style
 * prereqs. Writing to both means whichever store the evaluator looks
 * at, the prereq auto-ticks — and a user who's said the sponsor's
 * name on ANY surface gets the same outcome on the Tracker.
 */
export async function recordKeyRole(args: RecordKeyRoleArgs): Promise<RecordKeyRoleResult> {
  const cleanName = args.name.trim();
  if (!cleanName) throw new Error("recordKeyRole: name is required");

  // 1. Upsert Stakeholder row. Match on case-insensitive name so we
  //    don't create "Mum" and "mum" as two separate rows.
  const existingStakeholder = await db.stakeholder.findFirst({
    where: {
      projectId: args.projectId,
      name: { equals: cleanName, mode: "insensitive" as const },
    },
    select: { id: true, role: true, name: true },
  });

  let stakeholderId: string;
  let stakeholderCreated = false;
  if (existingStakeholder) {
    stakeholderId = existingStakeholder.id;
    // Only update role when the existing row has no role OR has a role
    // that doesn't classify to this canonical name. Avoid overwriting
    // "Executive Sponsor" with "Project Sponsor" or vice versa.
    const existingClass = classifyKeyRole(existingStakeholder.role);
    if (!existingStakeholder.role || existingClass !== args.role) {
      await db.stakeholder.update({
        where: { id: existingStakeholder.id },
        data: { role: args.role },
      });
    }
  } else {
    const created = await db.stakeholder.create({
      data: {
        projectId: args.projectId,
        name: cleanName,
        role: args.role,
        power: 80,    // key roles default to high power…
        interest: 80, // …and high interest. User can adjust later.
      },
    });
    stakeholderId = created.id;
    stakeholderCreated = true;
  }

  // 2. Find an agentId to attach the KB item to. KnowledgeBaseItem
  //    requires agentId (FK), so when the caller didn't supply one
  //    (People page edits aren't agent-scoped) we look up the project's
  //    active deployment.
  let agentId = args.agentId;
  if (!agentId) {
    const deployment = await db.agentDeployment.findFirst({
      where: { projectId: args.projectId, isActive: true },
      orderBy: { deployedAt: "desc" },
      select: { agentId: true },
    });
    agentId = deployment?.agentId ?? undefined;
  }

  let kbItemId: string | null = null;
  let kbItemCreated = false;

  if (agentId) {
    // 3. Upsert KnowledgeBaseItem. Title = canonical role name so the
    //    prereq evaluator's substring match finds it regardless of which
    //    surface wrote it. Tag with the source so we can audit later.
    const existingKb = await db.knowledgeBaseItem.findFirst({
      where: { agentId, projectId: args.projectId, title: args.role },
      select: { id: true },
    });
    const content = `[User confirmed ${new Date().toLocaleDateString("en-GB")} via ${args.source}] ${args.role}: ${cleanName}.`;
    const baseData = {
      content,
      trustLevel: "HIGH_TRUST" as const,
      tags: ["user_confirmed", "project_fact", "key_role", args.source],
      metadata: {
        source: args.source,
        canonicalRole: args.role,
        recordedAt: new Date().toISOString(),
      } as any,
    };
    if (existingKb) {
      kbItemId = existingKb.id;
      await db.knowledgeBaseItem.update({
        where: { id: existingKb.id },
        data: { ...baseData, updatedAt: new Date() },
      });
    } else {
      const created = await db.knowledgeBaseItem.create({
        data: {
          orgId: args.orgId,
          agentId,
          projectId: args.projectId,
          layer: "PROJECT",
          type: "TEXT",
          title: args.role,
          ...baseData,
        },
      });
      kbItemId = created.id;
      kbItemCreated = true;
    }

    // 4. Activity log — leaves a paper trail when the same role is
    //    re-recorded from different surfaces.
    await db.agentActivity.create({
      data: {
        agentId,
        type: "chat",
        summary: `${args.role} recorded: ${cleanName} (source: ${args.source}${stakeholderCreated ? "; new stakeholder row" : ""}${kbItemCreated ? "; new KB fact" : ""})`,
      },
    }).catch(() => {});
  }

  return { stakeholderId, kbItemId, stakeholderCreated, kbItemCreated };
}
