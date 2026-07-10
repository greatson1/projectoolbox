import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveApiCaller } from "@/lib/api-auth";
import { CreditService } from "@/lib/credits/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/agents/[id]/clarification/generate
 *
 * User-initiated: triggers artefact generation after a completed clarification session.
 * This IS a credit-consuming action but it is explicit and user-initiated — the user
 * clicks "Generate Documents" in the completion card.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const orgId = caller.orgId;

  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    select: { id: true, projectId: true, currentPhase: true },
  });
  if (!deployment?.projectId) {
    return NextResponse.json({ error: "No active deployment found" }, { status: 404 });
  }

  // Credit pre-flight only — do NOT deduct here. generatePhaseArtefacts
  // bills for itself (max(5, generated×2)) and only when at least one
  // artefact was actually produced. Deducting a flat 10 up front meant
  // (a) a failed generation still cost the user 10 credits with no refund,
  // and (b) a successful one was billed twice (10 here + N×2 inside).
  const hasCredits = await CreditService.checkBalance(orgId, 10);
  if (!hasCredits) {
    return NextResponse.json({ error: "Insufficient credits. 10 credits required for document generation." }, { status: 402 });
  }

  // Fire generation in background so response is instant
  (async () => {
    try {
      const { generatePhaseArtefacts } = await import("@/lib/agents/lifecycle-init");
      await generatePhaseArtefacts(agentId, deployment.projectId, deployment.currentPhase ?? undefined);

      // Post completion notification to chat
      await db.chatMessage.create({
        data: {
          agentId,
          role: "agent",
          content: `Your documents have been generated. Head to the **Artefacts** tab to review them. Any fields marked TBC can be updated there once you have the details.`,
        },
      }).catch(() => {});
    } catch (e) {
      console.error("[clarification/generate] failed:", e);
    }
  })();

  return NextResponse.json({ data: { status: "generating", projectId: deployment.projectId } });
}
