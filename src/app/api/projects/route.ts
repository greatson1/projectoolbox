import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { PLAN_LIMITS } from "@/lib/utils";

export const dynamic = "force-dynamic";

// GET /api/projects — List org projects
// Defaults to ACTIVE/PAUSED/COMPLETED. Pass ?include=archived to also include
// archived projects (e.g. an "Archived" tab on the projects page).
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation — session may still be loading" }, { status: 403 });

  const url = new URL(req.url);
  const filter = url.searchParams.get("include"); // null | "archived" | "only-archived"

  const where: any = { orgId };
  if (filter === "only-archived") where.status = "ARCHIVED";
  else if (filter !== "archived") where.status = { not: "ARCHIVED" };

  const projects = await db.project.findMany({
    where,
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

    // ── Project cap ────────────────────────────────────────────────────────
    // 1 agent = 1 active project. The cap that matters here is PROJECTS;
    // ACTIVE/PAUSED/COMPLETED count, ARCHIVED doesn't (an archived project
    // can be restored but doesn't consume the live quota). Lifting the cap
    // is a tier upgrade — the error message tells the user exactly that.
    const org = await db.organisation.findUnique({ where: { id: orgId }, select: { plan: true } });
    const planLimit = PLAN_LIMITS[org?.plan ?? "FREE"]?.projects ?? PLAN_LIMITS.FREE.projects;
    const activeProjects = await db.project.count({
      where: { orgId, status: { not: "ARCHIVED" } },
    });
    if (activeProjects >= planLimit) {
      return NextResponse.json({
        error: `Project limit reached (${planLimit} for ${org?.plan ?? "FREE"} plan). Archive an existing project or upgrade your plan to add more.`,
        code: "PLAN_LIMIT_PROJECTS",
        upgradeUrl: "/billing",
      }, { status: 403 });
    }

    // Idempotency: if a project with this exact name was created in the same
    // org within the last 60s, return that one. Prevents duplicates from
    // React Query retries, double-clicks, browser back-then-resubmit, and
    // multi-tab submissions of the same deploy wizard.
    const recentDuplicate = await db.project.findFirst({
      where: {
        orgId,
        name,
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (recentDuplicate) {
      return NextResponse.json({ data: recentDuplicate, idempotent: true }, { status: 200 });
    }

    // Map methodology keys to Prisma enum values. Single source of truth
    // lives in methodology-definitions.ts:toMethodologyEnum — see comment
    // there for the full alias / casing handling.
    const { toMethodologyEnum } = await import("@/lib/methodology-definitions");
    const methodology = (toMethodologyEnum(body.methodology) || "WATERFALL") as any;

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
