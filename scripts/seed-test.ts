/**
 * Seed script — creates a full test account with org, projects, agents,
 * activities, tasks, risks, and credit transactions so the app shows real data.
 *
 * Run: npx tsx scripts/seed-test.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter } as any);

const TEST_EMAIL = "test@projectoolbox.com";
const TEST_PASSWORD = "TestAgent2026!";

async function main() {
  console.log("🌱 Seeding test data...\n");

  // 1. Create user
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);
  const user = await db.user.upsert({
    where: { email: TEST_EMAIL },
    update: { passwordHash, onboardingComplete: true },
    create: {
      email: TEST_EMAIL,
      name: "Ty Beetseh",
      passwordHash,
      role: "OWNER",
      onboardingComplete: true,
    },
  });
  console.log(`✅ User: ${user.email} (${user.id})`);

  // 2. Create org
  let org = await db.organisation.upsert({
    where: { slug: "pmgt-solutions" },
    update: { creditBalance: 50000, plan: "PROFESSIONAL" },
    create: {
      name: "PMGT Solutions",
      slug: "pmgt-solutions",
      industry: "Consulting",
      companySize: "11-50",
      website: "https://pmgts.uk",
      plan: "PROFESSIONAL",
      creditBalance: 50000,
      users: { connect: { id: user.id } },
    },
  });
  // Ensure user has orgId
  await db.user.update({ where: { id: user.id }, data: { orgId: org.id } });
  console.log(`✅ Org: ${org.name} (${org.id})`);

  // 3. Create projects
  const projectDefs = [
    { name: "CRM Migration to Salesforce", methodology: "PRINCE2" as const, budget: 280000, category: "software", priority: "high", startDate: new Date("2026-01-15"), endDate: new Date("2026-09-30") },
    { name: "Mobile App Redesign", methodology: "AGILE_SCRUM" as const, budget: 120000, category: "software", priority: "medium", startDate: new Date("2026-02-01"), endDate: new Date("2026-07-31") },
    { name: "Office Relocation Programme", methodology: "WATERFALL" as const, budget: 450000, category: "operations", priority: "high", startDate: new Date("2026-03-01"), endDate: new Date("2026-12-31") },
  ];

  const projects = [];
  for (const pd of projectDefs) {
    const project = await db.project.upsert({
      where: { id: `seed-proj-${pd.name.toLowerCase().replace(/\s+/g, "-").slice(0, 20)}` },
      update: { ...pd, orgId: org.id },
      create: { id: `seed-proj-${pd.name.toLowerCase().replace(/\s+/g, "-").slice(0, 20)}`, ...pd, orgId: org.id },
    });
    // Add user as project member
    await db.projectMember.upsert({
      where: { userId_projectId: { userId: user.id, projectId: project.id } },
      update: { role: "PM" },
      create: { userId: user.id, projectId: project.id, role: "PM" },
    });
    projects.push(project);
    console.log(`✅ Project: ${project.name} (${project.id})`);
  }

  // 4. Create agents
  const agentDefs = [
    { name: "Alpha", codename: "ALPHA-01", gradient: "linear-gradient(135deg, #6366F1, #8B5CF6)", autonomyLevel: 4, status: "ACTIVE" as const },
    { name: "Bravo", codename: "BRAVO-02", gradient: "linear-gradient(135deg, #22D3EE, #06B6D4)", autonomyLevel: 3, status: "ACTIVE" as const },
    { name: "Charlie", codename: "CHARLIE-03", gradient: "linear-gradient(135deg, #10B981, #34D399)", autonomyLevel: 2, status: "ACTIVE" as const },
  ];

  const agents = [];
  for (const ad of agentDefs) {
    const agent = await db.agent.upsert({
      where: { id: `seed-agent-${ad.codename.toLowerCase()}` },
      update: { ...ad, orgId: org.id },
      create: { id: `seed-agent-${ad.codename.toLowerCase()}`, ...ad, orgId: org.id },
    });
    agents.push(agent);
    console.log(`✅ Agent: ${agent.name} (${agent.id})`);
  }

  // 5. Deploy agents to projects (one-to-one)
  for (let i = 0; i < Math.min(agents.length, projects.length); i++) {
    await db.agentDeployment.upsert({
      where: { id: `seed-deploy-${agents[i].id}-${projects[i].id}` },
      update: { isActive: true },
      create: {
        id: `seed-deploy-${agents[i].id}-${projects[i].id}`,
        agentId: agents[i].id,
        projectId: projects[i].id,
        isActive: true,
      },
    });
    console.log(`✅ Deployed ${agents[i].name} → ${projects[i].name}`);
  }

  // 6. Create tasks for each project
  const taskTemplates = [
    ["Define scope statement", "DONE"], ["Draft project charter", "DONE"], ["Identify stakeholders", "DONE"],
    ["Build risk register", "IN_PROGRESS"], ["Create WBS", "IN_PROGRESS"], ["Set up change control process", "TODO"],
    ["Schedule kick-off meeting", "DONE"], ["Prepare status report", "IN_PROGRESS"], ["Review budget forecast", "TODO"],
    ["Conduct quality review", "TODO"],
  ];
  for (const project of projects) {
    for (const [title, status] of taskTemplates) {
      await db.task.create({
        data: {
          title,
          status,
          projectId: project.id,
          priority: status === "IN_PROGRESS" ? "HIGH" : "MEDIUM",
          percentComplete: status === "DONE" ? 100 : status === "IN_PROGRESS" ? 50 : 0,
        },
      });
    }
    console.log(`✅ 10 tasks created for ${project.name}`);
  }

  // 7. Create risks
  const riskTemplates = [
    { title: "Key personnel leaving mid-project", probability: 3, impact: 4, status: "OPEN" },
    { title: "Vendor delivery delay for Phase 2 materials", probability: 4, impact: 3, status: "OPEN" },
    { title: "Budget overrun due to scope creep", probability: 2, impact: 5, status: "OPEN" },
    { title: "Integration testing failures", probability: 3, impact: 3, status: "MITIGATED" },
  ];
  for (const project of projects) {
    for (const risk of riskTemplates) {
      await db.risk.create({
        data: { ...risk, projectId: project.id },
      });
    }
    console.log(`✅ 4 risks created for ${project.name}`);
  }

  // 8. Create agent activities (recent timeline)
  const activityTypes = [
    { type: "DOCUMENT", summary: "Generated Risk Register v3 for Execution phase gate review" },
    { type: "MEETING", summary: "Processed daily stand-up transcript — 3 action items extracted" },
    { type: "RISK", summary: "Identified new risk: vendor API deprecation in Q3" },
    { type: "APPROVAL", summary: "Submitted Phase Gate Checklist for sponsor review" },
    { type: "REPORT", summary: "Generated weekly status report with EVM analysis" },
    { type: "DOCUMENT", summary: "Drafted change impact assessment for CR-008" },
    { type: "MEETING", summary: "Attended project board meeting — 6 decisions logged" },
    { type: "RISK", summary: "Updated risk register: 2 risks re-scored after mitigation review" },
    { type: "APPROVAL", summary: "Requested approval for budget reforecast (+£15K)" },
    { type: "REPORT", summary: "Published stakeholder communication — Phase 3 progress summary" },
    { type: "DOCUMENT", summary: "Completed sprint retrospective notes — 5 improvement actions" },
    { type: "SYSTEM", summary: "Autonomy level reviewed — maintaining Level 3 (Co-pilot)" },
  ];

  for (let i = 0; i < activityTypes.length; i++) {
    const agent = agents[i % agents.length];
    await db.agentActivity.create({
      data: {
        agentId: agent.id,
        type: activityTypes[i].type,
        summary: activityTypes[i].summary,
        createdAt: new Date(Date.now() - i * 45 * 60 * 1000), // spread over last ~9 hours
      },
    });
  }
  console.log(`✅ 12 agent activities created`);

  // 9. Create agent decisions
  const decisions = [
    { type: "RISK_RESPONSE" as const, description: "Escalated vendor risk to executive sponsor", reasoning: "Risk probability exceeded 70% threshold with £45K potential impact. PRINCE2 exception process triggered.", confidence: 0.94, status: "APPROVED" as const },
    { type: "SCHEDULE_CHANGE" as const, description: "Recommended 2-week schedule buffer for Phase 4", reasoning: "Historical velocity data shows 85% chance of overrun without buffer. Critical path analysis confirms.", confidence: 0.88, status: "APPROVED" as const },
    { type: "TASK_ASSIGNMENT" as const, description: "Auto-approved minor scope change CR-009", reasoning: "Within L3 autonomy bounds: <£5K, no schedule impact, aligned with project objectives.", confidence: 0.96, status: "AUTO_APPROVED" as const },
    { type: "RESOURCE_ALLOCATION" as const, description: "Deferred non-critical training to Phase 5", reasoning: "Resource conflict with critical path task T-312; training has 3-week float.", confidence: 0.91, status: "APPROVED" as const },
    { type: "ESCALATION" as const, description: "Flagged budget variance for PMO review", reasoning: "CPI dropped below 0.95 threshold — PRINCE2 exception process triggered.", confidence: 0.97, status: "PENDING" as const },
  ];

  for (const d of decisions) {
    await db.agentDecision.create({
      data: { ...d, agentId: agents[0].id },
    });
  }
  console.log(`✅ 5 agent decisions created`);

  // 10. Create pending approvals
  const approvals = [
    { title: "Phase Gate: Execution", description: "Agent Alpha requests approval to proceed to Execution phase — all 7 prerequisites verified", type: "PHASE_GATE" as const },
    { title: "Budget Reforecast +£15K", description: "Vendor costs increased due to supply chain delays. Agent recommends £15K contingency release.", type: "BUDGET" as const },
    { title: "Change Request CR-012", description: "Additional site survey required — impact: +3 days schedule, +£8K cost", type: "CHANGE_REQUEST" as const },
  ];

  for (let i = 0; i < approvals.length; i++) {
    await db.approval.create({
      data: {
        ...approvals[i],
        status: "PENDING",
        projectId: projects[i % projects.length].id,
        requestedById: user.id,
      },
    });
  }
  console.log(`✅ 3 pending approvals created`);

  // 11. Create credit transactions
  const creditOps = [
    { amount: 50000, type: "SUBSCRIPTION_GRANT" as const, description: "Professional plan — April 2026 credit allocation" },
    { amount: -1200, type: "USAGE" as const, description: "Risk Register v3 generation", agentId: agents[0].id },
    { amount: -450, type: "USAGE" as const, description: "Sprint retrospective processing", agentId: agents[1].id },
    { amount: -800, type: "USAGE" as const, description: "Change impact assessment", agentId: agents[2].id },
    { amount: -350, type: "USAGE" as const, description: "Weekly status report", agentId: agents[0].id },
    { amount: -200, type: "USAGE" as const, description: "Stakeholder communication draft", agentId: agents[1].id },
  ];

  for (const tx of creditOps) {
    await db.creditTransaction.create({
      data: { ...tx, orgId: org.id },
    });
  }
  console.log(`✅ 6 credit transactions created`);

  // 12. Create notifications
  const notifs = [
    { type: "APPROVAL_REQUEST" as const, title: "Phase Gate approval required", body: "Agent Alpha has completed all Execution phase prerequisites and requests approval to proceed." },
    { type: "AGENT_ALERT" as const, title: "Risk escalation: vendor delay", body: "Agent Charlie identified a high-severity risk with vendor delivery for Phase 2 materials. Immediate attention required." },
    { type: "BILLING" as const, title: "Credit usage alert", body: "Your organisation has used 6% of monthly credits (3,000 of 50,000). Current burn rate projects 18,000 by month end." },
    { type: "MILESTONE" as const, title: "Milestone approaching", body: "CRM Migration: Phase 3 delivery milestone is due in 5 days. 3 tasks remain incomplete." },
  ];

  for (const n of notifs) {
    await db.notification.create({
      data: { ...n, userId: user.id },
    });
  }
  console.log(`✅ 4 notifications created`);

  // 13. Create issues
  for (const project of projects.slice(0, 2)) {
    await db.issue.create({
      data: {
        title: "API endpoint returning 500 intermittently",
        description: "The /api/sync endpoint fails under high load. Investigating connection pool limits.",
        status: "OPEN",
        severity: "HIGH",
        projectId: project.id,
      },
    });
    await db.issue.create({
      data: {
        title: "Missing test coverage for payment module",
        description: "Unit test coverage dropped below 80% after recent refactor.",
        status: "IN_PROGRESS",
        severity: "MEDIUM",
        projectId: project.id,
      },
    });
  }
  console.log(`✅ 4 issues created`);

  console.log("\n🎉 Seed complete!\n");
  console.log(`   Login: ${TEST_EMAIL}`);
  console.log(`   Password: ${TEST_PASSWORD}`);
  console.log(`   URL: https://agent.projectoolbox.com/login\n`);
}

main()
  .catch((e) => { console.error("❌ Seed failed:", e); process.exit(1); })
  .finally(() => db.$disconnect());
