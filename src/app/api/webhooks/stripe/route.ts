import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { stripe, PLAN_CREDIT_GRANTS } from "@/lib/stripe";
import { CreditService } from "@/lib/credits/service";

// POST /api/webhooks/stripe — Handle Stripe events
export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (e: any) {
    console.error("Stripe webhook verification failed:", e.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    // ── Subscription created or updated ──
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as any;
      const customerId = subscription.customer as string;

      const org = await db.organisation.findFirst({ where: { stripeCustomerId: customerId } });
      if (!org) break;

      // Determine plan from metadata or price
      const planId = subscription.metadata?.planId || "PROFESSIONAL";
      const plan = planId.toUpperCase();

      await db.organisation.update({
        where: { id: org.id },
        data: {
          plan: plan as any,
          stripeSubId: subscription.id,
        },
      });

      // Grant monthly credits on new subscription
      if (event.type === "customer.subscription.created") {
        const credits = PLAN_CREDIT_GRANTS[plan] || 0;
        if (credits > 0) {
          await CreditService.grant(org.id, credits, "SUBSCRIPTION_GRANT", `${plan} plan — monthly credit grant`);
        }
      }

      console.log(`Subscription ${event.type}: org=${org.id} plan=${plan}`);
      break;
    }

    // ── Subscription cancelled ──
    case "customer.subscription.deleted": {
      const subscription = event.data.object as any;
      const customerId = subscription.customer as string;

      const org = await db.organisation.findFirst({ where: { stripeCustomerId: customerId } });
      if (!org) break;

      await db.organisation.update({
        where: { id: org.id },
        data: { plan: "FREE", stripeSubId: null },
      });

      console.log(`Subscription cancelled: org=${org.id} -> FREE`);
      break;
    }

    // ── One-time payment (credit purchase) ──
    case "checkout.session.completed": {
      const session = event.data.object as any;
      if (session.mode !== "payment") break;

      const orgId = session.metadata?.orgId;
      const credits = parseInt(session.metadata?.credits || "0");

      if (orgId && credits > 0) {
        await CreditService.grant(orgId, credits, "PURCHASE", `Credit purchase: ${credits} credits`, session.payment_intent as string);

        // Create invoice record
        await db.invoice.create({
          data: {
            orgId,
            stripeId: session.id,
            amount: session.amount_total / 100,
            currency: session.currency || "usd",
            status: "paid",
          },
        });

        console.log(`Credit purchase: org=${orgId} credits=${credits}`);
      }
      break;
    }

    // ── Invoice paid (recurring subscription) ──
    case "invoice.paid": {
      const invoice = event.data.object as any;
      const customerId = invoice.customer as string;

      const org = await db.organisation.findFirst({ where: { stripeCustomerId: customerId } });
      if (!org) break;

      // Grant monthly credits
      const credits = PLAN_CREDIT_GRANTS[org.plan] || 0;
      if (credits > 0) {
        await CreditService.grant(org.id, credits, "SUBSCRIPTION_GRANT", `${org.plan} plan — monthly renewal`);
      }

      // Record invoice
      await db.invoice.create({
        data: {
          orgId: org.id,
          stripeId: invoice.id,
          amount: invoice.amount_paid / 100,
          currency: invoice.currency || "usd",
          status: "paid",
          pdfUrl: invoice.invoice_pdf,
        },
      });

      console.log(`Invoice paid: org=${org.id} plan=${org.plan} credits=${credits}`);
      break;
    }

    default:
      console.log(`Unhandled Stripe event: ${event.type}`);
  }

  return NextResponse.json({ received: true });
}
