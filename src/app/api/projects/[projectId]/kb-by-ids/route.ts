import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/[projectId]/kb-by-ids?ids=cmAbc,cmDef,...
 *
 * Returns the named KnowledgeBaseItem rows scoped to the project + caller's
 * org. Used by the approvals UI to preview the actual content of facts
 * gated behind a research-finding approval — without exposing the full KB
 * for the project (which can be large).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No org" }, { status: 403 });

  const { projectId } = await params;
  const idsParam = req.nextUrl.searchParams.get("ids") || "";
  const ids = idsParam.split(",").map(s => s.trim()).filter(Boolean).slice(0, 100);
  if (ids.length === 0) return NextResponse.json({ data: [] });

  const project = await db.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const rows = await db.knowledgeBaseItem.findMany({
    where: { id: { in: ids }, projectId, orgId },
    select: { id: true, title: true, content: true, tags: true, trustLevel: true, type: true },
  });

  return NextResponse.json({ data: rows });
}
