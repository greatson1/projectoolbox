/**
 * Sentry server-side init.
 *
 * Loaded by `src/instrumentation.ts` when NEXT_RUNTIME === "nodejs".
 * No-op when SENTRY_DSN is unset — safe to deploy without DSN configured.
 */
import * as Sentry from "@sentry/nextjs";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,

    // Sample 10% of transactions in prod (zero in dev). Tune up once volume
    // is understood.
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,

    // Off by default — replay is a frontend feature, performance traces add
    // overhead. Errors + breadcrumbs are what we need for 2000-user ops.
    profilesSampleRate: 0,

    // Strip noisy Next.js framework events we can't act on.
    ignoreErrors: [
      // Vercel cold-start aborts when the lambda is recycled mid-request.
      "AbortError",
      // Anthropic 429/529 — already surfaced to the user; not actionable.
      /Rate limited by Anthropic/i,
      /Anthropic API is temporarily overloaded/i,
    ],

    // Trim PII — projectoolbox stores no user PII in error bodies, but be
    // defensive in case a stack trace leaks an email or token.
    sendDefaultPii: false,
  });
}