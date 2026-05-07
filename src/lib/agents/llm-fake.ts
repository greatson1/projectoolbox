/**
 * LLM fake mode — server-side fetch interception for E2E tests.
 *
 * When ANTHROPIC_FAKE=1 (or PERPLEXITY_FAKE=1) is set, calling
 * installLLMFakes() wraps globalThis.fetch so that any request to
 * api.anthropic.com/v1/messages or api.perplexity.ai is short-circuited
 * with a canned, deterministic response. Other URLs pass through
 * untouched.
 *
 * Why monkey-patch globalThis.fetch instead of refactoring 15+ inline
 * fetch sites? Because every agent code path uses raw fetch + headers.
 * Wrapping at the boundary keeps the production code unchanged and the
 * mock hook trivially auditable — there's exactly one place that
 * decides what a fake response looks like.
 *
 * NEVER imported by anything except instrumentation.ts. NEVER active
 * outside fake-mode env. Designed to be safe to ship in prod (no-op
 * unless env flags are set explicitly).
 *
 * Wire-up:
 *   src/instrumentation.ts → register() → installLLMFakes()
 */

const originalFetch = globalThis.fetch;
let installed = false;

const ANTHROPIC_HOST = "api.anthropic.com";
const PERPLEXITY_HOST = "api.perplexity.ai";

export function installLLMFakes(): void {
  if (installed) return;
  const fakeAnthropic = process.env.ANTHROPIC_FAKE === "1";
  const fakePerplexity = process.env.PERPLEXITY_FAKE === "1";
  if (!fakeAnthropic && !fakePerplexity) return;

  installed = true;
  console.warn(
    `[llm-fake] FAKE LLM MODE ACTIVE — Anthropic=${fakeAnthropic}, Perplexity=${fakePerplexity}. ` +
    `Production agent calls will return canned fixtures. This MUST NEVER be set in production.`,
  );

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (fakeAnthropic && url.includes(ANTHROPIC_HOST)) {
      return fakeAnthropicResponse(init);
    }
    if (fakePerplexity && url.includes(PERPLEXITY_HOST)) {
      return fakePerplexityResponse(init);
    }
    return originalFetch(input, init);
  };
}

/**
 * Returns a Response shaped like Anthropic's POST /v1/messages reply.
 * Routes between sub-fixtures based on coarse prompt heuristics so the
 * agent code paths get a response that matches what they expect.
 */
function fakeAnthropicResponse(init?: RequestInit): Response {
  const body = typeof init?.body === "string" ? init.body : "";
  const promptText = (() => {
    try {
      const parsed = JSON.parse(body);
      const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
      return messages.map((m: { content?: unknown }) => typeof m.content === "string" ? m.content : "").join("\n").toLowerCase();
    } catch { return ""; }
  })();

  let text: string;
  if (promptText.includes("clarification") && (promptText.includes("question") || promptText.includes("yesno"))) {
    text = JSON.stringify([{ question: "Confirm group size", field: "groupSize", type: "free" }]);
  } else if (promptText.includes("artefact") && (promptText.includes("queries") || promptText.includes("search querie"))) {
    text = JSON.stringify([
      { artefact: "Problem Statement", query: "[FAKE] mock query for Problem Statement", rationale: "test fixture" },
    ]);
  } else if (promptText.includes("contradiction") || promptText.includes("inconsistenc")) {
    text = JSON.stringify({ contradictions: [] });
  } else if (promptText.includes("extract") && promptText.includes("fact")) {
    text = JSON.stringify({ budget: null, startDate: null, endDate: null, sponsor: null });
  } else {
    text = "[FAKE] Mock chat reply from sanitised Sonnet output.";
  }

  return new Response(
    JSON.stringify({
      id: "msg_fake",
      type: "message",
      role: "assistant",
      model: "claude-fake",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 20 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/**
 * Returns a Response shaped like Perplexity's chat completions reply.
 */
function fakePerplexityResponse(_init?: RequestInit): Response {
  return new Response(
    JSON.stringify({
      id: "px_fake",
      choices: [{
        message: {
          role: "assistant",
          content: "[FAKE PERPLEXITY] Mock research finding for testing.",
        },
      }],
      citations: [],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
