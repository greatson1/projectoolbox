/**
 * Promote clarification answers to canonical tables.
 *
 * Until this layer existed, every clarification answer landed only in the
 * KnowledgeBase — handy for context injection but invisible to the dedicated
 * pages (Stakeholders, Cost, Resources, etc) which read from the canonical
 * tables. Result: a user could answer "Sarah Chen is the sponsor" and watch
 * the Stakeholders page stay empty.
 *
 * This module looks at each answer's `field`/`artefact` slug + the answer
 * text, and writes the relevant canonical row when the pattern is clear:
 *
 *   sponsor / project_sponsor      → Stakeholder (role: Project Sponsor)
 *   project_manager / pm           → Stakeholder (role: Project Manager)
 *   stakeholder*, key_contacts     → Stakeholder (role inferred from question)
 *   budget, total_cost, project_budget → Project.budget
 *   start_date, kickoff            → Project.startDate
 *   end_date, completion_date      → Project.endDate
 *
 * Idempotent — re-running on the same answer upserts rather than duplicates.
 * Non-fatal — every block is wrapped in try/catch and the caller fires this
 * fire-and-forget so a promote failure never blocks the answer flow.
 */

import { db } from "@/lib/db";

interface PromoteInput {
  projectId: string;
  questionField: string;     // e.g. "sponsor_name", "budget", "stakeholders"
  questionText: string;      // the human question — used for role inference
  answer: string;            // the user's answer
  artefactName?: string;     // e.g. "Stakeholder Register"
}

/**
 * Try to find the most plausible role for a stakeholder answer based on the
 * question text or field slug. Used so a question like "Who is the project
 * sponsor?" populates Stakeholder.role = "Project Sponsor".
 */
function inferRole(field: string, questionText: string): string | null {
  const both = `${field} ${questionText}`.toLowerCase();
  if (/sponsor/.test(both))                  return "Project Sponsor";
  if (/project\s*manager|\bpm\b/.test(both)) return "Project Manager";
  if (/program(me)?\s*manager/.test(both))   return "Programme Manager";
  if (/exec(utive)?|sponsor.*board/.test(both)) return "Executive Sponsor";
  if (/owner/.test(both))                    return "Product Owner";
  if (/lead\b/.test(both))                   return "Team Lead";
  if (/architect/.test(both))                return "Lead Architect";
  return null;
}

/**
 * Pull person-looking names out of an answer. Handles single names
 * ("Sarah Chen"), comma-separated lists ("Sarah Chen, Marcus Rivera"), and
 * "and"-separated lists ("Sarah Chen and Marcus Rivera"). Each candidate is
 * trimmed to a leading 2–4-word capitalised pattern so trailing context
 * ("Sarah Chen, COO at Acme") doesn't end up as the name.
 */
function extractNames(answer: string): string[] {
  if (!answer) return [];
  // Skip empty / "TBC" / yes-no answers
  const t = answer.trim();
  if (!t || /^tbc$/i.test(t) || /^(yes|no|n\/a|none|tba)$/i.test(t)) return [];

  // Split on common list separators
  const parts = t.split(/,| and |\n|;|·|•/i)
    .map(s => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const p of parts) {
    // Match the first 2–4 capitalised words at the start of the chunk
    const m = p.match(/^([A-Z][a-z'\-]+(?:\s+[A-Z][a-z'\-]+){1,3})\b/);
    if (m && m[1].length <= 60) out.push(m[1]);
  }
  return out;
}

function parseAmount(answer: string): number | null {
  if (!answer) return null;
  // Match anything that looks like a number, possibly with k/m suffix
  const m = answer.match(/£?\s*([\d,]+(?:\.\d+)?)\s*([kKmM]?)/);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (m[2] === "k" || m[2] === "K") n *= 1_000;
  if (m[2] === "m" || m[2] === "M") n *= 1_000_000;
  return n;
}

function parseDate(answer: string): Date | null {
  if (!answer) return null;
  const d = new Date(answer);
  if (!isNaN(d.getTime())) return d;
  // dd/mm/yyyy
  const m = answer.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const [, a, b, c] = m;
    const yr = c.length === 2 ? 2000 + parseInt(c, 10) : parseInt(c, 10);
    const dt = new Date(yr, parseInt(b, 10) - 1, parseInt(a, 10));
    if (!isNaN(dt.getTime())) return dt;
  }
  return null;
}

async function upsertStakeholder(
  projectId: string,
  name: string,
  role: string | null,
  power = 50,
  interest = 50,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const existing = await db.stakeholder.findFirst({
    where: { projectId, name: trimmed },
    select: { id: true, role: true },
  });
  if (existing) {
    // Only fill in role if it's currently blank — never overwrite a richer
    // role the user set explicitly elsewhere.
    if (role && !existing.role) {
      await db.stakeholder.update({ where: { id: existing.id }, data: { role } });
    }
  } else {
    await db.stakeholder.create({
      data: { projectId, name: trimmed, role, power, interest },
    });
  }
}

/**
 * Main entry — call after storeFactToKB. Quiet on no-match (most fields
 * don't have a canonical home; that's fine). Fire-and-forget at the call
 * site, but the function itself is structured as a normal async — exceptions
 * are caught per-block so a single failure doesn't lose the whole batch.
 */
export async function promoteAnswerToCanonicalTables(input: PromoteInput): Promise<{
  stakeholdersAdded: number;
  budgetSet: boolean;
  startDateSet: boolean;
  endDateSet: boolean;
}> {
  const { projectId, questionField, questionText, answer, artefactName } = input;
  const result = { stakeholdersAdded: 0, budgetSet: false, startDateSet: false, endDateSet: false };

  if (!answer || /^tbc$/i.test(answer.trim())) return result;

  const fieldLC = (questionField || "").toLowerCase();
  const questionLC = (questionText || "").toLowerCase();
  const artefactLC = (artefactName || "").toLowerCase();
  const isStakeholderArtefact = artefactLC.includes("stakeholder") || artefactLC.includes("communication");

  // ── Sponsor / PM / Stakeholder ───────────────────────────────────────────
  const looksStakeholder =
    /sponsor|project[\s_]?manager|\bpm\b|stakeholder|owner|lead/.test(fieldLC + " " + questionLC) ||
    isStakeholderArtefact;
  if (looksStakeholder) {
    try {
      const role = inferRole(fieldLC, questionLC);
      const names = extractNames(answer);
      for (const name of names) {
        // Sponsor / PM are high-power high-interest by definition; other
        // stakeholders default to 50/50 until the user adjusts on the People
        // page. Setting these defaults right means the power/interest matrix
        // already shows sponsors in the top quadrant on first load.
        const isSponsorish = role === "Project Sponsor" || role === "Executive Sponsor";
        const isPMish = role === "Project Manager" || role === "Programme Manager";
        const power    = isSponsorish ? 90 : isPMish ? 70 : 50;
        const interest = isSponsorish ? 80 : isPMish ? 80 : 50;
        await upsertStakeholder(projectId, name, role, power, interest);
        result.stakeholdersAdded++;
      }
    } catch (e) {
      console.error("[clarification-promote] stakeholder upsert failed:", e);
    }
  }

  // ── Budget ───────────────────────────────────────────────────────────────
  if (/budget|total\s*cost|project[_\s]budget/.test(fieldLC + " " + questionLC)) {
    try {
      const amount = parseAmount(answer);
      if (amount) {
        const existing = await db.project.findUnique({
          where: { id: projectId },
          select: { budget: true },
        });
        // Only set if not already set — never overwrite a deliberate later edit.
        if (!existing?.budget) {
          await db.project.update({ where: { id: projectId }, data: { budget: amount } });
          result.budgetSet = true;
        }
      }
    } catch (e) {
      console.error("[clarification-promote] budget update failed:", e);
    }
  }

  // ── Dates ────────────────────────────────────────────────────────────────
  const isStart = /start\s*date|kick\s*off|launch\s*date/.test(fieldLC + " " + questionLC);
  const isEnd   = /end\s*date|completion|deadline|target\s*date|go[-\s]?live/.test(fieldLC + " " + questionLC);
  if (isStart || isEnd) {
    try {
      const d = parseDate(answer);
      if (d) {
        const existing = await db.project.findUnique({
          where: { id: projectId },
          select: { startDate: true, endDate: true },
        });
        if (isStart && !existing?.startDate) {
          await db.project.update({ where: { id: projectId }, data: { startDate: d } });
          result.startDateSet = true;
        } else if (isEnd && !existing?.endDate) {
          await db.project.update({ where: { id: projectId }, data: { endDate: d } });
          result.endDateSet = true;
        }
      }
    } catch (e) {
      console.error("[clarification-promote] date update failed:", e);
    }
  }

  return result;
}
