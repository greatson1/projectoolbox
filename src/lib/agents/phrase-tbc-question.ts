/**
 * Pure phrasing helper for unresolved [TBC — X] items, extracted out of
 * clarification-session.ts so it can be unit-tested without dragging in
 * Prisma / db.ts. The full LLM-driven `phraseTBCQuestions` flow lives in
 * clarification-session.ts and falls back to this function on any failure.
 *
 * The lexicon is small on purpose: catch the obvious person/date/quantity/
 * yesno cases. Anything that doesn't match falls through to "What is the X?"
 * which is fine for free-text gaps like "venue name" or "training topic".
 */

import type { QuestionType } from "./clarification-types";

// Person-hint vocabulary kept in module scope so both the fallback and the
// post-LLM normaliser share one source of truth. If you teach the fallback
// to recognise a new role word, the normaliser learns it too.
const PERSON_HINTS = /\b(lead|leader|owner|manager|director|sponsor|stakeholder|approver|signatory|champion|head|chair|chairperson|contact|representative|liaison|coordinator|officer|administrator|author|person|individual)\b/i;

/**
 * Post-LLM normaliser — fixes the case where Haiku ignores the
 * "Person / role → Who is the X?" rule and emits "What is the X?" anyway
 * (regression observed in production: "What is the compliance lead?" /
 * "What is the devops lead?"). Pure heuristic: if the question starts
 * with "What is the" AND the trailing topic carries a person-hint word,
 * swap "What" for "Who" and force type "text".
 *
 * Defensive — no-op when the question doesn't start with that prefix,
 * or when the topic clearly isn't a person.
 */
export function normalisePersonHintQuestion(
  question: string,
  type: QuestionType,
): { question: string; type: QuestionType } {
  const trimmed = question.trim();
  // Only rewrite the specific "What is the X?" form so we never break
  // "What budget…", "What is the launch date…", etc.
  const m = trimmed.match(/^What\s+is\s+(the\s+)?(.+?)\??$/i);
  if (!m) return { question, type };
  const topic = m[2];
  if (!PERSON_HINTS.test(topic)) return { question, type };
  return {
    question: `Who is the ${topic.replace(/^the\s+/i, "")}?`,
    type: "text",
  };
}

/**
 * Deterministic fallback — picks the right interrogative (Who/When/How many/
 * Has) and `type` based on lexical hints in the topic. Used whenever the
 * Haiku phrasing pass fails or ANTHROPIC_API_KEY is missing, so users never
 * see a regression to the old dumb `What is the X?` template.
 */
export function phraseTBCQuestionFallback(item: string): { question: string; type: QuestionType } {
  const lower = item.toLowerCase().trim();
  // Strip leading filler ("the ", "a ") so the question reads cleanly.
  const cleaned = lower.replace(/^(the|a|an)\s+/, "");

  // Person/role topics → Who is X?
  // Uses PERSON_HINTS from module scope so the post-LLM normaliser shares
  // the same vocabulary.
  // "supplier name" / "vendor name" style — name + supplier-class noun ⇒ Who.
  const nameRole = /\bname\b/.test(cleaned) && /\b(supplier|vendor|partner|consultant|sponsor|owner|manager|director)\b/.test(cleaned);
  if (PERSON_HINTS.test(cleaned) || nameRole) {
    return { question: `Who is the ${cleaned}?`, type: "text" };
  }

  // Date topics → When is X?
  const dateHints = /\b(date|deadline|kickoff|kick-off|launch|milestone|due|start|end|completion|delivery|target date|go-live|cutover)\b/;
  if (dateHints.test(cleaned)) {
    return { question: `When is the ${cleaned}?`, type: "date" };
  }

  // Numeric topics → How many / What is the X? (type:number)
  const quantityHints = /\b(count|number of|headcount|team size|budget|cost|fee|rate|amount|total|hours|days|weeks|months|allocation|quantity|capacity|threshold|limit|fte|salary|price)\b/;
  if (quantityHints.test(cleaned)) {
    const isCount = /\b(count|number of|headcount|team size|hours|days|weeks|months|quantity|capacity|fte)\b/.test(cleaned);
    return { question: isCount ? `How many ${cleaned}?` : `What is the ${cleaned}?`, type: "number" };
  }

  // Yes/no topics → Has X been confirmed?
  const yesnoHints = /\b(booked|confirmed|signed|approved|completed|in place|available|required|received|issued|granted|in scope)\b/;
  if (yesnoHints.test(cleaned)) {
    return { question: `Has the ${cleaned} been confirmed?`, type: "yesno" };
  }

  // Default — open text
  return { question: `What is the ${cleaned}?`, type: "text" };
}
