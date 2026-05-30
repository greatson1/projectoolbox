/**
 * Next.js server-boot hook.
 *
 * Called once when the Node.js runtime (or edge runtime) starts.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Responsibilities:
 *   1. Initialise Sentry for the runtime that started (server or edge).
 *      Both configs are no-ops if SENTRY_DSN is unset, so this is safe
 *      regardless of environment.
 *   2. Install LLM fake mode for E2E tests when the ANTHROPIC_FAKE /
 *      PERPLEXITY_FAKE env flags are set. Both flags default to off, so
 *      this is a no-op in production.
 */
import * as Sentry from "@sentry/nextjs";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    const { installLLMFakes } = await import("@/lib/agents/llm-fake");
    installLLMFakes();
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/** Bridge for App Router request errors so Sentry sees them. */
export const onRequestError = Sentry.captureRequestError;