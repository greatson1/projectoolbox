import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DashboardLayoutClient } from "./DashboardLayoutClient";

/**
 * Server-side gate that wraps the dashboard. Runs ahead of the client layout
 * so we never paint a flash of dashboard content for a user who shouldn't
 * see it.
 *
 * Currently enforces one policy: org.requireMfa. If the user's active org
 * has the policy on AND the user hasn't enrolled TOTP, redirect to
 * /mfa-required. That page provides the same MfaCard widget in a locked
 * mode — they cannot escape until they enrol.
 *
 * Future policies (sessionTimeoutMinutes, ipAllowlist, signedDevicePolicy)
 * plug into the same flow.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    // The middleware should already have caught this, but defence in depth:
    // if for any reason the user is here without a session, send them to login.
    redirect("/login");
  }

  const userId = session.user.id;
  const orgId = (session.user as any).orgId as string | undefined;

  if (orgId) {
    // Two-column read so we get both the policy and the user's MFA status
    // in one round-trip. Both are tiny SELECTs covered by primary-key
    // indexes, so the latency cost is negligible.
    const [org, user] = await Promise.all([
      db.organisation.findUnique({ where: { id: orgId }, select: { requireMfa: true } }),
      db.user.findUnique({ where: { id: userId }, select: { mfaEnabled: true } }),
    ]);
    if (org?.requireMfa && !user?.mfaEnabled) {
      redirect("/mfa-required");
    }
  }

  return <DashboardLayoutClient>{children}</DashboardLayoutClient>;
}
