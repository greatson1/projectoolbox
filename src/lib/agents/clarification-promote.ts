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

// ─── Generic KB-fact → canonical promoter ──────────────────────────────────────

interface PromoteKBFactInput {
  projectId: string;
  /** Free-form KB item title (e.g. "Budget update", "Sponsor change"). */
  title: string;
  /** Free-form KB item content (e.g. "Budget reduced to £8,000 due to scope cut"). */
  content: string;
  /**
   * When true, overwrite existing canonical values rather than only filling
   * blanks. Use this for email-confirmed updates (the user is intentionally
   * changing a value) but NOT for first-pass clarification answers (which
   * should never overwrite a deliberate later edit).
   */
  allowOverwrite?: boolean;
}

/**
 * Same intent as promoteAnswerToCanonicalTables but driven by a KB row's
 * title + content rather than a structured question/answer pair. Used by
 * the email-fact confirmation flow (chat/stream) and the inbox process
 * route — wherever a confirmed fact lands in KB and might also need to
 * update project.budget / startDate / endDate / Stakeholder rows.
 *
 * The user's reported case: an inbound email said the budget had decreased.
 * They confirmed the fact in chat. The KB row got tagged user_confirmed but
 * project.budget stayed at the old value because nothing scanned the
 * confirmed fact for budget patterns. This closes that gap.
 *
 * Idempotent — safe to call multiple times on the same KB item; only acts
 * when it can parse a usable value.
 */
export async function promoteKBFactToCanonical(input: PromoteKBFactInput): Promise<{
  budgetUpdated: boolean;
  startDateUpdated: boolean;
  endDateUpdated: boolean;
  stakeholdersAdded: number;
}> {
  const { projectId, title, content, allowOverwrite = false } = input;
  const result = { budgetUpdated: false, startDateUpdated: false, endDateUpdated: false, stakeholdersAdded: 0 };

  const haystack = `${title}\n${content}`;
  const haystackLC = haystack.toLowerCase();

  // Strip provenance prefix the storeFactToKB helper adds:
  // "[User confirmed dd/mm/yyyy] body"
  const stripped = content.replace(/^\[(?:user confirmed|research|email|meeting)[^\]]*\]\s*/i, "");

  // ── Budget ───────────────────────────────────────────────────────────────
  // Only act when the title or content explicitly mentions budget. Numbers
  // alone in an email aren't enough — could be a quote, a venue capacity, a
  // page count. We require lexical evidence the number IS a budget.
  if (/budget|total\s*cost|allocated\s*funds|funding/.test(haystackLC)) {
    try {
      const amount = parseAmount(stripped);
      if (amount) {
        const existing = await db.project.findUnique({
          where: { id: projectId },
          select: { budget: true },
        });
        // Update if (a) blank and we should fill, or (b) overwrite is
        // explicitly allowed and the new value differs from current.
        const shouldWrite =
          !existing?.budget ||
          (allowOverwrite && existing.budget !== amount);
        if (shouldWrite) {
          await db.project.update({ where: { id: projectId }, data: { budget: amount } });
          result.budgetUpdated = true;
        }
      }
    } catch (e) {
      console.error("[promote-kb-fact] budget update failed:", e);
    }
  }

  // ── Dates ────────────────────────────────────────────────────────────────
  const isStart = /\b(start\s*date|kick\s*off|launch\s*date|project\s*start)\b/.test(haystackLC);
  const isEnd   = /\b(end\s*date|completion|deadline|target\s*date|go[-\s]?live|delivery\s*date)\b/.test(haystackLC);
  if (isStart || isEnd) {
    try {
      const d = parseDate(stripped);
      if (d) {
        const existing = await db.project.findUnique({
          where: { id: projectId },
          select: { startDate: true, endDate: true },
        });
        if (isStart) {
          const shouldWrite = !existing?.startDate || (allowOverwrite && existing.startDate?.getTime() !== d.getTime());
          if (shouldWrite) {
            await db.project.update({ where: { id: projectId }, data: { startDate: d } });
            result.startDateUpdated = true;
          }
        }
        if (isEnd) {
          const shouldWrite = !existing?.endDate || (allowOverwrite && existing.endDate?.getTime() !== d.getTime());
          if (shouldWrite) {
            await db.project.update({ where: { id: projectId }, data: { endDate: d } });
            result.endDateUpdated = true;
          }
        }
      }
    } catch (e) {
      console.error("[promote-kb-fact] date update failed:", e);
    }
  }

  // ── Sponsor / PM / Stakeholder ───────────────────────────────────────────
  if (/sponsor|project[\s_]?manager|\bpm\b|stakeholder|owner|champion/.test(haystackLC)) {
    try {
      const role = inferRole("", haystackLC);
      const names = extractNames(stripped);
      for (const name of names) {
        const isSponsorish = role === "Project Sponsor" || role === "Executive Sponsor";
        const isPMish = role === "Project Manager" || role === "Programme Manager";
        const power    = isSponsorish ? 90 : isPMish ? 70 : 50;
        const interest = isSponsorish ? 80 : isPMish ? 80 : 50;
        await upsertStakeholder(projectId, name, role, power, interest);
        result.stakeholdersAdded++;
      }
    } catch (e) {
      console.error("[promote-kb-fact] stakeholder upsert failed:", e);
    }
  }

  return result;
}
