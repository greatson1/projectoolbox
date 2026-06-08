import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/invoices — List org invoices
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 403 });

  const invoices = await db.invoice.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: invoices });
}

// POST /api/invoices — Create invoice (Stripe-backed)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 403 });

  const body = await req.json();
  const { amount, currency, stripeId, status } = body;

  if (!amount || typeof amount !== "number") {
    return NextResponse.json({ error: "Amount is required" }, { status: 400 });
  }

  const invoice = await db.invoice.create({
    data: {
      orgId,
      amount,
      currency: currency || "gbp",
      stripeId: stripeId || null,
      status: status || "draft",
    },
  });

  return NextResponse.json({ data: invoice }, { status: 201 });
}
