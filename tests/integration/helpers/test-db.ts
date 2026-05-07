/**
 * Integration test DB helpers — seed and clean up isolated test fixtures
 * against a real Postgres connection.
 *
 * Safety:
 *   - Refuses to run unless TEST_DATABASE_URL is set. Writing to the dev
 *     database (DATABASE_URL) is rejected with a thrown error.
 *   - Every fixture is scoped to a uniquely-named Organisation with the
 *     prefix __test_<run-id>__. cleanupTestOrg() deletes everything by
 *     orgId, so a leaked test row can't bleed into another suite.
 *
 * Why no transactional rollback?
 *   Prisma can only roll back a single connection's tx. The helpers we
 *   call (getPhaseCompletion, getNextRequiredStep) open new connections
 *   internally, so a wrapping tx wouldn't isolate anything. Prefix-
 *   based cleanup is more invasive but actually correct.
 */

import { db } from "@/lib/db";

const TEST_PREFIX = "__test_";

/**
 * Guard: integration tests refuse to run against the dev database.
 * Set TEST_DATABASE_URL to a separate Postgres before running this suite.
 */
function assertSafeDb(): void {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error(
      "Refusing to run integration tests without TEST_DATABASE_URL. " +
      "Set it in .env.test (or export inline) to a SEPARATE Postgres instance — " +
      "do NOT point it at the dev/prod database. Tests create and delete real rows.",
    );
  }
  if (process.env.DATABASE_URL && process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL is the same as DATABASE_URL. Use a separate database — " +
      "the cleanup helpers issue real DELETEs.",
    );
  }
}

export interface TestProjectOptions {
  methodology?: "WATERFALL" | "AGILE_SCRUM" | "AGILE_KANBAN" | "PRINCE2" | "HYBRID" | "SAFE";
  /** Phase the deployment is currently on. */
  currentPhase?: string;
  /**
   * Pre-Project artefacts to create at construction time, with chosen status.
   * Use to simulate "3 of 4 generated, 1 missing" scenarios.
   */
  artefacts?: Array<{
    name: string;
    status: "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  }>;
  /** Methodology phase definition this project should mirror. e.g. "Pre-Project". */
  primaryPhaseName?: string;
  /** Optional list of additional phase names (in order). */
  phaseSequence?: string[];
}

export interface TestProjectContext {
  orgId: string;
  projectId: string;
  agentId: string;
  deploymentId: string;
  /** Map of phase name → Phase row id. */
  phaseIds: Record<string, string>;
}

export async function createTestOrg(label = "agent"): Promise<string> {
  assertSafeDb();
  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const slug = `${TEST_PREFIX}${label}_${runId}`;
  const org = await db.organisation.create({
    data: { name: `Test Org ${runId}`, slug, currency: "GBP" },
  });
  return org.id;
}

/**
 * Create a fully-wired test project: org-scoped Project + Agent +
 * AgentDeployment + Phase rows + optional Artefacts.
 *
 * Uses the methodology-definitions module to build phase rows that
 * mirror what the live deploy flow creates — so tests exercise the
 * same data shapes the API helpers consume in production.
 */
export async function createTestProject(
  orgId: string,
  opts: TestProjectOptions = {},
): Promise<TestProjectContext> {
  assertSafeDb();

  const { getMethodology } = await import("@/lib/methodology-definitions");
  const methodologyEnum = opts.methodology || "WATERFALL";
  const methodologyId = methodologyEnum.toLowerCase().replace("agile_", "");
  const methodology = getMethodology(methodologyId);

  const phaseSequence = opts.phaseSequence
    || methodology.phases.map(p => p.name);
  const primaryPhase = opts.primaryPhaseName
    || phaseSequence[0]
    || "Pre-Project";

  // 1. Project
  const project = await db.project.create({
    data: {
      orgId,
      name: `Test Project ${Date.now()}`,
      methodology: methodologyEnum,
      status: "ACTIVE",
    },
  });

  // 2. Agent
  const agent = await db.agent.create({
    data: {
      orgId,
      name: "Test Nova",
      codename: `nova_${Date.now()}`,
      status: "ACTIVE",
      autonomyLevel: 2,
    },
  });

  // 3. Deployment
  const deployment = await db.agentDeployment.create({
    data: {
      agentId: agent.id,
      projectId: project.id,
      isActive: true,
      currentPhase: opts.currentPhase || primaryPhase,
      phaseStatus: "active",
      cyclePaused: true, // match the live default
    },
  });

  // 4. Phases — one row per methodology phase with its artefact list
  const phaseIds: Record<string, string> = {};
  for (const [idx, name] of phaseSequence.entries()) {
    const def = methodology.phases.find(p => p.name === name);
    const artefactNames = def?.artefacts.map(a => a.name) || [];
    const phase = await db.phase.create({
      data: {
        projectId: project.id,
        name,
        order: idx,
        status: name === primaryPhase ? "ACTIVE" : "PENDING",
        artefacts: artefactNames,
      },
    });
    phaseIds[name] = phase.id;
  }

  // 5. Artefacts (if any) — created against the primary phase
  if (opts.artefacts?.length) {
    const phaseId = phaseIds[primaryPhase];
    for (const a of opts.artefacts) {
      await db.agentArtefact.create({
        data: {
          agentId: agent.id,
          projectId: project.id,
          phaseId,
          name: a.name,
          format: "html",
          content: `<p>Test content for ${a.name}</p>`,
          status: a.status,
        },
      });
    }
  }

  return {
    orgId,
    projectId: project.id,
    agentId: agent.id,
    deploymentId: deployment.id,
    phaseIds,
  };
}

/**
 * Cascade-delete every row scoped to a test org. Runs in FK-respecting
 * order. Safe to call even if some rows don't exist.
 */
export async function cleanupTestOrg(orgId: string): Promise<void> {
  assertSafeDb();
  // Find all projects + agents under this org so we can delete their
  // children before deleting the parents themselves.
  const projects = await db.project.findMany({ where: { orgId }, select: { id: true } });
  const projectIds = projects.map(p => p.id);
  const agents = await db.agent.findMany({ where: { orgId }, select: { id: true } });
  const agentIds = agents.map(a => a.id);

  // Children of Project
  if (projectIds.length > 0) {
    await db.task.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
    await db.agentArtefact.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
    await db.phase.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
    await db.risk.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
    await db.stakeholder.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
    await db.knowledgeBaseItem.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
    await db.approval.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
    await db.agentDeployment.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => {});
  }

  // Children of Agent
  if (agentIds.length > 0) {
    await db.agentActivity.deleteMany({ where: { agentId: { in: agentIds } } }).catch(() => {});
    await db.chatMessage.deleteMany({ where: { agentId: { in: agentIds } } }).catch(() => {});
    await db.agentDecision.deleteMany({ where: { agentId: { in: agentIds } } }).catch(() => {});
  }

  await db.project.deleteMany({ where: { orgId } }).catch(() => {});
  await db.agent.deleteMany({ where: { orgId } }).catch(() => {});
  await db.organisation.delete({ where: { id: orgId } }).catch(() => {});
}

/**
 * Sweep helper — deletes every test org currently in the DB, regardless
 * of which run created it. Use as a one-shot cleanup if a previous run
 * crashed and left rows behind.
 *
 * Match: organisation.slug starting with "__test_".
 */
export async function sweepAllTestOrgs(): Promise<number> {
  assertSafeDb();
  const orphans = await db.organisation.findMany({
    where: { slug: { startsWith: TEST_PREFIX } },
    select: { id: true },
  });
  for (const o of orphans) await cleanupTestOrg(o.id);
  return orphans.length;
}
