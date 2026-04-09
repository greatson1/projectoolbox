import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

// Convenience alias
export const stripe = new Proxy({} as Stripe, {
  get(_, prop) {
    return (getStripe() as any)[prop];
  },
});

// Plan price IDs — create these in Stripe Dashboard
export const PLAN_PRICE_IDS: Record<string, string> = {
  STARTER: process.env.STRIPE_PRICE_STARTER || "",
  PROFESSIONAL: process.env.STRIPE_PRICE_PROFESSIONAL || "",
  BUSINESS: process.env.STRIPE_PRICE_BUSINESS || "",
};

// Credit pack price IDs (for Stripe Checkout sessions)
export const CREDIT_PACK_PRICES: Record<string, { credits: number; priceId: string }> = {
  pack_500: { credits: 500, priceId: process.env.STRIPE_PRICE_CREDITS_500 || "" },
  pack_2000: { credits: 2000, priceId: process.env.STRIPE_PRICE_CREDITS_2000 || "" },
  pack_5000: { credits: 5000, priceId: process.env.STRIPE_PRICE_CREDITS_5000 || "" },
  pack_10000: { credits: 10000, priceId: process.env.STRIPE_PRICE_CREDITS_10000 || "" },
};

/**
 * Credit pack amounts for off-session auto top-up charges (PaymentIntent).
 * amountPence must match the prices set in your Stripe Dashboard.
 * 1 credit = £0.01 retail price.
 */
export const CREDIT_PACK_AMOUNTS: Record<string, { credits: number; amountPence: number; label: string }> = {
  pack_500:   { credits: 500,   amountPence: 500,   label: "500 credits (£5)" },
  pack_2000:  { credits: 2000,  amountPence: 2000,  label: "2,000 credits (£20)" },
  pack_5000:  { credits: 5000,  amountPence: 5000,  label: "5,000 credits (£50)" },
  pack_10000: { credits: 10000, amountPence: 10000, label: "10,000 credits (£100)" },
};

// Plan credit grants on subscription
export const PLAN_CREDIT_GRANTS: Record<string, number> = {
  FREE: 50,
  STARTER: 500,
  PROFESSIONAL: 2000,
  BUSINESS: 10000,
  ENTERPRISE: 50000,
};
