import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/agents/artefacts/[id]/versions
// Returns the ArtefactVersion snapshots written by the PATCH handler,
// newest first. Each row is the content as it was BEFORE the save that
// created it — `content` is included so the editor's "Restore this
// version" action can write it back via the normal PATCH flow.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const artefact = await db.agentArtefact.findUnique({ where: { id }, select: { id: true } });
  if (!artefact) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const versions = await db.artefactVersion.findMany({
    where: { artefactId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      version: true,
      content: true,
      status: true,
      editedBy: true,
      comment: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ data: versions });
}
