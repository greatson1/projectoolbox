import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// GET /api/projects — List org projects
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ data: [] });

  const projects = await db.project.findMany({
    where: { orgId },
    include: {
      agents: { include: { agent: true } },
      _count: { select: { tasks: true, risks: true, approvals: { where: { status: "PENDING" } } } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ data: projects });
}

// POST /api/projects — Create project
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const body = await req.json();
  const { name, description, methodology, startDate, endDate, budget, priority, category } = body;

  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const project = await db.project.create({
    data: {
      name,
      description,
      methodology: methodology || "WATERFALL",
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      budget: budget ? parseFloat(budget) : undefined,
      priority,
      category,
      orgId,
    },
  });

  return NextResponse.json({ data: project }, { status: 201 });
}
