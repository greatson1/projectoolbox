/**
 * Backstop fact extraction for the chat agent.
 *
 * The system prompt instructs Claude to ALWAYS use <ASK> tags and to emit
 * <FACTS> blocks when the user provides new info, but Claude regularly
 * forgets one or both. When that happens, the user's plain-text answer to
 * a plain-text question is never persisted as a structured fact, and the
 * agent re-asks the same question on the next turn.
 *
 * This module runs after the user submits a chat message: if the most
 * recent agent message contained a question and the user's reply looks
 * substantive, ask Haiku to extract a {title, content} fact pair which is
 * then stored to the KB via storeFactToKB. Cost: ~1k tokens of Haiku per
 * triggered turn (≈ $0.0001).
 */

interface ExtractedFact {
  title: string;
  content: string;
}

/**
 * Returns the question text the agent asked, or null if the message isn't a
 * question worth attributing the next user reply to.
 *
 * Handles two cases:
 * 1. Structured agent-question card (content === "__AGENT_QUESTION__" with
 *    metadata.type === "agent_question"). These are generated when Claude
 *    emits a single <ASK> tag — they render as a Q&A card on the frontend
 *    but, for single-question cards, there's NO clarification session, so
 *    the user's reply has no automatic fact-storage path. The metadata
 *    holds the actual question text we use here.
 * 2. Plain prose ending in "?". Claude regularly violates the "always use
 *    <ASK>" rule and asks questions inline. Any answer the user gives is
 *    otherwise lost from the structured-fact perspective.
 *
 * Excludes: __CLARIFICATION_COMPLETE__, __PROJECT_STATUS__, and any other
 * placeholder content not paired with question-shaped metadata.
 */
export function getQuestionToBackstop(
  content: string,
  metadata: unknown,
): string | null {
  if (!content && !metadata) return null;
  const meta = (metadata && typeof metadata === "object" ? metadata : {}) as Record<string, unknown>;
  const metaType = typeof meta.type === "string" ? meta.type : null;
  const metaQuestion = meta.question as { question?: string } | undefined;

  // Case 1: structured agent-question card
  if (metaType === "agent_question" && metaQuestion?.question) {
    return metaQuestion.question;
  }

  // Case 2: prose with "?" — exclude internal placeholders that have no
  // user-facing question text in their content
  if (!content || content.startsWith("__")) return null;
  const stripped = content
    .replace(/<ASK[\s\S]*?<\/ASK>/gi, "")
    .replace(/<FACTS>[\s\S]*?<\/FACTS>/gi, "")
    .trim();
  if (!/\?/.test(stripped)) return null;
  return stripped;
}

/**
 * @deprecated Use getQuestionToBackstop instead — this signature can't
 * see the metadata field, so it misses __AGENT_QUESTION__ cards.
 * Kept as a thin wrapper for callers that haven't been updated yet.
 */
export function agentMessageContainsQuestion(content: string): boolean {
  return getQuestionToBackstop(content, null) !== null;
}

/**
 * Returns true if the user's reply is too short or non-substantive to be
 * worth running an LLM extraction on. Cheap pre-filter that saves the
 * Haiku call on chat noise like "ok", "wait", "what?".
 */
export function replyLooksSubstantive(reply: string): boolean {
  if (!reply) return false;
  const trimmed = reply.trim();
  if (trimmed.length < 2) return false;
  // Clarifying questions back to the agent — not an answer.
  if (/^(what|why|how|when|where|huh|sorry)\??$/i.test(trimmed)) return false;
  // Pure acknowledgements — not an answer worth extracting.
  if (/^(ok|okay|yes|no|sure|thanks?|cheers|got it|hold on|wait|one sec)\.?!?$/i.test(trimmed)) return false;
  return true;
}

/**
 * Calls Haiku to decide whether the user's reply answers the agent's
 * question, and if so, returns a {title, content} fact pair. Returns
 * null when the reply isn't an answer or the call fails.
 */
export async function extractAnswerFromReply(
  agentQuestion: string,
  userReply: string,
): Promise<ExtractedFact | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const prompt = `An AI project-management agent asked the user a question. The user replied. Decide whether the reply is a substantive answer to the question and, if so, extract a single fact pair to store in the project knowledge base.

AGENT QUESTION:
${agentQuestion}

USER REPLY:
${userReply}

Return STRICT JSON only — no preamble, no markdown fences:
{ "isAnswer": true|false, "title": "<2-5 word label>", "content": "<one sentence stating the fact>" }

Rules:
- isAnswer = false for: clarifying questions back to the agent, refusals ("not yet", "I don't know"), pure acknowledgements ("ok", "thanks"), off-topic replies.
- isAnswer = true only when the reply provides concrete information (a name, number, date, choice, yes/no) that resolves the agent's question.
- title: a short label suitable as a KB item title — e.g. "Project Sponsor", "Travel Class", "Venue Confirmed".
- content: a single sentence in the form "<title>: <user's value>." e.g. "Project Sponsor: Ty Yohny." Do not include any preamble or commentary.
- If isAnswer is false, set title and content to empty strings.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const text = (data.content?.[0]?.text || "").trim();
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(clean);
    if (!parsed || parsed.isAnswer !== true) return null;
    const title = String(parsed.title || "").trim();
    const content = String(parsed.content || "").trim();
    if (!title || !content) return null;
    return { title, content };
  } catch (e) {
    console.error("[extract-answer-from-reply] failed:", e);
    return null;
  }
}
