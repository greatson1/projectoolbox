import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// GET /api/projects/:id/metrics/history — Time-series metrics snapshots
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") || "30");

  const snapshots = await db.metricsSnapshot.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  return NextResponse.json({ data: snapshots });
}
