import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveApiCaller } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// GET /api/agents/:id/knowledge — List knowledge base items
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = caller.orgId;
  const { id: agentId } = await params;
  const { searchParams } = new URL(req.url);
  const layer = searchParams.get("layer"); // PROJECT, WORKSPACE, AGENT
  const type = searchParams.get("type");
  const search = searchParams.get("q");

  // Resolve the agent's active project so we can include project-scoped items
  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, isActive: true },
    select: { projectId: true },
  });
  const projectId = deployment?.projectId;

  const items = await db.knowledgeBaseItem.findMany({
    where: {
      orgId,
      ...(layer
        ? { layer }
        : {
            OR: [
              { agentId },
              ...(projectId ? [{ projectId }] : []),
              { layer: "WORKSPACE" },
            ],
          }),
      ...(type && { type }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: "insensitive" as any } },
          { content: { contains: search, mode: "insensitive" as any } },
        ],
      }),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, title: true, content: true, type: true, layer: true, trustLevel: true,
      confidential: true, tags: true, createdAt: true, updatedAt: true, fileUrl: true,
      sourceUrl: true, fileSize: true, mimeType: true,
    },
  });

  return NextResponse.json({ data: items });
}

// POST /api/agents/:id/knowledge — Add item to knowledge base
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = caller.orgId;
  const { id: agentId } = await params;
  const body = await req.json();
  const { title, content, type, layer, sourceUrl, trustLevel, confidential, tags, projectId } = body;

  if (!title || !content) {
    return NextResponse.json({ error: "Title and content required" }, { status: 400 });
  }

  // Get agent's project if not specified
  let effectiveProjectId = projectId;
  if (!effectiveProjectId) {
    const deployment = await db.agentDeployment.findFirst({
      where: { agentId, isActive: true },
      select: { projectId: true },
    });
    effectiveProjectId = deployment?.projectId || null;
  }

  const item = await db.knowledgeBaseItem.create({
    data: {
      orgId,
      agentId: layer === "WORKSPACE" ? null : agentId,
      projectId: effectiveProjectId,
      layer: layer || "PROJECT",
      type: type || "TEXT",
      title,
      content,
      sourceUrl: sourceUrl || null,
      trustLevel: trustLevel || "STANDARD",
      confidential: confidential || false,
      tags: tags || [],
    },
  });

  // Log activity
  await db.agentActivity.create({
    data: {
      agentId,
      type: "document",
      summary: `Knowledge base updated: "${title}" (${type || "TEXT"})`,
    },
  });

  return NextResponse.json({ data: item }, { status: 201 });
}

// DELETE /api/agents/:id/knowledge — Remove item
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await resolveApiCaller(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = caller.orgId;
  const { searchParams } = new URL(req.url);
  const itemId = searchParams.get("itemId");

  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });

  // Only delete items belonging to this org
  await db.knowledgeBaseItem.deleteMany({
    where: { id: itemId, orgId },
  });

  return NextResponse.json({ data: { deleted: true } });
}
