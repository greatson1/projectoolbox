/**
 * Cross-agent operating rules — single source of truth.
 *
 * These rules describe how every agent in the system should operate. They are
 * composed into every prompt the system sends to the LLM so behaviour stays
 * consistent across clarification, generation, replanning, and chat.
 *
 * Rules live HERE, not duplicated inline in each prompt builder, so a fix
 * lands in one place and propagates everywhere. Each rule is exported as a
 * named string and as a member of `OPERATING_RULES` for callers that want
 * the full block.
 */

/**
 * The agent does the legwork; the user only confirms what they uniquely know.
 *
 * The clarification flow used to drift into questions like "what is the
 * community venue research required?" or "what is the alternative entertainer
 * sourcing?" — these put the research burden back on the user, which defeats
 * the point of an autonomous PM. The rule below is repeated verbatim into
 * every clarification + generation prompt.
 */
export const RULE_RESEARCH_BEFORE_ASK = `🔍 RESEARCH-BEFORE-ASK RULE (applies to EVERY question you put to the user):

YOUR JOB is to do the research and present the user with CONCRETE OPTIONS to choose from.
The user's job is to confirm their preferences and tell you things only they know.

❌ NEVER ask the user open-ended meta-questions like:
   - "What is the [X] research required?"          ← you do the research
   - "What are the alternative [X] options?"        ← you find the alternatives
   - "What [X] sourcing should we consider?"        ← you find vendors/suppliers
   - "What are the considerations for [X]?"         ← you list them, user picks
   - "What approach should we take for [X]?"        ← propose 2–3, user picks
   - "What should the [X] strategy be?"             ← draft one, user edits
   - Any question where the user would reasonably reply "you tell me"

✅ INSTEAD:
   1. If the FEASIBILITY RESEARCH context contains 2+ candidates, ask as type "choice"
      with those candidates as options + "Other (please specify)" as the last option.
   2. If the research is thin, run more research before asking — do NOT push the
      thinking onto the user. Mark the field [TBC — researching X] in your draft
      and ask a precise question once you have real options.
   3. The only "text" questions allowed are for things ONLY the user knows:
      - Names of their internal stakeholders / team members
      - Specific internal constraints, budgets, deadlines they decided
      - Their own preferences when no objective answer exists
      - Specific values (account numbers, codes, references) they hold
   4. If you catch yourself wanting to ask "what is X" where X is a researchable
      topic, STOP — that's a research task, not a clarification question.

The user will see your questions inside their project chat. Every question
they have to think about instead of click through is friction. Concrete
choices > open prompts. Researched options > "what do you think?".`;

/**
 * Detect prompt anti-patterns at runtime — belt-and-braces against the LLM
 * still sneaking through bad questions despite the rule above.
 *
 * Returns true if the question text matches a known meta-pattern that
 * shouldn't have been generated. Callers can use this to drop, downgrade,
 * or rewrite the question before it reaches the user.
 */
const META_QUESTION_PATTERNS: RegExp[] = [
  /\bresearch\s+(?:is\s+)?required\b/i,                 // "research required"
  /\bwhat\s+(?:are\s+the\s+)?(?:alternative|options?)\b/i,    // "what alternative...", "what options..."
  /\bsourcing\s+(?:options?|alternatives?|strategy)\b/i,      // "sourcing options"
  /\b(?:considerations?|factors?)\s+(?:for|when|to)\b/i,      // "considerations for"
  /\bwhat\s+approach\s+(?:should|would|to)\b/i,               // "what approach should"
  /\bwhat\s+strategy\s+(?:should|would|to)\b/i,               // "what strategy"
  /\bwhich\s+(?:vendors?|suppliers?|providers?)\b/i,          // "which vendors"
  /\bsuggest\s+(?:some|a\s+few)\b/i,                          // "suggest some"
  /\bwhat\s+do\s+you\s+(?:think|suggest|recommend)\b/i,       // "what do you think"
];

export interface AntiPatternMatch {
  pattern: string;
  reason: string;
}

export function detectMetaQuestion(question: string): AntiPatternMatch | null {
  if (!question) return null;
  for (const re of META_QUESTION_PATTERNS) {
    if (re.test(question)) {
      return {
        pattern: re.source,
        reason:
          "This question asks the user to do research the agent should do. " +
          "Convert to a 'choice' question with researched options, or run more research first.",
      };
    }
  }
  return null;
}

/**
 * Compact one-liner version for embedding alongside other prompt rules where
 * the full block would be too verbose (e.g. follow-up clarification, replan
 * prompts). Pair with `RULE_RESEARCH_BEFORE_ASK` for the first contact and
 * use this terser form on subsequent prompts in the same flow.
 */
export const RULE_RESEARCH_BEFORE_ASK_SHORT =
  "RESEARCH-BEFORE-ASK: never ask the user 'what are the options for X' — research X yourself, then present the options as a choice question. Only ask 'text' questions for things only the user knows (their team, their preferences, their internal constraints).";

/**
 * The full bundle — import this when you want every operating rule in one
 * block. Individual rules are exported so callers can compose subsets.
 */
export const OPERATING_RULES = {
  researchBeforeAsk: RULE_RESEARCH_BEFORE_ASK,
  researchBeforeAskShort: RULE_RESEARCH_BEFORE_ASK_SHORT,
} as const;
