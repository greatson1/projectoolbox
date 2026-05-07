/**
 * Playwright fetch interceptor for LLM endpoints — keeps E2E runs
 * deterministic and free.
 *
 * Routes intercepted:
 *   - api.anthropic.com/v1/messages (Sonnet/Haiku)
 *   - api.perplexity.ai/chat/completions (research)
 *
 * For each, the helper returns a canned response that mirrors the
 * shape the production code expects. Tests can register scenario-
 * specific overrides via stubLLM(page, scenario).
 *
 * Why intercept at the network layer (not mock at the module level)?
 *   - Module-level mocks need server-side test injection — works in
 *     vitest but Playwright runs the real Next.js server. Intercepting
 *     network is the only way to stub LLM calls without forking the
 *     server. Anthropic + Perplexity calls happen from the server,
 *     so we intercept via Playwright's `page.route` AND a server-side
 *     env-flag check. Since Playwright `route` only catches browser
 *     fetches, you ALSO need to set ANTHROPIC_FAKE=1 in the dev-server
 *     env so the routes fall through to the local fake endpoints below.
 *     See tests/e2e/README.md for the wiring.
 */

import type { Page } from "@playwright/test";

export interface LLMScenario {
  /** Returned by Haiku when asked for clarification questions. */
  clarificationQuestions?: Array<{ question: string; field: string; type: "yesno" | "free" }>;
  /** Returned by the research-query builder. */
  researchQueries?: Array<{ artefact: string; query: string; rationale?: string }>;
  /** Returned by Perplexity. */
  researchFacts?: Array<{ title: string; content: string; targetArtefact?: string }>;
  /** Returned by Sonnet for chat replies. Plain text. */
  chatReply?: string;
}

const DEFAULT: Required<LLMScenario> = {
  clarificationQuestions: [
    { question: "Confirm group size", field: "groupSize", type: "free" },
  ],
  researchQueries: [
    {
      artefact: "Problem Statement",
      query: "Mock query for Problem Statement",
      rationale: "test fixture",
    },
  ],
  researchFacts: [
    { title: "Mock fact", content: "Mock content for testing.", targetArtefact: "Problem Statement" },
  ],
  chatReply: "Mock chat reply from sanitised Sonnet output.",
};

export async function stubLLM(page: Page, scenario: LLMScenario = {}): Promise<void> {
  const s = { ...DEFAULT, ...scenario };

  // Anthropic — fake an Anthropic /v1/messages response shape.
  await page.route("**/api.anthropic.com/v1/messages", async (route) => {
    const body = JSON.stringify({
      id: "msg_mock",
      type: "message",
      role: "assistant",
      model: "claude-mock",
      content: [{ type: "text", text: pickAnthropicResponse(route.request().postData(), s) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    await route.fulfill({ status: 200, contentType: "application/json", body });
  });

  // Perplexity — research endpoint
  await page.route("**/api.perplexity.ai/chat/completions", async (route) => {
    const body = JSON.stringify({
      id: "px_mock",
      choices: [{
        message: {
          role: "assistant",
          content: s.researchFacts.map(f => `### ${f.title}\n${f.content}`).join("\n\n"),
        },
      }],
      citations: [],
    });
    await route.fulfill({ status: 200, contentType: "application/json", body });
  });
}

function pickAnthropicResponse(reqBody: string | null, s: Required<LLMScenario>): string {
  // Look at the prompt to decide which scenario response to send.
  // Crude but matches how production code differentiates Haiku tasks.
  const prompt = (reqBody || "").toLowerCase();
  if (prompt.includes("clarification") && prompt.includes("question")) {
    return JSON.stringify(s.clarificationQuestions);
  }
  if (prompt.includes("artefact") && prompt.includes("queries")) {
    return JSON.stringify(s.researchQueries);
  }
  return s.chatReply;
}
