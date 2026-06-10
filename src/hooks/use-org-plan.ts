"use client";

/**
 * Tiny hook that gives the current org's plan to client components so
 * they can show the right BUSINESS+ upgrade hints AND so feature
 * checks can run in the browser (the server still re-enforces every
 * one — this is for UI gating only).
 *
 * Source: NextAuth session. The JWT carries `orgPlan` (stamped in
 * src/lib/auth.ts on mint + 5-min self-heal). The session callback
 * exposes it to the client.
 */

import { useSession } from "next-auth/react";
import { canUseFeature, PLAN_LIMITS, type PlanDefinition } from "@/lib/utils";

type PlanFeature = Parameters<typeof canUseFeature>[1];

export function useOrgPlan(): {
  plan: string;
  definition: PlanDefinition;
  can: (feature: PlanFeature) => boolean;
  isLoading: boolean;
} {
  const { data, status } = useSession();
  const plan = ((data as any)?.user?.orgPlan as string | undefined) || "FREE";
  const definition = PLAN_LIMITS[plan.toUpperCase()] || PLAN_LIMITS.FREE;
  return {
    plan,
    definition,
    can: (feature: PlanFeature) => canUseFeature(plan, feature),
    isLoading: status === "loading",
  };
}
