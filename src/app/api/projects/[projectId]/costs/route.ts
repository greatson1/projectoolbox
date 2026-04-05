import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// GET /api/projects/:id/costs — All cost entries
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;

  const entries = await db.costEntry.findMany({
    where: { projectId },
    orderBy: { recordedAt: "desc" },
  });

  // Aggregated summary
  const estimated = entries.filter(e => e.entryType === "ESTIMATE").reduce((s, e) => s + e.amount, 0);
  const actual = entries.filter(e => e.entryType === "ACTUAL").reduce((s, e) => s + e.amount, 0);
  const forecast = entries.filter(e => e.entryType === "FORECAST").reduce((s, e) => s + e.amount, 0);

  return NextResponse.json({ data: { entries, summary: { estimated, actual, forecast } } });
}

// POST /api/projects/:id/costs — Log a cost entry
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;
  const body = await req.json();

  const entry = await db.costEntry.create({
    data: {
      projectId,
      taskId: body.taskId || null,
      entryType: body.entryType || "ACTUAL",
      amount: body.amount,
      currency: body.currency || "GBP",
      description: body.description || null,
      recordedAt: body.recordedAt ? new Date(body.recordedAt) : new Date(),
      createdBy: session.user.id,
    },
  });

  return NextResponse.json({ data: entry }, { status: 201 });
}
