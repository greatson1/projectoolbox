/**
 * E2E Test Setup — creates a realistic project with agent for testing
 * Run: npx tsx scripts/e2e-test-setup.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) } as any);

const orgId = "cmnhsbiyh0000asj0yvr83pbs";

async function main() {
  // 1. Create test project
  const project = await db.project.create({
    data: {
      name: "E2E Test — Website Redesign",
      description: "Complete redesign of the company website. Includes UX research, wireframes, development, testing, and launch.",
      status: "ACTIVE",
      methodology: "AGILE_SCRUM",
      startDate: new Date("2026-04-07"),
      endDate: new Date("2026-07-31"),
      budget: 85000,
      priority: "HIGH",
      category: "software",
      orgId,
    },
  });
  console.log("Project:", project.id, project.name);

  // 2. Phases
  for (const [i, name] of ["Sprint Zero", "Sprint Cadence", "Release"].entries()) {
    await db.phase.create({ data: { projectId: project.id, name, order: i + 1, status: i === 0 ? "ACTIVE" : "PENDING" } });
  }
  console.log("3 phases created");

  // 3. Tasks (realistic mix)
  const tasks = [
    { title: "UX Research — User Interviews", status: "IN_PROGRESS", storyPoints: 5, priority: "HIGH" },
    { title: "Competitor Analysis", status: "DONE", storyPoints: 3, priority: "MEDIUM" },
    { title: "Wireframe — Homepage", status: "TODO", storyPoints: 8, priority: "HIGH" },
    { title: "Wireframe — Product Pages", status: "TODO", storyPoints: 5, priority: "MEDIUM" },
    { title: "Design System Setup", status: "IN_PROGRESS", storyPoints: 13, priority: "HIGH" },
    { title: "API Integration Planning", status: "BLOCKED", storyPoints: 8, priority: "HIGH" },
    { title: "Content Migration Plan", status: "TODO", storyPoints: 5, priority: "LOW" },
    { title: "Performance Baseline Audit", status: "DONE", storyPoints: 3, priority: "MEDIUM" },
    { title: "SEO Strategy Document", status: "TODO", storyPoints: 5, priority: "MEDIUM" },
    { title: "Accessibility Compliance Check", status: "TODO", storyPoints: 8, priority: "HIGH", endDate: new Date("2026-04-03") },
  ];
  for (const t of tasks) {
    await db.task.create({ data: { ...t, projectId: project.id } });
  }
  console.log("10 tasks created");

  // 4. Risks
  const risks = [
    { title: "Third-party API deprecation risk", probability: 4, impact: 4, score: 16, status: "OPEN", category: "Technical", mitigation: "Build abstraction layer" },
    { title: "Key designer may leave mid-project", probability: 2, impact: 5, score: 10, status: "OPEN", category: "Resource" },
    { title: "SEO ranking drop during migration", probability: 3, impact: 3, score: 9, status: "OPEN", category: "Technical", mitigation: "301 redirects + monitoring" },
  ];
  for (const r of risks) {
    await db.risk.create({ data: { ...r, projectId: project.id } });
  }
  console.log("3 risks created");

  // 5. Issues
  await db.issue.create({ data: { projectId: project.id, title: "Staging server SSL certificate expired", priority: "CRITICAL", status: "OPEN", description: "Cannot deploy to staging" } });
  await db.issue.create({ data: { projectId: project.id, title: "Design review feedback delayed", priority: "HIGH", status: "OPEN", description: "Client not responded in 5 days" } });
  console.log("2 issues created");

  // 6. Stakeholders
  await db.stakeholder.create({ data: { projectId: project.id, name: "Emma Wilson", role: "Project Sponsor", email: "emma@acme.com", power: 90, interest: 80, sentiment: "positive" } });
  await db.stakeholder.create({ data: { projectId: project.id, name: "David Park", role: "Head of Marketing", email: "david@acme.com", power: 70, interest: 90, sentiment: "concerned" } });
  console.log("2 stakeholders created");

  // 7. Agent
  const agent = await db.agent.create({
    data: {
      name: "Nova", codename: "NOVA-E2E", status: "ACTIVE", autonomyLevel: 3,
      personality: { formalityLevel: 40, conciseness: 60 },
      gradient: "linear-gradient(135deg, #6366F1, #8B5CF6)",
      title: "Agile Delivery Lead",
      domainTags: ["Agile", "Scrum", "Web Development"],
      defaultGreeting: "Hi! I'm Nova, your AI PM for the Website Redesign.",
      monthlyBudget: 500, orgId,
    },
  });
  console.log("Agent:", agent.name, "L3");

  // 8. Deploy
  const dep = await db.agentDeployment.create({
    data: {
      agentId: agent.id, projectId: project.id, isActive: true,
      currentPhase: "Sprint Zero", phaseStatus: "active",
      hitlPhaseGates: true, hitlBudgetChanges: true, hitlCommunications: false,
      escalationTimeout: 4, cycleInterval: 10, nextCycleAt: new Date(),
    },
  });
  console.log("Deployed:", dep.id);

  // 9. Agent email
  await db.agentEmail.create({ data: { agentId: agent.id, address: "nova@agents.projectoolbox.com", isActive: true } });

  // 10. Activities
  await db.agentActivity.create({ data: { agentId: agent.id, type: "lifecycle_init", summary: "Initialized Agile/Scrum lifecycle. Sprint Zero active." } });
  await db.agentActivity.create({ data: { agentId: agent.id, type: "proactive_alert", summary: "CRITICAL: Accessibility Compliance Check is overdue by 2 days." } });
  await db.agentActivity.create({ data: { agentId: agent.id, type: "proactive_alert", summary: "Risk R-001 (API deprecation) score 16 — mitigation plan needed." } });

  // 11. Approval
  await db.approval.create({
    data: {
      projectId: project.id, requestedById: agent.id, type: "RISK_RESPONSE",
      title: "Deploy risk mitigation: Build API abstraction layer",
      description: "API deprecation risk (score 16) requires mitigation. Recommend abstraction layer. Effort: 13 SP.",
      status: "PENDING", urgency: "HIGH",
      impactScores: { schedule: 3, cost: 2, scope: 2, stakeholder: 1 },
      reasoningChain: "API provider announced v2 deprecation by August 2026. Without abstraction, breaking change could take down the live site.",
      suggestedAlternatives: [
        { description: "Switch to Contentful API", creditCost: 8 },
        { description: "Build in-house CMS", creditCost: 15 },
      ],
      affectedItems: [
        { type: "task", id: "api-planning", title: "API Integration Planning" },
        { type: "risk", id: "r-001", title: "API deprecation risk" },
      ],
    },
  });
  console.log("1 approval created");

  // 12. Notifications
  const user = await db.user.findUnique({ where: { email: "teeweazy@gmail.com" } });
  if (user) {
    await db.notification.create({
      data: { userId: user.id, type: "AGENT_ALERT", title: "Nova flagged a critical risk", body: "API deprecation risk (score 16) needs attention.", actionUrl: "/approvals" },
    });
    await db.notification.create({
      data: { userId: user.id, type: "APPROVAL_REQUEST", title: "Approval needed: API abstraction layer", body: "Nova recommends building an abstraction layer.", actionUrl: "/approvals" },
    });
    console.log("2 notifications created");
  }

  // 13. Create a lifecycle_init job for VPS
  await db.agentJob.create({
    data: {
      agentId: agent.id, deploymentId: dep.id, type: "autonomous_cycle", priority: 3,
      status: "PENDING", scheduledFor: new Date(),
      payload: { projectId: project.id, projectName: project.name, methodology: "AGILE_SCRUM", autonomyLevel: 3, currentPhase: "Sprint Zero", phaseStatus: "active" },
    },
  });
  console.log("1 autonomous_cycle job queued");

  console.log("\n=== E2E TEST READY ===");
  console.log("Project:", project.name);
  console.log("Agent: Nova (L3 Co-pilot)");
  console.log("10 tasks, 3 risks, 2 issues, 2 stakeholders");
  console.log("1 pending approval, 2 notifications, 1 job queued");
  console.log("Credits: 10000 (PROFESSIONAL plan)");

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
