import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// GET /api/agents/:id/memory — Agent memory records (knowledge base + decision history)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: agentId } = await params;
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") || "20");

  // Combine knowledge base items + recent decisions as "memory"
  const [kbItems, decisions, activities] = await Promise.all([
    db.knowledgeBaseItem.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, title: true, type: true, layer: true, content: true, createdAt: true },
    }),
    db.agentDecision.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, type: true, description: true, reasoning: true, status: true, confidence: true, createdAt: true },
    }),
    db.agentActivity.findMany({
      where: { agentId, type: { in: ["proactive_alert", "lifecycle_init", "meeting"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, type: true, summary: true, metadata: true, createdAt: true },
    }),
  ]);

  return NextResponse.json({
    data: {
      knowledge: kbItems,
      decisions,
      activities,
      totalMemoryItems: kbItems.length + decisions.length + activities.length,
    },
  });
}
