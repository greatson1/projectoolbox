import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const stakeholders = await db.stakeholder.findMany({ where: { projectId } });
  return NextResponse.json({ data: stakeholders });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const body = await req.json();
  const stakeholder = await db.stakeholder.create({ data: { ...body, projectId } });

  // Track new stakeholder in KB
  import("@/lib/agents/kb-event-tracker").then(({ trackStakeholderChange }) => {
    trackStakeholderChange(projectId, body.name || "Stakeholder", `added as ${body.role || "stakeholder"} with ${body.influence || "unknown"} influence`).catch(() => {});
  }).catch(() => {});

  return NextResponse.json({ data: stakeholder }, { status: 201 });
}
