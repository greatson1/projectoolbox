import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const artefact = await db.agentArtefact.findUnique({ where: { id } });
  if (!artefact) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ data: artefact });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = await req.json();
  const { status, feedback, content } = body;

  const artefact = await db.agentArtefact.update({
    where: { id },
    data: {
      ...(status && { status }),
      ...(feedback !== undefined && { feedback }),
      ...(content && { content, version: { increment: 1 } }),
    },
  });

  // ── Knowledge extraction ──────────────────────────────────────────────────
  // When an artefact is saved (content changed) or approved, extract facts
  // into the knowledge base so future generations use real names and decisions.
  const shouldLearn = (content && content.trim().length > 50) || status === "APPROVED";
  if (shouldLearn) {
    try {
      // Fetch agent/org context for the KB write
      const deployment = await db.agentDeployment.findFirst({
        where: { projectId: artefact.projectId, isActive: true },
        select: { agentId: true },
      });
      const agentId = deployment?.agentId || artefact.agentId;
      if (agentId && artefact.projectId) {
        const agent = await db.agent.findUnique({ where: { id: agentId }, select: { orgId: true } });
        if (agent) {
          // Fire-and-forget — don't await so approval is instant for the user
          const { extractAndStoreArtefactKnowledge } = await import("@/lib/agents/artefact-learning");
          extractAndStoreArtefactKnowledge(
            { id: artefact.id, name: artefact.name, format: artefact.format, content: content || artefact.content, status: status || artefact.status },
            agentId,
            artefact.projectId,
            agent.orgId,
          ).catch(e => console.error("[artefact PATCH] knowledge extraction failed:", e));
        }
      }
    } catch (e) {
      console.error("[artefact PATCH] knowledge extraction setup failed:", e);
    }
  }

  return NextResponse.json({ data: artefact });
}
