/**
 * Server-side plan-feature gate used by API routes that toggle
 * BUSINESS+ governance switches (SSO/SAML setup, org-MFA enforcement,
 * audit log read, IP allowlist, etc.).
 *
 * Pattern in a route handler:
 *
 *   const guard = await requirePlanFeature(session, "ssoSaml");
 *   if (!guard.ok) return guard.response;
 *   // ...continue with the privileged operation
 *
 * Centralises three things every gated route would otherwise repeat:
 *   1. Resolving the org's current plan from the session/JWT (with a
 *      DB fallback for stale tokens whose orgPlan field hasn't been
 *      stamped yet — e.g. an OAuth user mid-onboarding).
 *   2. Looking up the feature on PLAN_LIMITS and returning a clean
 *      403 with the canonical message from insufficientPlanResponse().
 *   3. Returning a typed result so the call site doesn't need to
 *      remember which property to read.
 *
 * Use canUseFeature() instead when you just need a boolean (e.g.
 * conditionally rendering a UI button). This helper is the
 * yes-or-403 short-circuit for the route layer.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canUseFeature, insufficientPlanResponse, type PlanDefinition } from "@/lib/utils";

type PlanFeature = Parameters<typeof canUseFeature>[1];

interface OkResult {
  ok: true;
  plan: string;
}

interface BlockedResult {
  ok: false;
  /** Ready-to-return NextResponse with the appropriate 403/401 status. */
  response: NextResponse;
}

/**
 * Yes-or-403 gate for a plan feature. Returns ok+plan or a ready
 * NextResponse for the caller to `return` directly.
 *
 * The session argument is typed as `any` because route handlers get
 * the NextAuth session object whose precise shape (orgId, orgPlan)
 * varies between adapter and JWT strategies — both are tolerated.
 */
export async function requirePlanFeature(
  session: any | null | undefined,
  feature: PlanFeature,
): Promise<OkResult | BlockedResult> {
  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const orgId = session.user.orgId as string | undefined;
  if (!orgId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "No organisation" }, { status: 400 }),
    };
  }

  // Prefer the plan stamped on the session/JWT — middleware already uses
  // this, and the 5-min self-heal in auth.ts keeps it fresh. Fall back to
  // a DB read when the token is older than the feature wiring (e.g. user
  // signed in before orgPlan was added to the JWT shape).
  let plan: string | undefined = session.user.orgPlan;
  if (!plan) {
    const org = await db.organisation.findUnique({
      where: { id: orgId },
      select: { plan: true },
    }).catch(() => null);
    plan = org?.plan ?? "FREE";
  }

  if (!canUseFeature(plan, feature)) {
    const payload = insufficientPlanResponse(feature);
    return {
      ok: false,
      response: NextResponse.json(payload, { status: 403 }),
    };
  }

  return { ok: true, plan };
}

/**
 * Re-export for symmetry — callers that already imported the helper
 * from plan-guard.ts shouldn't also need to pull canUseFeature.
 */
export { canUseFeature };
export type { PlanDefinition };
