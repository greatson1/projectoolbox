import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// GET /api/agents/[id]/artefacts — List artefacts for an agent
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: agentId } = await params;

  const artefacts = await db.agentArtefact.findMany({
    where: { agentId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: artefacts });
}
