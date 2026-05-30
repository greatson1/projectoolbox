/**
 * Personal data export — GDPR Article 15 (right of access) for the data
 * subject (the individual user).
 *
 * GET /api/account/export
 *   → Returns a JSON blob with every record carrying this user's data:
 *     their User row, org memberships, project memberships, approvals
 *     they actioned, decisions they recorded, notifications addressed to
 *     them, audit-log entries they triggered, and chat messages they sent.
 *
 *   Any authenticated user can call this for THEIR own data — no admin
 *   override or impersonation, by design. Owners who need to fulfil a
 *   data subject access request on behalf of an employee should ask the
 *   employee to download their own data and forward it.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_RECORDS = 10_000;
const capped = { take: MAX_RECORDS } as const;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const exportedAt = new Date().toISOString();

  const [
    user,
    memberships,
    projectMemberships,
    approvalsAssigned,
    decisionsRecorded,
    notifications,
    auditLogs,
  ] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      // Exclude credential material; include preferences + display info.
      select: {
        id: true, email: true, name: true, image: true,
        emailVerified: true, role: true, onboardingComplete: true,
        notificationPrefs: true, orgId: true, mfaEnabled: true,
        createdAt: true, updatedAt: true,
      },
    }),
    db.userOrganisation.findMany({
      where: { userId },
      include: {
        org: { select: { id: true, name: true, slug: true, industry: true } },
      },
    }),
    db.projectMember.findMany({
      where: { userId },
      include: {
        project: { select: { id: true, name: true, status: true, orgId: true } },
      },
      ...capped,
    }),
    // Approvals routed to me OR raised by me. `assignedToId` is the reviewer;
    // `requestedById` is the requester. Both relate me to the record.
    db.approval.findMany({
      where: { OR: [{ assignedToId: userId }, { requestedById: userId }] },
      ...capped,
    }),
    db.decision.findMany({ where: { userId }, ...capped }),
    db.notification.findMany({ where: { userId }, ...capped }),
    db.auditLog.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, ...capped }),
  ]);

  const payload = {
    meta: {
      format: "projectoolbox-account-export-v1",
      exportedAt,
      userId,
      maxRecordsPerTable: MAX_RECORDS,
      notes: [
        "Password hash and MFA secret are deliberately excluded.",
        "OAuth provider tokens (Account.access_token, refresh_token) are excluded.",
        "ChatMessage rows aren't keyed to individual users in the current schema (they reference the agent, not the sender), so personal chat history isn't included here. If you need it, the organisation Owner can request a full org export and filter messages by the agents you used.",
      ],
    },
    user,
    organisationMemberships: memberships,
    projectMemberships,
    approvalsRelated: approvalsAssigned,
    decisionsRecorded,
    notifications,
    auditLogEntries: auditLogs,
  };

  // Audit the export so the user has a record AND the org sees it (per
  // GDPR transparency principle — the data controller should know when
  // data subjects exercise their rights).
  const orgId = (session.user as any).orgId as string | undefined;
  if (orgId) {
    await db.auditLog.create({
      data: { orgId, userId, action: "Exported personal data", target: "DSAR fulfilment (Article 15)" },
    });
  }

  const filename = `account-export-${userId}-${exportedAt.slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}