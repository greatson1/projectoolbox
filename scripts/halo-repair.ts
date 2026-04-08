/**
 * Halo Repair Script
 * 1. Generate missing Pre-Project artefacts (Problem Statement + Project Brief)
 * 2. Re-seed initial risks
 * 3. Re-create phase gate approval
 */
// Load .env before anything else
import { readFileSync } from "fs";
import { resolve } from "path";
const envPath = resolve(process.cwd(), ".env");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const idx = line.indexOf("=");
  if (idx === -1 || line.startsWith("#")) continue;
  const key = line.slice(0, idx).trim();
  let val = line.slice(idx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  if (key && !process.env[key]) process.env[key] = val;
}

import { db } from "../src/lib/db";
import { generatePhaseArtefacts } from "../src/lib/agents/lifecycle-init";

const AGENT_NAME = "Halo";

async function main() {
  const agent = await db.agent.findFirst({
    where: { name: { contains: AGENT_NAME } },
    include: { deployments: { where: { isActive: true }, take: 1 } },
  });
  if (!agent) throw new Error("Halo agent not found");

  const dep = agent.deployments[0];
  if (!dep) throw new Error("No active deployment");

  const projectId = dep.projectId;
  const agentId = agent.id;

  console.log(`Agent: ${agent.name} (${agentId})`);
  console.log(`Project: ${projectId}`);
  console.log(`Phase: ${dep.currentPhase}\n`);

  // ── 1. Generate missing artefacts ──────────────────────────────────────────
  console.log("=== Step 1: Generating missing artefacts ===");
  const existing = await db.agentArtefact.findMany({
    where: { agentId, projectId },
    select: { name: true },
  });
  console.log("Existing:", existing.map(a => a.name).join(", ") || "none");

  const result = await generatePhaseArtefacts(agentId, projectId, dep.currentPhase ?? undefined);
  console.log(`Generated: ${result.generated} | Skipped: ${result.skipped} | Phase: ${result.phase}`);

  // If Claude API call failed and artefacts still missing, seed with good starter content
  const artsAfter = await db.agentArtefact.findMany({ where: { agentId, projectId }, select: { name: true } });
  const artNames = artsAfter.map(a => a.name.toLowerCase());
  const missing: { name: string; content: string }[] = [];

  if (!artNames.some(n => n.includes("problem statement"))) {
    missing.push({
      name: "Problem Statement",
      content: `# Problem Statement\n\n## Document Control\n| Field | Value |\n|-------|-------|\n| Project | £2,000 Party for 10 Friends |\n| Version | 1.0 DRAFT |\n| Status | Draft — Awaiting Sponsor Review |\n| Owner | Project Manager |\n\n## Problem / Opportunity\nThere is a desire to host a memorable social gathering for 10 friends within a fixed budget of £2,000. Without structured planning, informal social events of this scale frequently suffer from budget overruns, last-minute vendor issues, and misaligned expectations among attendees.\n\n## Proposed Solution\nApply structured project management principles (PRINCE2 Pre-Project phase) to plan, coordinate, and deliver a high-quality party experience within the £2,000 budget constraint.\n\n## Success Criteria\n- Event delivered on or before target date\n- Total spend ≤ £2,000 (all-in)\n- All 10 guests attend and rate the event positively\n- No critical vendor failures on the day\n- Zero post-event disputes over costs or responsibilities\n\n## Constraints\n- Hard budget ceiling: £2,000\n- Guest count: 10 people\n- Timeline: To be confirmed at Initiation stage\n\n## Agent Progress Tracking Protocol\nThis document is maintained as a living artefact. The agent will update success criteria status at each phase gate and flag any constraint breaches immediately.`,
    });
  }

  if (!artNames.some(n => n.includes("project brief"))) {
    missing.push({
      name: "Project Brief",
      content: `# Project Brief\n\n## Document Control\n| Field | Value |\n|-------|-------|\n| Project | £2,000 Party for 10 Friends |\n| Version | 1.0 DRAFT |\n| Status | Draft — Awaiting Sponsor Review |\n| Owner | Project Manager |\n| Next Review | Pre-Project Phase Gate |\n\n## Project Overview\n| Field | Detail |\n|-------|--------|\n| Project Name | £2,000 Party for 10 Friends |\n| Project Manager | AI Agent (Halo) |\n| Sponsor | Project Owner |\n| Budget | £2,000 |\n| Methodology | PRINCE2 |\n| Current Phase | Pre-Project |\n| Overall Status | 🟢 Initiated |\n\n## Background\nThis project has been initiated to deliver a well-organised party for 10 friends. The project owner wishes to apply structured PM discipline to ensure the event is delivered within budget, on time, and to a standard that meets all attendees' expectations.\n\n## Objectives\n1. Secure a suitable venue within budget\n2. Arrange catering, entertainment, and logistics for 10 guests\n3. Deliver the event on the agreed date without budget overrun\n4. Achieve high guest satisfaction\n\n## Scope\n**In scope:** Venue selection, catering, entertainment, invitations, day-of coordination, budget tracking, risk management\n**Out of scope:** Post-event activities beyond a brief lessons-learned review\n\n## Budget Summary\n| Category | Estimated Allocation |\n|----------|---------------------|\n| Venue | £500 |\n| Catering & Drinks | £700 |\n| Entertainment | £300 |\n| Decorations | £200 |\n| Contingency | £300 |\n| **Total** | **£2,000** |\n\n## Key Risks (Pre-Project)\n- Budget overrun if venue/catering costs exceed estimates\n- Vendor cancellation requiring last-minute alternatives\n- Guest availability conflicts\n\n## Agent Progress Tracking Protocol\nThis document is maintained as a living artefact by the AI agent. Budget allocations will be updated at Initiation when confirmed quotes are received. Phase gate review will validate these estimates before execution begins.`,
    });
  }

  if (missing.length > 0) {
    console.log(`\nClaude API unavailable — seeding ${missing.length} missing artefact(s) with starter content:`);
    for (const art of missing) {
      await db.agentArtefact.create({
        data: { agentId, projectId, name: art.name, content: art.content, format: "markdown", status: "DRAFT", version: 1 },
      });
      console.log(`  Seeded: "${art.name}"`);
    }
  }
  console.log();

  // ── 2. Re-seed risks if still 0 ───────────────────────────────────────────
  console.log("=== Step 2: Seeding risks ===");
  const riskCount = await db.risk.count({ where: { projectId } });
  console.log(`Existing risk count: ${riskCount}`);

  if (riskCount === 0) {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { name: true, budget: true, category: true },
    });
    if (!project) throw new Error("Project not found");

    const isParty = project.name.toLowerCase().includes("party") ||
      project.category === "events" ||
      project.name.toLowerCase().includes("event");

    const seedRisks = [
      {
        title: "Budget overrun",
        description: `Risk of exceeding the £${(project.budget || 0).toLocaleString()} budget due to unexpected costs (venue, catering, entertainment price changes)`,
        probability: 3, impact: 4, score: 12, status: "OPEN",
      },
      {
        title: "Vendor cancellation",
        description: "A critical supplier (venue, caterer, DJ/entertainment) cancels or fails to deliver, requiring last-minute replacement at premium cost",
        probability: 2, impact: 5, score: 10, status: "OPEN",
      },
      {
        title: "Guest attendance shortfall",
        description: "Fewer guests attend than planned, impacting per-head cost allocations and prepaid minimum spend commitments",
        probability: 2, impact: 3, score: 6, status: "OPEN",
      },
      {
        title: "Venue unavailability",
        description: "Preferred venue becomes unavailable (double-booking, closure) requiring relocation at short notice",
        probability: 2, impact: 4, score: 8, status: "OPEN",
      },
      {
        title: "Schedule slippage",
        description: "Planning milestones (venue booking, catering confirmation) slip due to delayed decisions or stakeholder unavailability",
        probability: 3, impact: 3, score: 9, status: "OPEN",
      },
    ];

    for (const risk of seedRisks) {
      await db.risk.create({ data: { projectId, ...risk } });
      console.log(`  Created: "${risk.title}"`);
    }

    await db.agentActivity.create({
      data: {
        agentId,
        type: "risk",
        summary: `Identified ${seedRisks.length} initial risks for "${project.name}"`,
      },
    });
  } else {
    console.log("  Risks already exist — skipping");
  }

  // ── 3. Re-create phase gate approval if none pending ──────────────────────
  console.log("\n=== Step 3: Phase gate approval ===");
  const existingGate = await db.approval.findFirst({
    where: { projectId, type: "PHASE_GATE", status: "PENDING" },
  });

  if (!existingGate) {
    const gate = await db.approval.create({
      data: {
        projectId,
        requestedById: agentId,
        title: `Pre-Project Gate: Validate the project idea and authorise to proceed`,
        description: `The agent has completed the Pre-Project phase. Review the generated artefacts (Business Case, Options Analysis, Problem Statement, Project Brief) and approve to advance to Initiation.`,
        type: "PHASE_GATE",
        status: "PENDING",
        impact: "MEDIUM",
      },
    });
    console.log(`  Created phase gate approval: ${gate.id}`);

    await db.agentActivity.create({
      data: {
        agentId,
        type: "approval",
        summary: `Phase gate approval requested: Pre-Project → awaiting review`,
      },
    });
  } else {
    console.log(`  Phase gate already pending: ${existingGate.id}`);
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log("\n=== Final state ===");
  const [arts, risks, approvals] = await Promise.all([
    db.agentArtefact.findMany({ where: { agentId }, select: { name: true, status: true } }),
    db.risk.findMany({ where: { projectId }, select: { title: true, score: true }, orderBy: { score: "desc" } }),
    db.approval.findMany({ where: { projectId, status: "PENDING" }, select: { title: true, type: true } }),
  ]);

  console.log(`\nArtefacts (${arts.length}):`);
  arts.forEach(a => console.log(`  [${a.status}] ${a.name}`));

  console.log(`\nRisks (${risks.length}):`);
  risks.forEach(r => console.log(`  ${r.title} (score: ${r.score})`));

  console.log(`\nPending approvals (${approvals.length}):`);
  approvals.forEach(a => console.log(`  [${a.type}] ${a.title?.slice(0, 80)}`));

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
