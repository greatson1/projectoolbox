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
          currency: invoice.currency || "gbp",
          status: "paid",
          pdfUrl: invoice.invoice_pdf || null,
        },
      });

      console.log(`Invoice paid: org=${org.id} plan=${org.plan} credits=${credits}`);
      break;
    }

    // ── Invoice payment failed ──────────────────────────────────────────────
    case "invoice.payment_failed": {
      const invoice = event.data.object as any;
      const customerId = invoice.customer as string;
      const attemptCount: number = invoice.attempt_count || 1;

      const org = await db.organisation.findFirst({ where: { stripeCustomerId: customerId } });
      if (!org) break;

      // Record failed invoice
      await db.invoice.upsert({
        where: { stripeId: invoice.id },
        create: {
          orgId: org.id,
          stripeId: invoice.id,
          amount: invoice.amount_due / 100,
          currency: invoice.currency || "gbp",
          status: "failed",
        },
        update: { status: "failed" },
      }).catch(() => {}); // upsert may fail if Invoice model has no stripeId unique — safe to ignore

      if (attemptCount === 1) {
        // First failure — warn admins, keep plan active (Stripe will retry)
        await CreditService.notifyAdmins(org.id, "BILLING",
          "Payment failed — please update your card",
          `We couldn't charge your ${org.plan} subscription (attempt 1 of 4). Please update your payment method to avoid service interruption.`,
          "/billing");
      } else if (attemptCount >= 3) {
        // 3rd+ failure — downgrade to FREE to protect revenue
        await db.organisation.update({
          where: { id: org.id },
          data: { plan: "FREE", stripeSubId: null },
        });
        await CreditService.notifyAdmins(org.id, "BILLING",
          "Subscription suspended — payment failed",
          `After ${attemptCount} failed payment attempts your account has been moved to the FREE plan. Update your payment method and resubscribe to restore full access.`,
          "/billing");
      } else {
        // 2nd failure — more urgent warning
        await CreditService.notifyAdmins(org.id, "BILLING",
          `Payment failed again (attempt ${attemptCount} of 4)`,
          `We still can't charge your subscription. Please update your payment method urgently — after 4 failed attempts your account will be downgraded.`,
          "/billing");
      }

      console.log(`Invoice payment failed: org=${org.id} attempt=${attemptCount}`);
      break;
    }

    // ── Auto top-up PaymentIntent succeeded (belt-and-suspenders) ─────────
    // Primary grant happens in triggerAutoTopUp() via the direct API call.
    // This webhook catches edge cases where the PI succeeded asynchronously.
    case "payment_intent.succeeded": {
      const pi = event.data.object as any;
      if (pi.metadata?.type !== "auto_topup") break;

      const orgId = pi.metadata?.orgId;
      const credits = parseInt(pi.metadata?.credits || "0");
      if (!orgId || credits <= 0) break;

      // Only grant if no matching PURCHASE transaction exists (avoid double-granting)
      const alreadyGranted = await db.creditTransaction.count({
        where: { orgId, stripePaymentId: pi.id },
      });
      if (alreadyGranted > 0) break;

      await CreditService.grant(orgId, credits, "PURCHASE",
        `Auto top-up: ${credits.toLocaleString()} credits (async confirm)`, pi.id);

      console.log(`Auto top-up async succeeded: org=${orgId} credits=${credits}`);
      break;
    }

    // ── Auto top-up PaymentIntent failed ──────────────────────────────────
    case "payment_intent.payment_failed": {
      const pi = event.data.object as any;
      if (pi.metadata?.type !== "auto_topup") break;

      const orgId = pi.metadata?.orgId;
      if (!orgId) break;

      const failureMsg = pi.last_payment_error?.message || "Unknown error";
      await CreditService.notifyAdmins(orgId, "BILLING",
        "Auto top-up failed — action required",
        `We couldn't automatically top up your credits (${failureMsg}). Please add credits manually to avoid service interruption.`,
        "/billing");

      console.log(`Auto top-up failed: org=${orgId} reason=${failureMsg}`);
      break;
    }

    // ── Refund issued ──────────────────────────────────────────────────────
    case "charge.refunded": {
      const charge = event.data.object as any;
      const refundAmount = charge.amount_refunded; // in pence
      const customerId = charge.customer as string;
      if (!customerId) break;

      const org = await db.organisation.findFirst({ where: { stripeCustomerId: customerId } });
      if (!org) break;

      // Reverse credits proportional to refund
      // Find original PURCHASE transaction linked to this charge's payment intent
      const originalTx = await db.creditTransaction.findFirst({
        where: { orgId: org.id, stripePaymentId: charge.payment_intent, type: "PURCHASE" },
        orderBy: { createdAt: "desc" },
      });

      if (originalTx && originalTx.amount > 0) {
        // Reverse the full grant (partial refunds reverse proportionally)
        const fullChargeAmount = charge.amount; // original pence
        const refundRatio = refundAmount / fullChargeAmount;
        const creditsToReverse = Math.round(originalTx.amount * refundRatio);

        if (creditsToReverse > 0) {
          await db.$transaction([
            db.organisation.update({
              where: { id: org.id },
              data: { creditBalance: { decrement: creditsToReverse } },
            }),
            db.creditTransaction.create({
              data: {
                orgId: org.id,
                amount: -creditsToReverse,
                type: "REFUND",
                description: `Refund reversal: −${creditsToReverse} credits (£${(refundAmount / 100).toFixed(2)} refunded)`,
                stripePaymentId: charge.payment_intent,
              },
            }),
          ]);

          await CreditService.notifyAdmins(org.id, "BILLING",
            `Refund processed — ${creditsToReverse} credits removed`,
            `A refund of £${(refundAmount / 100).toFixed(2)} was processed. ${creditsToReverse} credits have been reversed from your balance.`,
            "/billing/credits");
        }
      }

      console.log(`Charge refunded: org=${org.id} refund=${refundAmount}p`);
      break;
    }

    default:
      // Silently ignore — Stripe sends many events we don't need
      break;
  }

  return NextResponse.json({ received: true });
}
