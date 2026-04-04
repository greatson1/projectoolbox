import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ data: [] });

  const schedules = await db.reportSchedule.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: schedules });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const body = await req.json();
  const schedule = await db.reportSchedule.create({
    data: {
      orgId,
      projectId: body.projectId,
      name: body.name || "Scheduled Report",
      templateId: body.templateId || "status",
      frequency: body.frequency || "WEEKLY",
      cronExpression: body.frequency === "DAILY" ? "0 9 * * *" : body.frequency === "MONTHLY" ? "0 9 1 * *" : "0 9 * * 1",
      recipients: body.recipients || [],
      isActive: true,
      nextRunAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return NextResponse.json({ data: schedule }, { status: 201 });
}
