/**
 * Paywall — gates the dashboard for orgs that don't yet have an active
 * organisation.
 *
 * Model (hybrid, post-2026-06-11):
 *   - FREE is a genuine always-free tier. Limits (1 project, 1 agent,
 *     50 credits/mo, L1 only, no API, no SSO, no audit log read) are
 *     enforced per-feature at the API layer — they're NOT a time bomb
 *     here. A FREE org can sit on FREE forever and use the product
 *     within those limits.
 *   - To unlock STARTER / PROFESSIONAL / BUSINESS the user starts a
 *     14-day TRIAL of that specific tier via Stripe Checkout — card
 *     required upfront, auto-charged on day 15 unless cancelled.
 *     Stripe owns the trial state; we just read the resulting plan
 *     and trialEndsAt off the Organisation row.
 *   - This file used to also enforce a 14-day "free trial" against
 *     org.createdAt. That created the "stealth trial → hard paywall"
 *     UX that Sakshi hit on day 6 and bounced. We've removed it.
 *
 * Blocking states in this file are now only:
 *   - no_org      → user signed up but hasn't completed onboarding;
 *                   redirect to /onboarding.
 *
 * Everything else (FREE, trialing, paid) passes through. Limits at the
 * API layer + per-feature 403s are how we monetise; nothing here
 * "locks" a user out of the dashboard if they're on FREE.
 *
 * Pure + db-free so the unit tests don't need Prisma. The DB lookup
 * lives in middleware.ts (JWT-cached) and src/app/api/billing/* (live
 * read).
 */

export type PaywallStatus =
  | { kind: "no_org"; reason: "User has not yet created or joined an organisation." }
  | { kind: "active"; plan: string };

export interface OrgPaywallInput {
  plan: string | null;
  /** Kept for backwards-compat in case other callers still pass it,
   *  but no longer used to compute a trial expiry. The trial concept
   *  now lives in Stripe, not in our paywall math. */
  createdAt?: Date | null;
}

/**
 * Returns the paywall verdict for a single org. Pure — feed in the
 * minimal data, no DB calls. Use isBlocked(status) to convert to a
 * yes/no for the layout gate.
 *
 * Today there are only two outcomes:
 *   - User has no org → no_org (blocked, redirect to onboarding)
 *   - User has any plan (including FREE) → active (pass through)
 *
 * A trialing org is "active" here — Stripe upgrades its plan to
 * STARTER/PROFESSIONAL/BUSINESS on the customer.subscription.created
 * webhook even while status='trialing', so we see it as paid. If the
 * trial cancels (Stripe sends customer.subscription.deleted), the
 * webhook flips the plan back to FREE — and FREE is "active" too,
 * just with smaller limits.
 */
export function evaluatePaywall(input: OrgPaywallInput): PaywallStatus {
  if (!input.plan) {
    return { kind: "no_org", reason: "User has not yet created or joined an organisation." };
  }
  return { kind: "active", plan: input.plan.toUpperCase() };
}

/**
 * True when the dashboard layout should render the paywall screen
 * instead of the real children. Only `no_org` blocks now — every plan
 * (FREE included) passes through.
 */
export function isBlocked(status: PaywallStatus): boolean {
  return status.kind === "no_org";
}

/**
 * Routes that are always reachable regardless of paywall verdict.
 * The user must be able to bill, see their account, log out, and
 * receive webhooks no matter what. Onboarding is allowed so users
 * stuck in no_org can finish creating an org.
 *
 * Match is prefix-based (startsWith), so an entry of "/billing"
 * covers "/billing/credits" too.
 */
export const PAYWALL_BYPASS_PATHS: readonly string[] = [
  "/billing",
  "/onboarding",
  "/admin",
  "/api/billing",
  "/api/webhooks",
  "/api/auth",
  "/api/health",
  "/login",
  "/signup",
  "/invite",
  "/waitlist",
  "/legal",
  "/forgot-password",
  "/reset-password",
];

export function isBypassed(pathname: string): boolean {
  for (const prefix of PAYWALL_BYPASS_PATHS) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return true;
  }
  return false;
}
