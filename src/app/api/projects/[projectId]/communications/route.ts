import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });
  const { projectId } = await params;

  const body = await req.json();

  const entry = await db.auditLog.create({
    data: {
      orgId,
      userId: session.user.id,
      action: "STAKEHOLDER_COMMUNICATION",
      target: `stakeholder:${body.stakeholderId}`,
      details: {
        type: body.type,
        notes: body.notes,
        date: body.date,
        projectId,
      },
    },
  });

  return NextResponse.json({ data: entry }, { status: 201 });
}
