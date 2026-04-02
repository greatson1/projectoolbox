import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter } as any);

async function main() {
  console.log("Seeding Projectoolbox database...");

  // ── Organisation ──
  const org = await db.organisation.upsert({
    where: { slug: "pmgt-solutions" },
    update: {},
    create: {
      name: "PMGT Solutions",
      slug: "pmgt-solutions",
      industry: "Consulting",
      companySize: "11-50",
      website: "https://pmgtsolutions.com",
      plan: "PROFESSIONAL",
      creditBalance: 2000,
      billingEmail: "billing@pmgtsolutions.com",
    },
  });
  console.log("✓ Organisation:", org.name);

  // ── Users ──
  const passwordHash = await bcrypt.hash("Password123!", 12);

  const users = await Promise.all([
    db.user.upsert({ where: { email: "ty@pmgtsolutions.com" }, update: {}, create: { name: "Dr. Ty Beetseh", email: "ty@pmgtsolutions.com", passwordHash, role: "OWNER", orgId: org.id, emailVerified: new Date(), onboardingComplete: true } }),
    db.user.upsert({ where: { email: "sarah@pmgtsolutions.com" }, update: {}, create: { name: "Sarah Chen", email: "sarah@pmgtsolutions.com", passwordHash, role: "ADMIN", orgId: org.id, emailVerified: new Date(), onboardingComplete: true } }),
    db.user.upsert({ where: { email: "james@pmgtsolutions.com" }, update: {}, create: { name: "James Okafor", email: "james@pmgtsolutions.com", passwordHash, role: "MEMBER", orgId: org.id, emailVerified: new Date(), onboardingComplete: true } }),
    db.user.upsert({ where: { email: "priya@pmgtsolutions.com" }, update: {}, create: { name: "Priya Sharma", email: "priya@pmgtsolutions.com", passwordHash, role: "MEMBER", orgId: org.id, emailVerified: new Date(), onboardingComplete: true } }),
    db.user.upsert({ where: { email: "liam@pmgtsolutions.com" }, update: {}, create: { name: "Liam Barrett", email: "liam@pmgtsolutions.com", passwordHash, role: "MEMBER", orgId: org.id, emailVerified: new Date(), onboardingComplete: true } }),
  ]);
  console.log("✓ Users:", users.length);

  // ── Projects ──
  const projects = await Promise.all([
    db.project.create({ data: { name: "Project Atlas", description: "Enterprise CRM migration to Salesforce", methodology: "PRINCE2", status: "ACTIVE", startDate: new Date("2026-01-15"), endDate: new Date("2026-09-30"), budget: 250000, priority: "high", category: "software", orgId: org.id } }),
    db.project.create({ data: { name: "SprintForge", description: "Internal agile delivery platform", methodology: "AGILE_SCRUM", status: "ACTIVE", startDate: new Date("2026-02-01"), endDate: new Date("2026-07-31"), budget: 120000, priority: "medium", category: "software", orgId: org.id } }),
    db.project.create({ data: { name: "Riverside Development", description: "Commercial property development Phase 2", methodology: "WATERFALL", status: "ACTIVE", startDate: new Date("2026-01-01"), endDate: new Date("2027-06-30"), budget: 500000, priority: "high", category: "construction", orgId: org.id } }),
    db.project.create({ data: { name: "Cloud Migration", description: "AWS to Azure infrastructure migration", methodology: "AGILE_KANBAN", status: "PAUSED", startDate: new Date("2026-03-01"), endDate: new Date("2026-12-31"), budget: 180000, priority: "medium", category: "software", orgId: org.id } }),
    db.project.create({ data: { name: "Brand Refresh", description: "Corporate rebrand and digital presence update", methodology: "HYBRID", status: "ACTIVE", startDate: new Date("2026-02-15"), endDate: new Date("2026-08-31"), budget: 85000, priority: "medium", category: "marketing", orgId: org.id } }),
  ]);
  console.log("✓ Projects:", projects.length);

  // ── Agents ──
  const agents = await Promise.all([
    db.agent.create({ data: { name: "Alpha", codename: "ALPHA-7", status: "ACTIVE", autonomyLevel: 4, gradient: "linear-gradient(135deg, #6366F1, #8B5CF6)", personality: { tone: 35, detail: 50 }, orgId: org.id } }),
    db.agent.create({ data: { name: "Bravo", codename: "BRAVO-3", status: "ACTIVE", autonomyLevel: 3, gradient: "linear-gradient(135deg, #22D3EE, #06B6D4)", personality: { tone: 50, detail: 60 }, orgId: org.id } }),
    db.agent.create({ data: { name: "Charlie", codename: "CHARLIE-5", status: "ACTIVE", autonomyLevel: 2, gradient: "linear-gradient(135deg, #10B981, #34D399)", personality: { tone: 70, detail: 40 }, orgId: org.id } }),
    db.agent.create({ data: { name: "Delta", codename: "DELTA-2", status: "PAUSED", autonomyLevel: 3, gradient: "linear-gradient(135deg, #F97316, #FB923C)", personality: { tone: 40, detail: 55 }, orgId: org.id } }),
    db.agent.create({ data: { name: "Echo", codename: "ECHO-9", status: "ACTIVE", autonomyLevel: 5, gradient: "linear-gradient(135deg, #EC4899, #F472B6)", personality: { tone: 25, detail: 70 }, orgId: org.id } }),
  ]);
  console.log("✓ Agents:", agents.length);

  // ── Deployments ──
  await Promise.all([
    db.agentDeployment.create({ data: { agentId: agents[0].id, projectId: projects[0].id, isActive: true, config: { methodology: "PRINCE2", hitl: { phaseGates: true, budget: true } } } }),
    db.agentDeployment.create({ data: { agentId: agents[1].id, projectId: projects[1].id, isActive: true, config: { methodology: "AGILE_SCRUM", hitl: { phaseGates: true } } } }),
    db.agentDeployment.create({ data: { agentId: agents[2].id, projectId: projects[2].id, isActive: true, config: { methodology: "WATERFALL", hitl: { phaseGates: true, budget: true, comms: true } } } }),
    db.agentDeployment.create({ data: { agentId: agents[3].id, projectId: projects[3].id, isActive: false, config: { methodology: "AGILE_KANBAN" } } }),
    db.agentDeployment.create({ data: { agentId: agents[4].id, projectId: projects[4].id, isActive: true, config: { methodology: "HYBRID", hitl: { phaseGates: true } } } }),
  ]);
  console.log("✓ Deployments: 5");

  // ── Approvals ──
  await Promise.all([
    db.approval.create({ data: { projectId: projects[0].id, requestedById: agents[0].id, assignedToId: users[0].id, type: "PHASE_GATE", title: "Phase Gate — Execution", description: "All 7 prerequisites verified. Risk Register v3 attached.", impact: { schedule: "low", cost: "low", scope: "none", risk: "medium" }, status: "PENDING" } }),
    db.approval.create({ data: { projectId: projects[2].id, requestedById: agents[2].id, assignedToId: users[0].id, type: "BUDGET", title: "Procurement — Steel reinforcement £28,500", description: "Barrett Steel order for Phase 3. Exceeds £10K threshold.", impact: { schedule: "high", cost: "high", scope: "none", risk: "low" }, status: "PENDING" } }),
    db.approval.create({ data: { projectId: projects[1].id, requestedById: agents[1].id, assignedToId: users[1].id, type: "SCOPE_CHANGE", title: "Sprint 7 scope change +2 SP", description: "PTX-113 timezone fix added mid-sprint.", impact: { schedule: "medium", cost: "low", scope: "low", risk: "low" }, status: "PENDING" } }),
  ]);
  console.log("✓ Approvals: 3");

  // ── Notifications ──
  await Promise.all([
    db.notification.create({ data: { userId: users[0].id, type: "APPROVAL_REQUEST", title: "Phase Gate Approval Required", body: "Agent Alpha needs approval for Execution phase gate on Project Atlas.", actionUrl: "/approvals", isRead: false } }),
    db.notification.create({ data: { userId: users[0].id, type: "RISK_ESCALATION", title: "Critical Risk — Supplier Delay", body: "Charlie flagged a 3-week supplier delay on Riverside Development.", actionUrl: "/approvals", isRead: false } }),
    db.notification.create({ data: { userId: users[0].id, type: "BILLING", title: "Credit Balance Alert", body: "753 credits remaining. At current rate, depletes in 9 days.", actionUrl: "/billing/credits", isRead: false } }),
    db.notification.create({ data: { userId: users[0].id, type: "AGENT_ALERT", title: "Agent Delta Paused", body: "Delta paused awaiting stakeholder feedback on Cloud Migration.", actionUrl: "/agents", isRead: true } }),
  ]);
  console.log("✓ Notifications: 4");

  // ── Credit Transactions ──
  await db.creditTransaction.create({ data: { orgId: org.id, amount: 2000, type: "SUBSCRIPTION_GRANT", description: "Professional plan — April 2026 grant" } });
  await db.creditTransaction.create({ data: { orgId: org.id, amount: -234, type: "USAGE", description: "Agent Alpha — week usage", agentId: agents[0].id } });
  await db.creditTransaction.create({ data: { orgId: org.id, amount: -189, type: "USAGE", description: "Agent Bravo — week usage", agentId: agents[1].id } });
  await db.creditTransaction.create({ data: { orgId: org.id, amount: -156, type: "USAGE", description: "Agent Charlie — week usage", agentId: agents[2].id } });
  console.log("✓ Credit transactions: 4");

  // ── Agent Activities ──
  const activities = [
    { agentId: agents[0].id, type: "document", summary: "Generated Risk Register v3 for Project Atlas" },
    { agentId: agents[0].id, type: "meeting", summary: "Processed board meeting transcript — 6 decisions logged" },
    { agentId: agents[1].id, type: "document", summary: "Generated Sprint 7 burndown report" },
    { agentId: agents[1].id, type: "approval", summary: "Submitted scope change for Sprint 7" },
    { agentId: agents[2].id, type: "risk", summary: "Identified supplier delay risk on Riverside" },
    { agentId: agents[4].id, type: "document", summary: "Created design asset handoff checklist (38 items)" },
    { agentId: agents[4].id, type: "risk", summary: "Flagged brand inconsistency across 3 deliverables" },
  ];
  await Promise.all(activities.map(a => db.agentActivity.create({ data: a })));
  console.log("✓ Agent activities:", activities.length);

  console.log("\n✅ Seed complete! Login with ty@pmgtsolutions.com / Password123!");
}

main().catch(console.error).finally(() => db.$disconnect());
