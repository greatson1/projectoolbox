/**
 * Lifecycle Init — Runs directly on Vercel (no VPS dependency).
 *
 * When an agent is deployed, this creates the DB phases and generates
 * the first set of artefacts for the Pre-Project / Sprint Zero phase.
 */

import { db } from "@/lib/db";
import { getMethodology } from "@/lib/methodology-definitions";
import { getPlaybook } from "./methodology-playbooks";
import { isSpreadsheetArtefact, getArtefactColumns } from "@/lib/artefact-types";

/**
 * Generate artefacts for the current (or specified) phase of a project.
 * Safe to call on existing deployments — skips artefacts already in DB.
 * Returns { generated, skipped }.
 */
export async function generatePhaseArtefacts(
  agentId: string,
  projectId: string,
  phaseName?: string,
): Promise<{ generated: number; skipped: number; phase: string }> {
  const [agent, project] = await Promise.all([
    db.agent.findUnique({ where: { id: agentId } }),
    db.project.findUnique({ where: { id: projectId } }),
  ]);
  if (!agent || !project) throw new Error("Agent or project not found");

  const methodologyId = (project.methodology || "PRINCE2").toLowerCase().replace("agile_", "");
  const methodology = getMethodology(methodologyId);

  // Determine target phase
  const deployment = await db.agentDeployment.findFirst({
    where: { agentId, projectId, isActive: true },
    orderBy: { deployedAt: "desc" },
  });
  const targetPhaseName = phaseName || deployment?.currentPhase || methodology.phases[0].name;
  const phaseDef = methodology.phases.find(p => p.name === targetPhaseName) || methodology.phases[0];

  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");

  const artefactNames = phaseDef.artefacts.filter(a => a.aiGeneratable).map(a => a.name);

  // Find which artefacts already exist for this project
  const existing = await db.agentArtefact.findMany({
    where: { projectId, agentId },
    select: { name: true },
  });
  const existingNames = new Set(existing.map(a => a.name.toLowerCase()));

  const toGenerate = artefactNames.filter(n => !existingNames.has(n.toLowerCase()));
  const skipped = artefactNames.length - toGenerate.length;

  if (toGenerate.length === 0) return { generated: 0, skipped, phase: targetPhaseName };

  await db.agentActivity.create({
    data: { agentId, type: "document", summary: `Generating ${toGenerate.length} artefact(s) for ${targetPhaseName} (${skipped} already exist)` },
  });

  const spreadsheetNames = toGenerate.filter(n => isSpreadsheetArtefact(n));
  const proseNames = toGenerate.filter(n => !isSpreadsheetArtefact(n));

  const BATCH_SIZE = 3;
  let totalGenerated = 0;

  const allBatches: Array<{ names: string[]; isSheet: boolean }> = [];
  for (let i = 0; i < proseNames.length; i += BATCH_SIZE) allBatches.push({ names: proseNames.slice(i, i + BATCH_SIZE), isSheet: false });
  for (let i = 0; i < spreadsheetNames.length; i += BATCH_SIZE) allBatches.push({ names: spreadsheetNames.slice(i, i + BATCH_SIZE), isSheet: true });

  for (const { names: batch, isSheet } of allBatches) {
    const prompt = isSheet
      ? buildSpreadsheetPrompt(project, targetPhaseName, batch, methodology.name)
      : buildArtefactPrompt(project, targetPhaseName, batch, methodology.name);

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) {
        console.error(`[generatePhaseArtefacts] API error ${response.status}: ${await response.text().catch(() => "unknown")}`);
        continue;
      }

      const data = await response.json();
      const text = (data.content?.[0]?.text || "").trim();
      if (!text) continue;

      const sections = text.split(/^## ARTEFACT:\s*/im).filter(Boolean);
      for (const section of sections) {
        const lines = section.trim().split("\n");
        // Strip bold markers, version numbers, and parenthetical notes from title
        const title = lines[0]?.trim()
          .replace(/\*+/g, "")
          .replace(/\s*\(.*?\)/g, "")
          .replace(/\s+v?\d+(\.\d+)*\s*$/i, "")
          .trim();
        const content = lines.slice(1).join("\n").trim();

        if (title && content.length > 20) {
          const normTitle = title.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
          const matchingDef = artefactNames.find(a => {
            const normDef = a.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
            return normTitle.includes(normDef) || normDef.includes(normTitle) ||
              // Word-level prefix match — "project brief draft" matches "project brief"
              normTitle.startsWith(normDef.split(" ").slice(0, 2).join(" "));
          });
          const artName = matchingDef || title;
          // Skip if now already exists (race condition guard)
          if (existingNames.has(artName.toLowerCase())) continue;
          // Detect format: CSV for spreadsheets, HTML if content starts with tag, else markdown
          let detectedFmt = "markdown";
          if (isSheet) { detectedFmt = "csv"; }
          else if (content.trimStart().startsWith("<")) { detectedFmt = "html"; }
          await db.agentArtefact.create({
            data: { agentId, projectId, name: artName, format: detectedFmt, content, status: "DRAFT", version: 1 },
          });
          existingNames.add(artName.toLowerCase());
          totalGenerated++;
        }
      }
    } catch (e) {
      console.error(`[generatePhaseArtefacts] Batch failed:`, e);
    }
  }

  if (totalGenerated > 0) {
    try {
      const { CreditService } = await import("@/lib/credits/service");
      await CreditService.deduct(agent.orgId, Math.max(5, totalGenerated * 2), `Generated ${targetPhaseName} artefacts for "${project.name}"`, agentId);
    } catch {}
    await db.agentActivity.create({
      data: { agentId, type: "document", summary: `${targetPhaseName}: ${totalGenerated} artefact(s) generated — ready for review` },
    });
  }

  return { generated: totalGenerated, skipped, phase: targetPhaseName };
}

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

      // Separate spreadsheet (CSV) from prose (markdown) artefacts
      const spreadsheetNames = artefactNames.filter(n => isSpreadsheetArtefact(n));
      const proseNames = artefactNames.filter(n => !isSpreadsheetArtefact(n));

      // Batch into groups of 3 — each group gets its own Claude call with full token budget.
      const BATCH_SIZE = 3;
      let totalGenerated = 0;

      // Process all artefacts (prose + spreadsheet) in batches
      const allBatches: Array<{ names: string[]; isSheet: boolean }> = [];
      for (let i = 0; i < proseNames.length; i += BATCH_SIZE) allBatches.push({ names: proseNames.slice(i, i + BATCH_SIZE), isSheet: false });
      for (let i = 0; i < spreadsheetNames.length; i += BATCH_SIZE) allBatches.push({ names: spreadsheetNames.slice(i, i + BATCH_SIZE), isSheet: true });

      for (let batchIdx = 0; batchIdx < allBatches.length; batchIdx++) {
        const { names: batch, isSheet } = allBatches[batchIdx];
        const prompt = isSheet
          ? buildSpreadsheetPrompt(project, firstPhase.name, batch, methodology.name)
          : buildArtefactPrompt(project, firstPhase.name, batch, methodology.name);

        try {
          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": process.env.ANTHROPIC_API_KEY,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-6",
              max_tokens: 8192,
              messages: [{ role: "user", content: prompt }],
            }),
          });

          if (!response.ok) {
            const errText = await response.text().catch(() => "unknown");
            console.error(`[lifecycle-init] Batch ${batchIdx} API error ${response.status}: ${errText}`);
            continue;
          }

          const data = await response.json();
          const text = (data.content?.[0]?.text || "").trim();

          if (!text) {
            console.error(`[lifecycle-init] Batch ${batchIdx} returned empty response`);
            continue;
          }

          // Parse sections — each artefact separated by "## ARTEFACT: <name>"
          const sections = text.split(/^## ARTEFACT:\s*/im).filter(Boolean);

          for (const section of sections) {
            const lines = section.trim().split("\n");
            // Strip bold markers, version numbers, and parenthetical notes from title
            const title = lines[0]?.trim()
              .replace(/\*+/g, "")
              .replace(/\s*\(.*?\)/g, "")
              .replace(/\s+v?\d+(\.\d+)*\s*$/i, "")
              .trim();
            const content = lines.slice(1).join("\n").trim();

            if (title && content.length > 20) {
              const normTitle = title.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
              const matchingDef = artefactNames.find(a => {
                const normDef = a.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
                return normTitle.includes(normDef) || normDef.includes(normTitle) ||
                  normTitle.startsWith(normDef.split(" ").slice(0, 2).join(" "));
              });

              const artName = matchingDef || title;
              // Detect format: CSV for spreadsheets, HTML if content starts with an HTML tag, else markdown
              let detectedFormat = "markdown";
              if (isSheet) {
                detectedFormat = "csv";
              } else if (content.trimStart().startsWith("<")) {
                detectedFormat = "html";
              }
              await db.agentArtefact.create({
                data: {
                  agentId,
                  projectId: project.id,
                  name: artName,
                  format: detectedFormat,
                  content,
                  status: "DRAFT",
                  version: 1,
                },
              });
              totalGenerated++;
            }
          }
        } catch (e) {
          console.error(`[lifecycle-init] Batch ${batchIdx} generation failed:`, e);
        }
      }

      if (totalGenerated > 0) {
        // Deduct credits for artefact generation
        try {
          const { CreditService } = await import("@/lib/credits/service");
          await CreditService.deduct(
            agent.orgId, Math.max(5, totalGenerated * 2),
            `Generated ${firstPhase.name} artefacts for "${project.name}"`,
            agentId,
          );
        } catch {}

        await db.agentActivity.create({
          data: { agentId, type: "document", summary: `${firstPhase.name}: ${totalGenerated} artefact(s) generated — ready for review` },
        });
      } else {
        console.error("[lifecycle-init] No artefacts were saved — check API key and model access");
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
  // requestedById is required — find the org owner (or any admin) to attribute the request to
  const orgOwner = await db.user.findFirst({
    where: { orgId: agent.orgId, role: { in: ["OWNER", "ADMIN"] } },
    select: { id: true },
  });
  const gateApproval = await db.approval.create({
    data: {
      projectId: project.id,
      requestedById: orgOwner?.id || agent.orgId, // fallback to orgId if no user found
      title: `${firstPhase.name} Gate: ${firstPhase.gate.criteria}`,
      description: `The agent has completed the ${firstPhase.name} phase. Review the generated artefacts and approve to advance to the next phase.`,
      type: "PHASE_GATE",
      status: "PENDING",
      impact: { level: "MEDIUM", description: "Phase gate approval" },
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

function buildSpreadsheetPrompt(project: any, phaseName: string, artefactNames: string[], methodologyName: string): string {
  const category = (project.category || "other").toLowerCase();
  const isTravel = category === "travel" || (project.name || "").toLowerCase().includes("trip") || (project.name || "").toLowerCase().includes("holiday");
  const isNigeria = (project.name || "").toLowerCase().includes("nigeria") || (project.name || "").toLowerCase().includes("lagos");
  const today = new Date().toLocaleDateString("en-GB");
  const startDate = project.startDate ? new Date(project.startDate).toLocaleDateString("en-GB") : "TBD";
  const endDate = project.endDate ? new Date(project.endDate).toLocaleDateString("en-GB") : "TBD";
  const budget = project.budget || 0;
  const budgetStr = budget.toLocaleString();

  const artefactInstructions = artefactNames.map(name => {
    const cols = getArtefactColumns(name);
    const headerRow = cols.length > 0 ? cols.join(",") : "ID,Description,Owner,Status,Notes";
    const lname = name.toLowerCase();
    let dataInstructions = "";

    if (lname.includes("schedule") || lname.includes("wbs") || lname.includes("work breakdown") || lname.includes("schedule baseline")) {
      const taskCategories = isTravel
        ? "Pre-Departure Planning, Bookings & Reservations, Documentation & Visas, Health Preparation, Packing, Day-by-Day Itinerary, Post-Trip"
        : "Project Setup, Requirements, Design, Build, Test, Deploy, Closure";
      const nigeriaTaskDetails = isNigeria ? `
MANDATORY TRAVEL TASKS TO INCLUDE (with realistic dates):
- Research Nigeria / Lagos trip (Pre-Departure Planning)
- Book return flights LHR→LOS (Bookings)
- Apply for Nigerian visa — allow 6+ weeks (Documentation & Visas)
- Obtain yellow fever vaccination certificate — MANDATORY FOR ENTRY — book GP appt (Health Preparation)
- Malaria prophylaxis prescription — GP appointment 6+ weeks before travel (Health Preparation)
- Book accommodation in Victoria Island or Ikoyi (Bookings)
- Arrange airport transfer from MMIA (Bookings)
- Purchase travel insurance with medical & repatriation cover (Documentation)
- Register trip with FCDO TravelAware website (Documentation)
- Get local Nigerian SIM card details / research Airtel or MTN (Pre-Departure)
- Pack and pre-departure checklist review (Packing)
- Day-by-day itinerary activities (Day-by-Day)
- Post-trip expense reconciliation (Post-Trip)` : "";
      dataInstructions = `Generate 15-25 specific task rows.
Task categories: ${taskCategories}
${nigeriaTaskDetails}
Use REAL dates between ${startDate} and ${endDate}.
Assign each task to a named owner or role.
Set Status for each task: tasks with planned start before ${today} and no completion should be "In Progress" or "At Risk".
RAG column: Green = on track, Amber = at risk, Red = delayed.
Critical Path: Yes/No — identify which tasks must not slip.
% Complete: 0-100 based on realistic progress as at ${today}.
Quote any fields containing commas.`;
    } else if (lname.includes("risk")) {
      const riskRows = isTravel ? (isNigeria ? `"R001","Logistics","Flight cancellation or severe delay","Return flight LHR-LOS cancelled or delayed >6hrs disrupting entire itinerary","2","4","8","HIGH","Traveller","Book flexible/refundable fares. Comprehensive travel insurance with cancellation cover","Rebook next available flight. Claim insurance","4","Open","${today}"
"R002","Documentation","Lost or stolen passport","Passport lost or stolen preventing travel or return to UK","1","5","5","MEDIUM","Traveller","Digital copies in cloud. Note British High Commission Lagos: +234 (0)1 277-0780","Emergency travel document via British High Commission","2","Open","${today}"
"R003","Documentation","Visa delays or refusal","Nigerian visa application delayed or refused preventing travel","2","5","10","HIGH","Traveller","Apply minimum 8 weeks in advance. Use reputable visa service. Monitor application","Rebook travel. Contact High Commission directly","5","Open","${today}"
"R004","Health","Yellow fever entry refusal","Entry to Nigeria refused — yellow fever vaccination certificate (yellow card) mandatory with NO exceptions","1","5","5","MEDIUM","Traveller","Book GP appointment immediately. Allow 10+ days for vaccination. Keep certificate in hand luggage","No contingency — must obtain certificate before travel","2","Open","${today}"
"R005","Health","Malaria risk","Nigeria is high-risk malaria country. Illness without prophylaxis can be severe","2","5","10","HIGH","Traveller","GP appointment for prophylaxis prescription (Doxycycline or Malarone). Start per GP guidance","Emergency medical insurance with repatriation cover","4","Open","${today}"
"R006","Security","Crime and safety risk in Lagos","FCO advises high awareness in Lagos. Petty crime, scams, and road safety incidents elevated","3","4","12","HIGH","Project Manager","Stay in recommended areas (Victoria Island/Ikoyi/Lekki). Pre-arrange trusted airport transfer. Brief on common scams","Emergency evacuation insurance. Register with FCDO TravelAware","6","Open","${today}"
"R007","Financial","Naira exchange rate volatility","NGN/GBP rate volatile. Parallel market rate 30-60% different from official rate. Budget variance risk HIGH","3","3","9","MEDIUM","Project Manager","Research current rates before travel. Take mixed GBP/USD cash + cards. Use reliable exchange services","15% contingency buffer in budget","5","Open","${today}"
"R008","Operational","Power outages (NEPA)","Frequent power cuts across Nigeria lasting hours. Hotel facilities impacted","4","2","8","MEDIUM","Traveller","Book hotels with generator backup confirmed. Carry power bank. Download offline maps/content","Flexible daily schedule. Generator hotels only","4","Open","${today}"
"R009","Operational","Internet and connectivity issues","4G may be patchy. UK data roaming expensive or unavailable","3","2","6","LOW","Traveller","Purchase local SIM on arrival (Airtel/MTN). Pre-download offline maps and documents","Offline backups of all itinerary and booking documents","2","Open","${today}"
"R010","Financial","Budget overrun","Actual trip spend exceeds planned budget of £${budgetStr}","2","3","6","MEDIUM","Project Manager","Track all spend in budget tracker. 10% variance triggers review. Maintain contingency reserve","Reduce discretionary activities. Apply contingency reserve","3","Open","${today}"
"R011","Health","Medical emergency abroad","Illness or injury requiring hospital treatment in Nigeria","2","4","8","HIGH","Traveller","Comprehensive travel insurance with medical and repatriation cover. Research nearest international hospital in Lagos (Eko Hospital, Lagos Island General)","Insurance emergency helpline. Repatriation if required","4","Open","${today}"
"R012","Logistics","Accommodation issues on arrival","Booked accommodation unavailable overbooked or below acceptable standard","1","3","3","LOW","Traveller","Book well-reviewed hotel. Keep confirmation email. Research backup hotels in same area","Relocate immediately. Claim via booking platform","1","Open","${today}"` : `"R001","Logistics","Flight cancellation or delay","Return flight cancelled or delayed >6hrs disrupting entire trip","2","4","8","HIGH","Traveller","Flexible fares. Travel insurance with cancellation cover","Rebook. Claim insurance","4","Open","${today}"
"R002","Documentation","Lost or stolen passport","Passport lost preventing travel or return","1","5","5","MEDIUM","Traveller","Digital copies in cloud. Note local embassy details","Emergency travel document via Embassy","2","Open","${today}"
"R003","Documentation","Visa delays","Visa application delayed beyond travel date","2","4","8","HIGH","Traveller","Apply 8+ weeks early. Monitor application","Rebook travel. Contact embassy","4","Open","${today}"
"R004","Financial","Budget overrun","Spend exceeds £${budgetStr} budget","3","3","9","MEDIUM","Project Manager","Weekly cost tracking. 10% variance triggers review","Apply contingency reserve","4","Open","${today}"
"R005","Health","Medical emergency abroad","Illness requiring medical attention","2","4","8","HIGH","Traveller","Comprehensive travel insurance. Research local hospitals","Insurance emergency line. Repatriation","4","Open","${today}"
"R006","Logistics","Accommodation issues","Accommodation unavailable or below standard","1","3","3","LOW","Traveller","Book with confirmed reviews. Keep confirmation","Relocate to backup","1","Open","${today}"`) : `"R001","Financial","Budget overrun","Project costs exceed planned budget of £${budgetStr}","3","4","12","HIGH","Project Manager","Weekly cost tracking. 10% variance triggers review. 20% triggers exception report","Descope lower priority work. Apply contingency","6","Open","${today}"
"R002","Schedule","Schedule slippage","Key milestones delayed due to dependency chains or resource issues","3","3","9","MEDIUM","Project Manager","Weekly progress reviews. Critical path monitoring. Escalation at 1-week slip","Replan remaining work. Escalate to sponsor","4","Open","${today}"
"R003","Stakeholder","Stakeholder unavailability","Key decision-makers unavailable for approvals causing delays","2","3","6","MEDIUM","Project Manager","Confirm availability at project start. Allow approval lead time in schedule","Delegate to nominated deputy","3","Open","${today}"
"R004","Scope","Scope creep","Additional requirements added without formal change control","3","3","9","MEDIUM","Project Manager","Strict change control. Documented scope baseline","Formal change request required","4","Open","${today}"
"R005","Resource","Key resource unavailability","Critical team member becomes unavailable","2","4","8","HIGH","Project Manager","Identify backup resources. Document knowledge","Bring in contractor. Replan affected tasks","4","Open","${today}"
"R006","Quality","Acceptance criteria not met","Deliverables fail to meet agreed acceptance criteria","2","4","8","HIGH","Project Manager","Clear acceptance criteria upfront. Regular quality reviews","Rework cycle. Lessons learned","4","Open","${today}"`;
      dataInstructions = `Use these exact data rows:
${riskRows}
Quote fields containing commas.`;
    } else if (lname.includes("stakeholder")) {
      const stRows = isTravel ? (isNigeria ? `"S001","Primary Traveller","Individual","Trip participant — makes all decisions and approvals","H","H","Champion","Champion","Direct","Daily","Self","Full ownership of all trip decisions"
"S002","Travel Agent / Booking Platform","Service Provider","Manages bookings. Key service delivery partner","M","L","Supportive","Supportive","Email/Phone","As needed","Primary Traveller","Booking confirmation and changes"
"S003","Airline (LHR-LOS route)","Service Provider","Transports traveller. Critical dependency for whole trip","H","L","Neutral","Neutral","App/Email","At booking and check-in","Primary Traveller","Flight bookings and changes"
"S004","Accommodation — Lagos","Service Provider","Provides lodging in destination. Safety and comfort critical","M","H","Neutral","Supportive","Email/App","Pre-arrival and during stay","Primary Traveller","Safety standards, generator backup, location"
"S005","Nigerian Host / Local Contact","Individual","Local knowledge, guidance, logistics support in Lagos","M","H","Supportive","Champion","WhatsApp/Phone","Daily during trip","Primary Traveller","Local knowledge, safety advice, local contacts"
"S006","British High Commission Lagos","Government","UK consular support in Nigeria. Emergency assistance","H","L","Neutral","Neutral","Emergency line / Website","Emergency only","Primary Traveller","Register on FCDO TravelAware. Emergency: +234 (0)1 277-0780"
"S007","Travel Insurance Provider","Service Provider","Financial protection against all trip disruptions. Medical cover essential","H","M","Neutral","Supportive","Phone/App","Claims as required","Primary Traveller","Policy coverage limits, claims process, emergency helpline"
"S008","GP / Travel Health Clinic","Healthcare Provider","Vaccination and health advice. Yellow fever cert and malaria prophylaxis essential","M","H","Neutral","Supportive","In-person/Phone","Pre-departure only","Primary Traveller","Yellow fever certificate, malaria prophylaxis, fitness to travel"
"S009","Emergency Contact (UK)","Individual","Family/friend. Notified of itinerary. Point of contact if traveller cannot be reached","M","H","Supportive","Champion","Phone/WhatsApp","Emergency + weekly check-in","Primary Traveller","Holds copy of all documents and itinerary"` : `"S001","Primary Traveller","Individual","Trip participant and decision-maker","H","H","Champion","Champion","Direct","Daily","Self","Full ownership"
"S002","Travel Agent / Booking Platform","Service Provider","Manages bookings","M","L","Supportive","Supportive","Email/Phone","As needed","Primary Traveller","Booking confirmation"
"S003","Airline","Service Provider","Core transport provider","H","L","Neutral","Neutral","App/Email","Booking and check-in","Primary Traveller","Flight bookings"
"S004","Accommodation Provider","Service Provider","Lodging at destination","M","H","Neutral","Supportive","Email/App","Pre-arrival","Primary Traveller","Safety and standards"
"S005","Travel Insurance Provider","Service Provider","Financial and medical protection","H","M","Neutral","Supportive","Phone/App","Claims","Primary Traveller","Policy coverage"
"S006","Emergency Contact (UK)","Individual","Home contact for emergencies","M","H","Supportive","Champion","Phone/WhatsApp","Emergency","Primary Traveller","Holds itinerary copy"`) : `"S001","Project Sponsor","Internal","Provides funding and strategic direction. Ultimate decision-maker and phase gate approver","H","H","Supportive","Champion","Meeting/Email","Weekly","PM","Budget approval, strategic direction, phase gate sign-off"
"S002","Project Manager (AI Agent)","Internal","Day-to-day project management delivery and reporting","H","H","Champion","Champion","All channels","Daily","Self","All project delivery and stakeholder management"
"S003","Delivery Team","Internal","Responsible for delivering project outputs to agreed quality","M","H","Supportive","Champion","Stand-up/Tools","Daily","PM","Task completion, quality, accurate estimation"
"S004","End Users / Clients","External","Will use or be directly affected by project outputs","M","H","Neutral","Supportive","Demo/Review","Bi-weekly","PM","Requirements validation, UAT participation, final acceptance"
"S005","Finance Department","Internal","Budget control, financial reporting, and payment approvals","H","M","Neutral","Supportive","Report/Meeting","Monthly","PM","Budget approval, actual cost tracking, variance authorisation"
"S006","External Suppliers","External","Provide contracted services or materials to the project","M","M","Neutral","Supportive","Email/Meeting","As needed","PM","On-time delivery, quality of contracted outputs"`;
      dataInstructions = `Use these exact data rows:\n${stRows}\nQuote fields containing commas.`;
    } else if (lname.includes("budget") || lname.includes("cost management")) {
      let budgetRows = "";
      if (isTravel && budget > 0) {
        const flights = Math.round(budget * 0.35);
        const accomm = Math.round(budget * 0.25);
        const transfers = Math.round(budget * 0.10);
        const meals = Math.round(budget * 0.12);
        const activities = Math.round(budget * 0.08);
        const health = Math.round(budget * 0.04);
        const contingency = budget - flights - accomm - transfers - meals - activities - health;
        budgetRows = `"Flights","Return flights to Lagos (LHR→LOS or LHR→ABV)","${flights}","0","${-flights}","0","${Math.round(flights/budget*100)}","Not Booked","Book 8+ weeks in advance for best fares"
"Accommodation","Hotel in Lagos — Victoria Island or Ikoyi (min 3-star with generator)","${accomm}","0","${-accomm}","0","${Math.round(accomm/budget*100)}","Not Booked","Confirm generator backup and location"
"Transfers","Airport transfer and local transport (Bolt/Uber in city)","${transfers}","0","${-transfers}","0","${Math.round(transfers/budget*100)}","Not Arranged","Pre-arrange MMIA airport pickup"
"Meals & Dining","All meals and drinks for trip duration","${meals}","0","${-meals}","0","${Math.round(meals/budget*100)}","Not Started","Mix of hotel restaurant and local dining"
"Activities","Excursions and activities (Lagos Island, Nike Art Gallery, Lekki Conservation)","${activities}","0","${-activities}","0","${Math.round(activities/budget*100)}","Not Booked","Book popular venues in advance"
"Health & Vaccinations","Yellow fever, malaria prophylaxis, travel health kit and GP appointments","${health}","0","${-health}","0","${Math.round(health/budget*100)}","Not Started","PRIORITY — book GP appointment this week"
"Documentation & Insurance","Travel insurance, visa fees, FCDO registration","0","0","0","0","0","Pending","Research visa requirements for UK passport"
"Contingency Reserve","Emergency reserve — requires PM approval to release","${contingency}","0","${-contingency}","0","${Math.round(contingency/budget*100)}","Reserved","Not to be used without explicit approval"`;
      } else {
        budgetRows = `"Labour","Project team time and effort","[per resource plan]","0","0","0","0","On Budget","See Resource Management Plan"
"External Services","Contracted external services","[as per contracts]","0","0","0","0","On Budget","Procurement per schedule"
"Materials & Equipment","Physical materials and equipment","[as specified]","0","0","0","0","On Budget","See WBS"
"Travel & Expenses","Project-related travel and expenses","[estimate]","0","0","0","0","On Budget","Approved per policy"
"Contingency Reserve","10-15% of total budget — requires PM approval","[reserve]","0","0","0","0","Reserved","Not to be used without approval"`;
      }
      dataInstructions = `Use these exact data rows (costs in £):\n${budgetRows}\nQuote fields containing commas. Ensure Planned Cost column values sum to approximately ${budgetStr}.`;
    } else {
      dataInstructions = `Generate 8-15 relevant data rows specific to this project (${project.name}).
Use real dates between ${startDate} and ${endDate}.
Assign each row to a named owner or role.
Set Status fields realistically based on today's date ${today}.
Quote fields containing commas.`;
    }

    return `## ARTEFACT: ${name}
Output ONLY a CSV. Header row (use exactly these columns):
${headerRow}
Then add data rows — ${dataInstructions}
RULES: comma-separated, quote any field containing a comma with double-quotes, NO markdown, NO extra text, NO explanatory notes — ONLY the header row followed immediately by data rows.`;
  }).join("\n\n");

  return `You are an AI Project Manager generating structured spreadsheet data for a project.
TODAY'S DATE: ${today}

PROJECT: ${project.name}
DESCRIPTION: ${project.description || "No description provided"}
BUDGET: £${budgetStr}
TIMELINE: ${startDate} to ${endDate}
CATEGORY: ${category}
METHODOLOGY: ${methodologyName}
PHASE: ${phaseName}
${isTravel ? `\nTRAVEL PROJECT: Use travel-specific terminology. Real destination-specific tasks and risks.` : ""}
${isNigeria ? `DESTINATION: Nigeria / Lagos — include yellow fever requirements, malaria, NGN currency, FCO advisory, connectivity, safety.` : ""}

Generate the following artefacts as CSV data. Each must be SPECIFIC to this project.
Start each with "## ARTEFACT: <name>" on its own line, then output the CSV immediately — no other text.

${artefactInstructions}`;
}

function buildArtefactPrompt(project: any, phaseName: string, artefactNames: string[], methodologyName: string): string {
  const category = (project.category || "other").toLowerCase();
  const isTravel = category === "travel" || (project.name || "").toLowerCase().includes("trip") || (project.name || "").toLowerCase().includes("holiday");
  const isNigeria = (project.name || "").toLowerCase().includes("nigeria") || (project.name || "").toLowerCase().includes("lagos");

  const today = new Date().toLocaleDateString("en-GB");
  const startDt = project.startDate ? new Date(project.startDate) : null;
  const endDt = project.endDate ? new Date(project.endDate) : null;
  const daysRemaining = endDt ? Math.ceil((endDt.getTime() - Date.now()) / 86_400_000) : null;
  const totalDays = (startDt && endDt) ? Math.ceil((endDt.getTime() - startDt.getTime()) / 86_400_000) : null;
  const budget = (project.budget || 0).toLocaleString();

  const domainContext = isTravel
    ? `TRAVEL PROJECT: Frame ALL documents in travel PM terms — itinerary, bookings, logistics, visa/health requirements, safety planning, destination-specific risks. Do NOT use software development language.`
    : "";

  const destinationContext = isNigeria
    ? `DESTINATION — NIGERIA / LAGOS. Include these specifics in ALL relevant documents:
FCO Travel Advisory: currently advises high vigilance in Lagos.
Yellow Fever Vaccination Certificate: MANDATORY for entry.
Malaria prophylaxis: REQUIRED (Doxycycline or Malarone).
Currency: Nigerian Naira (NGN). Take mixed GBP cash + USD + cards.
Local transport: Bolt and Uber recommended. Safe areas: Victoria Island, Ikoyi, Lekki.
Emergency: British High Commission Lagos: +234 (0)1 277-0780`
    : "";

  const artefactSections = artefactNames.map(n => {
    const guidance = getArtefactGuidance(n, project, isTravel, isNigeria, today);
    return `## ARTEFACT: ${n}\n${guidance}`;
  }).join("\n\n");

  return `You are a senior AI Project Manager producing enterprise-grade project management documents.

TODAY: ${today} | PHASE: ${phaseName} | PROJECT: ${project.name}
METHODOLOGY: ${methodologyName} | BUDGET: £${budget}
DURATION: ${startDt ? startDt.toLocaleDateString("en-GB") : "TBD"} → ${endDt ? endDt.toLocaleDateString("en-GB") : "TBD"}${totalDays ? ` (${totalDays} days)` : ""}${daysRemaining !== null ? ` · ${daysRemaining} days remaining` : ""}
DESCRIPTION: ${project.description || "No description provided"}
${domainContext ? `\n${domainContext}` : ""}${destinationContext ? `\n${destinationContext}` : ""}

━━━ OUTPUT FORMAT — CRITICAL ━━━
You MUST output clean HTML only. Zero markdown. Zero exceptions.

REQUIRED HTML ELEMENTS:
• Headings: <h2> for document title, <h3> for major sections, <h4> for sub-sections
• Paragraphs: <p> for all body text
• Tables: <table><thead><tr><th>...</th></tr></thead><tbody><tr><td>...</td></tr></tbody></table>
• Lists: <ul><li> for bullets, <ol><li> for numbered
• Bold labels: <strong>label:</strong> followed by text
• Status indicators: use text labels — ON TRACK / AT RISK / DELAYED (no emoji in tables)
• Horizontal rules: <hr> to separate major sections

DO NOT USE: # ## ### * ** __ - for bullets → `• ` in text or <li> | (pipe) for tables → use <table>
Any asterisk, hash, or pipe character in prose output = FAILURE.

━━━ DOCUMENT STANDARDS ━━━
1. SPECIFIC — use "${project.name}", actual dates, actual budget £${budget}
2. OWNED — every action, risk, and deliverable has a named owner or role
3. CURRENT — as at ${today}; pre-start items = "Not Started", with realistic % complete
4. COMPLETE — no placeholders, no "[insert here]", no truncation
5. PROFESSIONAL — British English (colour, organisation, prioritise, authorise)
6. Each document ends with an <h3>Agent Monitoring Protocol</h3> section

━━━ DOCUMENT CONTROL HEADER (use this exact structure for every document) ━━━
<table>
  <thead><tr><th>Field</th><th>Detail</th></tr></thead>
  <tbody>
    <tr><td><strong>Document</strong></td><td>[Document Name]</td></tr>
    <tr><td><strong>Project</strong></td><td>${project.name}</td></tr>
    <tr><td><strong>Version</strong></td><td>1.0</td></tr>
    <tr><td><strong>Date</strong></td><td>${today}</td></tr>
    <tr><td><strong>Status</strong></td><td>DRAFT — Awaiting Approval</td></tr>
    <tr><td><strong>Owner</strong></td><td>[Role]</td></tr>
    <tr><td><strong>Methodology</strong></td><td>${methodologyName}</td></tr>
  </tbody>
</table>

━━━ ARTEFACTS TO GENERATE ━━━
${artefactSections}

━━━ SEPARATOR RULE ━━━
Start each artefact with exactly "## ARTEFACT: <name>" on its own line (this line only may use ##).
Everything inside the artefact body must be HTML. No preamble or commentary between artefacts.`;
}

// ─── Per-artefact structural guidance ───

function getArtefactGuidance(name: string, project: any, isTravel: boolean, isNigeria: boolean, today: string): string {
  const n = name.toLowerCase().replace(/[^a-z ]/g, "").trim();
  const startDate = project.startDate ? new Date(project.startDate).toLocaleDateString("en-GB") : "TBD";
  const endDate = project.endDate ? new Date(project.endDate).toLocaleDateString("en-GB") : "TBD";
  const budget = (project.budget || 0).toLocaleString();

  const agentProtocol = (docType: string) => `
## Agent Progress Tracking Protocol
This document is maintained as a **living artefact** by the AI agent. Updates occur when:
- Progress is reported via the project chat interface
- Scheduled review intervals are reached (see below)
- An exception or threshold breach is detected

**Update triggers for ${docType}:**
- Status fields updated immediately when progress is reported
- RAG (🟢/🟡/🔴) recalculated at each review
- Deviations beyond threshold trigger an Exception Report and escalation
- All changes logged with date and reason in the Document Control section`;

  // ── Project Brief ──
  if (n.includes("project brief")) {
    return `Generate a specific **Project Brief** for ${project.name}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Project Brief |
| Project | ${project.name} |
| Version | 1.0 DRAFT |
| Date | ${today} |
| Status | Draft — Awaiting Sponsor Review |
| Owner | Project Manager |
| Next Review | [Phase Gate 1] |

## Project Overview
| Field | Detail |
|-------|--------|
| Project Name | ${project.name} |
| Sponsor | [Name / TBC] |
| Project Manager | AI Agent (supervised) |
| Start Date | ${startDate} |
| Target End Date | ${endDate} |
| Total Budget | £${budget} |
| Category | ${project.category || "General"} |
| Methodology | [methodology] |
| Current Phase | Pre-Project / Requirements |
| Overall Status | 🟢 Initiated |

## Purpose and Background
[Specific to ${project.name} — what is this project and why is it happening?]
${project.description ? `\n${project.description}` : ""}

## Objectives (SMART)
| # | Objective | Success Measure | Target Date | Owner | Status |
|---|-----------|----------------|-------------|-------|--------|
[3–5 SMART objectives specific to this project]

## Scope
**In Scope:**
[Bullet list — what IS included in this project, specific to ${project.name}]

**Out of Scope:**
[Explicit exclusions — what this project will NOT deliver]

## Key Deliverables
| # | Deliverable | Acceptance Criteria | Due Date | Owner | Status |
|---|-------------|-------------------|----------|-------|--------|
[All deliverables with specific, measurable acceptance criteria]

## Constraints
[Legal, time, budget £${budget}, resource, and other constraints specific to this project]

## Assumptions
[What we are assuming to be true for this project to succeed]

## Dependencies
[What this project depends on — internal and external]

## Key Stakeholders
| Name / Role | Interest | Influence | Engagement Required |
[Top 5 stakeholders — see Stakeholder Register for full list]

## Risks (Summary)
| Top Risk | Likelihood | Impact | Initial Mitigation |
[Top 3 risks — see Risk Register for full list]
${agentProtocol("Project Brief")}`;
  }

  // ── Outline Business Case ──
  if (n.includes("outline business case")) {
    return `Generate a concise **Outline Business Case** for ${project.name}. This is the LIGHTWEIGHT go/no-go document — maximum 2 pages. Do NOT expand it into a full Business Case.

## Document Control
| Field | Value |
|-------|-------|
| Document | Outline Business Case |
| Project | ${project.name} |
| Version | 1.0 DRAFT |
| Date | ${today} |
| Status | Draft — Awaiting Sponsor Approval |
| Decision Required | Go / No-Go to proceed to ${isTravel ? "full planning" : "Initiation phase"} |

## 1. Executive Summary
One paragraph: what the project is, why it is being pursued, and the recommendation.

## 2. Strategic Rationale
Why is this project worth doing? What problem or opportunity does it address?
${isTravel ? `\nFor this travel project: personal objectives, opportunity, timing rationale.` : ""}

## 3. Options Considered
| Option | Description | Estimated Cost | Key Benefit | Key Risk | Recommended? |
|--------|-------------|---------------|-------------|----------|-------------|
| Do Nothing | Status quo — do not proceed | £0 | None | Opportunity missed | ❌ No |
| Minimum Viable | [Scaled-down version] | £[lower] | [reduced benefit] | [higher risk] | [Y/N] |
| Full Scope (Recommended) | ${project.description || project.name} | £${budget} | [key benefit] | [key risk] | ✅ Yes |

## 4. Expected Benefits
[Bullet list of specific, measurable benefits — include £ value or quantified outcome where possible]

## 5. High-Level Cost Summary
| Category | Estimated Cost (£) | Notes |
|----------|--------------------|-------|
[Must total to approximately £${budget}]
| **TOTAL** | **£${budget}** | |

## 6. Top 3 Risks
| Risk | Likelihood | Impact | Initial Mitigation |
[Only the top 3 risks — full register developed in Phase 2]

## 7. Recommendation
**Decision: ✅ GO / ❌ NO-GO**
[One-sentence rationale. State conditions that must be met before proceeding.]

> ⚠️ Note: This is NOT the full Business Case. The full Business Case with NPV, ROI, and detailed analysis is produced in the next phase after this feasibility gate is approved.
${agentProtocol("Outline Business Case")}`;
  }

  // ── Requirements Specification ──
  if (n.includes("requirements specification") || n.includes("requirements spec")) {
    const travelCats = isTravel ? "Logistics, Documentation & Legal, Health & Safety, Accommodation, Activities & Itinerary, Financial, Contingency" : "Functional, Non-Functional, Data, Security, Performance, Compliance";
    const travelReqs = isNigeria ? `Must Have requirements to include:
- Return flights booked LHR ↔ LOS (or LHR ↔ ABV)
- Valid Nigerian visa obtained before departure
- Yellow fever vaccination certificate obtained (MANDATORY for entry)
- Malaria prophylaxis obtained and course started per GP advice
- Travel insurance secured — must include medical cover and repatriation
- Accommodation booked in safe area (Victoria Island, Ikoyi, or Lekki)
- Airport transfer arranged from MMIA
- FCDO TravelAware registration completed
- Emergency contacts briefed with full itinerary
- Local currency plan confirmed (NGN + GBP/USD cash + cards)` : "";
    return `Generate a **Requirements Specification** for ${project.name}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Requirements Specification |
| Project | ${project.name} |
| Version | 1.0 DRAFT |
| Date | ${today} |
| Status | Draft |

## Purpose
Define all requirements that the project must satisfy in order to be considered successfully delivered.

## Functional Requirements
| Req ID | Category | Requirement | Priority (MoSCoW) | Source | Acceptance Criteria | Status |
|--------|----------|-------------|------------------|--------|-------------------|--------|
[Categories: ${travelCats}. Minimum 15 requirements. Use Must/Should/Could/Won't priorities.
${travelReqs}]

## Non-Functional Requirements
Quality, performance, safety, compliance, and reliability requirements specific to this project.

## Constraints and Assumptions
[What constraints apply? What assumptions have been made?]

## Requirements Traceability Matrix
| Req ID | Requirement Summary | Source | Linked Deliverable | Verification Method | Status |
|--------|-------------------|--------|-------------------|-------------------|--------|
${agentProtocol("Requirements Specification")}`;
  }

  // ── Feasibility Study ──
  if (n.includes("feasibility")) {
    return `Generate a **Feasibility Study** for ${project.name}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Feasibility Study |
| Project | ${project.name} |
| Version | 1.0 DRAFT |
| Date | ${today} |
| Conclusion | VIABLE / NOT VIABLE / VIABLE WITH CONDITIONS |

## Study Purpose
Assess whether ${project.name} is technically, financially, operationally, and schedule-feasible within the stated constraints (budget: £${budget}, timeline: ${startDate} → ${endDate}).

## Feasibility Summary
| Area | Verdict | Key Finding | Action Required |
|------|---------|-------------|----------------|
| Technical | 🟢/🟡/🔴 | [key finding] | [action] |
| Financial | 🟢/🟡/🔴 | [key finding] | [action] |
| Operational | 🟢/🟡/🔴 | [key finding] | [action] |
| Schedule | 🟢/🟡/🔴 | [key finding] | [action] |
| Risk | 🟢/🟡/🔴 | [key finding] | [action] |

## Technical Feasibility
[Is the project technically achievable? What capabilities, tools, and expertise are required? Are they available?]
${isTravel ? `\nFor this travel project: visa processing feasibility, flight availability, accommodation availability in safe areas, health requirements achievability within timeline.` : ""}

## Financial Feasibility
[Is the project affordable within £${budget}? High-level cost-benefit assessment.]

| Cost Category | Estimate | Confidence | Notes |
|---------------|---------|------------|-------|
[All costs must sum to ≤ £${budget}]

## Operational Feasibility
[Can this be delivered? Capacity, capability, timing considerations.]

## Schedule Feasibility
[Is the ${startDate} → ${endDate} timeline achievable? What are the schedule risks?]
${isTravel && isNigeria ? `\nNote: Nigerian visa processing typically takes 3-6 weeks. Yellow fever vaccination requires GP appointment + 10 days minimum. These are on the critical path.` : ""}

## Risk Feasibility
[Are the risks at an acceptable level? Summary of the top 5 risks and whether they can be adequately mitigated.]

## Conclusion
**VERDICT: VIABLE / NOT VIABLE / VIABLE WITH CONDITIONS**

[State clearly whether the project should proceed and any conditions that must be met first.]
${agentProtocol("Feasibility Study")}`;
  }

  // ── Project Charter ──
  if (n.includes("project charter") || n === "charter") {
    return `Generate a **Project Charter** for ${project.name}. This is the formal document that authorises the project and grants the Project Manager authority.

## Document Control
| Field | Value |
|-------|-------|
| Document | Project Charter |
| Project | ${project.name} |
| Version | 1.0 DRAFT |
| Date | ${today} |
| Status | DRAFT — Awaiting Sponsor Signature |

## Project Authorisation
This charter formally authorises **${project.name}** and designates the AI Project Manager authority to apply project resources in accordance with this document.

| Field | Value |
|-------|-------|
| Project Name | ${project.name} |
| Project Sponsor | [Name — TBC] |
| Project Manager | AI Agent (supervised) |
| Authorisation Date | ${today} |
| Authorisation Status | DRAFT — Pending Sponsor Signature |
| Approved Budget | £${budget} |
| Start Date | ${startDate} |
| Target End Date | ${endDate} |

## Purpose and Justification
[Why is this project being initiated? What problem does it solve or opportunity does it capture?]

## Objectives (SMART)
| # | Objective | KPI | Target | Measurement |
|---|-----------|-----|--------|-------------|
[3–5 SMART objectives]

## High-Level Scope
**In Scope:** [specific deliverables and boundaries]
**Out of Scope:** [explicit exclusions]

## High-Level Milestone Plan
| Milestone | Target Date | Owner | Status |
|-----------|-------------|-------|--------|
[Key milestones between ${startDate} and ${endDate}]

## Approved Budget: £${budget}
| Category | Budget Allocation (£) | % of Total |
|----------|-----------------------|-----------|
[Budget breakdown by category]

## Top Risks
| Risk | Likelihood | Impact | Mitigation |
[Top 5 risks — full register in separate document]

## Project Organisation and Authority Levels
| Role | Name | Authority |
|------|------|-----------|
[Who can make what decisions]

## Approval and Signature
| Role | Name | Signature | Date |
|------|------|-----------|------|
| Project Sponsor | [Name] | _______________ | ________ |
| Project Manager | AI Agent | [Digital auth] | ${today} |
${agentProtocol("Project Charter")}`;
  }

  // ── Business Case (full) ──
  if (n.includes("business case") && !n.includes("outline")) {
    return `Generate a **full Business Case** for ${project.name}. This is the detailed document produced AFTER feasibility is confirmed. It must justify the investment of £${budget}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Business Case |
| Version | 1.0 DRAFT |
| Date | ${today} |
| Status | Draft — Awaiting Approval |

## Executive Summary
[One page — what the project is, why it is recommended, key financial metrics, risk level, and decision required]

## Strategic Context
[Why this project is necessary and how it aligns with strategic or personal goals]

## Options Analysis
| Option | Description | Total Cost | NPV/Value | Key Benefit | Key Risk | Recommended? |
|--------|-------------|-----------|---------|-------------|----------|-------------|
| 0 — Do Nothing | No action taken | £0 | [negative] | None | Opportunity lost | ❌ |
| 1 — Minimum | [Scaled-down version] | £[lower] | [value] | [benefit] | [risk] | Consider |
| 2 — Full Scope (Recommended) | ${project.description || project.name} | £${budget} | [value] | [main benefit] | [main risk] | ✅ |

## Financial Analysis
| Cost Category | Planned (£) | Actual (£) | Variance (£) | Notes |
[Detailed cost breakdown totalling £${budget}]

| Benefit | How Measured | Year 1 Value | Total Value |
[Quantify all benefits where possible]

**Financial Summary:**
- Total Investment: £${budget}
- Expected Return / Value: [£ or qualitative]
- Payback Period: [months/years]
- ROI / Benefit-Cost Ratio: [ratio]

## Non-Financial Benefits
[Qualitative benefits and how each will be measured or evidenced]

## Sensitivity Analysis
[What assumptions is this business case most sensitive to? What if key costs are 20% higher?]

## Risks and Assumptions
[Top 5 risks; full register in separate document]

## Recommendation
**RECOMMENDATION: ✅ PROCEED with Option 2 — Full Scope**
[Conditions, approvals required, and next steps]
${agentProtocol("Business Case")}`;
  }

  // ── Stakeholder Register ──
  if (n.includes("stakeholder register") || n.includes("initial stakeholder")) {
    const stakeholderTypes = isTravel
      ? "traveller, travel agent/booking platform, airline(s), accommodation provider(s), host contact in destination, emergency contact(s) at home, travel insurance provider, relevant high commission or embassy, health/vaccination provider, tour operators or activity providers"
      : "project sponsor, project manager, delivery team(s), end users/clients, IT/infrastructure, procurement, finance, external suppliers/vendors, regulatory/compliance bodies";
    return `Generate a **Stakeholder Register** for ${project.name}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Stakeholder Register |
| Version | 1.0 DRAFT |
| Date | ${today} |
| Total Stakeholders | [count] |

## Analysis Summary
| Quadrant | Stakeholders | Key Engagement Risk |
|----------|-------------|-------------------|
| Manage Closely (High Power, High Interest) | [names] | [risk] |
| Keep Satisfied (High Power, Low Interest) | [names] | [risk] |
| Keep Informed (Low Power, High Interest) | [names] | [risk] |
| Monitor (Low Power, Low Interest) | [names] | [risk] |

## Stakeholder Register
| ID | Name / Role | Organisation | Stake | Power | Interest | Current Engagement | Target Engagement | Channel | Frequency | Owner | Concerns |
|----|------------|-------------|-------|-------|---------|-------------------|------------------|---------|-----------|-------|---------|
[Identify ALL relevant stakeholders for this project. Types include: ${stakeholderTypes}]

## Engagement Strategies
For each "Manage Closely" stakeholder: specific 2–3 sentence engagement approach with named owner.

## Communication Schedule
| Stakeholder | Information Required | By When | Channel | Owner | Status |
${agentProtocol("Stakeholder Register")}`;
  }

  // ── Communication Plan ──
  if (n.includes("communication plan") || n.includes("communications plan")) {
    return `Generate a **Communication Plan** for ${project.name}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Communication Plan |
| Version | 1.0 DRAFT |
| Date | ${today} |

## Communication Objectives
[What the communication plan aims to achieve for ${project.name}]

## Communication Matrix
| # | Audience | Information / Message | Purpose | Channel | Format | Frequency | Owner | Timing |
|---|---------|----------------------|---------|---------|--------|-----------|-------|--------|
[Be specific: who gets what, when, how, from whom. Cover all stakeholders.]

## Escalation Path
| Trigger / Situation | Escalate To | Timeframe | Method | Expected Outcome |
|---------------------|------------|-----------|--------|----------------|
[Define what triggers escalation and to whom]

## Communication Calendar
| Date / Period | Event | Audience | Channel | Owner | Status |
[Map out the full communication schedule from ${startDate} to ${endDate}]

## Agent Communication Responsibilities
The AI agent will:
- Send scheduled status updates per the matrix above
- Generate and distribute Exception Reports when thresholds are breached
- Log all communications in the project activity feed
- Flag overdue communications for human follow-up
- Update stakeholder engagement status when responses are received
${agentProtocol("Communication Plan")}`;
  }

  // ── Risk Management Plan ──
  if (n.includes("risk management plan")) {
    return `Generate a **Risk Management Plan** for ${project.name}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Risk Management Plan |
| Version | 1.0 DRAFT |
| Date | ${today} |

## Risk Management Approach
Describe the methodology, tools, and processes for identifying, assessing, and managing risks on ${project.name}.

## Risk Appetite Statement
[What level of risk is acceptable for this project? Define specific thresholds.]

## Risk Categories
| Category | Description | Examples for This Project |
[List all applicable risk categories with project-specific examples]

## Probability and Impact Scales
| Score | Probability | Meaning | Impact | Meaning |
|-------|------------|---------|--------|---------|
| 1 | Very Low | <10% chance | Very Low | Negligible effect |
| 2 | Low | 10-30% | Low | Minor disruption |
| 3 | Medium | 30-50% | Medium | Significant disruption |
| 4 | High | 50-70% | High | Major impact on time/cost/quality |
| 5 | Very High | >70% | Very High | Project failure / safety risk |

## Risk Response Strategies
| Strategy | When to Use | Example for This Project |
|----------|------------|--------------------------|
| Avoid | Eliminate root cause | [example] |
| Transfer | Shift to third party | [example] |
| Mitigate | Reduce probability or impact | [example] |
| Accept | Tolerate residual risk | [example] |

## Risk Thresholds and Escalation
| Score | Rating | Required Action | Approver | Timeframe |
|-------|--------|----------------|----------|-----------|
| 1–5 | LOW | Monitor | PM | Monthly review |
| 6–10 | MEDIUM | Active mitigation | PM | Bi-weekly review |
| 11–19 | HIGH | Escalate + mitigation plan | Sponsor | Weekly review |
| 20–25 | CRITICAL | Immediate escalation | Sponsor + Board | Immediate |

## Review Schedule
| Review Type | Trigger / Frequency | Participants | Output |
[Define when risks are reviewed]

## Roles and Responsibilities
| Role | Risk Management Responsibility |
[PM, sponsor, risk owners, team members]
${agentProtocol("Risk Management Plan")}`;
  }

  // ── Quality Plan / Quality Management Plan ──
  if (n.includes("quality")) {
    return `Generate a **Quality Management Plan** for ${project.name}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Quality Management Plan |
| Version | 1.0 DRAFT |
| Date | ${today} |

## Quality Objectives
[Specific, measurable quality targets for ${project.name}]

## Quality Standards
[What standards must be met — regulatory, client, internal, industry-specific]

## Quality Assurance Activities
| Activity | Purpose | When | Owner | Method | Status |
|----------|---------|------|-------|--------|--------|
[Proactive activities to ensure quality is built in]

## Quality Control Activities
| Deliverable | Acceptance Criteria | Review Method | Reviewer | Sign-Off Required | Scheduled Date |
|-------------|-------------------|---------------|----------|-------------------|---------------|
[For every key deliverable — what does "good" look like and how is it verified]

## Defect / Issue Management
[How issues are identified, logged, prioritised, resolved, and closed]

## Quality Metrics
| Metric | Target | Current Value | Status | Measurement Method | Review Frequency |
${agentProtocol("Quality Management Plan")}`;
  }

  // ── Resource Plan / Resource Management Plan ──
  if (n.includes("resource plan") || n.includes("resource management")) {
    return `Generate a **Resource Management Plan** for ${project.name}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Resource Management Plan |
| Version | 1.0 DRAFT |
| Date | ${today} |

## Resource Summary
| Resource Type | Total Required | Available | Gap | Mitigation |
[Summary of all resource requirements]

## Resource Requirements
| Role | Name / TBD | Skills Required | Allocation % | Start Date | End Date | Source | Cost (£/day) | Status |
|------|-----------|----------------|-------------|------------|----------|--------|-------------|--------|
[All resources needed to deliver ${project.name}]

## RACI Matrix
| Deliverable / Task | [Role 1] | [Role 2] | [Role 3] | [Role 4] | Notes |
[R=Responsible, A=Accountable, C=Consulted, I=Informed. Cover all key deliverables.]

## Resource Calendar
| Resource | ${startDate} | [+1 week] | [+2 weeks] | ... | Notes |
[Show availability and allocation across the project timeline]

## Procurement Requirements
[Any external resources, services, or contractors that must be procured]

## Resource Risks
| Risk | Affected Resource | Mitigation | Contingency |
${agentProtocol("Resource Management Plan")}`;
  }

  // ── Change Control Plan ──
  if (n.includes("change control")) {
    return `Generate a **Change Control Plan** for ${project.name}.

## Document Control
| Field | Value |
|-------|-------|
| Document | Change Control Plan |
| Version | 1.0 DRAFT |
| Date | ${today} |

## Purpose
[Why change control is necessary and how it protects ${project.name}'s baseline]

## Change Request Process
Step-by-step process from identification to implementation:
1. [Step 1 — Identify and document]
2. [Step 2 — Impact assessment]
3. [Step 3 — Submission to authority]
4. [Step 4 — Decision: Approve / Reject / Defer]
5. [Step 5 — Update baselines if approved]
6. [Step 6 — Communicate and implement]

## Change Authority Levels
| Change Type | Estimated Impact | Authority Level | Approver | Decision Timeframe |
|-------------|----------------|----------------|----------|-------------------|
| Minor | ≤5% time or cost | PM | Project Manager | 2 business days |
| Moderate | 5-15% time or cost | Sponsor | Project Sponsor | 5 business days |
| Major | >15% or scope change | Board | Project Board | 10 business days |
| Emergency | Safety/critical | Sponsor | Sponsor immediate | Same day |

## Change Log
| CR ID | Date | Requestor | Description | Impact | Decision | Approver | Date Closed | Status |
[Start with empty log — to be populated as changes arise]

## Agent Role in Change Control
The AI agent automatically raises change requests when:
- Schedule variance exceeds 10% of remaining duration
- Cost variance exceeds 10% of remaining budget
- A new scope requirement is identified in chat
- A risk score increases above HIGH threshold
All automatic CRs require human review before implementation.
${agentProtocol("Change Control Plan")}`;
  }

  // ── Design Document (travel-specific becomes Detailed Trip Plan) ──
  if (n.includes("design document") || n === "design doc") {
    if (isTravel) {
      return `Generate a **Detailed Trip Plan** for ${project.name}. For this travel project the "Design Document" is the master planning document covering the full itinerary, logistics, and operational design.

## Document Control
| Field | Value |
|-------|-------|
| Document | Detailed Trip Plan |
| Project | ${project.name} |
| Version | 1.0 DRAFT |
| Date | ${today} |
| Status | Draft — Planning in Progress |

## Trip Overview
| Field | Detail |
[Destination, dates, duration, purpose, total budget £${budget}, traveller(s)]

## Day-by-Day Itinerary
| Day | Date | Morning | Afternoon | Evening | Accommodation | Meals | Transport | Notes |
[Cover every day from ${startDate} to ${endDate}. Be specific — named venues, activities, logistics.]

## Logistics Plan
| Component | Details | Provider | Cost (£) | Booked? | Confirmation # |
| Outbound flight | [details] | [airline] | [cost] | ❌ No | — |
| Return flight | [details] | [airline] | [cost] | ❌ No | — |
| Accommodation | [hotel name, area] | [provider] | [cost/night] | ❌ No | — |
| Airport transfer | [MMIA → hotel] | [provider] | [cost] | ❌ No | — |
${isNigeria ? `| Local SIM card | Airtel or MTN — purchase on arrival at airport | Local telco | £10–15 | ❌ No | — |\n| Yellow fever cert | GP appointment required | GP/Travel clinic | £[cost] | ❌ No | — |` : ""}

## Budget Allocation by Day
| Date | Accommodation (£) | Meals (£) | Transport (£) | Activities (£) | Misc (£) | Daily Total (£) |
[Cover each day. Total must equal £${budget}]

## Health & Safety Plan
${isNigeria ? `| Requirement | Details | Status | Deadline |\n|-------------|---------|--------|----------|\n| Yellow fever vaccination | Mandatory for entry — no exceptions | ❌ Not done | ASAP — book GP |\n| Malaria prophylaxis | GP prescription required — Doxycycline or Malarone | ❌ Not done | 6 weeks before travel |\n| Travel insurance | Medical + repatriation cover essential | ❌ Not done | Before booking |\n| FCDO TravelAware registration | Register trip for emergency support | ❌ Not done | Before departure |\n| Emergency contacts | British High Commission Lagos: +234 (0)1 277-0780 | ✅ Noted | — |` : "[Health and safety requirements specific to destination]"}

## Communication Design
How the traveller stays connected and maintains emergency communications.
${agentProtocol("Detailed Trip Plan")}`;
    }
    return `Generate a **Design Document** for ${project.name}.

## Document Control
| Version | 1.0 DRAFT | Date | ${today} | Status | Draft |

## Solution Overview
[High-level description of the proposed solution or approach for ${project.name}]

## Design Decisions
| Decision Area | Options Considered | Selected Approach | Rationale | Owner | Date |
[Key design decisions with full rationale]

## Detailed Specifications
[Detailed specifications for each component or deliverable — specific to this project]

## Interface and Integration Design
[How components interact; dependencies on external systems or services]

## Constraints and Assumptions
[Design constraints and critical assumptions]
${agentProtocol("Design Document")}`;
  }

  // ── Work Breakdown Structure ──
  if (n.includes("work breakdown") || n === "wbs") {
    return `Generate a **Work Breakdown Structure** for ${project.name}.

## Document Control
| Version | 1.0 DRAFT | Date | ${today} | Status | Draft |

## WBS Summary
Total deliverables: [count] | Work packages: [count] | Project: ${project.name}

## WBS Hierarchy
| WBS Code | Deliverable / Work Package | Parent | Description | Owner | Est. Duration | Planned Start | Planned End | Dependencies | % Complete | Status |
|----------|--------------------------|--------|-------------|-------|--------------|--------------|-------------|-------------|-----------|--------|
| 1.0 | ${project.name} | — | Total project | PM | [total] | ${startDate} | ${endDate} | — | 0% | Not Started |
[Decompose to Level 3 or 4. Each Level 3 package should be 1–2 weeks of effort or a discrete deliverable.]

## Work Package Descriptions
For each Level 2 deliverable:
### [1.1 — Name]
- Description:
- Key deliverables:
- Acceptance criteria:
- Owner:
- Estimated cost: £
- Estimated duration:
- Dependencies:
${agentProtocol("Work Breakdown Structure")}`;
  }

  // ── Status Reports ──
  if (n.includes("status report")) {
    return `Generate an initial **Status Report** template for ${project.name}, pre-populated for the current state as at ${today}.

## Status Report #1 — ${today}
**Project:** ${project.name} | **Phase:** [Current Phase] | **Reporting Period:** [dates]

## Overall Status
| Dimension | Status | Trend | Notes |
|-----------|--------|-------|-------|
| Schedule | 🟢 On Track | → | [comment] |
| Budget | 🟢 On Track | → | Committed: £0 of £${budget} |
| Quality | 🟢 On Track | → | No quality issues identified |
| Risks | 🟡 Monitoring | → | [X] open risks, [Y] high/critical |
| Stakeholders | 🟢 Engaged | → | Key stakeholders briefed |

## Progress This Period
[What was accomplished since last report — specific tasks completed]

## Planned Next Period
[What is planned for the next reporting period — specific tasks and milestones]

## Issues and Exceptions
| Issue ID | Description | Impact | Owner | Resolution | Due Date |
[Any current issues requiring action]

## Risks (Top 3 This Period)
| Risk | Score | Status | Action |

## Decisions Required
| Decision | Owner | Deadline |
[Any decisions needed from sponsor/stakeholders]

## Budget Summary
| Budget | Committed | Actual Spent | Forecast EAC | Variance |
| £${budget} | £0 | £0 | £${budget} | £0 |
${agentProtocol("Status Reports")}`;
  }

  // ── Acceptance Certificate ──
  if (n.includes("acceptance certificate")) {
    return `Generate an **Acceptance Certificate** for ${project.name}.

## Project Acceptance Certificate
| Field | Value |
|-------|-------|
| Project | ${project.name} |
| Date of Acceptance | [TBC — to be completed at project close] |
| Project Manager | AI Agent (supervised) |
| Sponsor | [Name — TBC] |

## Deliverables Accepted
| # | Deliverable | Acceptance Criteria | Met? | Reviewer | Date | Notes |
[List all key deliverables and whether each acceptance criterion was met]

## Outstanding Items
[Any items not yet fully accepted — punch list with owners and deadlines]

## Sign-Off
I confirm that the deliverables listed above have been reviewed and meet the agreed acceptance criteria.

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Project Sponsor | [Name] | _______________ | ________ |
| Project Manager | AI Agent | [Digital] | ________ |
${agentProtocol("Acceptance Certificate")}`;
  }

  // ── End Project Report ──
  if (n.includes("end project report") || n.includes("end of project")) {
    return `Generate an **End Project Report** for ${project.name} (to be completed at close).

## End Project Report
**Project:** ${project.name} | **Date:** [Close Date] | **Status:** [Closed]

## Performance Against Baseline
| Dimension | Baseline | Actual | Variance | Assessment |
|-----------|---------|--------|---------|------------|
| Schedule | ${startDate} → ${endDate} | [actual dates] | [+/- days] | 🟢/🟡/🔴 |
| Budget | £${budget} | £[actual] | £[variance] | 🟢/🟡/🔴 |
| Scope | [baseline scope] | [delivered] | [changes] | 🟢/🟡/🔴 |
| Quality | [targets] | [achieved] | [gaps] | 🟢/🟡/🔴 |

## Benefits Realised
[Did the project deliver its expected benefits? Evidence?]

## Lessons Learned Summary
[Top 5 lessons — see full Lessons Learned document]

## Outstanding Risks/Issues
[Any residual risks or issues transferred to BAU/operations]

## Formal Closure
**Project ${project.name} is formally closed.** All deliverables accepted, lessons captured, resources released.
${agentProtocol("End Project Report")}`;
  }

  // ── Lessons Learned ──
  if (n.includes("lessons learned") || n.includes("lessons learnt")) {
    return `Generate a **Lessons Learned** document for ${project.name}.

## Lessons Learned Register
**Project:** ${project.name} | **Date:** ${today} | **Phase:** [All phases]

## What Went Well
| # | Area | What Worked | Recommendation for Future |
|---|------|-------------|--------------------------|
[Specific successes — what should be repeated on future projects?]

## What Could Be Improved
| # | Area | What Didn't Work | Root Cause | Recommendation |
|---|------|-----------------|------------|----------------|
[Honest reflection — what should be done differently?]

## Key Lessons by Phase
| Phase | Lesson | Recommendation | Priority |
[One or two key lessons from each phase of the project]

## Recommendations for Next Project
[Top 5 actionable recommendations for future projects of this type]
${agentProtocol("Lessons Learned")}`;
  }

  // ── Closure Report ──
  if (n.includes("closure report")) {
    return `Generate a **Closure Report** for ${project.name}.

## Project Closure Report
**Project:** ${project.name} | **Closure Date:** [TBC] | **Status:** CLOSED

## Project Summary
[Brief description of what was delivered and the overall outcome]

## Closure Confirmation Checklist
| Item | Status | Owner | Notes |
|------|--------|-------|-------|
| All deliverables formally accepted | ✅/❌ | PM | |
| Acceptance Certificate signed | ✅/❌ | Sponsor | |
| All contracts and POs closed | ✅/❌ | PM | |
| Resources released | ✅/❌ | PM | |
| Financial accounts closed | ✅/❌ | Finance | |
| All artefacts archived | ✅/❌ | PM | |
| Lessons Learned completed | ✅/❌ | PM | |
| Benefits handover arranged | ✅/❌ | Sponsor | |

## Financial Summary
| Budget | Actual Spend | Variance | % Under/Over |
| £${budget} | £[actual] | £[var] | [%] |

## Benefits Handover
[Who is responsible for realising ongoing benefits? How will they be tracked?]

## Formal Closure Statement
Project ${project.name} is hereby formally closed. All obligations have been met.

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Sponsor | [Name] | _______________ | ________ |
${agentProtocol("Closure Report")}`;
  }

  // ── Default for any other artefact ──
  return `Generate a complete, professional **${name}** for ${project.name}.

## Document Control
| Document | ${name} | Project | ${project.name} | Version | 1.0 DRAFT | Date | ${today} | Status | Draft |

## Required Content
This document must:
1. Be SPECIFIC to ${project.name} — actual dates between ${startDate} and ${endDate}, budget £${budget}, named stakeholders and owners
2. Include tables with Status (🟢/🟡/🔴 or Not Started/In Progress/Complete) wherever tasks, risks, or actions are listed
3. Assign a named owner or responsible role to every action, deliverable, or decision
4. Include a "Current Status as at ${today}" summary section
5. Use British English throughout

## Purpose and Scope
[What this document covers and why it is needed for ${project.name}]

## Main Content
[Produce the full, substantive content appropriate for a ${name}. Use tables, headings, and bullet points throughout.]

## Summary and Next Actions
| Action | Owner | Due Date | Status |
[Concrete next actions arising from this document]
${agentProtocol(name)}`;
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
