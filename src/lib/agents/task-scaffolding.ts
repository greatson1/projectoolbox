/**
 * Task Scaffolding — creates a comprehensive PM task list on project deploy.
 *
 * When an agent is deployed, this creates the full lifecycle task breakdown
 * covering every phase. Tasks are grouped by phase with parent tasks for
 * each category (artefact generation, governance, monitoring, etc.).
 *
 * The agent then updates task progress as it works:
 *   - Artefact generated → corresponding task goes to 100%
 *   - Phase gate requested → governance task updated
 *   - Risks identified → risk task updated
 *   - Phase advanced → previous phase tasks marked complete
 *
 * Tasks from approved artefacts (WBS, Schedule) are ADDITIONAL — they
 * represent the project's actual work, not the agent's PM work.
 */

import { db } from "@/lib/db";

// ─── Task templates per phase ────────────────────────────────────────────────

interface TaskTemplate {
  title: string;
  category: "artefact" | "governance" | "monitoring" | "stakeholder" | "delivery";
  /** If set, this task auto-completes when the named artefact is generated */
  linkedArtefact?: string;
  /** If set, this task auto-completes when this event fires */
  linkedEvent?: string;
  estimatedHours?: number;
}

/** Universal tasks that appear in every phase */
const UNIVERSAL_TASKS: TaskTemplate[] = [
  { title: "Review and update Risk Register", category: "monitoring", estimatedHours: 1 },
  { title: "Stakeholder communication and updates", category: "stakeholder", estimatedHours: 1 },
];

/** Phase-specific task templates keyed by normalised phase name */
const PHASE_TASKS: Record<string, TaskTemplate[]> = {
  // ── Phase 1: Requirements / Pre-Project / Foundation / Sprint Zero ──
  "requirements": [
    { title: "Generate Project Brief", category: "artefact", linkedArtefact: "Project Brief", estimatedHours: 0.5 },
    { title: "Generate Outline Business Case", category: "artefact", linkedArtefact: "Outline Business Case", estimatedHours: 0.5 },
    { title: "Generate Requirements Specification", category: "artefact", linkedArtefact: "Requirements Specification", estimatedHours: 1 },
    { title: "Generate Feasibility Study", category: "artefact", linkedArtefact: "Feasibility Study", estimatedHours: 1 },
    { title: "Generate Initial Risk Register", category: "artefact", linkedArtefact: "Initial Risk Register", estimatedHours: 0.5 },
    { title: "Generate Initial Stakeholder Register", category: "artefact", linkedArtefact: "Initial Stakeholder Register", estimatedHours: 0.5 },
    { title: "Conduct clarification Q&A with project owner", category: "governance", linkedEvent: "clarification_complete", estimatedHours: 0.5 },
    { title: "Submit Phase 1 gate approval", category: "governance", linkedEvent: "gate_request", estimatedHours: 0.25 },
    { title: "Obtain approval for all Phase 1 artefacts", category: "governance", linkedEvent: "phase_advanced", estimatedHours: 0.25 },
  ],
  "pre-project": [
    { title: "Generate Project Brief", category: "artefact", linkedArtefact: "Project Brief", estimatedHours: 0.5 },
    { title: "Generate Outline Business Case", category: "artefact", linkedArtefact: "Outline Business Case", estimatedHours: 0.5 },
    { title: "Generate Initial Risk Register", category: "artefact", linkedArtefact: "Initial Risk Register", estimatedHours: 0.5 },
    { title: "Generate Initial Stakeholder Register", category: "artefact", linkedArtefact: "Initial Stakeholder Register", estimatedHours: 0.5 },
    { title: "Conduct clarification Q&A with project owner", category: "governance", linkedEvent: "clarification_complete", estimatedHours: 0.5 },
    { title: "Submit Phase Gate approval", category: "governance", linkedEvent: "gate_request", estimatedHours: 0.25 },
  ],
  "foundation": [
    { title: "Generate Project Brief", category: "artefact", linkedArtefact: "Project Brief", estimatedHours: 0.5 },
    { title: "Generate Outline Business Case", category: "artefact", linkedArtefact: "Outline Business Case", estimatedHours: 0.5 },
    { title: "Generate Initial Risk Register", category: "artefact", linkedArtefact: "Initial Risk Register", estimatedHours: 0.5 },
    { title: "Submit Phase Gate approval", category: "governance", linkedEvent: "gate_request", estimatedHours: 0.25 },
  ],
  "sprint zero": [
    { title: "Generate Product Vision", category: "artefact", linkedArtefact: "Product Vision", estimatedHours: 0.5 },
    { title: "Generate Initial Product Backlog", category: "artefact", linkedArtefact: "Initial Product Backlog", estimatedHours: 1 },
    { title: "Generate Definition of Done", category: "artefact", linkedArtefact: "Definition of Done", estimatedHours: 0.25 },
    { title: "Generate Team Charter", category: "artefact", linkedArtefact: "Team Charter", estimatedHours: 0.25 },
    { title: "Submit Sprint Zero gate approval", category: "governance", linkedEvent: "gate_request", estimatedHours: 0.25 },
  ],

  // ── Phase 2: Design / Initiation / Planning ──
  "design": [
    { title: "Generate Project Charter", category: "artefact", linkedArtefact: "Project Charter", estimatedHours: 1 },
    { title: "Generate Full Business Case", category: "artefact", linkedArtefact: "Business Case", estimatedHours: 2 },
    { title: "Generate Stakeholder Register", category: "artefact", linkedArtefact: "Stakeholder Register", estimatedHours: 0.5 },
    { title: "Generate Communication Plan", category: "artefact", linkedArtefact: "Communication Plan", estimatedHours: 0.5 },
    { title: "Generate Design Document", category: "artefact", linkedArtefact: "Design Document", estimatedHours: 2 },
    { title: "Generate Work Breakdown Structure", category: "artefact", linkedArtefact: "Work Breakdown Structure", estimatedHours: 1 },
    { title: "Generate Schedule with Dependencies", category: "artefact", linkedArtefact: "Schedule with Dependencies", estimatedHours: 1 },
    { title: "Generate Cost Management Plan", category: "artefact", linkedArtefact: "Cost Management Plan", estimatedHours: 1 },
    { title: "Generate Resource Management Plan", category: "artefact", linkedArtefact: "Resource Management Plan", estimatedHours: 0.5 },
    { title: "Generate Risk Management Plan", category: "artefact", linkedArtefact: "Risk Management Plan", estimatedHours: 0.5 },
    { title: "Generate Quality Management Plan", category: "artefact", linkedArtefact: "Quality Management Plan", estimatedHours: 0.5 },
    { title: "Generate Change Control Plan", category: "artefact", linkedArtefact: "Change Control Plan", estimatedHours: 0.5 },
    { title: "Submit Phase 2 gate approval", category: "governance", linkedEvent: "gate_request", estimatedHours: 0.25 },
    { title: "Obtain approval for all baselines", category: "governance", linkedEvent: "phase_advanced", estimatedHours: 0.5 },
  ],
  "initiation": [
    { title: "Generate Project Charter", category: "artefact", linkedArtefact: "Project Charter", estimatedHours: 1 },
    { title: "Generate Full Business Case", category: "artefact", linkedArtefact: "Business Case", estimatedHours: 2 },
    { title: "Generate Stakeholder Register", category: "artefact", linkedArtefact: "Stakeholder Register", estimatedHours: 0.5 },
    { title: "Generate Communication Plan", category: "artefact", linkedArtefact: "Communication Plan", estimatedHours: 0.5 },
    { title: "Generate Risk Management Plan", category: "artefact", linkedArtefact: "Risk Management Plan", estimatedHours: 0.5 },
    { title: "Generate Quality Management Plan", category: "artefact", linkedArtefact: "Quality Management Plan", estimatedHours: 0.5 },
    { title: "Submit Initiation gate approval", category: "governance", linkedEvent: "gate_request", estimatedHours: 0.25 },
  ],
  "planning": [
    { title: "Generate Work Breakdown Structure", category: "artefact", linkedArtefact: "Work Breakdown Structure", estimatedHours: 1 },
    { title: "Generate Schedule with Dependencies", category: "artefact", linkedArtefact: "Schedule with Dependencies", estimatedHours: 1 },
    { title: "Generate Cost Management Plan", category: "artefact", linkedArtefact: "Cost Management Plan", estimatedHours: 1 },
    { title: "Generate Resource Management Plan", category: "artefact", linkedArtefact: "Resource Management Plan", estimatedHours: 0.5 },
    { title: "Generate Change Control Plan", category: "artefact", linkedArtefact: "Change Control Plan", estimatedHours: 0.5 },
    { title: "Submit Planning gate approval", category: "governance", linkedEvent: "gate_request", estimatedHours: 0.25 },
  ],

  // ── Phase 3: Build / Execution / Sprint Cadence / Iterative Delivery ──
  "build": [
    { title: "Monitor task progress and update schedule", category: "monitoring", estimatedHours: 2 },
    { title: "Track budget burn rate and forecast", category: "monitoring", estimatedHours: 1 },
    { title: "Generate weekly status reports", category: "delivery", estimatedHours: 1 },
    { title: "Process and evaluate change requests", category: "governance", estimatedHours: 1 },
    { title: "Conduct risk reviews and update register", category: "monitoring", estimatedHours: 1 },
  ],
  "execution": [
    { title: "Monitor task progress and update schedule", category: "monitoring", estimatedHours: 2 },
    { title: "Track budget burn rate and forecast", category: "monitoring", estimatedHours: 1 },
    { title: "Generate weekly status reports", category: "delivery", estimatedHours: 1 },
    { title: "Process and evaluate change requests", category: "governance", estimatedHours: 1 },
    { title: "Conduct risk reviews and update register", category: "monitoring", estimatedHours: 1 },
    { title: "Submit Execution gate approval", category: "governance", linkedEvent: "gate_request", estimatedHours: 0.25 },
  ],
  "sprint cadence": [
    { title: "Manage sprint backlog and velocity", category: "delivery", estimatedHours: 1 },
    { title: "Generate sprint retrospective report", category: "delivery", estimatedHours: 0.5 },
    { title: "Update burndown and track impediments", category: "monitoring", estimatedHours: 1 },
  ],
  "iterative delivery": [
    { title: "Track iteration progress and adjust", category: "delivery", estimatedHours: 1 },
    { title: "Generate iteration reports", category: "delivery", estimatedHours: 0.5 },
    { title: "Process feedback and adjust backlog", category: "delivery", estimatedHours: 1 },
  ],
  "continuous delivery": [
    { title: "Monitor lead time and throughput", category: "monitoring", estimatedHours: 1 },
    { title: "Track WIP limits and flow efficiency", category: "monitoring", estimatedHours: 0.5 },
  ],

  // ── Phase 4: Test ──
  "test": [
    { title: "Generate Test Plan", category: "artefact", linkedArtefact: "Test Plan", estimatedHours: 1 },
    { title: "Generate Test Results Report", category: "artefact", linkedArtefact: "Test Results Report", estimatedHours: 1 },
    { title: "Track defect resolution", category: "monitoring", estimatedHours: 1 },
    { title: "Submit Test gate approval", category: "governance", linkedEvent: "gate_request", estimatedHours: 0.25 },
  ],

  // ── Phase 5: Deploy / Release ──
  "deploy": [
    { title: "Generate Deployment Plan", category: "artefact", linkedArtefact: "Deployment Plan", estimatedHours: 1 },
    { title: "Generate Go-Live Checklist", category: "artefact", linkedArtefact: "Go-Live Checklist", estimatedHours: 0.5 },
    { title: "Generate Lessons Learned Report", category: "artefact", linkedArtefact: "Lessons Learned Report", estimatedHours: 1 },
    { title: "Submit Deploy gate approval", category: "governance", linkedEvent: "gate_request", estimatedHours: 0.25 },
  ],
  "release": [
    { title: "Generate Release Notes", category: "artefact", linkedArtefact: "Release Notes", estimatedHours: 0.5 },
    { title: "Generate Retrospective Report", category: "artefact", linkedArtefact: "Retrospective Report", estimatedHours: 0.5 },
    { title: "Submit Release gate approval", category: "governance", linkedEvent: "gate_request", estimatedHours: 0.25 },
  ],

  // ── Phase: Closing / Closure / Review ──
  "closing": [
    { title: "Generate Lessons Learned Report", category: "artefact", linkedArtefact: "Lessons Learned Report", estimatedHours: 1 },
    { title: "Generate Project Closure Report", category: "artefact", linkedArtefact: "Project Closure Report", estimatedHours: 1 },
    { title: "Archive all project artefacts", category: "governance", estimatedHours: 0.5 },
    { title: "Submit final sign-off approval", category: "governance", linkedEvent: "gate_request", estimatedHours: 0.25 },
  ],
  "closure": [
    { title: "Generate Lessons Learned Report", category: "artefact", linkedArtefact: "Lessons Learned Report", estimatedHours: 1 },
    { title: "Generate Project Closure Report", category: "artefact", linkedArtefact: "Project Closure Report", estimatedHours: 1 },
    { title: "Archive all project artefacts", category: "governance", estimatedHours: 0.5 },
    { title: "Submit final sign-off approval", category: "governance", linkedEvent: "gate_request", estimatedHours: 0.25 },
  ],
  "review": [
    { title: "Conduct process review", category: "governance", estimatedHours: 1 },
    { title: "Document improvement recommendations", category: "delivery", estimatedHours: 0.5 },
  ],

  // ── Setup (Kanban) ──
  "setup": [
    { title: "Set up Kanban board and WIP limits", category: "delivery", estimatedHours: 0.5 },
    { title: "Define flow policies and DoD", category: "governance", estimatedHours: 0.5 },
    { title: "Submit Setup gate approval", category: "governance", linkedEvent: "gate_request", estimatedHours: 0.25 },
  ],
};

const CATEGORY_LABELS: Record<string, string> = {
  artefact: "Document Generation",
  governance: "Governance & Approvals",
  monitoring: "Monitoring & Control",
  stakeholder: "Stakeholder Management",
  delivery: "Delivery & Execution",
};

// ─── Main scaffolding function ───────────────────────────────────────────────

/**
 * Creates a comprehensive PM task list covering ALL phases of the project.
 * Called once during lifecycle init — idempotent (skips if tasks already exist).
 *
 * Structure:
 *   Phase 1: Requirements
 *     ├─ Document Generation (parent)
 *     │   ├─ Generate Project Brief
 *     │   ├─ Generate Outline Business Case
 *     │   └─ ...
 *     ├─ Governance & Approvals (parent)
 *     │   ├─ Conduct clarification Q&A
 *     │   └─ Submit Phase Gate approval
 *     └─ Monitoring & Control (parent)
 *         └─ Review and update Risk Register
 *   Phase 2: Design
 *     └─ ...
 */
export async function scaffoldProjectTasks(
  agentId: string,
  projectId: string,
  phases: Array<{ id: string; name: string; order: number }>,
  project: { startDate?: Date | string | null; endDate?: Date | string | null; methodology?: string },
): Promise<number> {
  // Idempotent: skip if agent already created tasks for this project
  const existingCount = await db.task.count({
    where: { projectId, createdBy: `agent:${agentId}`, description: { contains: "[scaffolded]" } },
  });
  if (existingCount > 0) return 0;

  // Load methodology definition to get actual artefact lists
  let methodologyDef: any = null;
  try {
    const { getMethodology } = await import("@/lib/methodology-definitions");
    methodologyDef = getMethodology(project.methodology || "waterfall");
  } catch {}

  // Calculate rough date distribution across phases
  const startDate = project.startDate ? new Date(project.startDate) : new Date();
  const endDate = project.endDate ? new Date(project.endDate) : new Date(startDate.getTime() + 90 * 86_400_000);
  const totalDays = Math.max(7, Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000));
  const daysPerPhase = Math.max(3, Math.floor(totalDays / Math.max(1, phases.length)));

  let totalCreated = 0;

  // Only scaffold the FIRST phase (current active phase) — not all phases upfront.
  // When a phase advances, scaffoldNextPhase() is called to create the next batch.
  const currentPhase = phases.find(p => p.order === 0) || phases[0];
  const phasesToScaffold = currentPhase ? [currentPhase] : [];

  for (const phase of phasesToScaffold) {
    const phaseKey = phase.name.toLowerCase();

    // Build artefact tasks dynamically from methodology definition
    const methodPhase = methodologyDef?.phases?.find((p: any) => p.name.toLowerCase() === phaseKey);
    const artefactTasks: TaskTemplate[] = (methodPhase?.artefacts || [])
      .filter((a: any) => a.aiGeneratable !== false)
      .map((a: any) => ({
        title: `Generate ${a.name}`,
        category: "artefact" as const,
        linkedArtefact: a.name,
        estimatedHours: a.required ? 1 : 0.5,
      }));

    // Add governance and monitoring tasks from the hardcoded templates (if they exist)
    const staticTasks = (PHASE_TASKS[phaseKey] || []).filter(t => t.category !== "artefact");
    const allTasks = [...artefactTasks, ...staticTasks, ...UNIVERSAL_TASKS];

    // Phase date range
    const phaseStart = new Date(startDate.getTime() + phase.order * daysPerPhase * 86_400_000);
    const phaseEnd = new Date(phaseStart.getTime() + daysPerPhase * 86_400_000);

    // Group by category
    const byCategory: Record<string, TaskTemplate[]> = {};
    for (const t of allTasks) {
      const cat = t.category;
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(t);
    }

    // Create parent task for each category, then child tasks
    for (const [category, tasks] of Object.entries(byCategory)) {
      const parentLabel = CATEGORY_LABELS[category] || category;

      // Create category parent task
      const parent = await db.task.create({
        data: {
          projectId,
          title: `${phase.name}: ${parentLabel}`,
          description: `[scaffolded] Parent task for ${parentLabel} in ${phase.name} phase`,
          status: phase.order === 0 ? "IN_PROGRESS" : "TODO",
          priority: category === "artefact" ? "HIGH" : "MEDIUM",
          phaseId: phase.name,
          startDate: phaseStart,
          endDate: phaseEnd,
          progress: 0,
          estimatedHours: tasks.reduce((s, t) => s + (t.estimatedHours || 1), 0),
          createdBy: `agent:${agentId}`,
        },
      });
      totalCreated++;

      // Create child tasks
      for (const template of tasks) {
        await db.task.create({
          data: {
            projectId,
            title: template.title,
            description: `[scaffolded]${template.linkedArtefact ? ` [artefact:${template.linkedArtefact}]` : ""}${template.linkedEvent ? ` [event:${template.linkedEvent}]` : ""}`,
            status: phase.order === 0 ? "TODO" : "TODO",
            priority: template.category === "artefact" ? "HIGH" : "MEDIUM",
            phaseId: phase.name,
            parentId: parent.id,
            startDate: phaseStart,
            endDate: phaseEnd,
            progress: 0,
            estimatedHours: template.estimatedHours || 1,
            createdBy: `agent:${agentId}`,
          },
        });
        totalCreated++;
      }
    }
  }

  // Log activity
  await db.agentActivity.create({
    data: {
      agentId,
      type: "document",
      summary: `Scaffolded ${totalCreated} PM tasks across ${phases.length} phases`,
    },
  }).catch(() => {});

  return totalCreated;
}

// ─── Progress update functions ───────────────────────────────────────────────

/**
 * Called when an artefact is generated — finds the matching scaffolded task
 * and sets it to 100%. Also updates the parent task's aggregate progress.
 */
export async function onArtefactGenerated(
  agentId: string,
  projectId: string,
  artefactName: string,
): Promise<void> {
  try {
    // Find the scaffolded task linked to this artefact
    const task = await db.task.findFirst({
      where: {
        projectId,
        createdBy: `agent:${agentId}`,
        description: { contains: `[artefact:${artefactName}]` },
      },
    });
    if (!task) return;

    await db.task.update({
      where: { id: task.id },
      data: { progress: 100, status: "DONE" },
    });

    // Update parent task aggregate progress
    if (task.parentId) {
      await updateParentProgress(task.parentId);
    }
  } catch (e) {
    console.error("[task-scaffolding] onArtefactGenerated failed:", e);
  }
}

/**
 * Called when an artefact is approved — marks the approval-related task.
 */
export async function onArtefactApproved(
  agentId: string,
  projectId: string,
  artefactName: string,
): Promise<void> {
  // The artefact generation task should already be at 100%.
  // Nothing extra needed here — approval triggers phase gate logic elsewhere.
}

/**
 * Called when an agent event fires (gate_request, phase_advanced, clarification_complete).
 * Finds and updates the matching scaffolded task.
 */
export async function onAgentEvent(
  agentId: string,
  projectId: string,
  eventType: string,
): Promise<void> {
  try {
    const task = await db.task.findFirst({
      where: {
        projectId,
        createdBy: `agent:${agentId}`,
        description: { contains: `[event:${eventType}]` },
        status: { not: "DONE" },
      },
    });
    if (!task) return;

    await db.task.update({
      where: { id: task.id },
      data: { progress: 100, status: "DONE" },
    });

    if (task.parentId) {
      await updateParentProgress(task.parentId);
    }
  } catch (e) {
    console.error("[task-scaffolding] onAgentEvent failed:", e);
  }
}

/**
 * Called when a phase advances — marks all tasks in the completed phase as DONE,
 * and sets the new phase's tasks to IN_PROGRESS.
 */
export async function onPhaseAdvanced(
  agentId: string,
  projectId: string,
  completedPhase: string,
  newPhase: string,
): Promise<void> {
  try {
    // Mark all incomplete tasks in completed phase as done
    await db.task.updateMany({
      where: {
        projectId,
        createdBy: `agent:${agentId}`,
        phaseId: completedPhase,
        status: { not: "DONE" },
        description: { contains: "[scaffolded]" },
      },
      data: { progress: 100, status: "DONE" },
    });

    // Scaffold the NEW phase's PM tasks (just-in-time, not upfront)
    const phaseRow = await db.phase.findFirst({
      where: { projectId, name: newPhase },
      select: { id: true, name: true, order: true },
    });
    if (phaseRow) {
      const project = await db.project.findUnique({
        where: { id: projectId },
        select: { startDate: true, endDate: true, methodology: true },
      });
      if (project) {
        await scaffoldProjectTasks(agentId, projectId, [phaseRow], project);
      }
    }

    // Set new phase parent tasks to IN_PROGRESS
    await db.task.updateMany({
      where: {
        projectId,
        createdBy: `agent:${agentId}`,
        phaseId: newPhase,
        parentId: null,
        description: { contains: "[scaffolded]" },
      },
      data: { status: "IN_PROGRESS" },
    });
  } catch (e) {
    console.error("[task-scaffolding] onPhaseAdvanced failed:", e);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Recalculate parent task progress from children */
async function updateParentProgress(parentId: string): Promise<void> {
  const children = await db.task.findMany({
    where: { parentId },
    select: { progress: true },
  });
  if (children.length === 0) return;

  const avgProgress = Math.round(children.reduce((s, c) => s + (c.progress || 0), 0) / children.length);
  const allDone = children.every(c => (c.progress || 0) >= 100);

  await db.task.update({
    where: { id: parentId },
    data: {
      progress: avgProgress,
      status: allDone ? "DONE" : avgProgress > 0 ? "IN_PROGRESS" : "TODO",
    },
  });
}
