/**
 * Sanitise chat-stream Sonnet output before persisting + streaming.
 *
 * The fabricated-names validator + contradiction detector + allow-list block
 * the same class of bug at artefact-generation time. Chat replies bypass all
 * of that — Sonnet is free to write anything, so it produces lines like:
 *
 *     Budget: £3,000 [VERIFIED]
 *
 * when the project's actual budget is null. The "[VERIFIED]" badge is
 * doubly wrong: it asserts authority Sonnet doesn't have, AND the value is
 * fabricated.
 *
 * This module runs post-stream (before save + before final flush) and:
 *   1. Strips self-asserted authority tags ([VERIFIED] / [CONFIRMED] /
 *      [SOURCE: agent] / "verified by me" prose). Verification is the
 *      property of facts in the KB, not something the LLM declares.
 *   2. For load-bearing fields (budget, startDate, endDate, sponsor),
 *      if Sonnet asserts a SPECIFIC value that differs from — or has no
 *      backing in — the project's confirmed facts, replace the value with
 *      "[TBC — <field> not confirmed]".
 *
 * Pure: takes content + ConfirmedFacts, returns sanitised content + a list
 * of corrections so the caller can log what was changed.
 */

import type { ConfirmedFacts } from "@/lib/agents/confirmed-facts";

/**
 * Live phase-completion snapshot the chat-stream caller passes alongside
 * confirmed facts. Used by the sanitiser to invalidate "phase complete"
 * style assertions when the gate isn't actually ready, and to rewrite
 * "X of Y required artefacts" claims when the methodology has zero items
 * marked required:true.
 */
export interface PhaseCompletionSnapshot {
  phaseName: string;
  canAdvance: boolean;
  artefacts: { done: number; total: number };
  pmTasks: { done: number; total: number };
  deliveryTasks: { done: number; total: number };
  /** Count of artefacts the methodology marks `required: true` for THIS phase. */
  requiredArtefactCount: number;
  /** Count of artefacts the methodology marks `aiGeneratable: true` for THIS phase. */
  aiGeneratableArtefactCount: number;
}

export interface ChatSanitiseResult {
  content: string;
  corrections: Array<{
    kind: "stripped_verified_tag" | "replaced_fabricated_value" | "rewrote_phase_complete_claim" | "rewrote_required_count_claim" | "stripped_context_marker_leak";
    field?: string;
    before: string;
    after: string;
  }>;
}

const VERIFIED_TAG_REGEX = /\s*\[(?:VERIFIED|CONFIRMED|SOURCE\s*:\s*[^\]]+|VERIFIED\s+BY\s+[^\]]+)\]/gi;

// Context-marker leaks. The chat-stream feeds Claude an inbound history with
// <prior_question>, <prior_clarification>, <prior_event> XML wrappers (and
// previously [I asked the user]: "..." prose). Despite the system-prompt
// rule "NEVER echo these", Claude occasionally regurgitates the format —
// the user sees `[I asked the user]: "What should be the primary comms…"`
// as the agent's reply instead of an actual response. Strip every variant
// post-stream so a single slip never reaches the chat UI.
//
// We strip the WHOLE element (wrapper + inner text), not just the tags —
// the inner text without its wrapper would be dangling context (e.g. a
// bare "Who is the compliance lead?" with no question prompt around it).
const PRIOR_XML_PAIRED_REGEX = /<prior_(question|clarification|event)(?:\s+[^>]*)?>[\s\S]*?<\/prior_\1>/gi;
const PRIOR_XML_SELF_REGEX = /<prior_(?:question|clarification|event)(?:\s+[^>]*)?\/>/gi;
// Catch any nested <effect ...>...</effect> children that survive after the
// outer <prior_event kind="tool_effects"> is stripped above.
const PRIOR_XML_EFFECT_REGEX = /<effect(?:\s+[^>]*)?>[\s\S]*?<\/effect>/gi;
// Legacy bracketed natural-language form. Old chat history (and a few
// stubborn models) still produces lines like `[I asked the user]: "..."`
// or `[I posted a project status card]` or `[I generated 3 risks]`.
//
// We catch `[I <verb>...]` where the verb is either:
//   - a regular past-tense form ending in -ed / -ied (asked, posted,
//     generated, created, updated, scheduled, ...), OR
//   - one of the common irregular past-tense forms we've seen leak
//     (sent, made, set, told, wrote, got, did, put, kept, found, built,
//      met, gave, took, ran, threw, won, drew).
//
// This is intentionally broader than a fixed verb list — any first-person
// past-tense narration in brackets is overwhelmingly a context-marker
// leak from the inbound history, not legitimate prose.
//
// After the closing `]`, if followed by `:` we consume the rest of the
// line — that catches the trailing quoted text + options block
// regardless of whether the model used ASCII or smart quotes, and avoids
// the trap where a smart apostrophe (’ — same codepoint as the closing
// single quote) would fool a pedantic quote-pair matcher into stopping
// mid-string.
const LEGACY_BRACKET_LEAK_REGEX =
  /\[I\s+(?:[a-z]+(?:ied|ed)|sent|made|set|told|wrote|got|did|put|kept|found|built|met|gave|took|ran|threw|won|drew|saw|knew|came|went|left|paid|hit|cut|spent|swept|stood|read|let|brought|caught)\b[^\]]*\](?:\s*:[^\n]*)?/gi;

/**
 * Cheap, no-dependency read-path strip — call this on agent messages
 * returned from `/api/agents/:id/chat` so any historical or new leak
 * gets removed before the UI sees it.
 *
 * Defence in depth — even if a future write path bypasses the full
 * sanitiseChatResponse pass (e.g. lifecycle-init creating a static
 * message that itself was templated from leaked context), the UI never
 * renders the leak.
 *
 * Pure regex; doesn't read confirmed facts; safe to call on every
 * agent-role message on read.
 */
export function stripContextMarkerLeaks(content: string): string {
  if (!content) return content;
  let out = content;
  out = out.replace(PRIOR_XML_PAIRED_REGEX, "");
  out = out.replace(PRIOR_XML_SELF_REGEX, "");
  out = out.replace(PRIOR_XML_EFFECT_REGEX, "");
  out = out.replace(LEGACY_BRACKET_LEAK_REGEX, "");
  return out.replace(/[ \t]{2,}/g, " ").replace(/^[ \t]+/gm, "").trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitiseChatResponse(
  content: string,
  facts: ConfirmedFacts,
  phase?: PhaseCompletionSnapshot,
): ChatSanitiseResult {
  const corrections: ChatSanitiseResult["corrections"] = [];
  if (!content) return { content, corrections };

  let out = content;

  // ── 0. Strip leaked context markers ──
  // <prior_question>, <prior_clarification>, <prior_event>, <effect>, and
  // legacy [I asked the user]: "..." prose. These should ONLY appear in the
  // inbound history; if Claude echoes them they need to be removed before
  // the user sees them. Run this first so later regex passes operate on
  // clean prose.
  const captureLeak = (re: RegExp) => {
    const matches = out.match(re);
    if (matches && matches.length > 0) {
      for (const m of matches) {
        corrections.push({ kind: "stripped_context_marker_leak", before: m.slice(0, 200), after: "" });
      }
      out = out.replace(re, "");
    }
  };
  captureLeak(PRIOR_XML_PAIRED_REGEX);
  captureLeak(PRIOR_XML_SELF_REGEX);
  captureLeak(PRIOR_XML_EFFECT_REGEX);
  captureLeak(LEGACY_BRACKET_LEAK_REGEX);
  // Collapse any double spaces / leading whitespace left behind so the
  // sanitised reply doesn't show weird gaps where the markers used to be.
  out = out.replace(/[ \t]{2,}/g, " ").replace(/^[ \t]+/gm, "").trim();

  // ── 1. Strip self-asserted verification tags ──
  // [VERIFIED], [CONFIRMED], [SOURCE: agent], [verified by Sonnet] etc.
  // Authority comes from the KB / approved artefacts, not chat prose.
  const tagMatches = out.match(VERIFIED_TAG_REGEX);
  if (tagMatches && tagMatches.length > 0) {
    for (const tag of tagMatches) {
      corrections.push({ kind: "stripped_verified_tag", before: tag.trim(), after: "" });
    }
    out = out.replace(VERIFIED_TAG_REGEX, "");
  }

  // ── 2. Catch budget assertions that don't match confirmed facts ──
  // Examples Sonnet writes:
  //   "Budget: £3,000"
  //   "the £3,000 budget"
  //   "Budget: £3000"
  //   "Total budget: £3,000"
  // If facts.budget is null OR a different number, replace the asserted
  // figure with [TBC — budget not confirmed].
  const budgetRegex = /(?:budget(?:\s*:|\s+is|\s+set\s+at|\s+of)?\s*)([£$€]\s*[\d,]+(?:\.\d+)?(?:\s*[kKmM])?)/gi;
  const budgetMatches = Array.from(out.matchAll(budgetRegex));
  for (const m of budgetMatches) {
    const asserted = m[1].trim();
    const num = parseFloat(asserted.replace(/[£$€,\s]/g, "").replace(/[kK]$/, "000").replace(/[mM]$/, "000000"));
    if (!Number.isFinite(num) || num <= 0) continue;

    const matches =
      facts.budget != null && Math.abs(num - facts.budget) / Math.max(num, facts.budget) < 0.01;
    if (matches) continue; // value matches confirmed, leave alone

    // Replace just the figure portion, not the surrounding "Budget:" label.
    const replacement = "[TBC — budget not confirmed]";
    out = out.replace(asserted, replacement);
    corrections.push({
      kind: "replaced_fabricated_value",
      field: "budget",
      before: asserted,
      after: replacement,
    });
  }

  // ── 3. Catch sponsor assertions that don't match confirmed sponsor ──
  // "Sponsor: <Name>", "the sponsor is <Name>", "<Name> (sponsor)"
  // If facts.sponsor is set and asserted differs, OR facts.sponsor is null
  // and Sonnet has invented a name, replace.
  const sponsorRegex = /(?:sponsor\s*:?\s+|sponsor\s+is\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g;
  const sponsorMatches = Array.from(out.matchAll(sponsorRegex));
  for (const m of sponsorMatches) {
    const asserted = m[1].trim();
    if (facts.sponsor && asserted.toLowerCase() === facts.sponsor.toLowerCase()) continue;
    // No confirmed sponsor or a different name — strip the asserted name.
    const replacement = "[TBC — sponsor not confirmed]";
    out = out.replace(asserted, replacement);
    corrections.push({
      kind: "replaced_fabricated_value",
      field: "sponsor",
      before: asserted,
      after: replacement,
    });
  }

  // ── 4. Catch start/end-date assertions that don't match confirmed dates ──
  // Format examples Sonnet may produce: "Start date: 18 May 2026",
  // "starting 09/05/2026", "by 2026-05-18". Only check when facts have
  // explicit dates; otherwise leave alone (chat may quote a request the
  // user just made).
  // We keep this conservative — only strip on a clear mismatch with a
  // confirmed date, NOT on missing-confirmed-date.
  if (facts.startDate || facts.endDate) {
    const dateRegex = /(?:start(?:\s+date)?(?:\s+of)?\s*:?\s*|starting\s+|begins\s+|begin\s+|kicks?\s+off\s+|launch(?:es|ing)?\s+(?:on\s+)?)((?:\d{1,2}[\s\/-][A-Za-z]{3,9}[\s\/-]\d{4})|(?:\d{1,2}\/\d{1,2}\/\d{4})|(?:\d{4}-\d{2}-\d{2}))/gi;
    const dateMatches = Array.from(out.matchAll(dateRegex));
    for (const m of dateMatches) {
      const asserted = m[1].trim();
      const parsed = new Date(asserted);
      if (Number.isNaN(parsed.getTime())) continue;
      const startMatches =
        facts.startDate &&
        parsed.toISOString().slice(0, 10) === facts.startDate.slice(0, 10);
      if (startMatches) continue;
      // Mismatch — replace with confirmed value (or TBC if unset)
      const replacement = facts.startDate
        ? facts.startDate
        : "[TBC — start date not confirmed]";
      out = out.replace(asserted, replacement);
      corrections.push({
        kind: "replaced_fabricated_value",
        field: "startDate",
        before: asserted,
        after: replacement,
      });
    }
  }

  // ── 5. Phase-complete / ready-to-advance assertions ──
  // When the gate is NOT ready (canAdvance === false), Sonnet sometimes
  // still narrates "Pre-Project phase is now complete ✅" or "ready to
  // advance". This rewrites those claims to match the live status. We only
  // act when we have a phase snapshot AND the gate is not ready — if we
  // don't know the truth, we leave the prose alone.
  if (phase && !phase.canAdvance) {
    const phaseEsc = escapeRegex(phase.phaseName);
    // Patterns: "Pre-Project phase is now complete", "phase is complete ✅",
    // "the phase is complete", "Pre-Project is ready to advance",
    // "ready for gate approval", "all PM tasks (are/now) complete",
    // "all artefacts (are/now) approved".
    const PHASE_DONE_PATTERNS: RegExp[] = [
      new RegExp(`(${phaseEsc}\\s+phase\\s+is\\s+(?:now\\s+)?complete[!.\\s✅]*)`, "gi"),
      /(\bphase\s+is\s+(?:now\s+)?complete[!.\s✅]*)/gi,
      /(\b(?:ready\s+to\s+advance|ready\s+for\s+gate\s+approval|ready\s+for\s+phase\s+gate)[!.\s✅]*)/gi,
      /(\ball\s+pm\s+tasks?\s+(?:are|now)\s+complete[!.\s✅]*)/gi,
      /(\ball\s+artefacts?\s+(?:are|now)\s+approved[!.\s✅]*)/gi,
      /(\bgate\s+(?:is\s+)?(?:ready|good\s+to\s+go)[!.\s✅]*)/gi,
    ];
    const blockerLine =
      `[NOT READY — ${phase.artefacts.done}/${phase.artefacts.total} artefacts approved, ` +
      `${phase.pmTasks.done}/${phase.pmTasks.total} PM tasks done, ` +
      `${phase.deliveryTasks.done}/${phase.deliveryTasks.total} delivery tasks done]`;
    for (const re of PHASE_DONE_PATTERNS) {
      const matches = Array.from(out.matchAll(re));
      for (const m of matches) {
        const before = m[1];
        out = out.replace(before, blockerLine);
        corrections.push({
          kind: "rewrote_phase_complete_claim",
          field: "phase_complete",
          before: before.trim(),
          after: blockerLine,
        });
      }
    }
  }

  // ── 6. "X of Y required artefacts" claims ──
  // Nova said "3 of 3 required artefacts are APPROVED" when the methodology
  // has 0 artefacts marked required:true (4 are ai-generatable). The "3
  // required" subset is fabricated — there is no required subset. Replace
  // with the actual numbers.
  if (phase) {
    const REQUIRED_COUNT_PATTERNS: RegExp[] = [
      /(\b(\d+)\s+of\s+(\d+)\s+required\s+artefacts?\b)/gi,
      /(\b(\d+)\/(\d+)\s+required\s+artefacts?\b)/gi,
      /(\b(\d+)\s+required\s+artefacts?\s+(?:are|have\s+been)\s+approved\b)/gi,
    ];
    const realCount = phase.requiredArtefactCount > 0
      ? `${phase.artefacts.done} of ${phase.requiredArtefactCount} required artefacts approved (${phase.artefacts.total} total this phase)`
      : `${phase.artefacts.done}/${phase.aiGeneratableArtefactCount} artefacts generated (this phase has no strictly-required artefacts; ${phase.aiGeneratableArtefactCount} are AI-generatable)`;
    for (const re of REQUIRED_COUNT_PATTERNS) {
      const matches = Array.from(out.matchAll(re));
      for (const m of matches) {
        const before = m[1];
        // Skip if the asserted "Y" already matches the real required count.
        const assertedTotal = parseInt(m[3] ?? m[2] ?? "", 10);
        if (Number.isFinite(assertedTotal) && assertedTotal === phase.requiredArtefactCount && phase.requiredArtefactCount > 0) continue;
        out = out.replace(before, realCount);
        corrections.push({
          kind: "rewrote_required_count_claim",
          field: "required_artefacts",
          before: before.trim(),
          after: realCount,
        });
      }
    }
  }

  // Tidy double-spaces left by stripped tags
  out = out.replace(/[ \t]{2,}/g, " ").replace(/\s+\n/g, "\n");

  return { content: out, corrections };
}
