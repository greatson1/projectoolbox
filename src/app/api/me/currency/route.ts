import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { normaliseCurrency, DEFAULT_CURRENCY } from "@/lib/currency";

export const dynamic = "force-dynamic";

// GET /api/me/currency — returns the active org's display currency.
// Resilient: if the column doesn't exist yet (pre-migration), returns GBP.
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ data: { currency: DEFAULT_CURRENCY } });

  try {
    const org = await db.organisation.findUnique({ where: { id: orgId }, select: { currency: true } });
    return NextResponse.json({ data: { currency: normaliseCurrency(org?.currency) } });
  } catch {
    return NextResponse.json({ data: { currency: DEFAULT_CURRENCY } });
  }
}

// PATCH /api/me/currency — update org currency. Only org owners/admins.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const role = (session.user as any).role;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });
  if (role !== "OWNER" && role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const currency = normaliseCurrency(body?.currency);

  try {
    await db.organisation.update({ where: { id: orgId }, data: { currency } });
    return NextResponse.json({ data: { currency } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Update failed" }, { status: 500 });
  }
}
