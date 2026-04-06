/**
 * Lifecycle Init — Runs directly on Vercel (no VPS dependency).
 *
 * When an agent is deployed, this creates the DB phases and generates
 * the first set of artefacts for the Pre-Project / Sprint Zero phase.
 */

import { db } from "@/lib/db";
import { getMethodology } from "@/lib/methodology-definitions";
import { getPlaybook } from "./methodology-playbooks";

/**
 * Initialise the project lifecycle: create Phase rows, set currentPhase,
 * and generate initial artefacts via Claude.
 */
export async function runLifecycleInit(agentId: string, deploymentId: string) {
  const deployment = await db.agentDeployment.findUnique({
    where: { id: deploymentId },
    include: { project: true, agent: true },
  });
  if (!deployment) throw new Error("Deployment not found");

  const project = deployment.project;
  const agent = deployment.agent;
  const methodologyId = (project.methodology || "PRINCE2").toLowerCase().replace("agile_", "");
  const methodology = getMethodology(methodologyId);
  const playbook = getPlaybook(methodologyId);

  // ── Step 1: Create Phase rows in DB ──
  await db.agentActivity.create({
    data: { agentId, type: "deployment", summary: `Initialising ${methodology.name} lifecycle for "${project.name}"` },
  });

  const existingPhases = await db.phase.findMany({ where: { projectId: project.id } });
  if (existingPhases.length === 0) {
    for (let i = 0; i < methodology.phases.length; i++) {
      const phase = methodology.phases[i];
      await db.phase.create({
        data: {
          projectId: project.id,
          name: phase.name,
          order: i,
          status: i === 0 ? "ACTIVE" : "PENDING",
          criteria: phase.gate.criteria,
          artefacts: phase.artefacts.map(a => a.name),
          approvalReq: phase.gate.preRequisites.some(p => p.requiresHumanApproval),
        },
      });
    }
  }

  // ── Step 2: Set current phase ──
  const firstPhase = methodology.phases[0];
  await db.agentDeployment.update({
    where: { id: deploymentId },
    data: {
      currentPhase: firstPhase.name,
      phaseStatus: "active",
      lastCycleAt: new Date(),
      nextCycleAt: new Date(Date.now() + 10 * 60_000),
    },
  });

  // ── Step 3: Generate initial artefacts via Claude ──
  if (process.env.ANTHROPIC_API_KEY) {
    const artefactNames = firstPhase.artefacts.filter(a => a.aiGeneratable).map(a => a.name);

    if (artefactNames.length > 0) {
      await db.agentActivity.create({
        data: { agentId, type: "document", summary: `Generating ${artefactNames.length} artefact(s) for ${firstPhase.name} phase` },
      });

      const prompt = buildArtefactPrompt(project, firstPhase.name, artefactNames, methodology.name);

      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const text = (data.content?.[0]?.text || "").trim();

          // Parse sections — each artefact separated by "## ARTEFACT: <name>"
          const sections = text.split(/^## ARTEFACT:\s*/im).filter(Boolean);

          for (const section of sections) {
            const lines = section.trim().split("\n");
            const title = lines[0]?.trim();
            const content = lines.slice(1).join("\n").trim();

            if (title && content) {
              const matchingDef = artefactNames.find(a =>
                title.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase().includes(title.toLowerCase().replace(/[^a-z ]/g, ""))
              );

              await db.agentArtefact.create({
                data: {
                  agentId,
                  projectId: project.id,
                  name: matchingDef || title,
                  format: "markdown",
                  content,
                  status: "DRAFT",
                  version: 1,
                },
              });
            }
          }

          // Deduct credits for artefact generation
          try {
            const { CreditService } = await import("@/lib/credits/service");
            await CreditService.deduct(
              agent.orgId, 5,
              `Generated ${firstPhase.name} artefacts for "${project.name}"`,
              agentId,
            );
          } catch {}

          await db.agentActivity.create({
            data: { agentId, type: "document", summary: `${firstPhase.name} artefacts generated — ready for review` },
          });
        }
      } catch (e) {
        console.error("[lifecycle-init] Artefact generation failed:", e);
        await db.agentActivity.create({
          data: { agentId, type: "chat", summary: `Artefact generation failed — will retry on next cycle` },
        });
      }
    }
  }

  // ── Step 4: Create initial risk assessment ──
  const existingRisks = await db.risk.count({ where: { projectId: project.id } });
  if (existingRisks === 0) {
    const seedRisks = getSeedRisks(project.name, project.category || "other", project.budget || 0);
    for (const risk of seedRisks) {
      await db.risk.create({
        data: { projectId: project.id, ...risk },
      });
    }
    await db.agentActivity.create({
      data: { agentId, type: "risk", summary: `Identified ${seedRisks.length} initial risks for "${project.name}"` },
    });
  }

  // ── Step 5: Create gate approval request ──
  const gateApproval = await db.approval.create({
    data: {
      projectId: project.id,
      agentId,
      title: `${firstPhase.name} Gate: ${firstPhase.gate.criteria}`,
      description: `The agent has completed the ${firstPhase.name} phase. Review the generated artefacts and approve to advance to the next phase.`,
      type: "PHASE_GATE",
      status: "PENDING",
      impact: "MEDIUM",
    },
  });

  await db.agentActivity.create({
    data: { agentId, type: "approval", summary: `Phase gate approval requested: ${firstPhase.name} → awaiting review` },
  });

  // Mark the job as completed if it exists
  try {
    await db.agentJob.updateMany({
      where: { agentId, type: "lifecycle_init", status: { in: ["PENDING", "FAILED"] } },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  } catch {}

  return { phases: methodology.phases.length, currentPhase: firstPhase.name };
}

function buildArtefactPrompt(project: any, phaseName: string, artefactNames: string[], methodologyName: string): string {
  const category = (project.category || "other").toLowerCase();
  const isTravel = category === "travel" || (project.name || "").toLowerCase().includes("trip") || (project.name || "").toLowerCase().includes("holiday");
  const isNigeria = (project.name || "").toLowerCase().includes("nigeria") || (project.name || "").toLowerCase().includes("lagos");
  const isPersonal = category === "personal";

  const contextHints = isTravel
    ? `\nThis is a TRAVEL project. Frame all documents in travel PM terms: itinerary, logistics, bookings, visa/health requirements, safety, budget breakdown by component (flights, accommodation, transfers, meals, activities, contingency). Do NOT use software/corporate PM language.`
    : isPersonal
    ? `\nThis is a PERSONAL project. Use plain language, practical checklists, and personal project framing — not corporate PM jargon.`
    : "";

  const nigeriaHints = isNigeria
    ? `\nDestination: Nigeria. Include specific considerations for: FCO travel advisory, yellow fever vaccination certificate (mandatory), malaria prophylaxis, currency (NGN / parallel market rate), connectivity, local transport options, recommended areas to stay.`
    : "";

  return `You are an AI Project Manager initialising a project. Generate professional, specific, practical artefacts.

PROJECT: ${project.name}
DESCRIPTION: ${project.description || "No description provided"}
BUDGET: £${(project.budget || 0).toLocaleString()}
TIMELINE: ${project.startDate ? new Date(project.startDate).toLocaleDateString("en-GB") : "TBD"} to ${project.endDate ? new Date(project.endDate).toLocaleDateString("en-GB") : "TBD"}
CATEGORY: ${category}
METHODOLOGY: ${methodologyName}
CURRENT PHASE: ${phaseName}
${contextHints}${nigeriaHints}

Generate the following artefacts. Each must be SPECIFIC to this project — no generic templates.

${artefactNames.map(n => `## ARTEFACT: ${n}\n(Write the complete, specific ${n} for this project)`).join("\n\n")}

Rules:
- SPECIFIC: use the actual project name, budget figures, dates, destinations
- Use British English throughout
- Include tables, bullet points, and headings for readability
- For travel: include actual cost breakdowns summing to the £${(project.budget || 0).toLocaleString()} budget
- For risk documents: list REAL risks for this specific project and destination
- 400-900 words per artefact
- Start each section with "## ARTEFACT: <exact name>"`;
}

function getSeedRisks(projectName: string, category: string, budget: number) {
  const name = projectName.toLowerCase();
  const risks = [
    { title: "Budget overrun", description: `Risk of exceeding the £${budget.toLocaleString()} budget due to unforeseen costs or price increases`, probability: 3, impact: 4, score: 12, status: "OPEN" },
    { title: "Schedule slippage", description: "Key milestones may be delayed due to dependency chains or resource unavailability", probability: 3, impact: 3, score: 9, status: "OPEN" },
    { title: "Stakeholder availability", description: "Key decision-makers may be unavailable for timely approvals, causing delays", probability: 2, impact: 3, score: 6, status: "OPEN" },
  ];

  if (category === "travel" || name.includes("trip") || name.includes("travel") || name.includes("holiday")) {
    risks.push(
      { title: "Flight cancellation or delay", description: "Flights may be cancelled or significantly delayed, disrupting the entire itinerary and incurring rebooking costs", probability: 2, impact: 4, score: 8, status: "OPEN" },
      { title: "Visa / entry requirements not met", description: "Entry documentation, visa approvals, or vaccination requirements may not be obtained in time", probability: 2, impact: 5, score: 10, status: "OPEN" },
      { title: "Health and medical risk", description: "Illness, injury, or required vaccinations (e.g. yellow fever, malaria prophylaxis) may impact the traveller or cause trip cancellation", probability: 2, impact: 4, score: 8, status: "OPEN" },
      { title: "Accommodation unavailability", description: "Booked accommodation may be unavailable, overbooked, or below acceptable standard on arrival", probability: 1, impact: 3, score: 3, status: "OPEN" },
      { title: "Currency and payment issues", description: "Access to local currency (NGN, etc.) may be restricted; card payments may not be accepted at all locations", probability: 2, impact: 3, score: 6, status: "OPEN" },
    );
  }

  if (name.includes("nigeria") || name.includes("lagos") || name.includes("abuja")) {
    risks.push(
      { title: "Security and safety risk", description: "Nigeria carries an elevated FCO travel advisory. Petty crime, scams, and in some regions civil unrest are material risks requiring mitigation", probability: 3, impact: 5, score: 15, status: "OPEN" },
      { title: "Yellow fever vaccination requirement", description: "Yellow fever vaccination certificate (valid yellow card) is mandatory for entry into Nigeria. Without it, entry will be refused", probability: 1, impact: 5, score: 5, status: "OPEN" },
      { title: "Naira exchange rate volatility", description: "The Nigerian Naira has experienced significant exchange rate volatility. Budget variance risk is HIGH", probability: 3, impact: 3, score: 9, status: "OPEN" },
      { title: "Power and connectivity outages", description: "Nigeria experiences frequent power cuts and intermittent internet connectivity which may disrupt communications and planned activities", probability: 4, impact: 2, score: 8, status: "OPEN" },
    );
  }

  if (category === "events" || name.includes("event") || name.includes("conference") || name.includes("wedding")) {
    risks.push(
      { title: "Vendor no-show or cancellation", description: "A critical vendor (caterer, photographer, venue) cancels or fails to deliver", probability: 2, impact: 5, score: 10, status: "OPEN" },
      { title: "Weather disruption", description: "Adverse weather affecting outdoor elements of the event", probability: 2, impact: 3, score: 6, status: "OPEN" },
      { title: "Attendance variance", description: "Actual attendance significantly different from planned, affecting catering and logistics", probability: 3, impact: 2, score: 6, status: "OPEN" },
    );
  }

  return risks;
}
