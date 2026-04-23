/**
 * Autonomous Sprint Planner
 *
 * After WBS/task seeding, the agent automatically:
 *   1. Estimates story points for each task (using Claude Haiku — cheap)
 *   2. Reads team members from Stakeholder Register
 *   3. Calculates team capacity per sprint
 *   4. Creates sprints with proper date ranges
 *   5. Assigns tasks to sprints (highest priority first, up to capacity)
 *   6. Assigns tasks to team members based on role matching
 *   7. Creates calendar events for sprint ceremonies
 *
 * Called automatically after WBS/Schedule artefact is approved.
 */

import { db } from "@/lib/db";
import { looksLikeFabricatedName } from "./fabricated-names";

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_SPRINT_DURATION_DAYS = 14;
const DEFAULT_VELOCITY_POINTS = 20; // story points per sprint (conservative default)
const HOURS_PER_POINT = 4; // rough estimate: 1 SP ≈ 4 hours of effort

// ─── Main entry point ────────────────────────────────────────────────────────

export interface PlanSprintsOptions {
  /** When true, clears existing auto-planned sprint assignments and re-plans from scratch.
   *  User-set sprint assignments (sprintId on tasks) are preserved unless `resetAll` is also true. */
  force?: boolean;
  /** When true alongside force, also clears user-set sprint assignments (full replan). */
  resetAll?: boolean;
  /** Override sprint duration in days (default: 14). */
  sprintDurationDays?: number;
  /** Override team velocity in story points per sprint (default: auto-calculated). */
  velocityOverride?: number;
}

export async function planSprints(
  agentId: string,
  projectId: string,
  opts: PlanSprintsOptions = {},
): Promise<{ sprints: number; tasksAssigned: number; pointsPlanned: number; cleared: number }> {
  const { force = false, resetAll = false, sprintDurationDays, velocityOverride } = opts;

  // ── Force replan: clear existing auto-planned sprint links ──────────────────
  let cleared = 0;
  if (force) {
    // Remove sprint assignment from tasks whose sprint was auto-planned
    // (goal contains "[auto-planned]" or "[source:artefact]")
    const autoSprints = await db.sprint.findMany({
      where: {
        projectId,
        OR: [
          { goal: { contains: "[auto-planned]" } },
          { goal: { contains: "[source:artefact]" } },
        ],
      },
      select: { id: true },
    });
    const autoSprintIds = autoSprints.map(s => s.id);

    if (autoSprintIds.length > 0 || resetAll) {
      const unassignWhere = resetAll
        ? { projectId }                                           // every task
        : { projectId, sprintId: { in: autoSprintIds } };        // only auto-sprint tasks
      const unassigned = await db.task.updateMany({
        where: unassignWhere,
        data: { sprintId: null },
      });
      cleared = unassigned.count;

      // Delete the now-empty auto-planned sprints
      if (autoSprintIds.length > 0) {
        await db.sprint.deleteMany({
          where: { id: { in: autoSprintIds } },
        }).catch(() => {});
      }
    }
  }

  // Load project, tasks, existing sprints, stakeholders, and project members
  const [project, tasks, existingSprints, stakeholders, projectMembers] = await Promise.all([
    db.project.findUnique({ where: { id: projectId } }),
    db.task.findMany({
      where: { projectId, sprintId: null },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    }),
    db.sprint.findMany({ where: { projectId }, orderBy: { startDate: "asc" } }),
    db.stakeholder.findMany({ where: { projectId } }),
    db.projectMember.findMany({
      where: { projectId },
      include: { user: { select: { name: true } } },
    }),
  ]);

  if (!project) return { sprints: 0, tasksAssigned: 0, pointsPlanned: 0, cleared };

  // Only plan for unassigned tasks — if everything is already sprint-linked, there's nothing to do.
  // NOTE: We intentionally do NOT bail just because sprints already exist. When a WBS is approved
  // after a Backlog (or vice versa), the new tasks need to be slotted into existing sprints.
  const backlogTasks = tasks.filter(t => !t.sprintId);
  if (backlogTasks.length === 0) return { sprints: 0, tasksAssigned: 0, pointsPlanned: 0, cleared };

  // ── Step 1: Estimate story points using Claude Haiku ──
  await estimateStoryPoints(backlogTasks, project);

  // Reload tasks after estimation
  const updatedTasks = await db.task.findMany({
    where: { projectId, sprintId: null },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  // ── Step 2: Extract team members from stakeholders + project members ──
  const stakeholderTeam = extractTeamMembers(stakeholders);
  const memberTeam: TeamMember[] = (projectMembers || [])
    .filter((m: any) => m.user?.name)
    .map((m: any) => ({ name: m.user.name, role: m.role || "Team" }));
  // Merge: project members first (explicitly added), then stakeholders (auto-extracted)
  const seen = new Set<string>();
  const teamMembers: TeamMember[] = [];
  for (const m of [...memberTeam, ...stakeholderTeam]) {
    const key = m.name.toLowerCase();
    if (!seen.has(key)) { seen.add(key); teamMembers.push(m); }
  }

  // ── Step 3: Calculate sprint parameters ──
  const effectiveSprintDuration = sprintDurationDays ?? DEFAULT_SPRINT_DURATION_DAYS;
  const startDate = project.startDate || new Date();
  const endDate = project.endDate || new Date(startDate.getTime() + 90 * 86_400_000);
  const projectDays = Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000);
  const sprintCount = Math.max(1, Math.ceil(projectDays / effectiveSprintDuration));
  const totalPoints = updatedTasks.reduce((s, t) => s + (t.storyPoints || 1), 0);
  const velocity = velocityOverride ?? Math.max(10, Math.ceil(totalPoints / sprintCount));

  // ── Step 4: Create sprints and assign tasks ──
  const orgId = project.orgId;
  let tasksAssigned = 0;
  let pointsPlanned = 0;
  let sprintsCreated = 0;
  let taskQueue = [...updatedTasks].sort((a, b) => {
    // Priority: HIGH first, then by estimated hours (largest first for bin-packing)
    const pMap: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    const pa = pMap[a.priority || "MEDIUM"] ?? 1;
    const pb = pMap[b.priority || "MEDIUM"] ?? 1;
    if (pa !== pb) return pa - pb;
    return (b.storyPoints || 1) - (a.storyPoints || 1);
  });

  for (let i = 0; i < sprintCount && taskQueue.length > 0; i++) {
    const sprintStart = new Date(new Date(startDate).getTime() + i * effectiveSprintDuration * 86_400_000);
    const sprintEnd = new Date(sprintStart.getTime() + effectiveSprintDuration * 86_400_000);
    const sprintName = `Sprint ${existingSprints.length + i + 1}`;

    // Check if sprint with this name already exists
    const existing = await db.sprint.findFirst({ where: { projectId, name: sprintName } });
    let sprintId: string;

    if (existing) {
      sprintId = existing.id;
    } else {
      const sprint = await db.sprint.create({
        data: {
          projectId,
          name: sprintName,
          goal: `[auto-planned] Deliver priority items — ${velocity} story points target`,
          startDate: sprintStart,
          endDate: sprintEnd,
          status: i === 0 ? "ACTIVE" : "PLANNING",
        },
      });
      sprintId = sprint.id;
      sprintsCreated++;

      // Create calendar events for sprint ceremonies
      await createSprintEvents(orgId, projectId, agentId, sprintName, sprintStart, sprintEnd);
    }

    // Assign tasks up to velocity
    let sprintPoints = 0;
    const assigned: string[] = [];
    let memberIdx = 0;

    for (let j = 0; j < taskQueue.length; j++) {
      const task = taskQueue[j];
      const pts = task.storyPoints || 1;
      if (sprintPoints + pts > velocity * 1.2) continue; // allow 20% overflow

      // Assign to a team member (round-robin)
      const assignee = teamMembers.length > 0 ? teamMembers[memberIdx % teamMembers.length] : null;
      memberIdx++;

      await db.task.update({
        where: { id: task.id },
        data: {
          sprintId,
          startDate: sprintStart,
          endDate: sprintEnd,
          ...(assignee ? { assigneeName: assignee.name } : {}),
        },
      });

      sprintPoints += pts;
      tasksAssigned++;
      assigned.push(task.id);
    }

    pointsPlanned += sprintPoints;
    taskQueue = taskQueue.filter(t => !assigned.includes(t.id));
  }

  // Log activity
  const agent = await db.agent.findUnique({ where: { id: agentId }, select: { name: true } });
  await db.agentActivity.create({
    data: {
      agentId,
      type: "document",
      summary: `Auto-planned ${sprintsCreated} sprint(s): ${tasksAssigned} tasks assigned, ${pointsPlanned} story points across ${sprintCount} sprint(s). Team: ${teamMembers.map(m => m.name).join(", ") || "unassigned"}`,
    },
  });

  // Reverse sync: update Sprint Plans artefact
  try {
    const { syncSprintsToArtefact } = await import("@/lib/agents/artefact-sync");
    await syncSprintsToArtefact(projectId);
  } catch {}

  return { sprints: sprintsCreated, tasksAssigned, pointsPlanned, cleared };
}

// ─── Story point estimation ──────────────────────────────────────────────────

async function estimateStoryPoints(tasks: any[], project: any): Promise<void> {
  // Skip if most tasks already have points
  const withPoints = tasks.filter(t => t.storyPoints && t.storyPoints > 0);
  if (withPoints.length > tasks.length * 0.5) return;

  const tasksWithoutPoints = tasks.filter(t => !t.storyPoints || t.storyPoints === 0);
  if (tasksWithoutPoints.length === 0) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fallback: estimate from hours or use default
    for (const task of tasksWithoutPoints) {
      const pts = task.estimatedHours ? Math.max(1, Math.round(task.estimatedHours / HOURS_PER_POINT)) : 2;
      await db.task.update({ where: { id: task.id }, data: { storyPoints: pts } });
    }
    return;
  }

  // Batch estimate with Claude Haiku (cheap, fast)
  const taskList = tasksWithoutPoints.slice(0, 30).map((t, i) =>
    `${i + 1}. "${t.title}" — ${t.description?.slice(0, 80) || "no description"} — priority: ${t.priority || "MEDIUM"} — est hours: ${t.estimatedHours || "unknown"}`
  ).join("\n");

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 512,
        messages: [{
          role: "user",
          content: `Estimate story points (Fibonacci: 1,2,3,5,8,13) for these project tasks.
Project: "${project.name}" (Budget: £${(project.budget || 0).toLocaleString()})

${taskList}

Return ONLY a JSON array of numbers in order, one per task. Example: [3,5,2,8,1]`,
        }],
      }),
    });

    if (!response.ok) throw new Error(`API error ${response.status}`);
    const data = await response.json();
    const text = (data.content?.[0]?.text || "").trim();
    const match = text.match(/\[[\d,\s]+\]/);
    if (match) {
      const points: number[] = JSON.parse(match[0]);

      // Apply ML calibration multiplier if we have historical data
      let multiplier = 1.0;
      try {
        const project = await db.project.findUnique({ where: { id: projectId }, select: { orgId: true } });
        if (project) {
          const { predictStoryPointCalibration } = await import("@/lib/ml/story-point-calibration");
          const cal = await predictStoryPointCalibration(project.orgId);
          if (cal.confidence > 0.2) multiplier = cal.multiplier;
        }
      } catch { /* non-fatal */ }

      for (let i = 0; i < Math.min(points.length, tasksWithoutPoints.length); i++) {
        const raw = Math.max(1, Math.min(13, points[i] || 2));
        const calibrated = Math.max(1, Math.min(21, Math.round(raw * multiplier)));
        await db.task.update({ where: { id: tasksWithoutPoints[i].id }, data: { storyPoints: calibrated } });
      }
    }
  } catch (e) {
    console.error("[sprint-planner] Story point estimation failed:", e);
    // Fallback: simple estimation
    for (const task of tasksWithoutPoints) {
      const pts = task.estimatedHours ? Math.max(1, Math.round(task.estimatedHours / HOURS_PER_POINT)) : 2;
      await db.task.update({ where: { id: task.id }, data: { storyPoints: pts } });
    }
  }
}

// ─── Team member extraction ──────────────────────────────────────────────────

interface TeamMember {
  name: string;
  role: string;
}

function extractTeamMembers(stakeholders: any[]): TeamMember[] {
  // Filter to internal team members (not external stakeholders)
  const teamRoles = ["project manager", "developer", "designer", "qa", "analyst", "lead", "engineer",
    "architect", "consultant", "coordinator", "administrator", "team", "delivery", "scrum master",
    "product owner", "traveller", "organiser", "primary"];

  return stakeholders
    .filter(s => {
      // Drop stakeholders whose name looks like an LLM-fabricated personal name
      // (e.g. "Sarah Johnson") so they don't leak into task.assigneeName.
      if (looksLikeFabricatedName(s.name)) return false;
      const role = (s.role || s.organisation || "").toLowerCase();
      const stake = (s.stake || "").toLowerCase();
      return teamRoles.some(r => role.includes(r) || stake.includes(r))
        || stake.includes("internal")
        || (s.power === "H" && s.interest === "H");
    })
    .map(s => ({
      name: s.name || s.role || "Team Member",
      role: s.role || s.stake || "Team",
    }))
    .slice(0, 10); // cap at 10 team members
}

// ─── Calendar event creation ─────────────────────────────────────────────────

async function createSprintEvents(
  orgId: string,
  projectId: string,
  agentId: string,
  sprintName: string,
  startDate: Date,
  endDate: Date,
): Promise<void> {
  const events = [
    {
      title: `${sprintName}: Sprint Planning`,
      description: `Planning session for ${sprintName}. Review backlog, commit to sprint goal, assign stories to team members.`,
      startTime: startDate,
    },
    {
      title: `${sprintName}: Sprint Review & Demo`,
      description: `Demo completed work from ${sprintName}. Gather stakeholder feedback. Review acceptance criteria.`,
      startTime: new Date(endDate.getTime() - 86_400_000), // day before end
    },
    {
      title: `${sprintName}: Retrospective`,
      description: `${sprintName} retrospective. What went well, what to improve, action items for next sprint.`,
      startTime: endDate,
    },
  ];

  for (const evt of events) {
    // Check for existing event with same title to avoid duplicates
    const existing = await db.calendarEvent.findFirst({
      where: { projectId, title: evt.title },
    });
    if (existing) continue;

    await db.calendarEvent.create({
      data: {
        orgId,
        projectId,
        agentId,
        title: evt.title,
        description: evt.description,
        startTime: evt.startTime,
        endTime: new Date(evt.startTime.getTime() + 60 * 60 * 1000), // 1 hour
        source: "AGENT",
      },
    }).catch(() => {});
  }
}
