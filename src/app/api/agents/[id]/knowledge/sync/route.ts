import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/agents/:id/knowledge/sync
 *
 * Called by the VPS agent after each cycle to sync knowledge items
 * from the agent's local memory to the Supabase KnowledgeBaseItem table.
 * This makes agent knowledge visible in the UI Knowledge Base.
 *
 * Auth: uses the CRON_SECRET or job API key (not user session)
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Verify API key
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const jobKey = process.env.JOB_API_KEY;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && authHeader !== `Bearer ${jobKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: agentId } = await params;
  const body = await req.json();
  const { items } = body; // Array of { title, content, type, category, tags }

  if (!items || !Array.isArray(items)) {
    return NextResponse.json({ error: "items array required" }, { status: 400 });
  }

  const agent = await db.agent.findUnique({ where: { id: agentId }, select: { orgId: true } });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  // Get active project
  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    select: { projectId: true },
  });

  let synced = 0;
  for (const item of items.slice(0, 20)) { // Max 20 items per sync
    try {
      // Dedup by title + agentId
      const existing = await db.knowledgeBaseItem.findFirst({
        where: { agentId, title: item.title },
      });

      if (existing) {
        // Update existing
        await db.knowledgeBaseItem.update({
          where: { id: existing.id },
          data: { content: item.content, updatedAt: new Date() },
        });
      } else {
        // Create new
        await db.knowledgeBaseItem.create({
          data: {
            orgId: agent.orgId,
            agentId,
            projectId: deployment?.projectId || null,
            layer: item.category === "client_learning" ? "WORKSPACE" : "PROJECT",
            type: "DECISION",
            title: item.title,
            content: item.content,
            tags: item.tags || [item.category || "agent-memory", "auto-synced"],
          },
        });
      }
      synced++;
    } catch {}
  }

  return NextResponse.json({ data: { synced } });
}
