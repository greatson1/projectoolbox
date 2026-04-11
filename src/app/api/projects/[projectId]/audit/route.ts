import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/projects/:id/audit — Project-level audit trail
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") || "50");
  const type = searchParams.get("type");

  const logs = await db.auditLog.findMany({
    where: {
      projectId,
      ...(type && { entityType: type }),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ data: logs });
}
