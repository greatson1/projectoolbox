import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ── GET /api/reports/schedule?projectId=xxx ──────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation — session may still be loading" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  const schedules = await db.reportSchedule.findMany({
    where: {
      orgId,
      ...(projectId ? { projectId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: schedules });
}

// ── POST /api/reports/schedule ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const body = await req.json();
  const {
    name, templateId, projectId,
    frequency = "WEEKLY",
    dayOfWeek = 1,    // 0=Sun … 6=Sat (for WEEKLY/BIWEEKLY)
    dayOfMonth = 1,   // 1–28 (for MONTHLY)
    hour = 9,         // 0–23
    recipients = [],
  } = body;

  const cron = buildCron(frequency, dayOfWeek, dayOfMonth, hour);
  const nextRunAt = calcNextRun(frequency, dayOfWeek, dayOfMonth, hour);

  const schedule = await db.reportSchedule.create({
    data: {
      orgId,
      projectId: projectId || null,
      name: name || buildDefaultName(templateId, frequency),
      templateId: templateId || "status",
      frequency,
      cronExpression: cron,
      recipients,
      isActive: true,
      nextRunAt,
    },
  });

  return NextResponse.json({ data: schedule }, { status: 201 });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function buildCron(frequency: string, dayOfWeek: number, dayOfMonth: number, hour: number): string {
  switch (frequency) {
    case "DAILY":     return `0 ${hour} * * *`;
    case "WEEKLY":    return `0 ${hour} * * ${dayOfWeek}`;
    case "BIWEEKLY":  return `0 ${hour} * * ${dayOfWeek}`; // handled at run time — we skip alternate weeks
    case "MONTHLY":   return `0 ${hour} ${dayOfMonth} * *`;
    default:          return `0 ${hour} * * ${dayOfWeek}`;
  }
}

export function calcNextRun(frequency: string, dayOfWeek: number, dayOfMonth: number, hour: number): Date {
  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0);
  next.setMilliseconds(0);
  next.setMinutes(0);
  next.setHours(hour);

  switch (frequency) {
    case "DAILY": {
      if (next <= now) next.setDate(next.getDate() + 1);
      break;
    }
    case "WEEKLY":
    case "BIWEEKLY": {
      const todayDow = now.getDay();
      let daysUntil = (dayOfWeek - todayDow + 7) % 7;
      if (daysUntil === 0 && next <= now) daysUntil = 7;
      next.setDate(next.getDate() + daysUntil);
      if (frequency === "BIWEEKLY") next.setDate(next.getDate() + 7);
      break;
    }
    case "MONTHLY": {
      next.setDate(dayOfMonth);
      if (next <= now) {
        next.setMonth(next.getMonth() + 1);
        next.setDate(dayOfMonth);
      }
      break;
    }
  }
  return next;
}

function buildDefaultName(templateId: string, frequency: string): string {
  const tNames: Record<string, string> = {
    status: "Status Report", executive: "Executive Summary", risk: "Risk Report",
    evm: "EVM Report", sprint: "Sprint Review", stakeholder: "Stakeholder Update",
    budget: "Budget Report", phase_gate: "Phase Gate Report",
  };
  const fNames: Record<string, string> = {
    DAILY: "Daily", WEEKLY: "Weekly", BIWEEKLY: "Bi-weekly", MONTHLY: "Monthly",
  };
  return `${fNames[frequency] || frequency} ${tNames[templateId] || templateId}`;
}
