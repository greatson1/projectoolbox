import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveApiCaller } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/agents/[id]/kb/store-fact
 *
 * Stores a user-confirmed fact directly to the Knowledge Base.
 * Used when the user answers an interactive question card — zero credit cost.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const { title, content } = await req.json();

  if (!title || !content) {
    return NextResponse.json({ error: "title and content are required" }, { status: 400 });
  }

  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    select: { projectId: true },
  });
  if (!deployment?.projectId) {
    return NextResponse.json({ error: "No active deployment" }, { status: 404 });
  }

  try {
    const { storeFactToKB } = await import("@/lib/agents/clarification-session");
    await storeFactToKB(agentId, deployment.projectId, caller.orgId, title, String(content), ["chat_answer", "user_confirmed"]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[kb/store-fact] failed:", e);
    return NextResponse.json({ error: "Failed to store fact" }, { status: 500 });
  }
}
