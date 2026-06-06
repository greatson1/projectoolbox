import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ensureProjectMutable } from "@/lib/archive-guard";

export const dynamic = "force-dynamic";

/** UTC midnight for a given date (or today) — the canonical standupDate key. */
function dayStart(d?: string | Date): Date {
  const base = d ? new Date(d) : new Date();
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
}

/**
 * GET /api/projects/:projectId/standups?date=YYYY-MM-DD
 * Lists stand-up entries. With ?date, returns just that day's entries;
 * without, returns the most recent 60 (for the "Previous Days" view).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const dateParam = req.nextUrl.searchParams.get("date");

  const where = dateParam
    ? { projectId, standupDate: dayStart(dateParam) }
    : { projectId };

  const standups = await db.standup.findMany({
    where,
    orderBy: [{ standupDate: "desc" }, { memberName: "asc" }],
    take: dateParam ? undefined : 60,
  });
  return NextResponse.json({ data: standups });
}

/**
 * POST /api/projects/:projectId/standups
 * Upsert one member's entry for a day (one entry per person per day).
 * Body: { memberName, date?, yesterday?, today?, blockers?, mood?, sprintId? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  const blocked = await ensureProjectMutable(projectId);
  if (blocked) return NextResponse.json({ error: blocked.error, reason: blocked.reason }, { status: blocked.status });

  const body = await req.json();
  const memberName = (body.memberName || "").trim();
  if (!memberName) return NextResponse.json({ error: "memberName required" }, { status: 400 });

  const standupDate = dayStart(body.date);
  const fields = {
    yesterday: body.yesterday ?? null,
    today: body.today ?? null,
    blockers: body.blockers ?? null,
    mood: body.mood ?? null,
    sprintId: body.sprintId ?? null,
  };

  const standup = await db.standup.upsert({
    where: { projectId_standupDate_memberName: { projectId, standupDate, memberName } },
    create: { projectId, standupDate, memberName, createdById: (session.user as any).id ?? null, ...fields },
    update: { ...fields },
  });

  return NextResponse.json({ data: standup }, { status: 201 });
}

/**
 * DELETE /api/projects/:projectId/standups?id=...
 * Remove a single stand-up entry.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const existing = await db.standup.findFirst({ where: { id, projectId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.standup.delete({ where: { id } });
  return NextResponse.json({ data: { id } });
}
