import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// GET /api/reports — List reports
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ data: [] });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const projectId = searchParams.get("projectId");

  const reports = await db.report.findMany({
    where: {
      orgId,
      ...(type && { type: type as any }),
      ...(projectId && { projectId }),
    },
    include: { project: { select: { id: true, name: true } } },
    orderBy: { generatedAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ data: reports });
}

// POST /api/reports — Generate report
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const body = await req.json();
  const { title, type, projectId, sections, format, recipients } = body;

  const report = await db.report.create({
    data: {
      title: title || `${type} Report`,
      type: type || "STATUS",
      status: "PUBLISHED",
      format: format || "PDF",
      projectId,
      orgId,
      sections,
      recipients: recipients || [],
      creditsUsed: 10,
    },
  });

  // Deduct credits
  const { CreditService } = await import("@/lib/credits/service");
  await CreditService.deduct(orgId, 10, `Report generated: ${report.title}`);

  return NextResponse.json({ data: report }, { status: 201 });
}
