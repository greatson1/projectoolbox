/**
 * Field Check-ins — daily cron that chases silent real-world work.
 *
 * The agent can see its own document tasks move, but HUMAN-executor tasks
 * (installs, workshops, sign-offs) only move when someone reports progress.
 * When an in-flight HUMAN task has been silent for CHASE_AFTER_DAYS, the
 * agent raises a CheckIn: a chat card + notification asking for a status.
 * Any progress update on the task resolves its open check-ins (see the
 * task PATCH handler).
 *
 * Cron schedule: 0 7 * * * (daily, 07:00 UTC). Protected by CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHASE_AFTER_DAYS = 3;
const MAX_CHASES_PER_PROJECT = 5;
const DAY_MS = 86_400_000;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ?afterDays=N overrides the silence threshold (still behind CRON_SECRET
  // in prod) — lets ops trigger an immediate sweep after an incident.
  const afterDaysParam = Number(new URL(req.url).searchParams.get("afterDays"));
  const afterDays = Number.isFinite(afterDaysParam) && afterDaysParam >= 0 ? afterDaysParam : CHASE_AFTER_DAYS;
  const cutoff = new Date(Date.now() - afterDays * DAY_MS);
  let checkInsCreated = 0;
  const chased: string[] = [];

  try {
    const projects = await db.project.findMany({
      where: { status: "ACTIVE", archivedAt: null },
      select: {
        id: true,
        name: true,
        orgId: true,
        agents: {
          where: { isActive: true },
          select: { agentId: true, agent: { select: { name: true } } },
          take: 1,
        },
      },
    });

    for (const project of projects) {
      const agentId = project.agents[0]?.agentId ?? null;
      const agentName = project.agents[0]?.agent?.name ?? "Agent";

      // In-flight human work that has been quiet since the cutoff. lastUpdateAt
      // is the human-report timestamp; fall back to startDate/createdAt for
      // tasks nobody has ever reported on.
      const candidates = await db.task.findMany({
        where: {
          projectId: project.id,
          executor: "HUMAN",
          status: "IN_PROGRESS",
          OR: [
            { lastUpdateAt: { lt: cutoff } },
            { lastUpdateAt: null, startDate: { lt: cutoff } },
            { lastUpdateAt: null, startDate: null, createdAt: { lt: cutoff } },
          ],
        },
        select: { id: true, title: true, isCriticalPath: true, lastUpdateAt: true, startDate: true, createdAt: true },
        orderBy: [{ isCriticalPath: "desc" }, { startDate: "asc" }],
        take: MAX_CHASES_PER_PROJECT * 3,
      });
      if (candidates.length === 0) continue;

      // One open chase per task at a time.
      const openByTask = new Set(
        (
          await db.checkIn.findMany({
            where: { projectId: project.id, status: "OPEN", taskId: { in: candidates.map((t) => t.id) } },
            select: { taskId: true },
          })
        ).map((c) => c.taskId),
      );

      let createdForProject = 0;
      for (const task of candidates) {
        if (createdForProject >= MAX_CHASES_PER_PROJECT) break;
        if (openByTask.has(task.id)) continue;

        const silentSince = task.lastUpdateAt ?? task.startDate ?? task.createdAt;
        const silentDays = Math.floor((Date.now() - silentSince.getTime()) / DAY_MS);
        const question =
          `"${task.title}" has been in progress with no update for ${silentDays} day${silentDays === 1 ? "" : "s"}` +
          (task.isCriticalPath ? " — and it is on the critical path" : "") +
          `. What's the latest? Update the task's progress (or mark it blocked with a reason) and I'll fold it into the schedule.`;

        const checkIn = await db.checkIn.create({
          data: { projectId: project.id, taskId: task.id, agentId, question },
        });

        if (agentId) {
          await db.chatMessage.create({
            data: {
              agentId,
              role: "agent",
              content: "__CHECK_IN__",
              metadata: {
                type: "check_in",
                checkInId: checkIn.id,
                taskId: task.id,
                taskTitle: task.title,
                question,
                critical: task.isCriticalPath,
              } as any,
            },
          }).catch(() => {});
        }

        try {
          const { dispatchNotification } = await import("@/lib/agents/notification-channels");
          await dispatchNotification(project.orgId, {
            agentId: agentId ?? undefined,
            agentName,
            projectName: project.name,
            title: `Check-in: ${task.title}`,
            body: question,
            actionUrl: `/projects/${project.id}/pm-tracker`,
            urgency: task.isCriticalPath ? "high" : "medium",
          });
        } catch (e) {
          console.error("[field-checkins] notification failed (non-blocking):", e);
        }

        checkInsCreated++;
        createdForProject++;
        chased.push(`${project.name}: ${task.title}`);
      }
    }

    return NextResponse.json({ data: { checkInsCreated, chased } });
  } catch (e: any) {
    console.error("[field-checkins] failed:", e);
    return NextResponse.json({ error: e?.message || "field-checkins failed" }, { status: 500 });
  }
}
