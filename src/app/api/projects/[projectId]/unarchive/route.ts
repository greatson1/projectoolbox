import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  const { projectId } = await params;

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, orgId: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (project.orgId !== orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const updated = await db.project.update({
    where: { id: projectId },
    data: {
      status: "ACTIVE",
      archivedAt: null,
      archivedBy: null,
      archiveReason: null,
    },
  });

  // Note: cascaded agents are NOT auto-unarchived. The user can choose to
  // unarchive each agent individually — the project may be unarchived for
  // reference work without spinning the agent back up.

  return NextResponse.json({ data: updated });
}
