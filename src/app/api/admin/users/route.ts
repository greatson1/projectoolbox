import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/users
 *
 * Same auth pattern as /api/waitlist GET — header `x-admin-key` must
 * equal `process.env.ADMIN_SECRET`. Returns every User row with the
 * activity signals an admin actually cares about: which org they're in,
 * its plan, how many projects/agents/chats are linked, last login
 * (approximated by the most recent ChatMessage from that user's org), and
 * whether they actually completed onboarding.
 *
 * Two derived flags:
 *   - looksAbandoned: registered, onboarding-complete, has an org, but
 *     no projects, agents, or chats. The "Sakshi" pattern — engaged just
 *     enough to make an account then bounced.
 *   - looksBrokenSignup: emailVerified AND no passwordHash AND no Account
 *     row. The "Mohd Amaan" pattern — stuck partway through OAuth.
 */
export async function GET(req: NextRequest) {
  const adminKey = req.headers.get("x-admin-key");
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Pull every user with their org + counts. Done as a few parallel queries
  // rather than one mega-join so the shape stays easy to read; admin user
  // counts are <1000 in the foreseeable future so the N+1 doesn't bite.
  const users = await db.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, email: true, name: true, role: true,
      orgId: true, emailVerified: true, passwordHash: true,
      onboardingComplete: true, createdAt: true, updatedAt: true,
      org: { select: { name: true, plan: true } },
    },
  });

  const userIds = users.map(u => u.id);
  const orgIds = Array.from(new Set(users.map(u => u.orgId).filter((x): x is string => !!x)));

  const [accountRows, sessionRows, projectsByOrg, agentsByOrg, chatsByOrg] = await Promise.all([
    db.account.groupBy({ by: ["userId"], _count: { _all: true }, where: { userId: { in: userIds } } }),
    // Session.expires > now() counts as "still logged in". When the JWT
    // strategy is in use (current), Session rows are rare — but we still
    // surface the count so an env switch to database sessions doesn't
    // silently break the metric.
    db.session.groupBy({
      by: ["userId"], _count: { _all: true },
      where: { userId: { in: userIds }, expires: { gt: new Date() } },
    }),
    orgIds.length ? db.project.groupBy({ by: ["orgId"], _count: { _all: true }, where: { orgId: { in: orgIds } } }) : [],
    orgIds.length ? db.agent.groupBy({ by: ["orgId"], _count: { _all: true }, where: { orgId: { in: orgIds } } }) : [],
    // Chat activity is the strongest "is this org actually using the
    // product" signal. Joined via Agent → Org because ChatMessage has no
    // orgId of its own.
    orgIds.length ? db.$queryRawUnsafe<Array<{ orgId: string; n: number; last: Date | null }>>(`
      SELECT a."orgId", COUNT(*)::int as n, MAX(cm."createdAt") as last
      FROM "ChatMessage" cm
      JOIN "Agent" a ON a.id = cm."agentId"
      WHERE a."orgId" = ANY($1::text[])
      GROUP BY a."orgId"
    `, orgIds) : [],
  ]);

  const accountByUser = Object.fromEntries(accountRows.map(r => [r.userId, r._count._all]));
  const activeSessionByUser = Object.fromEntries(sessionRows.map(r => [r.userId, r._count._all]));
  const projectsByOrgMap = Object.fromEntries(projectsByOrg.map(r => [r.orgId, r._count._all]));
  const agentsByOrgMap = Object.fromEntries(agentsByOrg.map(r => [r.orgId, r._count._all]));
  const chatsByOrgMap = Object.fromEntries((chatsByOrg as any[]).map(r => [r.orgId, { n: r.n, last: r.last }]));

  const data = users.map(u => {
    const linkedAccounts = accountByUser[u.id] || 0;
    const activeSessions = activeSessionByUser[u.id] || 0;
    const projects = u.orgId ? projectsByOrgMap[u.orgId] || 0 : 0;
    const agents = u.orgId ? agentsByOrgMap[u.orgId] || 0 : 0;
    const chats = u.orgId ? (chatsByOrgMap[u.orgId]?.n || 0) : 0;
    const lastChatAt: Date | null = u.orgId ? (chatsByOrgMap[u.orgId]?.last || null) : null;

    const looksBrokenSignup = !!u.emailVerified && !u.passwordHash && linkedAccounts === 0;
    const looksAbandoned = !!u.onboardingComplete && !!u.orgId && projects === 0 && agents === 0 && chats === 0;

    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      org: u.orgId ? { id: u.orgId, name: u.org?.name ?? "(unknown)", plan: u.org?.plan ?? "FREE" } : null,
      emailVerified: u.emailVerified,
      passwordHash: !!u.passwordHash,
      linkedAccounts,
      activeSessions,
      onboardingComplete: u.onboardingComplete,
      projects, agents, chats,
      lastActivityAt: lastChatAt ?? u.updatedAt,
      createdAt: u.createdAt,
      looksBrokenSignup,
      looksAbandoned,
    };
  });

  // Filter out obvious test accounts from the headline count but include them
  // in the response — the UI can toggle to show them. Excluding here would
  // hide bot-stuffed test signups too, which is the opposite of useful.
  const realCount = data.filter(u => !/@projectoolbox\.test$|^ui-walk-|^e2e-/.test(u.email)).length;

  return NextResponse.json({
    data,
    count: data.length,
    realCount,
  });
}
