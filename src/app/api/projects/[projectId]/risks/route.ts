import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const risks = await db.risk.findMany({
    where: { projectId },
    orderBy: { score: "desc" },
  });

  return NextResponse.json({ data: risks });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const body = await req.json();

  const risk = await db.risk.create({
    data: { ...body, score: (body.probability || 3) * (body.impact || 3), projectId },
  });

  return NextResponse.json({ data: risk }, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;

  const body = await req.json();
  const { riskId, action, ...data } = body;
  if (!riskId) return NextResponse.json({ error: "riskId required" }, { status: 400 });

  // ── Response action sub-operations ──────────────────────────────────────
  if (action === "add-response-action") {
    const existing = await db.risk.findUnique({ where: { id: riskId, projectId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const log = (existing.responseLog as any[] | null) ?? [];
    const newEntry = {
      id: crypto.randomUUID(),
      strategy: data.strategy || "REDUCE",
      action: data.actionText,
      owner: data.owner || null,
      dueDate: data.dueDate || null,
      status: "PLANNED",
      notes: data.notes || null,
      createdAt: new Date().toISOString(),
    };
    const updated = await db.risk.update({
      where: { id: riskId, projectId },
      data: { responseLog: [...log, newEntry] },
    });
    return NextResponse.json({ data: updated });
  }

  if (action === "update-response-action") {
    const existing = await db.risk.findUnique({ where: { id: riskId, projectId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const log = ((existing.responseLog as any[]) ?? []).map((entry: any) =>
      entry.id === data.actionId
        ? { ...entry, ...data.patch, updatedAt: new Date().toISOString() }
        : entry
    );
    const updated = await db.risk.update({
      where: { id: riskId, projectId },
      data: { responseLog: log },
    });
    return NextResponse.json({ data: updated });
  }

  if (action === "delete-response-action") {
    const existing = await db.risk.findUnique({ where: { id: riskId, projectId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const log = ((existing.responseLog as any[]) ?? []).filter((e: any) => e.id !== data.actionId);
    const updated = await db.risk.update({
      where: { id: riskId, projectId },
      data: { responseLog: log },
    });
    return NextResponse.json({ data: updated });
  }

  // ── Regular risk field update ────────────────────────────────────────────
  if (data.probability || data.impact) {
    const existing = await db.risk.findUnique({ where: { id: riskId } });
    if (existing) {
      data.score = (data.probability || existing.probability) * (data.impact || existing.impact);
    }
  }

  const risk = await db.risk.update({
    where: { id: riskId, projectId },
    data,
  });

  return NextResponse.json({ data: risk });
}
