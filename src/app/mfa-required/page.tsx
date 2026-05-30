import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { MfaRequiredClient } from "./MfaRequiredClient";

/**
 * Interstitial enforced by the dashboard server layout when:
 *   - the user's active org has requireMfa=true, AND
 *   - the user has NOT yet enrolled TOTP.
 *
 * The user cannot bypass this page (the dashboard layout redirects them
 * straight back). The only way through is to enrol via the MfaCard widget
 * embedded below, which on success refreshes the user row → next layout
 * render lets them in.
 *
 * If they reach this page without the policy actually being on (e.g. they
 * navigated here directly), we send them back to /dashboard so they don't
 * see a misleading enforcement screen.
 */
export default async function MfaRequiredPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const userId = session.user.id;
  const orgId = (session.user as any).orgId as string | undefined;
  if (!orgId) redirect("/onboarding");

  const [org, user] = await Promise.all([
    db.organisation.findUnique({
      where: { id: orgId },
      select: { name: true, requireMfa: true },
    }),
    db.user.findUnique({ where: { id: userId }, select: { mfaEnabled: true } }),
  ]);

  if (!org?.requireMfa || user?.mfaEnabled) {
    // Policy off or already enrolled — nothing to enforce, drop them into
    // the app.
    redirect("/dashboard");
  }

  return <MfaRequiredClient orgName={org.name} userEmail={session.user.email ?? "you"} />;
}
