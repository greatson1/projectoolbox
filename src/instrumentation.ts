/**
 * Next.js server-boot hook.
 *
 * Called once when the Node.js runtime starts (per Next.js
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation).
 *
 * Currently only used to install LLM fake mode for E2E tests when the
 * ANTHROPIC_FAKE / PERPLEXITY_FAKE env flags are set. Both flags
 * default to off, so this is a no-op in production.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installLLMFakes } = await import("@/lib/agents/llm-fake");
    installLLMFakes();
  }
}
