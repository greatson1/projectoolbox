/**
 * Daily Digest Generator
 *
 * Generates a summary of the day's agent activities for each org.
 * Called from the cron tick — only generates once per day.
 */

import { db } from "@/lib/db";

export async function generateDailyDigest(): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get all orgs
  const orgs = await db.organisation.findMany({ select: { id: true, name: true } });
  let generated = 0;

  for (const org of orgs) {
    // Check if today's digest already exists
    const existing = await db.dailyDigest.findUnique({
      where: { orgId_date: { orgId: org.id, date: today } },
    });
    if (existing) continue;

    // Get today's activities for this org
    const activities = await db.agentActivity.findMany({
      where: {
        agent: { orgId: org.id },
        createdAt: { gte: today },
      },
      include: { agent: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });

    if (activities.length === 0) continue; // No activity = no digest

    // Get stats
    const agents = [...new Set(activities.map(a => a.agent.name))];
    const actionCount = activities.length;
    const alerts = activities.filter(a => a.type.includes("alert")).length;
    const decisions = await db.agentDecision.count({
      where: { agent: { orgId: org.id }, createdAt: { gte: today } },
    });
    const approvals = await db.approval.count({
      where: { project: { orgId: org.id }, status: "PENDING" },
    });

    // Build summary
    const summary = `${agents.length} agent${agents.length > 1 ? "s" : ""} performed ${actionCount} action${actionCount !== 1 ? "s" : ""} today. ${alerts > 0 ? `${alerts} proactive alert${alerts !== 1 ? "s" : ""} raised. ` : ""}${decisions > 0 ? `${decisions} decision${decisions !== 1 ? "s" : ""} made. ` : ""}${approvals > 0 ? `${approvals} approval${approvals !== 1 ? "s" : ""} pending.` : "All approvals resolved."}`;

    // Build highlights
    const highlights = activities.slice(0, 5).map(a =>
      `${a.agent.name}: ${a.summary.slice(0, 100)}`
    );

    // Build stats
    const stats = {
      totalActions: actionCount,
      agents: agents.length,
      alerts,
      decisions,
      pendingApprovals: approvals,
    };

    await db.dailyDigest.create({
      data: {
        orgId: org.id,
        date: today,
        summary,
        highlights,
        stats,
      },
    });

    generated++;
  }

  return generated;
}
