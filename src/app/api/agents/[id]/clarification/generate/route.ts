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

  // Credit check — generation costs 10 credits
  const hasCredits = await CreditService.checkBalance(orgId, 10);
  if (!hasCredits) {
    return NextResponse.json({ error: "Insufficient credits. 10 credits required for document generation." }, { status: 402 });
  }

  await CreditService.deduct(orgId, 10, "Artefact generation (post-clarification)", agentId);

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
