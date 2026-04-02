import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter } as any);

async function main() {
  console.log("Seeding project data...");

  // Get existing projects
  const projects = await db.project.findMany({ orderBy: { createdAt: "asc" } });
  if (projects.length === 0) { console.log("No projects found. Run seed.ts first."); return; }

  const atlas = projects.find(p => p.name.includes("Atlas"));
  const sprint = projects.find(p => p.name.includes("Sprint"));
  const riverside = projects.find(p => p.name.includes("Riverside"));
  const cloud = projects.find(p => p.name.includes("Cloud"));
  const brand = projects.find(p => p.name.includes("Brand"));

  if (!atlas || !sprint || !riverside) { console.log("Expected projects not found"); return; }

  // ── PHASES for Atlas (PRINCE2) ──
  const atlasPhases = [
    { name: "Pre-Project", order: 1, status: "COMPLETED", projectId: atlas.id },
    { name: "Initiation", order: 2, status: "COMPLETED", projectId: atlas.id },
    { name: "Planning", order: 3, status: "COMPLETED", projectId: atlas.id },
    { name: "Execution", order: 4, status: "ACTIVE", projectId: atlas.id },
    { name: "Closing", order: 5, status: "PENDING", projectId: atlas.id },
  ];
  for (const p of atlasPhases) { await db.phase.create({ data: p }); }
  console.log("✓ Atlas phases: 5");

  // ── TASKS for Atlas ──
  const atlasTasks = [
    { title: "Finalise Salesforce configuration", status: "DONE", priority: "HIGH", progress: 100, storyPoints: 8, startDate: new Date("2026-02-01"), endDate: new Date("2026-03-15"), projectId: atlas.id },
    { title: "Data migration — Phase 1 (contacts)", status: "DONE", priority: "HIGH", progress: 100, storyPoints: 13, startDate: new Date("2026-03-01"), endDate: new Date("2026-03-20"), projectId: atlas.id },
    { title: "Data migration — Phase 2 (opportunities)", status: "IN_PROGRESS", priority: "HIGH", progress: 65, storyPoints: 13, startDate: new Date("2026-03-21"), endDate: new Date("2026-04-15"), projectId: atlas.id },
    { title: "Custom API integration with legacy ERP", status: "IN_PROGRESS", priority: "CRITICAL", progress: 40, storyPoints: 21, startDate: new Date("2026-03-15"), endDate: new Date("2026-05-01"), projectId: atlas.id },
    { title: "User acceptance testing — Round 1", status: "TODO", priority: "HIGH", progress: 0, storyPoints: 8, startDate: new Date("2026-04-15"), endDate: new Date("2026-05-01"), projectId: atlas.id },
    { title: "Training programme development", status: "IN_PROGRESS", priority: "MEDIUM", progress: 30, storyPoints: 5, startDate: new Date("2026-04-01"), endDate: new Date("2026-04-20"), projectId: atlas.id },
    { title: "Go-live readiness checklist", status: "TODO", priority: "HIGH", progress: 0, storyPoints: 3, startDate: new Date("2026-05-01"), endDate: new Date("2026-05-10"), projectId: atlas.id },
    { title: "Hypercare support plan", status: "TODO", priority: "MEDIUM", progress: 0, storyPoints: 5, startDate: new Date("2026-05-10"), endDate: new Date("2026-06-10"), projectId: atlas.id },
    { title: "Security audit and penetration testing", status: "IN_PROGRESS", priority: "CRITICAL", progress: 55, storyPoints: 8, startDate: new Date("2026-03-25"), endDate: new Date("2026-04-10"), projectId: atlas.id },
    { title: "Performance load testing (500 concurrent)", status: "TODO", priority: "HIGH", progress: 0, storyPoints: 5, startDate: new Date("2026-04-10"), endDate: new Date("2026-04-20"), projectId: atlas.id },
    { title: "Dashboard and reporting setup", status: "DONE", priority: "MEDIUM", progress: 100, storyPoints: 5, startDate: new Date("2026-02-15"), endDate: new Date("2026-03-10"), projectId: atlas.id },
    { title: "Email template migration", status: "DONE", priority: "LOW", progress: 100, storyPoints: 3, startDate: new Date("2026-03-01"), endDate: new Date("2026-03-08"), projectId: atlas.id },
    { title: "Workflow automation rules", status: "IN_PROGRESS", priority: "MEDIUM", progress: 70, storyPoints: 8, startDate: new Date("2026-03-10"), endDate: new Date("2026-04-05"), projectId: atlas.id },
    { title: "Third-party app integrations (Mailchimp, Slack)", status: "TODO", priority: "LOW", progress: 0, storyPoints: 5, startDate: new Date("2026-04-20"), endDate: new Date("2026-05-05"), projectId: atlas.id },
    { title: "Data quality validation scripts", status: "DONE", priority: "HIGH", progress: 100, storyPoints: 5, startDate: new Date("2026-02-20"), endDate: new Date("2026-03-05"), projectId: atlas.id },
  ];
  for (const t of atlasTasks) { await db.task.create({ data: t }); }
  console.log("✓ Atlas tasks:", atlasTasks.length);

  // ── TASKS for SprintForge ──
  const sprintTasks = [
    { title: "Design system tokens and theme provider", status: "DONE", priority: "HIGH", progress: 100, storyPoints: 5, projectId: sprint!.id },
    { title: "JWT auth with refresh token rotation", status: "DONE", priority: "CRITICAL", progress: 100, storyPoints: 5, projectId: sprint!.id },
    { title: "Reusable data table component", status: "DONE", priority: "MEDIUM", progress: 100, storyPoints: 3, projectId: sprint!.id },
    { title: "Stripe subscription lifecycle webhooks", status: "BLOCKED", priority: "HIGH", progress: 30, storyPoints: 5, projectId: sprint!.id },
    { title: "Onboarding wizard multi-step form", status: "IN_PROGRESS", priority: "CRITICAL", progress: 60, storyPoints: 8, projectId: sprint!.id },
    { title: "Real-time dashboard data refresh", status: "IN_PROGRESS", priority: "HIGH", progress: 45, storyPoints: 5, projectId: sprint!.id },
    { title: "Subscription plan comparison component", status: "TODO", priority: "HIGH", progress: 0, storyPoints: 5, projectId: sprint!.id },
    { title: "Credit usage aggregation cron job", status: "TODO", priority: "MEDIUM", progress: 0, storyPoints: 3, projectId: sprint!.id },
    { title: "Fix duplicate onboarding email trigger", status: "IN_PROGRESS", priority: "CRITICAL", progress: 80, storyPoints: 2, projectId: sprint!.id },
    { title: "Analytics chart drill-down interaction", status: "IN_PROGRESS", priority: "MEDIUM", progress: 35, storyPoints: 3, projectId: sprint!.id },
  ];
  for (const t of sprintTasks) { await db.task.create({ data: t }); }
  console.log("✓ SprintForge tasks:", sprintTasks.length);

  // ── RISKS for Atlas ──
  const atlasRisks = [
    { title: "Vendor API deprecation in Q3", probability: 4, impact: 5, score: 20, status: "OPEN", category: "Technical", owner: "Sarah Chen", mitigation: "Evaluate alternative APIs; begin migration planning by May", projectId: atlas.id },
    { title: "Resource conflict on critical path", probability: 3, impact: 5, score: 15, status: "OPEN", category: "Resource", owner: "James Okafor", mitigation: "Cross-train team; identify backup resources", projectId: atlas.id },
    { title: "Budget overrun from scope creep", probability: 4, impact: 4, score: 16, status: "MITIGATING", category: "Financial", owner: "Priya Sharma", mitigation: "Enforce change control; weekly budget reviews", projectId: atlas.id },
    { title: "Key stakeholder availability limited", probability: 3, impact: 3, score: 9, status: "OPEN", category: "Stakeholder", owner: "Liam Barrett", mitigation: "Schedule recurring sessions; async decisions", projectId: atlas.id },
    { title: "Integration testing delays", probability: 3, impact: 4, score: 12, status: "OPEN", category: "Technical", owner: "Mia Novak", mitigation: "Start integration tests early; automate regression", projectId: atlas.id },
    { title: "Data migration quality issues", probability: 4, impact: 4, score: 16, status: "MITIGATING", category: "Technical", owner: "Sarah Chen", mitigation: "Parallel validation; rollback procedures", projectId: atlas.id },
    { title: "Regulatory compliance changes", probability: 2, impact: 5, score: 10, status: "WATCHING", category: "External", owner: "Priya Sharma", mitigation: "Monitor regulatory updates; compliance buffer", projectId: atlas.id },
    { title: "Team attrition mid-project", probability: 2, impact: 4, score: 8, status: "WATCHING", category: "Resource", owner: "James Okafor", mitigation: "Knowledge sharing; documentation standards", projectId: atlas.id },
  ];
  for (const r of atlasRisks) { await db.risk.create({ data: r }); }
  console.log("✓ Atlas risks:", atlasRisks.length);

  // ── RISKS for Riverside ──
  const riversideRisks = [
    { title: "Supplier delivery delay — Phase 3 materials", probability: 5, impact: 5, score: 25, status: "OPEN", category: "External", owner: "Charlie (Agent)", mitigation: "Source from Barrett Steel (+$9K); parallel Phase 3B works", projectId: riverside.id },
    { title: "Planning permission amendment required", probability: 3, impact: 5, score: 15, status: "OPEN", category: "Regulatory", owner: "Liam Barrett", mitigation: "Pre-submit consultation with planning authority", projectId: riverside.id },
    { title: "Ground contamination discovery", probability: 2, impact: 5, score: 10, status: "WATCHING", category: "Environmental", owner: "Sarah Chen", mitigation: "Environmental survey complete; remediation budget allocated", projectId: riverside.id },
    { title: "Subcontractor insolvency risk", probability: 2, impact: 4, score: 8, status: "WATCHING", category: "Financial", owner: "James Okafor", mitigation: "Performance bonds in place; backup subcontractor list", projectId: riverside.id },
    { title: "Weather delays to foundation works", probability: 4, impact: 3, score: 12, status: "OPEN", category: "Environmental", owner: "Priya Sharma", mitigation: "Float in schedule; covered working areas for critical path", projectId: riverside.id },
  ];
  for (const r of riversideRisks) { await db.risk.create({ data: r }); }
  console.log("✓ Riverside risks:", riversideRisks.length);

  // ── ISSUES for Atlas ──
  const atlasIssues = [
    { title: "Legacy ERP API returning inconsistent date formats", priority: "HIGH", status: "IN_PROGRESS", projectId: atlas.id },
    { title: "Salesforce sandbox rate limits exceeded during testing", priority: "MEDIUM", status: "OPEN", projectId: atlas.id },
    { title: "Missing permission check on admin data export", priority: "CRITICAL", status: "IN_PROGRESS", projectId: atlas.id },
    { title: "CSV import fails on records with special characters", priority: "MEDIUM", status: "RESOLVED", projectId: atlas.id },
    { title: "Dashboard charts not rendering on Safari 16", priority: "LOW", status: "OPEN", projectId: atlas.id },
  ];
  for (const i of atlasIssues) { await db.issue.create({ data: i }); }
  console.log("✓ Atlas issues:", atlasIssues.length);

  // ── ISSUES for SprintForge ──
  const sprintIssues = [
    { title: "Stripe test mode 500 on subscription.deleted", priority: "HIGH", status: "OPEN", projectId: sprint!.id },
    { title: "Timezone handling in sprint date calculations", priority: "CRITICAL", status: "IN_PROGRESS", projectId: sprint!.id },
    { title: "Memory leak in real-time dashboard polling", priority: "MEDIUM", status: "OPEN", projectId: sprint!.id },
  ];
  for (const i of sprintIssues) { await db.issue.create({ data: i }); }
  console.log("✓ SprintForge issues:", sprintIssues.length);

  // ── STAKEHOLDERS for Atlas ──
  const atlasStakeholders = [
    { name: "Dr. Emma Wright", role: "Executive Sponsor", organisation: "Atlas Corp", power: 90, interest: 70, sentiment: "supportive", email: "emma.wright@atlascorp.com", projectId: atlas.id },
    { name: "Mark Phillips", role: "Programme Director", organisation: "Atlas Corp", power: 75, interest: 85, sentiment: "engaged", email: "mark.phillips@atlascorp.com", projectId: atlas.id },
    { name: "Lisa Chen", role: "Head of Sales", organisation: "Atlas Corp", power: 60, interest: 95, sentiment: "champion", email: "lisa.chen@atlascorp.com", projectId: atlas.id },
    { name: "David Kumar", role: "IT Director", organisation: "Atlas Corp", power: 80, interest: 60, sentiment: "neutral", email: "david.kumar@atlascorp.com", projectId: atlas.id },
    { name: "Rachel Adams", role: "Data Protection Officer", organisation: "Atlas Corp", power: 65, interest: 40, sentiment: "cautious", email: "rachel.adams@atlascorp.com", projectId: atlas.id },
    { name: "Tom Barrett", role: "Sales Operations Manager", organisation: "Atlas Corp", power: 40, interest: 90, sentiment: "champion", projectId: atlas.id },
  ];
  for (const s of atlasStakeholders) { await db.stakeholder.create({ data: s }); }
  console.log("✓ Atlas stakeholders:", atlasStakeholders.length);

  // ── CHANGE REQUESTS for Atlas ──
  const atlasCRs = [
    { title: "Add custom reporting module for sales directors", description: "Sales leadership requires 5 additional dashboard reports not in original scope. Impact: +$15K, +2 weeks.", status: "SUBMITTED", impact: { schedule: "medium", cost: "high", scope: "medium", risk: "low" }, requestedBy: "Lisa Chen", projectId: atlas.id },
    { title: "Extend UAT period by 1 week", description: "QA team needs additional time due to integration complexity. Impact: +1 week, no cost.", status: "APPROVED", impact: { schedule: "medium", cost: "none", scope: "none", risk: "low" }, requestedBy: "James Okafor", projectId: atlas.id },
    { title: "Replace legacy email templates with Salesforce Marketing Cloud", description: "Marketing wants to consolidate email tooling. Impact: +$8K, +3 weeks, reduces long-term maintenance.", status: "UNDER_REVIEW", impact: { schedule: "high", cost: "medium", scope: "medium", risk: "medium" }, requestedBy: "Mark Phillips", projectId: atlas.id },
  ];
  for (const cr of atlasCRs) { await db.changeRequest.create({ data: cr }); }
  console.log("✓ Atlas change requests:", atlasCRs.length);

  // ── CHANGE REQUESTS for Riverside ──
  const riversideCRs = [
    { title: "Steel reinforcement specification change", description: "Structural engineer requires 20mm bars instead of 16mm for Phase 3 foundations. Impact: +$3,500.", status: "APPROVED", impact: { schedule: "none", cost: "low", scope: "low", risk: "low" }, requestedBy: "Structural Engineer", projectId: riverside.id },
    { title: "Additional site survey for contamination", description: "Environmental agency requested extended survey. Impact: +$12K, +2 weeks delay to Phase 2.", status: "SUBMITTED", impact: { schedule: "high", cost: "high", scope: "none", risk: "medium" }, requestedBy: "Environmental Agency", projectId: riverside.id },
  ];
  for (const cr of riversideCRs) { await db.changeRequest.create({ data: cr }); }
  console.log("✓ Riverside change requests:", riversideCRs.length);

  // ── More Agent Activities ──
  const agents = await db.agent.findMany();
  const alpha = agents.find(a => a.name === "Alpha");
  const bravo = agents.find(a => a.name === "Bravo");
  const charlie = agents.find(a => a.name === "Charlie");
  const echo = agents.find(a => a.name === "Echo");

  if (alpha && bravo && charlie && echo) {
    const activities = [
      { agentId: alpha.id, type: "document", summary: "Generated weekly status report for Project Atlas" },
      { agentId: alpha.id, type: "risk", summary: "Updated risk scores — 2 risks escalated to critical" },
      { agentId: alpha.id, type: "approval", summary: "Submitted Change Request CR-003 for review" },
      { agentId: bravo.id, type: "meeting", summary: "Processed Sprint 7 planning meeting — 12 items refined" },
      { agentId: bravo.id, type: "document", summary: "Generated Sprint 7 burndown report with velocity analysis" },
      { agentId: charlie.id, type: "risk", summary: "Identified supplier delay risk — score 25 (critical)" },
      { agentId: charlie.id, type: "document", summary: "Drafted Change Request for additional site survey" },
      { agentId: charlie.id, type: "meeting", summary: "Attended site progress meeting — 4 decisions logged" },
      { agentId: echo.id, type: "document", summary: "Created brand asset handoff checklist (38 items)" },
      { agentId: echo.id, type: "risk", summary: "Flagged brand inconsistency across 3 deliverables" },
      { agentId: echo.id, type: "approval", summary: "Submitted design review package for stakeholder sign-off" },
      { agentId: alpha.id, type: "chat", summary: "Responded to budget variance query from programme director" },
      { agentId: bravo.id, type: "chat", summary: "Provided sprint velocity analysis to scrum master" },
    ];
    for (const a of activities) { await db.agentActivity.create({ data: a }); }
    console.log("✓ Additional activities:", activities.length);
  }

  // ── More Notifications ──
  const users = await db.user.findMany({ take: 1 });
  if (users[0]) {
    const notifs = [
      { userId: users[0].id, type: "MILESTONE" as const, title: "Atlas: Data Migration Phase 1 Complete", body: "All 45,000 contact records migrated successfully. Zero data loss. Phase 2 can begin.", actionUrl: "/projects", isRead: false },
      { userId: users[0].id, type: "AGENT_ALERT" as const, title: "Agent Alpha: Weekly Report Generated", body: "Project Atlas weekly status report is ready for review. Covers sprint progress, budget, and risk updates.", actionUrl: "/projects", isRead: true },
      { userId: users[0].id, type: "RISK_ESCALATION" as const, title: "2 Risks Escalated to Critical", body: "Vendor API deprecation (score 20) and data migration quality (score 16) require immediate attention.", actionUrl: "/approvals", isRead: false },
      { userId: users[0].id, type: "SYSTEM" as const, title: "Stripe Webhook Connected", body: "Payment processing is now live. Subscription and credit purchase webhooks are active.", actionUrl: "/billing", isRead: true },
    ];
    for (const n of notifs) { await db.notification.create({ data: n }); }
    console.log("✓ Notifications:", notifs.length);
  }

  // ── More Credit Transactions ──
  const org = await db.organisation.findFirst();
  if (org && alpha && bravo && charlie && echo) {
    const txns = [
      { orgId: org.id, amount: -18, type: "USAGE" as const, description: "Generated Risk Register v3 (12 pages)", agentId: alpha.id },
      { orgId: org.id, amount: -12, type: "USAGE" as const, description: "Processed sprint retro transcript", agentId: bravo.id },
      { orgId: org.id, amount: -22, type: "USAGE" as const, description: "Risk probability analysis (Monte Carlo)", agentId: alpha.id },
      { orgId: org.id, amount: -14, type: "USAGE" as const, description: "Change impact assessment CR-003", agentId: charlie.id },
      { orgId: org.id, amount: -8, type: "USAGE" as const, description: "Weekly status report generation", agentId: alpha.id },
      { orgId: org.id, amount: -11, type: "USAGE" as const, description: "Brand consistency audit", agentId: echo.id },
      { orgId: org.id, amount: -6, type: "USAGE" as const, description: "Sprint burndown chart generation", agentId: bravo.id },
      { orgId: org.id, amount: -15, type: "USAGE" as const, description: "Meeting summary extraction (45 min)", agentId: alpha.id },
      { orgId: org.id, amount: -5, type: "USAGE" as const, description: "Design asset checklist compilation", agentId: echo.id },
      { orgId: org.id, amount: -9, type: "USAGE" as const, description: "Backlog grooming priority re-scoring", agentId: bravo.id },
    ];
    for (const t of txns) { await db.creditTransaction.create({ data: t }); }

    // Update credit balance
    const totalUsed = txns.reduce((s, t) => s + Math.abs(t.amount), 0);
    await db.organisation.update({ where: { id: org.id }, data: { creditBalance: { decrement: totalUsed } } });
    console.log("✓ Credit transactions:", txns.length, "(-" + totalUsed + " credits)");
  }

  console.log("\n✅ Project data seeded! All modules now have real data.");
}

main().catch(console.error).finally(() => db.$disconnect());
