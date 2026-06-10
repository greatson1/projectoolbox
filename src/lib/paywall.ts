/**
 * Paywall — gates the dashboard for orgs that haven't paid.
 *
 * Model: every new org gets a 14-day free trial from its createdAt. After
 * that window, if the org is still on the FREE plan, the dashboard
 * blocks with a "subscribe to continue" screen and forces the user to
 * /billing before they can use any other route.
 *
 * Why a trial rather than locking immediately: people need to actually
 * experience the product before they'll pay for it. Sakshi's pattern
 * (sign up, see dashboard, never come back) suggests the value isn't
 * obvious from the marketing page — let new orgs run a real project
 * end-to-end first, THEN ask for money.
 *
 * Pure + db-free so the unit tests don't need Prisma. The DB lookup
 * lives in resolvePaywallForOrg() which composes evaluatePaywall() with
 * a single Project + Org read.
 */

export const TRIAL_DAYS = 14;

export type PaywallStatus =
  | { kind: "no_org"; reason: "User has not yet created or joined an organisation." }
  | { kind: "trial_active"; daysRemaining: number; trialEndsAt: Date }
  | { kind: "trial_expired"; trialEndedAt: Date; plan: string }
  | { kind: "paid"; plan: string };

export interface OrgPaywallInput {
  plan: string | null;
  createdAt: Date | null;
  /** Optional override — set this on an Org row to grant an extended
   *  trial (sales-led pilots, partner orgs) without flipping the plan
   *  to a paid tier. Stored in Organisation.metadata.trialEndsAt or
   *  similar — resolvePaywallForOrg handles the lookup. */
  trialEndsAtOverride?: Date | null;
}

/**
 * Returns the paywall verdict for a single org. Pure — feed in the
 * minimal data, no DB calls. Use isBlocked(status) to convert to a
 * yes/no for the layout gate.
 */
export function evaluatePaywall(input: OrgPaywallInput, now: Date = new Date()): PaywallStatus {
  if (!input.plan && !input.createdAt) {
    return { kind: "no_org", reason: "User has not yet created or joined an organisation." };
  }
  const plan = (input.plan || "FREE").toUpperCase();
  if (plan !== "FREE") {
    return { kind: "paid", plan };
  }

  const trialEnd = computeTrialEnd(input.createdAt!, input.trialEndsAtOverride ?? null);
  const msRemaining = trialEnd.getTime() - now.getTime();
  if (msRemaining > 0) {
    const daysRemaining = Math.ceil(msRemaining / 86_400_000);
    return { kind: "trial_active", daysRemaining, trialEndsAt: trialEnd };
  }
  return { kind: "trial_expired", trialEndedAt: trialEnd, plan };
}

/**
 * Trial end date. Override wins when set (sales-led extensions), else
 * 14 days from createdAt. Pure.
 */
export function computeTrialEnd(createdAt: Date, override: Date | null): Date {
  if (override) return override;
  return new Date(createdAt.getTime() + TRIAL_DAYS * 86_400_000);
}

/**
 * True when the dashboard layout should render the paywall screen
 * instead of the real children. Trial-active and paid pass through;
 * trial-expired and no-org block.
 */
export function isBlocked(status: PaywallStatus): boolean {
  return status.kind === "trial_expired" || status.kind === "no_org";
}

/**
 * Routes that are always reachable regardless of paywall verdict.
 * The user must be able to BILL, see their account, log out, and
 * receive webhooks no matter what. Onboarding is allowed so users
 * stuck in no_org can finish creating an org → reach billing.
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
