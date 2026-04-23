import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { stripe, planPriceId, packPriceId, CREDIT_PACK_PRICES } from "@/lib/stripe";

export const dynamic = "force-dynamic";

// POST /api/billing/checkout — Create Stripe Checkout session
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const body = await req.json();
  const { type, planId, packId } = body;
  // type: "subscription" | "credits"

  const org = await db.organisation.findUnique({ where: { id: orgId } });
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 });

  // Get or create Stripe customer
  let customerId = org.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: org.billingEmail || session.user.email!,
      name: org.name,
      metadata: { orgId },
    });
    customerId = customer.id;
    await db.organisation.update({ where: { id: orgId }, data: { stripeCustomerId: customerId } });
  }

  if (type === "subscription") {
    const priceId = planPriceId(planId, (org as any).currency);
    if (!priceId) return NextResponse.json({ error: "Invalid plan" }, { status: 400 });

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.NEXTAUTH_URL}/billing?upgraded=true`,
      cancel_url: `${process.env.NEXTAUTH_URL}/billing`,
      metadata: { orgId, planId },
    });

    return NextResponse.json({ data: { checkoutUrl: checkoutSession.url } });
  }

  if (type === "credits") {
    const pack = CREDIT_PACK_PRICES[packId];
    if (!pack) return NextResponse.json({ error: "Invalid pack" }, { status: 400 });
    const priceId = packPriceId(packId, (org as any).currency);
    if (!priceId) return NextResponse.json({ error: "Invalid pack" }, { status: 400 });

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.NEXTAUTH_URL}/billing/credits?purchased=true`,
      cancel_url: `${process.env.NEXTAUTH_URL}/billing/credits`,
      metadata: { orgId, credits: pack.credits.toString() },
    });

    return NextResponse.json({ data: { checkoutUrl: checkoutSession.url } });
  }

  return NextResponse.json({ error: "Invalid type" }, { status: 400 });
}
