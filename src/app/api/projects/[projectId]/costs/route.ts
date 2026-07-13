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

  // ── FX conversion at write time ─────────────────────────────────────────
  // Every SUM/EVM/CPI path reads CostEntry.amount currency-blind, so a
  // foreign-currency cost MUST land in `amount` already converted to the
  // org base currency. The rate comes from the USER (zero-fabrication —
  // we never invent exchange rates); the original figure is preserved on
  // the row for audit. Same-currency entries pass through untouched.
  const entryCurrency = (body.currency || orgCurrency).toUpperCase();
  const rawAmount = Number(body.amount);
  if (!Number.isFinite(rawAmount) || rawAmount < 0) {
    return NextResponse.json({ error: "A valid amount is required" }, { status: 400 });
  }
  let amount = rawAmount;
  let fx: { originalAmount: number; originalCurrency: string; fxRate: number } | null = null;
  if (entryCurrency !== orgCurrency.toUpperCase()) {
    const fxRate = Number(body.fxRate);
    if (!Number.isFinite(fxRate) || fxRate <= 0) {
      return NextResponse.json(
        {
          error: `Amount is in ${entryCurrency} but the project books costs in ${orgCurrency} — provide fxRate (how many ${orgCurrency} one ${entryCurrency} is worth). Rates are never assumed.`,
          reason: "fx_rate_required",
        },
        { status: 400 },
      );
    }
    amount = Math.round(rawAmount * fxRate * 100) / 100;
    fx = { originalAmount: rawAmount, originalCurrency: entryCurrency, fxRate };
  }

  const entry = await db.costEntry.create({
    data: {
      projectId,
      taskId: body.taskId || null,
      entryType: body.entryType || "ACTUAL",
      category: body.category || "OTHER",
      amount,
      currency: orgCurrency,
      ...(fx ?? {}),
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
      target:
        (body.description || `${orgCurrency} ${amount}`) +
        (fx ? ` (${fx.originalCurrency} ${fx.originalAmount} @ ${fx.fxRate})` : ""),
    },
  });

  // Track cost entries in KB (converted base-currency amount)
  import("@/lib/agents/kb-event-tracker").then(({ trackCostEntry }) => {
    trackCostEntry(projectId, body.entryType || "ACTUAL", amount, body.category || "OTHER", body.description).catch(() => {});
  }).catch(() => {});

  // Reverse sync to Cost Management Plan artefact — keeps the
  // approved CSV in sync with the live CostEntry table so the
  // artefact viewer shows the same numbers as the Cost page.
  // Previously the artefact stayed frozen at whatever the agent
  // generated, even after the user edited line items.
  // Fire-and-forget so the POST returns quickly; failure is logged
  // and doesn't fail the cost insert.
  import("@/lib/agents/artefact-sync")
    .then(({ syncCostEntriesToArtefact }) => syncCostEntriesToArtefact(projectId))
    .catch((e) => console.error(`[artefact-sync] syncCostEntriesToArtefact failed for project ${projectId}:`, e));

  return NextResponse.json({ data: entry }, { status: 201 });
}
