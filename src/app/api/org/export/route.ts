/**
 * Org-wide data export — GDPR Article 20 (right to data portability) for the
 * data controller (the customer organisation).
 *
 * GET /api/org/export
 *   → Returns a JSON blob with all org-scoped data, ready to feed into a
 *     migration tool or hand to a compliance team.
 *
 * Scope:
 *   - OWNER role only. ADMIN can request via support; OWNER is the sole
 *     authority for "we are leaving" decisions.
 *   - Includes every project + its operational records (tasks, artefacts,
 *     risks, stakeholders, costs, decisions, activity log, chat messages,
 *     KB items, approvals).
 *   - Excludes secret material: password hashes, MFA secrets, OAuth tokens,
 *     integration API keys, Stripe IDs, agent prompts that may carry
 *     embedded customer credentials.
 *   - Each table is capped at MAX_RECORDS to keep the response under the
 *     Vercel 4.5 MB body limit on free tier. Larger orgs are flagged with
 *     `truncated: true` per-table and can request a chunked export.
 *
 * Performance: single SELECT per table with `where: { orgId }` (or
 * `where: { project: { orgId } }` for project-scoped tables). Uses the
 * existing indexes; no full-table scans. At 2000 users / ~100 projects per
 * org / ~1000 records per project this returns in well under 10s.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds; export is one-shot, no streaming

const MAX_RECORDS = 10_000;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orgId = (session.user as any).orgId as string | undefined;
  const role = (session.user as any).role as string | undefined;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });
  if (role !== "OWNER") {
    return NextResponse.json({ error: "Only the organisation Owner can export org-wide data" }, { status: 403 });
  }

  const userId = session.user.id;
  const exportedAt = new Date().toISOString();

  // Helper — caps `take` so a runaway table doesn't blow the response body.
  const capped = { take: MAX_RECORDS } as const;

  // Org-scoped (direct orgId column)
  const [
    org,
    memberships,
    invitations,
    projects,
    agents,
    invoices,
    creditTxns,
    apiKeys,
    auditLogs,
    knowledgeBase,
    meetings,
    reports,
  ] = await Promise.all([
    db.organisation.findUnique({
      where: { id: orgId },
      // Don't include relations here — we fetch them separately to keep
      // the payload structure flat and easy to consume.
      select: {
        id: true, name: true, slug: true, industry: true, companySize: true,
        website: true, timezone: true, currency: true, billingEmail: true,
        logoUrl: true, plan: true, creditBalance: true,
        globalHitlPolicy: true, createdAt: true, updatedAt: true,
        // Stripe IDs intentionally omitted — they belong to the billing
        // relationship, not the customer's data.
      },
    }),
    db.userOrganisation.findMany({
      where: { orgId },
      include: {
        user: {
          select: {
            id: true, email: true, name: true, image: true, role: true,
            onboardingComplete: true, createdAt: true, updatedAt: true,
            // passwordHash + mfaSecret + notificationPrefs intentionally omitted
          },
        },
      },
      ...capped,
    }),
    db.invitation.findMany({
      where: { orgId },
      // Don't include the token — that's a credential.
      select: { id: true, email: true, role: true, status: true, invitedBy: true, expiresAt: true, sentAt: true, acceptedAt: true },
      ...capped,
    }),
    db.project.findMany({
      where: { orgId },
      include: {
        members: { select: { userId: true, role: true } },
      },
      ...capped,
    }),
    db.agent.findMany({
      where: { orgId },
      select: {
        id: true, name: true, codename: true, title: true,
        gradient: true, autonomyLevel: true, status: true,
        domainTags: true, personality: true, defaultGreeting: true,
        monthlyBudget: true, createdAt: true, updatedAt: true,
      },
      ...capped,
    }),
    db.invoice.findMany({ where: { orgId }, ...capped }),
    db.creditTransaction.findMany({ where: { orgId }, ...capped }),
    db.apiKey.findMany({
      where: { orgId },
      // Don't return keyHash; the lastFour is fine for user-facing
      // identification of which key did what.
      select: { id: true, name: true, lastFour: true, lastUsed: true, expiresAt: true, revokedAt: true, createdAt: true },
      ...capped,
    }),
    db.auditLog.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, ...capped }),
    db.knowledgeBaseItem.findMany({ where: { orgId }, ...capped }),
    db.meeting.findMany({ where: { orgId }, include: { actionItems: true }, ...capped }),
    db.report.findMany({ where: { orgId }, ...capped }),
  ]);

  // Project-scoped (filtered via project.orgId)
  const projectIds = projects.map((p) => p.id);
  const [
    tasks,
    artefacts,
    risks,
    issues,
    stakeholders,
    costEntries,
    decisions,
    approvals,
    activity,
    chatMessages,
    phases,
    sprints,
  ] = projectIds.length === 0
    ? [[], [], [], [], [], [], [], [], [], [], [], []] as unknown[][]
    : await Promise.all([
        db.task.findMany({ where: { projectId: { in: projectIds } }, ...capped }),
        db.agentArtefact.findMany({ where: { projectId: { in: projectIds } }, ...capped }),
        db.risk.findMany({ where: { projectId: { in: projectIds } }, ...capped }),
        db.issue.findMany({ where: { projectId: { in: projectIds } }, ...capped }),
        db.stakeholder.findMany({ where: { projectId: { in: projectIds } }, ...capped }),
        db.costEntry.findMany({ where: { projectId: { in: projectIds } }, ...capped }),
        db.decision.findMany({ where: { projectId: { in: projectIds } }, ...capped }),
        db.approval.findMany({ where: { projectId: { in: projectIds } }, ...capped }),
        // AgentActivity has no projectId column — scope through the agent's
        // orgId instead. Same scope (all activity in this org) since every
        // agent belongs to exactly one org.
        db.agentActivity.findMany({ where: { agent: { orgId } }, orderBy: { createdAt: "desc" }, ...capped }),
        db.chatMessage.findMany({
          where: { agent: { orgId } },
          orderBy: { createdAt: "desc" },
          ...capped,
        }),
        db.phase.findMany({ where: { projectId: { in: projectIds } }, ...capped }),
        db.sprint.findMany({ where: { projectId: { in: projectIds } }, ...capped }),
      ]);

  // Per-table truncation flags — surface to the customer so they know if
  // they hit the cap.
  const truncations: Record<string, boolean> = {};
  const flag = (k: string, arr: unknown[]) => { truncations[k] = arr.length >= MAX_RECORDS; };
  flag("memberships", memberships);
  flag("invitations", invitations);
  flag("projects", projects);
  flag("agents", agents);
  flag("invoices", invoices);
  flag("creditTxns", creditTxns);
  flag("apiKeys", apiKeys);
  flag("auditLogs", auditLogs);
  flag("knowledgeBase", knowledgeBase);
  flag("meetings", meetings);
  flag("reports", reports);
  flag("tasks", tasks);
  flag("artefacts", artefacts);
  flag("risks", risks);
  flag("issues", issues);
  flag("stakeholders", stakeholders);
  flag("costEntries", costEntries);
  flag("decisions", decisions);
  flag("approvals", approvals);
  flag("activity", activity);
  flag("chatMessages", chatMessages);
  flag("phases", phases);
  flag("sprints", sprints);

  const payload = {
    meta: {
      format: "projectoolbox-org-export-v1",
      exportedAt,
      exportedBy: { userId, email: session.user.email },
      orgId,
      maxRecordsPerTable: MAX_RECORDS,
      truncated: Object.values(truncations).some(Boolean),
      truncations,
      notes: [
        "Password hashes, MFA secrets, OAuth tokens, integration API secrets and Stripe IDs are deliberately excluded.",
        "API key tokens are excluded; only metadata is included.",
        "If any table is marked `truncated: true`, contact support for a chunked export of that table.",
      ],
    },
    organisation: org,
    memberships,
    invitations,
    projects,
    agents,
    knowledgeBase,
    auditLogs,
    invoices,
    creditTransactions: creditTxns,
    apiKeys,
    meetings,
    reports,
    project_scoped: {
      tasks,
      artefacts,
      risks,
      issues,
      stakeholders,
      costEntries,
      decisions,
      approvals,
      activity,
      chatMessages,
      phases,
      sprints,
    },
  };

  // Audit the export — important for compliance trail.
  await db.auditLog.create({
    data: {
      orgId,
      userId,
      action: "Exported organisation data",
      target: `${projectIds.length} project(s), ${memberships.length} member(s)`,
    },
  });

  // Return as downloadable JSON file
  const filename = `org-export-${org?.slug || orgId}-${exportedAt.slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}