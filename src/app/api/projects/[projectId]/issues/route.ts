import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const issues = await db.issue.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ data: issues });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const body = await req.json();
  const issue = await db.issue.create({ data: { ...body, projectId } });

  // Track new issue in KB
  import("@/lib/agents/kb-event-tracker").then(({ trackIssueResolution }) => {
    if (body.status === "RESOLVED" || body.status === "CLOSED") {
      trackIssueResolution(projectId, body.title || "Issue", body.resolution || "Resolved", body.severity || "MEDIUM").catch(() => {});
    }
  }).catch(() => {});

  return NextResponse.json({ data: issue }, { status: 201 });
}
