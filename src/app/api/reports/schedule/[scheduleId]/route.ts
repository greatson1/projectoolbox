import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { buildCron, calcNextRun } from "../route";

export const dynamic = "force-dynamic";

// ── PATCH /api/reports/schedule/:id — toggle active / update ─────────────────
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ scheduleId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { scheduleId } = await params;
  const body = await req.json();
  const { isActive, recipients, frequency, dayOfWeek, dayOfMonth, hour } = body;

  const existing = await db.reportSchedule.findUnique({ where: { id: scheduleId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updateData: any = {};
  if (isActive !== undefined) updateData.isActive = isActive;
  if (recipients !== undefined) updateData.recipients = recipients;
  if (frequency || dayOfWeek !== undefined || dayOfMonth !== undefined || hour !== undefined) {
    const freq = frequency || existing.frequency;
    const dow  = dayOfWeek  ?? 1;
    const dom  = dayOfMonth ?? 1;
    const h    = hour       ?? 9;
    updateData.frequency       = freq;
    updateData.cronExpression  = buildCron(freq, dow, dom, h);
    updateData.nextRunAt       = calcNextRun(freq, dow, dom, h);
  }

  const schedule = await db.reportSchedule.update({ where: { id: scheduleId }, data: updateData });
  return NextResponse.json({ data: schedule });
}

// ── DELETE /api/reports/schedule/:id ─────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ scheduleId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { scheduleId } = await params;
  await db.reportSchedule.delete({ where: { id: scheduleId } });
  return NextResponse.json({ ok: true });
}
