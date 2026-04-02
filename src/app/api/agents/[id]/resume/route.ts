import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const agent = await db.agent.update({
    where: { id },
    data: { status: "ACTIVE" },
  });

  await db.agentActivity.create({
    data: { agentId: id, type: "resumed", summary: `Agent resumed by ${session.user.name || "user"}` },
  });

  return NextResponse.json({ data: agent });
}
