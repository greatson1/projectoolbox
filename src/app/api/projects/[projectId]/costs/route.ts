import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ensureProjectMutable } from "@/lib/archive-guard";

export const dynamic = "force-dynamic";

// GET /api/projects/:id/costs — Cost entries + breakdown by category
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;

  const entries = await db.costEntry.findMany({
    where: { projectId },
    orderBy: { recordedAt: "desc" },
  });

  // Category breakdown
  const byCategory: Record<string, { estimated: number; actual: number; committed: number }> = {};
  for (const e of entries) {
    const cat = e.category || "OTHER";
    if (!byCategory[cat]) byCategory[cat] = { estimated: 0, actual: 0, committed: 0 };
    if (e.entryType === "ESTIMATE") byCategory[cat].estimated += e.amount;
    else if (e.entryType === "ACTUAL") byCategory[cat].actual += e.amount;
    else if (e.entryType === "COMMITMENT") byCategory[cat].committed += e.amount;
  }

  const totalEstimated = Object.values(byCategory).reduce((s, c) => s + c.estimated, 0);
  const totalActual = Object.values(byCategory).reduce((s, c) => s + c.actual, 0);
  const totalCommitted = Object.values(byCategory).reduce((s, c) => s + c.committed, 0);

  return NextResponse.json({
    data: {
      entries,
      byCategory,
      summary: { estimated: totalEstimated, actual: totalActual, committed: totalCommitted },
    },
  });
}

// POST /api/projects/:id/costs — Log a cost entry (labour, material, PO, invoice)
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;
  const body = await req.json();

  const blocked = await ensureProjectMutable(projectId);
  if (blocked) return NextResponse.json({ error: blocked.error, reason: blocked.reason }, { status: blocked.status });

  let orgCurrency = "GBP";
  try {
    const proj = await db.project.findUnique({ where: { id: projectId }, select: { org: { select: { currency: true } } } });
    if (proj?.org?.currency) orgCurrency = proj.org.currency;
  } catch {}

  const entry = await db.costEntry.create({
    data: {
      projectId,
      taskId: body.taskId || null,
      entryType: body.entryType || "ACTUAL",
      category: body.category || "OTHER",
      amount: body.amount,
      currency: body.currency || orgCurrency,
      description: body.description || null,
      vendorName: body.vendorName || null,
      poNumber: body.poNumber || null,
      invoiceRef: body.invoiceRef || null,
      unitQty: body.unitQty || null,
      unitRate: body.unitRate || null,
      recordedAt: body.recordedAt ? new Date(body.recordedAt) : new Date(),
      createdBy: session.user.id,
    },
  });

  // Audit log
  await db.auditLog.create({
    data: {
      orgId: (session.user as any).orgId,
      userId: session.user.id,
      projectId,
      action: `Logged ${body.entryType || "ACTUAL"} cost: ${body.category || "OTHER"}`,
      target: body.description || `£${body.amount}`,
    },
  });

  // Track cost entries in KB
  import("@/lib/agents/kb-event-tracker").then(({ trackCostEntry }) => {
    trackCostEntry(projectId, body.entryType || "ACTUAL", body.amount, body.category || "OTHER", body.description).catch(() => {});
  }).catch(() => {});

  return NextResponse.json({ data: entry }, { status: 201 });
}
