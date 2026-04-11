import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

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
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const orgId = (session.user as any).orgId;
    if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

    const body = await req.json();
    const { name, description, startDate, endDate, budget, priority, category } = body;

    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    // Map methodology keys to Prisma enum values (handles any casing from the deploy wizard)
    const METHODOLOGY_MAP: Record<string, string> = {
      prince2: "PRINCE2", waterfall: "WATERFALL", scrum: "AGILE_SCRUM",
      kanban: "AGILE_KANBAN", safe: "SAFE", hybrid: "HYBRID",
      // Uppercase variants (deploy wizard sends .toUpperCase())
      PRINCE2: "PRINCE2", WATERFALL: "WATERFALL", SCRUM: "AGILE_SCRUM",
      KANBAN: "AGILE_KANBAN", SAFE: "SAFE", HYBRID: "HYBRID",
      // Already-mapped enum values (idempotent)
      AGILE_SCRUM: "AGILE_SCRUM", AGILE_KANBAN: "AGILE_KANBAN",
    };
    const methodology = (METHODOLOGY_MAP[body.methodology] || "WATERFALL") as any;

    // Auto-detect project tier
    let tier = body.tier || null;
    try {
      const { detectProjectTier } = await import("@/lib/agents/project-tier");
      tier = tier || detectProjectTier({
        budget: budget ? parseFloat(budget) : null,
        startDate: startDate || null,
        endDate: endDate || null,
      });
    } catch {}

    const project = await db.project.create({
      data: {
        name,
        description,
        methodology: methodology || "WATERFALL",
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        budget: budget ? parseFloat(budget) : undefined,
        tier,
        priority,
        category,
        orgId,
      },
    });

    return NextResponse.json({ data: project }, { status: 201 });
  } catch (e: any) {
    console.error("[POST /api/projects]", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
