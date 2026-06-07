/**
 * Pure helpers for reasoning about __clarification_session__ KB state.
 * Lives in its own file (no db imports) so phase-next-action's session
 * source-of-truth check is regression-testable without spinning up a
 * Prisma client.
 */

/**
 * Given the JSON content of an active clarification session, return true
 * when ≥1 question is still unanswered. Returns false on null/malformed
 * content (callers should fall back to their other signals in that case).
 *
 * The shape we expect is the ClarificationSession the chat-stream route
 * writes:
 *   { questions: Array<{ id, text, answered?: boolean, ... }> }
 *
 * Failure mode this guards: status card reads the session and shows "19
 * Open questions" while the chat agent's next-action resolver concludes
 * "clarification already happened" from the existence of any artefact —
 * telling the user "no pending questions" while the same UI shouts about
 * 19. The session is the source of truth for "what's left to ask".
 */
export function sessionHasUnansweredQuestions(content: string | null | undefined): boolean {
  if (!content) return false;
  try {
    const sess = JSON.parse(content);
    if (!Array.isArray(sess?.questions)) return false;
    return sess.questions.some((q: any) => !q?.answered);
  } catch {
    return false;
  }
}
