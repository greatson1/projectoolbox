import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { stripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

// POST /api/billing/portal — Create Stripe Customer Portal session
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const org = await db.organisation.findUnique({ where: { id: orgId } });
  if (!org?.stripeCustomerId) {
    return NextResponse.json({ error: "No Stripe customer. Subscribe to a plan first." }, { status: 400 });
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: `${process.env.NEXTAUTH_URL}/billing`,
  });

  return NextResponse.json({ data: { portalUrl: portalSession.url } });
}
