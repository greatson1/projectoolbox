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
    include: {
      project: { select: { id: true, name: true } },
      versions: { orderBy: { version: "desc" }, take: 5 },
    },
    orderBy: { generatedAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ data: reports });
}

// POST /api/reports — Generate report with REAL content
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const body = await req.json();
  const { title, type, projectId, sections, format, recipients } = body;

  if (!projectId) {
    return NextResponse.json({ error: "Project ID required for report generation" }, { status: 400 });
  }

  // Check credits
  const { CreditService } = await import("@/lib/credits/service");
  const hasCredits = await CreditService.checkBalance(orgId, 10);
  if (!hasCredits) {
    return NextResponse.json({ error: "Insufficient credits. Reports cost 10 credits." }, { status: 402 });
  }

  // Create report record first (DRAFT)
  const report = await db.report.create({
    data: {
      title: title || `${(type || "STATUS").replace(/_/g, " ")} Report`,
      type: type || "STATUS",
      status: "DRAFT",
      format: format || "PDF",
      projectId,
      orgId,
      sections: sections || [],
      recipients: recipients || [],
      creditsUsed: 10,
    },
  });

  // Generate actual content from project data
  try {
    const { gatherProjectData, generateReportContent } = await import("@/lib/agents/report-generator");

    const projectData = await gatherProjectData(projectId);
    const content = await generateReportContent(type || "STATUS", sections || [], projectData);

    // Update report with generated content
    await db.report.update({
      where: { id: report.id },
      data: {
        content,
        status: "PUBLISHED",
        publishedAt: new Date(),
        pageCount: Math.ceil(content.length / 3000), // Rough page estimate
      },
    });

    // Deduct credits
    await CreditService.deduct(orgId, 10, `Report generated: ${report.title}`);

    // Log activity
    const agent = await db.agent.findFirst({
      where: { orgId, status: "ACTIVE" },
      select: { id: true },
    });
    if (agent) {
      await db.agentActivity.create({
        data: {
          agentId: agent.id,
          type: "document",
          summary: `Generated ${(type || "STATUS").replace(/_/g, " ")} report for ${projectData.project.name}`,
        },
      });
    }

    // Create notification
    await db.notification.create({
      data: {
        userId: session.user.id!,
        type: "AGENT_ALERT",
        title: `Report generated: ${report.title}`,
        body: `Your ${(type || "STATUS").replace(/_/g, " ")} report for ${projectData.project.name} is ready for review.`,
        actionUrl: `/projects/${projectId}/reports`,
      },
    });

    const updated = await db.report.findUnique({
      where: { id: report.id },
      include: { project: { select: { id: true, name: true } }, versions: true },
    });

    return NextResponse.json({ data: updated }, { status: 201 });
  } catch (e: any) {
    // If generation fails, keep the record but mark as failed
    await db.report.update({
      where: { id: report.id },
      data: { status: "FAILED", content: `<p>Report generation failed: ${e.message}</p>` },
    });
    console.error("Report generation error:", e);
    return NextResponse.json({ data: report, error: e.message }, { status: 201 });
  }
}
