import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveApiCaller } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// GET /api/projects/[projectId]/benefits — list all benefits
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const benefits = await db.benefit.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ data: benefits });
}

// POST /api/projects/[projectId]/benefits — create a benefit
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const body = await req.json();

  const benefit = await db.benefit.create({
    data: {
      projectId,
      name: body.name || "Untitled Benefit",
      description: body.description || null,
      category: body.category || "Strategic",
      status: body.status || "NOT_STARTED",
      targetValue: body.targetValue || 0,
      realisedValue: body.realisedValue || 0,
      currency: body.currency || "GBP",
      owner: body.owner || null,
      targetDate: body.targetDate ? new Date(body.targetDate) : null,
      measures: body.measures || null,
      createdBy: caller.userId ? `user:${caller.userId}` : `agent:${body.agentId || "unknown"}`,
    },
  });

  return NextResponse.json({ data: benefit }, { status: 201 });
}

// PATCH /api/projects/[projectId]/benefits — update a benefit (id in body)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Convert targetDate string to Date if present
  if (updates.targetDate) updates.targetDate = new Date(updates.targetDate);

  // Fetch old status for change detection
  const oldBenefit = await db.benefit.findUnique({ where: { id }, select: { status: true, name: true } });

  const benefit = await db.benefit.update({
    where: { id },
    data: updates,
  });

  // Track benefit status changes in KB
  if (updates.status && oldBenefit && updates.status !== oldBenefit.status) {
    const { projectId } = await params;
    import("@/lib/agents/kb-event-tracker").then(({ trackBenefitUpdate }) => {
      trackBenefitUpdate(projectId, benefit.name, oldBenefit.status, updates.status, updates.realisedValue).catch(() => {});
    }).catch(() => {});
  }

  return NextResponse.json({ data: benefit });
}

// DELETE /api/projects/[projectId]/benefits — delete a benefit (id in query)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await db.benefit.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
