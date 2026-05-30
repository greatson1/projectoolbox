/**
 * Sentry edge-runtime init (middleware, edge API routes).
 *
 * Loaded by `src/instrumentation.ts` when NEXT_RUNTIME === "edge".
 * No-op when SENTRY_DSN is unset.
 */
import * as Sentry from "@sentry/nextjs";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
    sendDefaultPii: false,
  });
}