import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { looksLikeFabricatedName } from "@/lib/agents/fabricated-names";

export const dynamic = "force-dynamic";

/**
 * GET /api/projects/:id/resources
 *
 * Returns resource/workload data derived from:
 *  - Stakeholders (the registered team for the project)
 *  - Tasks (workload via assigneeId, estimatedHours, actualHours)
 *
 * Each member entry has:
 *   id, name, role, email, sentiment
 *   tasks: { total, done, inProgress, todo, blocked }
 *   hours: { estimated, actual }
 *   allocation: 0-100 (% of project tasks assigned to this person)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  const [stakeholders, tasks] = await Promise.all([
    db.stakeholder.findMany({ where: { projectId } }),
    db.task.findMany({
      where: { projectId },
      select: {
        id: true, status: true, assigneeId: true,
        estimatedHours: true, actualHours: true,
        priority: true, title: true,
      },
    }),
  ]);

  const totalTasks = tasks.length;

  // Build a workload map keyed by assigneeId (could be a name or ID string)
  const workloadByAssignee = new Map<string, {
    tasks: { total: number; done: number; inProgress: number; todo: number; blocked: number };
    hours: { estimated: number; actual: number };
  }>();

  for (const task of tasks) {
    if (!task.assigneeId) continue;
    const key = task.assigneeId;
    if (!workloadByAssignee.has(key)) {
      workloadByAssignee.set(key, {
        tasks: { total: 0, done: 0, inProgress: 0, todo: 0, blocked: 0 },
        hours: { estimated: 0, actual: 0 },
      });
    }
    const w = workloadByAssignee.get(key)!;
    w.tasks.total += 1;
    const s = (task.status || "").toUpperCase();
    if (s === "DONE") w.tasks.done += 1;
    else if (s === "IN_PROGRESS") w.tasks.inProgress += 1;
    else if (s === "BLOCKED") w.tasks.blocked += 1;
    else w.tasks.todo += 1;
    w.hours.estimated += task.estimatedHours || 0;
    w.hours.actual += task.actualHours || 0;
  }

  // Merge stakeholders with their workload
  // Match by: stakeholder.name === assigneeId (name-based assignment) or by id
  // Defensive filter: drop stakeholders whose name looks fabricated (e.g. old
  // rows that pre-date the fabricated-name block in the seeder).
  const members = stakeholders
    .filter(s => !looksLikeFabricatedName(s.name))
    .map(s => {
    const workload = workloadByAssignee.get(s.name) || workloadByAssignee.get(s.id) || {
      tasks: { total: 0, done: 0, inProgress: 0, todo: 0, blocked: 0 },
      hours: { estimated: 0, actual: 0 },
    };
    const allocation = totalTasks > 0 ? Math.round((workload.tasks.total / totalTasks) * 100) : 0;
    return {
      id: s.id,
      name: s.name,
      role: s.role || "Team Member",
      email: s.email || null,
      sentiment: s.sentiment || "neutral",
      power: s.power,
      interest: s.interest,
      tasks: workload.tasks,
      hours: workload.hours,
      allocation,
      // Carry the source-prefix-bearing notes through so the Resources
      // page can render the SourceBadge + "Why this resource?" expansion.
      notes: s.notes || null,
    };
  });

  // Also include any assigneeIds not matched to a stakeholder (freeform names)
  const knownIds = new Set([
    ...stakeholders.map(s => s.name),
    ...stakeholders.map(s => s.id),
  ]);
  const unmatched: typeof members = [];
  for (const [assigneeId, workload] of workloadByAssignee.entries()) {
    if (!knownIds.has(assigneeId)) {
      // Don't surface freeform assignees that look like fabricated names
      if (looksLikeFabricatedName(assigneeId)) continue;
      const allocation = totalTasks > 0 ? Math.round((workload.tasks.total / totalTasks) * 100) : 0;
      unmatched.push({
        id: assigneeId,
        name: assigneeId,
        role: "Team Member",
        email: null,
        sentiment: "neutral",
        power: 50,
        interest: 50,
        tasks: workload.tasks,
        hours: workload.hours,
        allocation,
      });
    }
  }

  const allMembers = [...members, ...unmatched];

  // Summary stats
  const totalEstimatedHours = allMembers.reduce((s, m) => s + m.hours.estimated, 0);
  const totalActualHours = allMembers.reduce((s, m) => s + m.hours.actual, 0);
  const avgAllocation = allMembers.length > 0
    ? Math.round(allMembers.reduce((s, m) => s + m.allocation, 0) / allMembers.length)
    : 0;
  const unassignedTasks = tasks.filter(t => !t.assigneeId).length;

  return NextResponse.json({
    data: {
      members: allMembers,
      summary: {
        teamSize: allMembers.length,
        avgAllocation,
        totalEstimatedHours: Math.round(totalEstimatedHours),
        totalActualHours: Math.round(totalActualHours),
        totalTasks,
        unassignedTasks,
      },
    },
  });
}
