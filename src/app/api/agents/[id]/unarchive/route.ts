import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // Restore to PAUSED — the user can explicitly resume from there. We never
  // auto-resume an archived agent because the project context may have moved on.
  const agent = await db.agent.update({
    where: { id },
    data: {
      status: "PAUSED",
      archivedAt: null,
      archivedBy: null,
      archiveReason: null,
    },
  });

  await db.agentActivity.create({
    data: {
      agentId: id,
      type: "unarchived",
      summary: `Agent unarchived by ${session.user.name || "user"} — restored to paused`,
    },
  });

  return NextResponse.json({ data: agent });
}
