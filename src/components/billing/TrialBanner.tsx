"use client";

/**
 * Trial countdown banner. Renders when the org has a trialEndsAt in
 * the future — i.e. they're on a paid plan but Stripe says
 * status='trialing'. Shows X days remaining and links to /billing so
 * the user can see what's happening with their card or cancel.
 *
 * Hides itself when:
 *   - trialEndsAt is null (org is on FREE or has paid past the trial)
 *   - trialEndsAt is in the past (webhook hasn't yet cleared the
 *     column — fail-soft so we don't show a stale "0 days left" pill)
 *
 * Drops into the dashboard layout as a thin top-of-page strip; the
 * design is intentionally non-blocking — trialing users keep working,
 * they just see a gentle reminder.
 */

import Link from "next/link";
import { useSession } from "next-auth/react";
import { Clock } from "lucide-react";

export function TrialBanner() {
  const { data } = useSession();
  const trialEndsAtRaw = (data as any)?.user?.orgTrialEndsAt as string | null | undefined;
  const plan = (data as any)?.user?.orgPlan as string | undefined;
  if (!trialEndsAtRaw) return null;

  const trialEnd = new Date(trialEndsAtRaw);
  const msRemaining = trialEnd.getTime() - Date.now();
  if (msRemaining <= 0) return null;

  const daysRemaining = Math.ceil(msRemaining / 86_400_000);
  const urgent = daysRemaining <= 3;

  return (
    <div className={`px-4 py-2 text-xs flex items-center justify-center gap-3 border-b ${urgent ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300" : "bg-primary/5 border-primary/20"}`}>
      <Clock className={`w-3.5 h-3.5 ${urgent ? "text-amber-500" : "text-primary"}`} />
      <span className="font-medium">
        {daysRemaining} day{daysRemaining === 1 ? "" : "s"} left on your {plan ?? ""} trial
        {urgent && " — card will be charged when it ends"}
      </span>
      <Link href="/billing" className="font-semibold underline hover:no-underline">
        Manage billing
      </Link>
    </div>
  );
}
