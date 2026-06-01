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
    //
    // Defensive try/catch: if either column is missing from the DB
    // (Prisma schema added it but the manual SQL migration hasn't been
    // applied yet), the SELECT throws PostgresError 42703 and the
    // unhandled throw kills the entire dashboard for every user. We
    // fail OPEN here — no MFA enforcement until the columns exist —
    // because the alternative is a full-dashboard outage. The migration
    // SQL lives at prisma/manual-migrations/2026-05-30-add-mfa-and-
    // org-policy-columns.sql; run it to re-enable enforcement.
    try {
      const [org, user] = await Promise.all([
        db.organisation.findUnique({ where: { id: orgId }, select: { requireMfa: true } }),
        db.user.findUnique({ where: { id: userId }, select: { mfaEnabled: true } }),
      ]);
      if (org?.requireMfa && !user?.mfaEnabled) {
        redirect("/mfa-required");
      }
    } catch (err) {
      // Don't crash the dashboard if MFA columns aren't migrated yet.
      // The redirect() inside the try block throws a Next.js
      // NEXT_REDIRECT sentinel that we MUST re-throw — otherwise the
      // redirect would be swallowed and the user would land on the
      // dashboard despite being subject to the policy.
      const errCode = (err as { digest?: string } | null)?.digest;
      if (typeof errCode === "string" && errCode.startsWith("NEXT_REDIRECT")) throw err;
      // Anything else (missing column, DB unreachable) — log and pass through.
      console.warn("[dashboard layout] MFA policy check skipped:", err instanceof Error ? err.message : err);
    }
  }

  return <DashboardLayoutClient>{children}</DashboardLayoutClient>;
}
