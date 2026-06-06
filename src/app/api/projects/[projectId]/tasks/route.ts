import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ensureProjectMutable } from "@/lib/archive-guard";

export const dynamic = "force-dynamic";

// GET /api/projects/[projectId]/tasks
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const { searchParams } = new URL(req.url);
  const includeAll = searchParams.get("include") === "all";

  // ── Lazy backfill: bridge approved-artefact → Task table ──────────────
  // The Schedule / WBS parser hook runs on artefact PATCH. Projects whose
  // artefacts landed APPROVED through a different path (seed scripts,
  // bulk imports, internal-generate auto-approve, agent-created with
  // immediate approval) bypass that hook — leaving the Schedule, Agile
  // Board, Gantt, EVM, and PM Tracker delivery layer EMPTY even though
  // the WBS artefact says "10 tasks, Discovery 2026-04-01 → 04-10". This
  // backfill detects that exact gap on first read and self-heals: 0
  // schedule-sourced tasks + ≥1 approved WBS/Schedule artefact → run the
  // parser. shouldBackfillTasks() makes this O(2 small queries) when
  // there's nothing to do, so the common path stays fast.
  try {
    const { shouldBackfillTasks, syncProjectTasksFromArtefacts } =
      await import("@/lib/agents/sync-project-tasks-from-artefacts");
    if (await shouldBackfillTasks(projectId)) {
      const result = await syncProjectTasksFromArtefacts(projectId);
      if (result.tasksCreated > 0) {
        console.log(`[tasks GET] lazy backfill created ${result.tasksCreated} task(s) for ${projectId}`);
      }
    }
  } catch (e) {
    console.error("[tasks GET] lazy backfill failed (returning whatever exists):", e);
  }

  // ── Lazy backfill #2: Initial Product Backlog artefact → Task rows ────
  // The DoD/DoR criteria GET endpoint already does this for the criteria
  // columns. Apply the same pattern here so the Product Backlog page isn't
  // empty when an approved backlog artefact exists but the ingest hook
  // either pre-dated it or no-op'd because the parser didn't recognise the
  // PBI-heading format. Idempotent: ingestCriteriaArtefact deletes its own
  // previously seeded rows (createdBy=agent:*, description carries
  // [source:initial-backlog]) before re-creating, and only fires when
  // there are zero source:initial-backlog rows currently in the project.
  try {
    const alreadySeeded = await db.task.count({
      where: {
        projectId,
        description: { contains: "[source:initial-backlog]" },
      },
    });
    if (alreadySeeded === 0) {
      const backlogArtefact = await db.agentArtefact.findFirst({
        where: {
          projectId,
          status: "APPROVED",
          OR: [
            { name: { contains: "initial product backlog", mode: "insensitive" } },
            { name: { contains: "product backlog", mode: "insensitive" } },
          ],
        },
        orderBy: { updatedAt: "desc" },
        select: { id: true, name: true, content: true, agentId: true, projectId: true },
      });
      if (backlogArtefact?.content) {
        const { ingestCriteriaArtefact } = await import("@/lib/agents/criteria-ingest");
        const out = await ingestCriteriaArtefact(backlogArtefact, backlogArtefact.agentId);
        if ((out.tasks ?? 0) > 0) {
          console.log(`[tasks GET] backlog backfill: ${out.tasks} task(s) seeded from "${backlogArtefact.name}"`);
        }
      }
    }
  } catch (e) {
    console.error("[tasks GET] backlog backfill failed (returning whatever exists):", e);
  }

  let tasks = await db.task.findMany({
    where: {
      projectId,
      // By default, exclude scaffolded PM overhead tasks from delivery views.
      // Pass ?include=all to get everything (used by PM progress tracker).
      ...(!includeAll ? {
        NOT: { description: { contains: "[scaffolded]" } },
      } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  // Second pass: also remove agent-created overhead that slipped through without [scaffolded] tag.
  // Agent overhead tasks have no real dates — delivery tasks always have dates from WBS/Schedule.
  if (!includeAll) {
    tasks = tasks.filter((t) =>
      !(t.createdBy?.startsWith("agent:") && !t.startDate && !t.endDate)
    );
  }

  return NextResponse.json({ data: tasks });
}

// POST /api/projects/[projectId]/tasks
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const body = await req.json();

  const blocked = await ensureProjectMutable(projectId);
  if (blocked) return NextResponse.json({ error: blocked.error, reason: blocked.reason }, { status: blocked.status });

  // Normalise date strings (e.g. "2026-06-15") to Date so Prisma accepts them
  for (const key of ["startDate", "endDate"]) {
    if (typeof body[key] === "string" && body[key]) body[key] = new Date(body[key]);
  }
  // Strip server-managed fields a client must not set
  for (const k of ["id", "projectId", "createdBy", "lastEditedBy", "createdAt", "updatedAt"]) delete body[k];

  const task = await db.task.create({
    data: { ...body, projectId, createdBy: session.user.id },
  });

  // Append newly created task to the WBS/Schedule artefact CSV so artefact stays in sync
  try {
    const { appendTaskToArtefact } = await import("@/lib/agents/artefact-sync");
    await appendTaskToArtefact(projectId, task);
  } catch (e) {
    console.error("[POST /tasks] artefact append failed (non-blocking):", e);
  }

  return NextResponse.json({ data: task }, { status: 201 });
}
