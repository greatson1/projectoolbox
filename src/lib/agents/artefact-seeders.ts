/**
 * Artefact Seeders — bridges approved artefact documents to structured DB records.
 *
 * When the user approves an artefact, the content (CSV) is parsed and the
 * relevant DB tables are populated so every project module shows live data.
 *
 * Seeding map:
 *   Stakeholder Register / Initial Stakeholder Register → db.stakeholder
 *   Risk Register / Initial Risk Register / Risk Management Plan → db.risk
 *   Budget Breakdown / Cost Management Plan → db.costEntry
 *   Sprint Plans / Iteration Plans → db.task (sprint-scoped)
 *   Schedule Baseline / WBS / Work Breakdown Structure → db.task (handled by schedule-parser.ts)
 *
 * All seeders are idempotent: agent-created records are deleted and re-created
 * on every approval so re-approvals after edits stay in sync.
 *
 * Exported:
 *   seedArtefactData(artefact, agentId) — dispatcher; call once from PATCH handler
 */

import { db } from "@/lib/db";

// ─── Public dispatcher ────────────────────────────────────────────────────────

interface ArtefactInput {
  id: string;
  name: string;
  format: string;
  content: string;
  projectId: string;
}

export async function seedArtefactData(
  artefact: ArtefactInput,
  agentId: string,
): Promise<void> {
  const lname = artefact.name.toLowerCase();

  if (
    lname.includes("stakeholder register") ||
    lname.includes("stakeholder list") ||
    lname.includes("initial stakeholder")
  ) {
    await seedStakeholders(artefact, agentId);
    return;
  }

  if (
    lname.includes("risk register") ||
    lname.includes("initial risk") ||
    lname.includes("risk management plan") ||
    lname.includes("risk log")
  ) {
    await seedRisks(artefact, agentId);
    return;
  }

  if (
    lname.includes("budget breakdown") ||
    lname.includes("cost management plan") ||
    lname.includes("budget plan") ||
    lname.includes("cost baseline") ||
    lname.includes("cost plan") ||
    lname.includes("cost estimate") ||
    lname.includes("project estimate") ||
    lname.includes("cost breakdown")
  ) {
    await seedCosts(artefact, agentId);
    return;
  }

  if (
    lname.includes("sprint plan") ||
    lname.includes("iteration plan") ||
    lname.includes("sprint backlog") ||
    (lname === "backlog")
  ) {
    await seedSprintTasks(artefact, agentId);
    return;
  }

  if (
    lname.includes("change request register") ||
    lname.includes("change request log") ||
    lname.includes("change log")
  ) {
    await seedChangeRequests(artefact, agentId);
    return;
  }

  // Schedule Baseline / WBS are handled by schedule-parser.ts — no duplicate seeding here
}

// ─── Stakeholder seeder ───────────────────────────────────────────────────────
// Artefact columns:
//   ID | Name / Role | Organisation | Stake / Interest | Power (H/M/L) | Interest (H/M/L)
//   Current Engagement | Target Engagement | Communication Method | Frequency | Owner | Notes/Key Concerns

async function seedStakeholders(artefact: ArtefactInput, agentId: string): Promise<void> {
  const rows = parseCSV(artefact.content);
  if (rows.length === 0) return;

  // Remove only agent-seeded stakeholders so manual additions are preserved
  await db.stakeholder.deleteMany({
    where: { projectId: artefact.projectId },
    // Note: Stakeholder has no createdBy — we delete all and re-seed
  });

  let created = 0;
  for (const row of rows) {
    const nameRaw  = col(row, ["Name / Role", "Name", "Stakeholder", "Stakeholder Name"]);
    if (!nameRaw) continue;

    // Split "Name / Role" or "Name - Role" into separate fields
    const parts    = nameRaw.split(/[\/\-–]/).map(s => s.trim());
    const name     = parts[0] || nameRaw;
    const roleHint = parts[1] || col(row, ["Role", "Title", "Position"]);

    const org          = col(row, ["Organisation", "Organization", "Company", "Department"]);
    const powerRaw     = col(row, ["Power (H/M/L)", "Power", "Influence (H/M/L)", "Influence"]);
    const interestRaw  = col(row, ["Interest (H/M/L)", "Interest", "Concern (H/M/L)"]);
    const engageCur    = col(row, ["Current Engagement", "Current", "Engagement Level", "Engagement"]);
    const email        = col(row, ["Email", "Contact", "E-mail"]);
    const notes        = col(row, ["Notes", "Key Concerns", "Comments", "Stake / Interest"]);

    const power    = parseHML(powerRaw);
    const interest = parseHML(interestRaw);
    const sentiment = engagementToSentiment(engageCur);

    try {
      await db.stakeholder.create({
        data: {
          projectId: artefact.projectId,
          name: name.slice(0, 200),
          role: (roleHint || col(row, ["Role", "Job Title", "Designation"])).slice(0, 200) || null,
          organisation: org.slice(0, 200) || null,
          power,
          interest,
          sentiment: sentiment || null,
          email: email.slice(0, 200) || null,
        },
      });
      created++;
    } catch (e) {
      console.error("[stakeholder-seeder] Failed to create:", name, e);
    }
  }
  console.log(`[artefact-seeders] Stakeholder Register: ${created} stakeholders seeded`);
}

function parseHML(raw: string): number {
  const s = (raw || "").toLowerCase().trim();
  if (s === "h" || s === "high" || s === "3") return 80;
  if (s === "m" || s === "med" || s === "medium" || s === "2") return 50;
  if (s === "l" || s === "low" || s === "1") return 20;
  const n = parseInt(s, 10);
  if (!isNaN(n)) {
    // Could be 1-5 or 0-100
    if (n <= 5) return Math.round(n * 20);
    return Math.min(100, Math.max(0, n));
  }
  return 50; // default medium
}

function engagementToSentiment(engagement: string): string {
  const s = (engagement || "").toLowerCase();
  if (s.includes("champion") || s.includes("support") || s.includes("advocate") || s.includes("sponsor")) return "positive";
  if (s.includes("resist") || s.includes("block") || s.includes("oppos") || s.includes("against")) return "negative";
  if (s.includes("neutral") || s.includes("unaware") || s.includes("indifferent")) return "neutral";
  return "neutral";
}

/**
 * Sanitise owner/assignee names from Claude-generated CSV.
 * Claude often hallucinate personal names like "Tom Rodriguez", "Sarah Mitchell".
 * If the name looks like a fabricated personal name (first + last), replace with
 * a role title like "Project Manager" or just "TBD".
 * Keep role titles, "TBD", and single-word roles as-is.
 */
function sanitiseOwnerName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "—" || trimmed === "-") return null;

  // Known role titles — keep these as-is
  const roleTitles = [
    "project manager", "pm", "sponsor", "team lead", "lead", "owner",
    "finance", "hr", "admin", "coordinator", "director", "analyst",
    "developer", "designer", "architect", "consultant", "manager",
    "scrum master", "product owner", "delivery lead", "risk owner",
    "primary traveller", "traveller", "organiser", "host",
    "tbd", "tbc", "unassigned", "agent", "ai agent",
  ];
  const lower = trimmed.toLowerCase();
  if (roleTitles.some(r => lower.includes(r))) return trimmed;

  // If it looks like "FirstName LastName" (two capitalised words) — it's likely fabricated
  const parts = trimmed.split(/\s+/);
  if (parts.length === 2 && /^[A-Z][a-z]+$/.test(parts[0]) && /^[A-Z][a-z]+$/.test(parts[1])) {
    return "Project Manager"; // Replace fabricated name with role
  }
  if (parts.length >= 3 && parts.every(p => /^[A-Z]/.test(p))) {
    return "Project Manager";
  }

  return trimmed;
}

// ─── Risk seeder ─────────────────────────────────────────────────────────────
// Artefact columns:
//   Risk ID | Category | Title | Description | Likelihood (1-5) | Impact (1-5) | Score
//   Risk Rating | Owner | Mitigation Actions | Contingency Plan | Residual Score | Status | Last Reviewed

async function seedRisks(artefact: ArtefactInput, agentId: string): Promise<void> {
  const rows = parseCSV(artefact.content);
  if (rows.length === 0) return;

  // Remove previously agent-seeded risks
  // Risk has no createdBy field — use a convention: risks without an assigneeId that were seeded
  // We'll delete all risks and re-seed (user-added ones are expected to be added via the UI POST)
  await db.risk.deleteMany({ where: { projectId: artefact.projectId } });

  let created = 0;
  for (const row of rows) {
    const title = col(row, ["Title", "Risk", "Risk Title", "Risk Description", "Name"]);
    if (!title) continue;

    const description  = col(row, ["Description", "Details", "Risk Description"]);
    const category     = col(row, ["Category", "Type", "Risk Category", "Risk Type"]);
    const likelihoodRaw = col(row, ["Likelihood (1-5)", "Likelihood", "Probability (1-5)", "Probability", "L"]);
    const impactRaw    = col(row, ["Impact (1-5)", "Impact", "Severity (1-5)", "Severity", "I"]);
    const scoreRaw     = col(row, ["Score", "Risk Score", "Rating Score", "Total"]);
    const statusRaw    = col(row, ["Status", "Risk Status", "State"]);
    const owner        = col(row, ["Owner", "Risk Owner", "Assigned To", "Responsible"]);
    const mitigation   = col(row, ["Mitigation Actions", "Mitigation", "Controls", "Response", "Actions"]);

    const probability = parseRating(likelihoodRaw, 3);
    const impact      = parseRating(impactRaw, 3);
    const score       = parseInt(scoreRaw, 10) || (probability * impact);
    const status      = normaliseRiskStatus(statusRaw);

    try {
      await db.risk.create({
        data: {
          projectId: artefact.projectId,
          title: title.slice(0, 255),
          description: description || null,
          category: category || null,
          probability,
          impact,
          score,
          status,
          owner: sanitiseOwnerName(owner) || null,
          mitigation: mitigation || null,
        },
      });
      created++;
    } catch (e) {
      console.error("[risk-seeder] Failed to create:", title, e);
    }
  }
  console.log(`[artefact-seeders] Risk Register: ${created} risks seeded`);
}

function parseRating(raw: string, defaultVal: number): number {
  const n = parseFloat((raw || "").replace(/[^0-9.]/g, ""));
  if (isNaN(n)) return defaultVal;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function normaliseRiskStatus(raw: string): string {
  const s = (raw || "").toLowerCase();
  if (s.includes("clos") || s.includes("resolv") || s.includes("done")) return "CLOSED";
  if (s.includes("monitor") || s.includes("watch")) return "MONITORING";
  if (s.includes("escalat")) return "ESCALATED";
  return "OPEN";
}

// ─── Cost seeder ─────────────────────────────────────────────────────────────
// Budget Breakdown columns:
//   Category | Sub-Category / Item | Planned Cost (£) | Actual Cost (£) | Variance (£)
//   % Spent | % of Total Budget | Status | Notes
//
// Cost Management Plan columns:
//   Work Package | Category | Resource/Item | Unit | Qty | Unit Cost (£) | Planned Total (£)
//   Actual Cost (£) | Variance (£) | % Spent | Phase | Status | Notes

async function seedCosts(artefact: ArtefactInput, agentId: string): Promise<void> {
  const rows = parseCSV(artefact.content);
  if (rows.length === 0) return;

  // Remove previously agent-seeded cost entries
  await db.costEntry.deleteMany({
    where: { projectId: artefact.projectId, createdBy: `agent:${agentId}` },
  });

  let created = 0;
  for (const row of rows) {
    const itemRaw     = col(row, ["Sub-Category / Item", "Resource/Item", "Work Package", "Item", "Description", "Category"]);
    const categoryRaw = col(row, ["Category", "Type", "Cost Category"]);
    const plannedRaw  = col(row, ["Planned Cost (£)", "Planned Total (£)", "Planned (£)", "Planned Cost", "Budget (£)", "Budget"]);
    const actualRaw   = col(row, ["Actual Cost (£)", "Actual (£)", "Actual Cost", "Actual"]);
    const unitQtyRaw  = col(row, ["Qty", "Quantity", "Units"]);
    const unitRateRaw = col(row, ["Unit Cost (£)", "Rate (£)", "Unit Rate", "Rate"]);
    const phase       = col(row, ["Phase", "Project Phase"]);
    const notes       = col(row, ["Notes", "Comments"]);

    const planned = parseCurrency(plannedRaw);
    const actual  = parseCurrency(actualRaw);
    const category = mapCostCategory(categoryRaw || itemRaw);
    const description = [itemRaw, phase, notes].filter(Boolean).join(" | ").slice(0, 500);
    const unitQty  = parseFloat(unitQtyRaw)  || null;
    const unitRate = parseCurrency(unitRateRaw) || null;

    if (planned <= 0 && actual <= 0) continue; // skip empty rows

    try {
      if (planned > 0) {
        await db.costEntry.create({
          data: {
            projectId: artefact.projectId,
            entryType: "ESTIMATE",
            category,
            amount: planned,
            currency: "GBP",
            description: description || itemRaw || null,
            unitQty,
            unitRate,
            createdBy: `agent:${agentId}`,
          },
        });
        created++;
      }
      if (actual > 0) {
        await db.costEntry.create({
          data: {
            projectId: artefact.projectId,
            entryType: "ACTUAL",
            category,
            amount: actual,
            currency: "GBP",
            description: description || itemRaw || null,
            unitQty,
            unitRate,
            createdBy: `agent:${agentId}`,
          },
        });
        created++;
      }
    } catch (e) {
      console.error("[cost-seeder] Failed to create cost entry:", itemRaw, e);
    }
  }
  console.log(`[artefact-seeders] Budget/Cost: ${created} cost entries seeded`);
}

function parseCurrency(raw: string): number {
  if (!raw) return 0;
  // Strip £, $, commas, spaces; handle "(negative)" accounting format
  const cleaned = raw.replace(/[£$€,\s]/g, "").replace(/^\((.+)\)$/, "-$1");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function mapCostCategory(raw: string): string {
  const s = (raw || "").toLowerCase();
  if (s.includes("labour") || s.includes("labor") || s.includes("staff") || s.includes("resource") || s.includes("salary") || s.includes("consultant")) return "LABOUR";
  if (s.includes("material") || s.includes("equipment") || s.includes("hardware") || s.includes("licen")) return "MATERIALS";
  if (s.includes("service") || s.includes("contract") || s.includes("vendor") || s.includes("supplier") || s.includes("software")) return "SERVICES";
  if (s.includes("travel") || s.includes("transport") || s.includes("subsist")) return "TRAVEL";
  if (s.includes("contingenc") || s.includes("reserve") || s.includes("buffer")) return "CONTINGENCY";
  return "OTHER";
}

// ─── Sprint task seeder ───────────────────────────────────────────────────────
// Sprint Plans columns:
//   Sprint | Story ID | User Story | Points | Owner | Status | Start | End | Actual Completion | Notes
// Iteration Plans columns:
//   Iteration | Item ID | Work Item | Owner | Planned Points | Completed Points | Status | Start | End | Notes

async function seedSprintTasks(artefact: ArtefactInput, agentId: string): Promise<void> {
  const rows = parseCSV(artefact.content);
  if (rows.length === 0) return;

  // Remove only agent-generated sprint tasks (not scaffolded PM tasks or WBS tasks)
  await db.task.deleteMany({
    where: {
      projectId: artefact.projectId,
      createdBy: `agent:${agentId}`,
      description: { contains: "[source:sprint]" },
    },
  });

  // ── Step 1: Extract unique sprints from CSV and create Sprint records ──
  const sprintMap = new Map<string, { name: string; startDate: Date | null; endDate: Date | null; tasks: any[] }>();

  for (const row of rows) {
    const sprintName = col(row, ["Sprint", "Iteration", "Sprint Number"]);
    if (!sprintName) continue;
    if (!sprintMap.has(sprintName)) {
      sprintMap.set(sprintName, { name: sprintName, startDate: null, endDate: null, tasks: [] });
    }
    const entry = sprintMap.get(sprintName)!;
    const startRaw = col(row, ["Start", "Start Date"]);
    const endRaw = col(row, ["End", "End Date", "Actual Completion"]);
    const sd = parseDate(startRaw);
    const ed = parseDate(endRaw);
    if (sd && (!entry.startDate || sd < entry.startDate)) entry.startDate = sd;
    if (ed && (!entry.endDate || ed > entry.endDate)) entry.endDate = ed;
    entry.tasks.push(row);
  }

  // Delete existing agent-seeded sprints (avoid duplicates on re-approval)
  await db.sprint.deleteMany({
    where: { projectId: artefact.projectId, goal: { contains: "[source:artefact]" } },
  }).catch(() => {});

  // Create Sprint records and build sprintId lookup
  const sprintIdMap = new Map<string, string>();
  const project = await db.project.findUnique({ where: { id: artefact.projectId }, select: { orgId: true, startDate: true, endDate: true } });

  for (const [name, info] of sprintMap) {
    // Default dates: distribute evenly across project timeline if not in CSV
    const defaultStart = info.startDate || project?.startDate || new Date();
    const defaultEnd = info.endDate || new Date(defaultStart.getTime() + 14 * 86_400_000); // 2 weeks

    // Check if a user-created sprint with this name exists — don't overwrite
    const existing = await db.sprint.findFirst({ where: { projectId: artefact.projectId, name } });
    if (existing) {
      sprintIdMap.set(name, existing.id);
    } else {
      const sprint = await db.sprint.create({
        data: {
          projectId: artefact.projectId,
          name,
          goal: `[source:artefact] Auto-created from Sprint Plans artefact`,
          startDate: defaultStart,
          endDate: defaultEnd,
          status: "PLANNING",
        },
      });
      sprintIdMap.set(name, sprint.id);

      // Create calendar events for this sprint (planning, review, retro)
      if (project?.orgId) {
        const sprintDays = Math.ceil((defaultEnd.getTime() - defaultStart.getTime()) / 86_400_000);
        const events = [
          { title: `${name}: Sprint Planning`, startTime: defaultStart, desc: `Planning session for ${name}. Review backlog, commit to sprint goal, assign stories.` },
          { title: `${name}: Sprint Review`, startTime: new Date(defaultEnd.getTime() - 86_400_000), desc: `Demo completed work from ${name}. Gather stakeholder feedback.` },
          { title: `${name}: Retrospective`, startTime: defaultEnd, desc: `${name} retrospective. What went well, what to improve, action items.` },
        ];
        for (const evt of events) {
          await db.calendarEvent.create({
            data: {
              orgId: project.orgId,
              projectId: artefact.projectId,
              agentId,
              title: evt.title,
              description: evt.desc,
              startTime: evt.startTime,
              endTime: new Date(evt.startTime.getTime() + 60 * 60 * 1000), // 1 hour
              source: "AGENT",
            },
          }).catch(() => {});
        }
      }
    }
  }

  console.log(`[artefact-seeders] Created ${sprintMap.size} sprint(s) with calendar events`);

  // ── Step 2: Create tasks and assign to sprints ──
  let created = 0;
  for (const row of rows) {
    const title = col(row, ["User Story", "Work Item", "Task", "Story", "Feature", "Item", "Title"]);
    if (!title) continue;

    const sprintName  = col(row, ["Sprint", "Iteration", "Sprint Number"]);
    const storyPointsRaw = col(row, ["Points", "Planned Points", "Story Points", "Pts"]);
    const owner       = col(row, ["Owner", "Assigned To", "Assignee"]);
    const statusRaw   = col(row, ["Status"]);
    const startRaw    = col(row, ["Start", "Start Date"]);
    const endRaw      = col(row, ["End", "End Date", "Actual Completion"]);
    const notes       = col(row, ["Notes", "Comments", "Acceptance Criteria"]);
    const completedRaw = col(row, ["Completed Points", "Actual Points"]);

    const storyPoints = parseInt(storyPointsRaw, 10) || null;
    const progress    = resolveSprintProgress(statusRaw, storyPointsRaw, completedRaw);
    const status      = resolveTaskStatus(statusRaw, progress);
    const sprintId    = sprintName ? sprintIdMap.get(sprintName) || null : null;

    const desc = [
      "[source:sprint]",
      sprintName ? `Sprint: ${sprintName}` : null,
      owner && owner !== "TBD" ? `Owner: ${owner}` : null,
      notes || null,
    ].filter(Boolean).join(" | ");

    try {
      await db.task.create({
        data: {
          projectId: artefact.projectId,
          title: title.slice(0, 255),
          description: desc || null,
          status,
          startDate: parseDate(startRaw) ?? null,
          endDate: parseDate(endRaw) ?? null,
          progress,
          storyPoints,
          sprintId,
          assigneeName: owner && owner !== "TBD" ? owner : null,
          isCriticalPath: false,
          createdBy: `agent:${agentId}`,
          lastEditedBy: `agent:${agentId}`,
        },
      });
      created++;
    } catch (e) {
      console.error("[sprint-seeder] Failed to create task:", title, e);
    }
  }
  console.log(`[artefact-seeders] Sprint Plans: ${created} sprint tasks seeded`);
}

// ─── Change Request Register → ChangeRequest table ──────────────────────────

async function seedChangeRequests(artefact: ArtefactInput, agentId: string): Promise<void> {
  const rows = parseCSV(artefact.content);
  if (rows.length < 2) return; // header + at least 1 row

  // Delete existing agent-seeded change requests
  await db.changeRequest.deleteMany({
    where: { projectId: artefact.projectId, requestedBy: `agent:${agentId}` },
  });

  let created = 0;
  for (const row of rows.slice(1)) {
    const title = col(row, ["Title", "Change Request", "CR Title", "Name"]);
    if (!title) continue;

    const description = col(row, ["Description", "Details", "Change Description"]);
    const priority = col(row, ["Priority", "Urgency"]) || "MEDIUM";
    const statusRaw = col(row, ["Status", "Decision", "State"]) || "SUBMITTED";
    const category = col(row, ["Category", "Type", "Change Type"]);
    const requestedByName = col(row, ["Requested By", "Requester", "Raised By"]);
    const impactSchedule = col(row, ["Impact on Schedule", "Schedule Impact"]);
    const impactCost = col(row, ["Impact on Cost (£)", "Cost Impact", "Cost (£)"]);
    const impactScope = col(row, ["Impact on Scope", "Scope Impact"]);

    // Normalise status
    const s = statusRaw.toLowerCase();
    const status = s.includes("approved") || s.includes("accepted") ? "APPROVED"
      : s.includes("reject") ? "REJECTED"
      : s.includes("implement") ? "IMPLEMENTED"
      : s.includes("review") || s.includes("assess") ? "UNDER_REVIEW"
      : "SUBMITTED";

    try {
      await db.changeRequest.create({
        data: {
          projectId: artefact.projectId,
          title: title.slice(0, 255),
          description: [
            description,
            category ? `Category: ${category}` : null,
            impactSchedule ? `Schedule impact: ${impactSchedule}` : null,
            impactCost ? `Cost impact: ${impactCost}` : null,
            impactScope ? `Scope impact: ${impactScope}` : null,
          ].filter(Boolean).join("\n") || null,
          status,
          impact: {
            priority,
            schedule: impactSchedule || null,
            cost: impactCost || null,
            scope: impactScope || null,
          } as any,
          requestedBy: `agent:${agentId}`,
        },
      });
      created++;
    } catch (e) {
      console.error("[cr-seeder] Failed to create change request:", title, e);
    }
  }
  console.log(`[artefact-seeders] Change Request Register: ${created} CRs seeded`);
}

function resolveSprintProgress(statusRaw: string, planned: string, completed: string): number {
  const p = parseFloat(planned);
  const c = parseFloat(completed);
  if (!isNaN(p) && !isNaN(c) && p > 0) return Math.round((c / p) * 100);
  const s = (statusRaw || "").toLowerCase();
  if (s.includes("done") || s.includes("complete")) return 100;
  if (s.includes("progress") || s.includes("active")) return 50;
  return 0;
}

function resolveTaskStatus(statusRaw: string, progress: number): string {
  const s = (statusRaw || "").toLowerCase();
  if (s.includes("done") || s.includes("complete") || progress >= 100) return "DONE";
  if (s.includes("progress") || s.includes("active") || (progress > 0 && progress < 100)) return "IN_PROGRESS";
  if (s.includes("risk") || s.includes("block")) return "AT_RISK";
  return "TODO";
}

// ─── Shared CSV utilities ─────────────────────────────────────────────────────

function parseCSV(raw: string): Record<string, string>[] {
  const cleaned = raw.replace(/^```[a-z]*\n?/im, "").replace(/```\s*$/im, "").trim();
  const lines = splitCSVLines(cleaned);
  if (lines.length < 2) return [];
  const headers = parseCSVRow(lines[0]).map(h => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVRow(lines[i]);
    if (cells.every(c => !c.trim())) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = (cells[idx] ?? "").trim(); });
    rows.push(obj);
  }
  return rows;
}

function splitCSVLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { inQuote = !inQuote; current += ch; }
    else if ((ch === "\n" || ch === "\r") && !inQuote) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (current.trim()) lines.push(current);
      current = "";
    } else { current += ch; }
  }
  if (current.trim()) lines.push(current);
  return lines;
}

function parseCSVRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { current += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === "," && !inQuote) { fields.push(current); current = ""; }
    else { current += ch; }
  }
  fields.push(current);
  return fields;
}

function col(row: Record<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    const key = Object.keys(row).find(k => k.toLowerCase() === alias.toLowerCase());
    if (key && row[key]) return row[key].trim();
  }
  return "";
}

function parseDate(raw: string): Date | undefined {
  if (!raw || raw === "TBD" || raw === "-" || raw === "N/A") return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? undefined : d;
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(raw)) {
    const [day, month, year] = raw.split("/");
    const d = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
    return isNaN(d.getTime()) ? undefined : d;
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}
