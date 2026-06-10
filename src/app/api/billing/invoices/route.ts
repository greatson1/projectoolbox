import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/invoices
 *
 * Paginated invoice history for the caller's org. The main /billing
 * page already shows the most recent 20 via /api/billing — this
 * endpoint exists so the dedicated history page can scroll back through
 * everything without that GET payload growing unbounded.
 *
 * Query params (all optional):
 *   limit    page size (default 50, max 200)
 *   cursor   ISO timestamp from a previous page's last invoice.createdAt
 *            (the "load older" link sends this back). Server-side
 *            cursor pagination keeps every page reproducible — offset
 *            would race with new invoices arriving mid-scroll.
 *   from     ISO date inclusive lower bound
 *   to       ISO date inclusive upper bound
 *   format   "csv" → returns CSV download instead of JSON. Mirrors the
 *            row shape the Stripe portal shows but uses the columns the
 *            UK finance team actually wants.
 *
 * Response (JSON):
 *   { data: Invoice[], nextCursor: string | null }
 *
 * Response (CSV):
 *   text/csv; charset=utf-8 with Content-Disposition attachment.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const url = new URL(req.url);
  const limitRaw = parseInt(url.searchParams.get("limit") || "50", 10);
  const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 50));
  const cursor = url.searchParams.get("cursor");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const format = url.searchParams.get("format");

  const where: any = { orgId };
  if (from || to) {
    where.createdAt = {};
    if (from) {
      const d = new Date(from);
      if (!isNaN(d.getTime())) where.createdAt.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!isNaN(d.getTime())) {
        // Include the whole "to" day — finance reports run on day
        // boundaries and "2026-06-30" usually means "anything that
        // happened on the 30th too".
        d.setHours(23, 59, 59, 999);
        where.createdAt.lte = d;
      }
    }
  }
  if (cursor) {
    const d = new Date(cursor);
    if (!isNaN(d.getTime())) where.createdAt = { ...(where.createdAt || {}), lt: d };
  }

  // CSV path: return EVERY matching row (no cursor) but still bounded
  // by the from/to filter. If the org genuinely has 10,000 invoices
  // they shouldn't fit in a CSV either; the date filter exists for
  // exactly this use case.
  if (format === "csv") {
    const all = await db.invoice.findMany({
      where: { orgId, ...(where.createdAt ? { createdAt: where.createdAt } : {}) },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });
    const header = ["Invoice ID", "Date", "Amount", "Currency", "Status", "Stripe ID"];
    const rows = all.map((inv) => [
      inv.id,
      inv.createdAt.toISOString().slice(0, 10),
      String(inv.amount ?? 0),
      (inv.currency ?? "gbp").toUpperCase(),
      inv.status ?? "",
      inv.stripeId ?? "",
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="invoices-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  // JSON path: cursor pagination. Fetch limit+1 so we know whether
  // there's another page without a second count query.
  const invoices = await db.invoice.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });
  const hasMore = invoices.length > limit;
  const trimmed = hasMore ? invoices.slice(0, limit) : invoices;
  const nextCursor = hasMore ? trimmed[trimmed.length - 1].createdAt.toISOString() : null;

  return NextResponse.json({ data: trimmed, nextCursor });
}
