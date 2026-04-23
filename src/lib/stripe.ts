import Stripe from "stripe";
import { normaliseCurrency, CurrencyCode } from "@/lib/currency";

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

type PlanId = "STARTER" | "PROFESSIONAL" | "BUSINESS";
type PackId = "pack_500" | "pack_2000" | "pack_5000" | "pack_10000";

/**
 * Per-currency price ID lookup.
 *
 * Env var convention:
 *   STRIPE_PRICE_<PLAN>_GBP  / _USD / _EUR   — preferred, per-currency price
 *   STRIPE_PRICE_<PLAN>                      — legacy fallback (historically USD)
 *
 * If the currency-specific env var is not set we fall back to the legacy one.
 * Callers must check the returned ID is non-empty — empty means no Stripe
 * price is configured for that currency (UI should disable checkout).
 */
function envPlan(plan: PlanId, currency: CurrencyCode): string {
  const specific = process.env[`STRIPE_PRICE_${plan}_${currency}`];
  const fallback = process.env[`STRIPE_PRICE_${plan}`];
  return specific || fallback || "";
}

function envPack(pack: PackId, currency: CurrencyCode): string {
  const num = pack.replace("pack_", "");
  const specific = process.env[`STRIPE_PRICE_CREDITS_${num}_${currency}`];
  const fallback = process.env[`STRIPE_PRICE_CREDITS_${num}`];
  return specific || fallback || "";
}

/** Pick the correct Stripe price ID for a plan given the org's currency. */
export function planPriceId(plan: PlanId | string, currency: string | null | undefined): string {
  return envPlan(plan as PlanId, normaliseCurrency(currency));
}

/** Pick the correct Stripe price ID for a credit pack given the org's currency. */
export function packPriceId(pack: PackId | string, currency: string | null | undefined): string {
  return envPack(pack as PackId, normaliseCurrency(currency));
}

// Legacy flat lookups — kept for any caller still reading them.
// New code should call planPriceId() / packPriceId() with the org's currency.
export const PLAN_PRICE_IDS: Record<string, string> = {
  STARTER: process.env.STRIPE_PRICE_STARTER || "",
  PROFESSIONAL: process.env.STRIPE_PRICE_PROFESSIONAL || "",
  BUSINESS: process.env.STRIPE_PRICE_BUSINESS || "",
};

export const CREDIT_PACK_PRICES: Record<string, { credits: number; priceId: string }> = {
  pack_500: { credits: 500, priceId: process.env.STRIPE_PRICE_CREDITS_500 || "" },
  pack_2000: { credits: 2000, priceId: process.env.STRIPE_PRICE_CREDITS_2000 || "" },
  pack_5000: { credits: 5000, priceId: process.env.STRIPE_PRICE_CREDITS_5000 || "" },
  pack_10000: { credits: 10000, priceId: process.env.STRIPE_PRICE_CREDITS_10000 || "" },
};

/**
 * Credit pack amounts for off-session auto top-up (PaymentIntent, in minor units).
 * Approximate equivalence: values are matched to the Stripe prices for each currency.
 * 1 credit = £0.01 / $0.01 / €0.01 retail price.
 */
export const CREDIT_PACK_AMOUNTS: Record<string, { credits: number; amountMinor: number; label: string }> = {
  pack_500:   { credits: 500,   amountMinor: 500,   label: "500 credits" },
  pack_2000:  { credits: 2000,  amountMinor: 2000,  label: "2,000 credits" },
  pack_5000:  { credits: 5000,  amountMinor: 5000,  label: "5,000 credits" },
  pack_10000: { credits: 10000, amountMinor: 10000, label: "10,000 credits" },
};

// Plan credit grants on subscription
export const PLAN_CREDIT_GRANTS: Record<string, number> = {
  FREE: 50,
  STARTER: 500,
  PROFESSIONAL: 2000,
  BUSINESS: 10000,
  ENTERPRISE: 50000,
};
