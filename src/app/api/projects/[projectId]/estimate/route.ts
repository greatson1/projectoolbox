import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { syncCostEntriesToArtefact } from "@/lib/agents/artefact-sync";

export const dynamic = "force-dynamic";

// ── GET /api/projects/[projectId]/estimate ─────────────────────────────────
// Returns all ESTIMATE entries grouped by category with subtotals and grand total
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { projectId } = await params;

  const entries = await db.costEntry.findMany({
    where: { projectId, entryType: "ESTIMATE" },
    orderBy: { recordedAt: "asc" },
  });

  // Group by category
  const grouped: Record<string, typeof entries> = {};
  for (const entry of entries) {
    const cat = entry.category ?? "OTHER";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(entry);
  }

  const categories = Object.entries(grouped).map(([category, items]) => ({
    category,
    items,
    subtotal: items.reduce((sum, e) => sum + e.amount, 0),
  }));

  const grandTotal = categories.reduce((sum, c) => sum + c.subtotal, 0);

  return NextResponse.json({ data: { categories, grandTotal, entries } });
}

// ── POST /api/projects/[projectId]/estimate ────────────────────────────────
// Creates a new ESTIMATE cost entry
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { projectId } = await params;
  const body = await req.json();

  const { description, category, unitQty, unitRate, vendorName, amount: rawAmount } = body as {
    description?: string;
    category?: string;
    unitQty?: number;
    unitRate?: number;
    vendorName?: string;
    amount?: number;
  };

  // Derive amount: prefer unitQty × unitRate; fall back to explicit amount
  let amount: number;
  if (unitQty != null && unitRate != null) {
    amount = unitQty * unitRate;
  } else if (rawAmount != null) {
    amount = rawAmount;
  } else {
    return NextResponse.json({ error: "Provide either unitQty + unitRate or amount" }, { status: 400 });
  }

  const entry = await db.costEntry.create({
    data: {
      projectId,
      entryType: "ESTIMATE",
      category: (category ?? "OTHER").toUpperCase(),
      amount,
      description: description ?? null,
      vendorName: vendorName ?? null,
      unitQty: unitQty ?? null,
      unitRate: unitRate ?? null,
      currency: "GBP",
      createdBy: (session.user as { id?: string }).id ?? null,
    },
  });

  // Fire-and-forget reverse sync — keep the Cost artefact CSV up to date
  syncCostEntriesToArtefact(projectId).catch(() => {});

  return NextResponse.json({ data: entry }, { status: 201 });
}

// ── PUT /api/projects/[projectId]/estimate?entryId=xxx ─────────────────────
// Updates an existing ESTIMATE entry (inline row edit)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { projectId } = await params;
  const { searchParams } = new URL(req.url);
  const entryId = searchParams.get("entryId");

  if (!entryId) return NextResponse.json({ error: "entryId query param required" }, { status: 400 });

  const existing = await db.costEntry.findUnique({ where: { id: entryId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.projectId !== projectId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as {
    description?: string;
    unitQty?: number;
    unitRate?: number;
    amount?: number;
    vendorName?: string;
  };

  // Recalculate amount when qty/rate provided
  let amount = existing.amount;
  if (body.unitQty != null && body.unitRate != null) {
    amount = body.unitQty * body.unitRate;
  } else if (body.amount != null) {
    amount = body.amount;
  }

  const updated = await db.costEntry.update({
    where: { id: entryId },
    data: {
      description: body.description ?? existing.description,
      unitQty: body.unitQty ?? existing.unitQty,
      unitRate: body.unitRate ?? existing.unitRate,
      vendorName: body.vendorName ?? existing.vendorName,
      amount,
    },
  });

  syncCostEntriesToArtefact(projectId).catch(() => {});

  return NextResponse.json({ data: updated });
}

// ── DELETE /api/projects/[projectId]/estimate?entryId=xxx ──────────────────
// Deletes an estimate entry
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { projectId } = await params;
  const { searchParams } = new URL(req.url);
  const entryId = searchParams.get("entryId");

  if (!entryId) return NextResponse.json({ error: "entryId query param required" }, { status: 400 });

  // Verify the entry belongs to this project
  const entry = await db.costEntry.findUnique({ where: { id: entryId } });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (entry.projectId !== projectId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await db.costEntry.delete({ where: { id: entryId } });

  syncCostEntriesToArtefact(projectId).catch(() => {});

  return NextResponse.json({ success: true });
}

// ── PATCH /api/projects/[projectId]/estimate ───────────────────────────────
// action: "set-budget" → sets project.budget to the grand total supplied
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { projectId } = await params;
  const body = await req.json() as { action?: string; total?: number };

  if (body.action === "set-budget") {
    if (body.total == null || isNaN(body.total)) {
      return NextResponse.json({ error: "total is required" }, { status: 400 });
    }
    const updated = await db.project.update({
      where: { id: projectId },
      data: { budget: body.total },
    });
    return NextResponse.json({ data: updated });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
