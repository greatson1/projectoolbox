/**
 * Central Claude model registry — the ONLY place model IDs live.
 *
 * Why this exists: on 2026-06-15 Anthropic retired `claude-sonnet-4-20250514`,
 * which was hardcoded in ~19 files. Every chat, artefact-generation, report,
 * meeting-processing and closure call started returning 404 not_found_error —
 * silently, because most call paths swallow LLM errors. A model retirement
 * must be a one-line change here, not a codebase-wide grep.
 *
 * Tiers:
 *   heavy — main reasoning/generation work (artefacts, chat, reports,
 *           meeting processing, closure, procurement).
 *   light — cheap/fast classification & extraction (clarification parsing,
 *           fact extraction, sentiment, validators).
 *
 * `claude-sonnet-5` notes (vs the old sonnet-4):
 *   - Thinking is ON by default when the `thinking` field is omitted, which
 *     changes the response shape (content[0] becomes a thinking block) and
 *     spends output tokens. All existing call sites parse content[0].text and
 *     size max_tokens tightly, so requests built from HEAVY_MODEL_REQUEST pin
 *     thinking OFF to preserve sonnet-4 behaviour. Adopt adaptive thinking
 *     deliberately, per call site, not by accident.
 *   - Non-default temperature/top_p/top_k now return 400 (none are used in
 *     this codebase today — keep it that way or gate them by tier).
 *   - New tokenizer: ~30% more tokens for the same text. max_tokens budgets
 *     are output-side and unchanged in meaning, but token-based cost maths
 *     and context-window estimates should be re-baselined.
 */
export const MODELS = {
  heavy: "claude-sonnet-5",
  light: "claude-haiku-4-5",
} as const;

/**
 * Spread into a /v1/messages request body in place of the old
 * `model: "claude-sonnet-4-20250514"` line:
 *
 *   body: JSON.stringify({
 *     ...HEAVY_MODEL_REQUEST,
 *     max_tokens: 2048,
 *     messages,
 *   })
 */
export const HEAVY_MODEL_REQUEST = {
  model: MODELS.heavy,
  thinking: { type: "disabled" as const },
} as const;
