/**
 * Standalone artefact generator for the Lagos Nigeria trip project.
 * Uses direct pg (no Prisma) + Anthropic API.
 *
 * Run: DB_URL="..." ANTHROPIC_KEY="..." node scripts/fix-lagos-generate.mjs
 */

import pkg from 'pg';
import https from 'https';
const { Pool } = pkg;

// https.request wrapper that works around Windows Schannel CRL issue
function anthropicRequest(apiKey, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      rejectUnauthorized: false,  // bypass CRL check on Windows
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const PROJECT_ID = "cmnlcjhz30000v8j0jhqwqvaa";
const PHASE_NAME = "Pre-Project";

const dbUrl = (process.env.DATABASE_URL || process.env.DB_URL || '').replace(/^["']|["']$/g, '');
const apiKey = (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY || '').replace(/^["']|["']$/g, '');

if (!dbUrl) throw new Error("DATABASE_URL not set");
if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, max: 3 });

// ── Helpers ──────────────────────────────────────────────────────────────────

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(project, artefactNames) {
  const today = new Date().toLocaleDateString("en-GB");
  const budget = project.budget || 3500;
  const start = project.startDate ? new Date(project.startDate).toLocaleDateString("en-GB") : "20/05/2026";
  const end = project.endDate ? new Date(project.endDate).toLocaleDateString("en-GB") : "03/06/2026";
  const daysLeft = project.startDate
    ? Math.max(0, Math.ceil((new Date(project.startDate) - new Date()) / 86400000))
    : 43;

  const artefactSections = artefactNames.map(name => {
    return `## ARTEFACT: ${name}
${getGuidance(name, project.name, budget, start, end, today, daysLeft)}`;
  }).join("\n\n");

  return `You are an expert PRINCE2 project manager generating Pre-Project phase artefacts for a personal travel project.

PROJECT CONTEXT:
- Name: ${project.name}
- Category: Travel / Personal
- Budget: £${budget.toLocaleString()}
- Start: ${start}
- End: ${end}
- Today: ${today} (${daysLeft} days until departure)
- Description: ${project.description || 'Planning and management of a personal trip from the UK to Lagos, Nigeria, including flights, accommodation, visas, health preparation, and itinerary.'}

GENERATION RULES:
1. SPECIFIC — use actual project name, real dates between ${start} and ${end}, budget £${budget}
2. OWNED — every task/risk/action must have a named owner (Traveller, Project Manager, Agent, GP, etc.)
3. TRACKABLE — include Status (🟢/🟡/🔴), % Complete, Last Updated fields throughout
4. CURRENT — reference today (${today}) for "as at" status — tasks with planned start before today should show actual progress
5. ACTIONABLE — the AI agent must be able to read and know: current state, what next, who responsible
6. PROGRESS PROTOCOL — every document must end with "## Agent Progress Tracking Protocol" section
7. British English throughout (organisation, colour, prioritise, artefact)
8. NIGERIA-SPECIFIC — include: yellow fever certificate (MANDATORY for entry), malaria prophylaxis, FCO Travel Advisory HIGH for Lagos, Nigerian visa requirement (6+ weeks processing), NGN currency (Naira), Victoria Island/Ikoyi for accommodation, NEPA power outages, MMIA airport, British High Commission Lagos contact

For each artefact, begin with "## ARTEFACT: [exact name]" then the full content.

${artefactSections}`;
}

function getGuidance(name, projectName, budget, start, end, today, daysLeft) {
  const lname = name.toLowerCase();

  if (lname.includes("problem statement")) {
    return `Write a formal PRINCE2 Problem/Opportunity Statement document (800-1200 words).

Structure:
## Document Control
| Field | Value |
|---|---|
| Document Title | Problem Statement |
| Project | ${projectName} |
| Version | 1.0 |
| Status | DRAFT |
| Created | ${today} |
| Author | Project Manager / AI Agent |

## 1. Problem or Opportunity
Describe the opportunity of the Lagos Nigeria trip — reasons for travel, purpose (leisure, cultural, business networking, family), significance of visiting Lagos.

## 2. Situation As-Is
Current state: trip not yet booked, planning in early stages. Departure in ${daysLeft} days. Key uncertainties: visa status, flights, accommodation, health preparations.

## 3. Why Action is Needed
Time pressure: visa processing 6+ weeks, yellow fever vaccination required, flights booking up. Risk of inadequate preparation.

## 4. Constraints & Assumptions
- Budget: £${budget} total
- Dates fixed: ${start} to ${end}
- UK passport holder travelling from London
- Nigeria requires visa in advance (not on arrival)
- Yellow fever vaccination certificate MANDATORY — no exceptions at immigration

## 5. High-Level Objectives
List 5-7 SMART objectives for the trip.

## 6. Success Criteria
Measurable criteria — safe arrival/return, all bookings confirmed by [date], visa obtained, all health requirements met.

## 7. Scope
In scope / out of scope for this planning project.

## Agent Progress Tracking Protocol
This document is maintained as a living artefact by the AI agent. Updates occur when progress is reported via the project chat interface. Status fields are updated immediately when progress is reported. All changes logged with date and reason.`;
  }

  if (lname.includes("options analysis") || lname.includes("options appraisal")) {
    return `Write a formal Options Analysis / Options Appraisal document (900-1200 words).

Structure:
## Document Control
| Field | Value |
|---|---|
| Document Title | Options Analysis |
| Project | ${projectName} |
| Version | 1.0 |
| Status | DRAFT |
| Created | ${today} |

## 1. Introduction & Purpose
Purpose of this options analysis for the Lagos Nigeria trip.

## 2. Options Considered
Present 3-4 options, e.g.:
- Option 0: Do nothing (baseline)
- Option 1: Solo independent travel (direct flights, independent accommodation)
- Option 2: Package/guided trip through specialist Africa travel agent
- Option 3: Hybrid — book flights independently, use local fixer/guide in Lagos

## 3. Appraisal Criteria
Criteria: Cost (weight 30%), Safety (30%), Flexibility (20%), Experience Quality (20%)

## 4. Options Comparison Table
| Criterion | Weight | Option 0 | Option 1 | Option 2 | Option 3 |
Score each option against criteria.

## 5. Financial Comparison
Estimated costs for each option vs £${budget} budget.

## 6. Risk Profile Per Option
Key risks and mitigations for each.

## 7. Recommended Option
State recommendation with rationale. Reference FCO advice for Lagos.

## 8. Decision Record
| Decision | Date | Decided By | Notes |
|---|---|---|---|
| [Pending PM review] | ${today} | Project Manager | — |

## Agent Progress Tracking Protocol
Updated when PM selects preferred option and records decision. Decision status tracked until confirmed.`;
  }

  if (lname.includes("outline business case") || lname.includes("business case")) {
    return `Write a formal Outline Business Case document (900-1200 words).

Structure:
## Document Control
| Field | Value |
|---|---|
| Document Title | Outline Business Case |
| Project | ${projectName} |
| Version | 1.0 |
| Status | DRAFT |
| Created | ${today} |

## 1. Executive Summary
One-paragraph summary of the business case for the Lagos Nigeria trip.

## 2. Reasons (Strategic Alignment)
Why this trip, what value it delivers (cultural enrichment, networking, family, career, adventure).

## 3. Business Options
Reference Options Analysis. State preferred option.

## 4. Expected Benefits
| Benefit | Measure | Who Realises It | When |
At least 5 measurable benefits.

## 5. Expected Dis-benefits
Potential negatives: cost, time off work, health risks, etc.

## 6. Timescale
Key milestones with dates from ${today} to end of trip ${end}.

## 7. Costs
| Category | Estimated Cost (£) |
|---|---|
| Flights (return, LHR–LOS) | £[estimate] |
| Accommodation (${Math.ceil((new Date(end) - new Date(start)) / 86400000)} nights) | £[estimate] |
| Visa fees | £[estimate] |
| Travel insurance | £[estimate] |
| Health (vaccinations, prophylaxis) | £[estimate] |
| Ground transport | £[estimate] |
| Food & activities | £[estimate] |
| Contingency (15%) | £[estimate] |
| **TOTAL** | **£${budget}** |

## 8. Investment Appraisal
Value-for-money assessment. Cost per day, cost per key objective.

## 9. Major Risks
Top 3 risks with likelihood, impact, mitigation.

## 10. Recommendation
Proceed / Proceed with conditions / Do not proceed.

## Agent Progress Tracking Protocol
Updated when costs are confirmed and risk profile changes. Budget actuals tracked against plan. Agent will flag if actual spend exceeds any category by >10%.`;
  }

  if (lname.includes("project brief")) {
    return `Write a formal PRINCE2 Project Brief document (1000-1400 words).

Structure:
## Document Control
| Field | Value |
|---|---|
| Document Title | Project Brief |
| Project | ${projectName} |
| Version | 1.0 |
| Status | DRAFT |
| Created | ${today} |
| Author | Project Manager / AI Agent |

## 1. Project Definition
### 1.1 Background
Context of the Lagos Nigeria trip — who is travelling, from where, why, when.

### 1.2 Project Objectives
5-7 SMART objectives with measurable success criteria.

### 1.3 Desired Outcomes
What success looks like for each phase of the trip.

### 1.4 Project Scope
**In Scope:** [list]
**Out of Scope:** [list]

### 1.5 Constraints
- Budget: £${budget}
- Fixed dates: ${start} to ${end}
- Nigerian visa lead time: minimum 6 weeks
- Yellow fever certificate mandatory

### 1.6 Assumptions
List 5-8 planning assumptions.

## 2. Outline Business Case
Reference: see Outline Business Case document.
Summary: £${budget} for a ${Math.ceil((new Date(end) - new Date(start)) / 86400000)}-day trip to Lagos, Nigeria.

## 3. Project Approach
How the trip will be planned and executed. Tools: AI project agent, booking platforms, FCDO guidance.

## 4. Project Management Team
| Role | Name / Title | Responsibilities |
|---|---|---|
| Executive / Sponsor | Traveller | Decision making, funding approval |
| Project Manager | Traveller / AI Agent | Day-to-day planning, tracking |
| Supplier | Travel Agent / Booking platforms | Flight and hotel bookings |
| User | Traveller | Enjoying the trip! |

## 5. Quality Expectations
Standards for: accommodation (min 4★ in Victoria Island/Ikoyi), flights (reputable carrier), transfers (pre-arranged not street taxi).

## 6. Initial Risk Summary
| Risk | Rating | Mitigation |
|---|---|---|
| Visa delays | HIGH | Apply immediately — 8 weeks lead time |
| Yellow fever requirement | HIGH | GP appointment this week |
| Security in Lagos | HIGH | FCO advisory active — stay in safe zones |
| Budget overrun | MEDIUM | 15% contingency allocated |
| Health (malaria) | HIGH | Prophylaxis from GP |

## 7. Tolerances
- Budget: ±10% (£${Math.round(budget * 0.1)} contingency)
- Schedule: Dates fixed — cannot flex beyond ${start}/${end}
- Scope: Core itinerary protected; day trips flexible

## 8. Key Milestones
| Milestone | Target Date | Status |
|---|---|---|
| Project Brief approved | ${today} | 🟡 In Progress |
| Visa application submitted | [date — 8+ weeks before departure] | ⬜ Not Started |
| Yellow fever vaccination | [date — 10+ days before departure] | ⬜ Not Started |
| Flights booked | [date] | ⬜ Not Started |
| Accommodation confirmed | [date] | ⬜ Not Started |
| Travel insurance purchased | [date] | ⬜ Not Started |
| Departure | ${start} | ⬜ Not Started |
| Return | ${end} | ⬜ Not Started |

## 9. Approval
| Role | Name | Date | Signature |
|---|---|---|---|
| Project Executive | | | |
| Project Manager | | | |

## Agent Progress Tracking Protocol
This document is maintained as a living artefact by the AI agent.
**Milestone tracking:** Agent updates Status column when milestones are completed.
**Budget tracking:** Agent updates Outline Business Case costs when bookings are confirmed.
**Risk tracking:** Agent escalates any HIGH risks that become critical.
**Update triggers:**
- Milestone completion reported → Status updated to ✅ and date recorded
- New booking confirmed → Costs updated, budget variance calculated
- FCO advisory changes → Risk register updated, agent notifies PM
- ${daysLeft} days remaining — daily check-ins begin 2 weeks before departure`;
  }

  // Generic fallback
  return `Write a comprehensive ${name} document appropriate for a PRINCE2 Pre-Project phase for the ${projectName}.

Include:
- Document Control table (title, version, date, status, author)
- All standard sections for this document type
- Progress tracking fields (Status, % Complete, Last Updated, Owner, RAG where applicable)
- Nigeria/Lagos-specific content where relevant (yellow fever mandatory, visa requirements, FCO advisory, NGN currency, Victoria Island/Ikoyi area, MMIA airport, malaria risk)
- Agent Progress Tracking Protocol section at the end

The document should be 800-1200 words and immediately useful as a working project management document.`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const client = await pool.connect();
  try {
    // Get project
    const { rows: [project] } = await client.query(
      `SELECT id, name, methodology, budget, "startDate", "endDate", category, description FROM "Project" WHERE id = $1`,
      [PROJECT_ID]
    );
    if (!project) throw new Error(`Project ${PROJECT_ID} not found`);
    console.log(`Project: ${project.name} | ${project.methodology} | £${project.budget}`);

    // Get deployment
    const { rows: [deployment] } = await client.query(
      `SELECT id, "agentId" FROM "AgentDeployment" WHERE "projectId" = $1 AND "isActive" = true ORDER BY "deployedAt" DESC LIMIT 1`,
      [PROJECT_ID]
    );
    if (!deployment) throw new Error("No active deployment");
    console.log(`Deployment: ${deployment.id} | Agent: ${deployment.agentId}`);

    // Check existing artefacts
    const { rows: existing } = await client.query(
      `SELECT name FROM "AgentArtefact" WHERE "projectId" = $1 AND "agentId" = $2`,
      [PROJECT_ID, deployment.agentId]
    );
    const existingNames = new Set(existing.map(a => a.name.toLowerCase()));
    console.log(`Existing artefacts: ${existing.length}`);

    // PRINCE2 Pre-Project artefacts
    const allArtefacts = ["Problem Statement", "Options Analysis", "Outline Business Case", "Project Brief"];
    const toGenerate = allArtefacts.filter(n => !existingNames.has(n.toLowerCase()));

    if (toGenerate.length === 0) {
      console.log("All artefacts already exist — nothing to generate");
      return;
    }
    console.log(`\nTo generate: ${toGenerate.join(", ")}`);

    // Ensure phases exist
    const { rows: phaseRows } = await client.query(`SELECT id FROM "Phase" WHERE "projectId" = $1`, [PROJECT_ID]);
    if (phaseRows.length === 0) {
      console.log("Creating PRINCE2 phases...");
      const phases = [
        { name: "Pre-Project", order: 0, status: "ACTIVE" },
        { name: "Initiation", order: 1, status: "PENDING" },
        { name: "Delivery", order: 2, status: "PENDING" },
        { name: "Closure", order: 3, status: "PENDING" },
      ];
      for (const p of phases) {
        const phaseId = genId();
        await client.query(
          `INSERT INTO "Phase" (id, "projectId", name, "order", status, criteria, artefacts, "approvalReq") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [phaseId, PROJECT_ID, p.name, p.order, p.status, "Phase gate review", JSON.stringify([]), false]
        );
      }
      console.log("Phases created");

      // Update deployment
      await client.query(
        `UPDATE "AgentDeployment" SET "currentPhase" = $1, "phaseStatus" = 'active', "lastCycleAt" = NOW(), "nextCycleAt" = NOW() + INTERVAL '10 minutes' WHERE id = $2`,
        [PHASE_NAME, deployment.id]
      );
    }

    // Generate one at a time — Sonnet is slow; large batch requests time out on Windows TCP
    let totalGenerated = 0;

    for (let i = 0; i < toGenerate.length; i++) {
      const batch = [toGenerate[i]];
      console.log(`\nGenerating [${i + 1}/${toGenerate.length}]: ${batch[0]}`);

      const prompt = buildPrompt(project, batch);

      console.log(`  Prompt: ${prompt.length} chars`);
      const data = await anthropicRequest(apiKey, {
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });

      if (data.error) {
        console.error(`API error: ${JSON.stringify(data.error)}`);
        continue;
      }

      const text = (data.content?.[0]?.text || "").trim();
      console.log(`  Response: ${text.length} chars`);

      // Parse sections
      const sections = text.split(/^## ARTEFACT:\s*/im).filter(Boolean);
      console.log(`  Parsed ${sections.length} sections`);

      for (const section of sections) {
        const lines = section.trim().split("\n");
        const title = lines[0]?.trim().replace(/\*+/g, "").trim();
        const content = lines.slice(1).join("\n").trim();

        if (!title || content.length < 50) continue;

        // Match to expected name
        const matchingDef = allArtefacts.find(a =>
          title.toLowerCase().includes(a.toLowerCase()) ||
          a.toLowerCase().includes(title.toLowerCase().replace(/[^a-z ]/g, ""))
        );
        const artName = matchingDef || title;

        if (existingNames.has(artName.toLowerCase())) {
          console.log(`  Skipping duplicate: ${artName}`);
          continue;
        }

        const artId = genId();
        await client.query(
          `INSERT INTO "AgentArtefact" (id, "agentId", "projectId", name, format, content, status, version, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, 'markdown', $5, 'DRAFT', 1, NOW(), NOW())`,
          [artId, deployment.agentId, PROJECT_ID, artName, content]
        );
        existingNames.add(artName.toLowerCase());
        totalGenerated++;
        console.log(`  ✓ Saved: ${artName} (${content.split(/\s+/).length} words)`);
      }
    }

    // Log activity
    await client.query(
      `INSERT INTO "AgentActivity" (id, "agentId", type, summary) VALUES ($1, $2, 'document', $3)`,
      [genId(), deployment.agentId, `Pre-Project: ${totalGenerated} artefact(s) generated — ready for review`]
    );

    console.log(`\n✓ Complete — ${totalGenerated} artefacts generated`);

    // Final summary
    const { rows: final } = await client.query(
      `SELECT name, length(content) as chars FROM "AgentArtefact" WHERE "projectId" = $1 ORDER BY "createdAt" ASC`,
      [PROJECT_ID]
    );
    console.log(`\nFinal artefacts (${final.length}):`);
    for (const a of final) {
      console.log(`  ~${Math.round(a.chars / 5)}w | ${a.name}`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
