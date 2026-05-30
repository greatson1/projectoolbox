/**
 * Sentry client-side init.
 *
 * Next.js 16 + Sentry v10 auto-loads this file in the browser. Keeps the
 * frontend signal narrow: errors + breadcrumbs only, no session replay
 * (heavy) and no performance traces by default.
 *
 * No-op when NEXT_PUBLIC_SENTRY_DSN is unset.
 */
import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
    ignoreErrors: [
      // ResizeObserver / NextRouter cancellations — noisy and not actionable.
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      "NEXT_REDIRECT",
      "NEXT_NOT_FOUND",
    ],
  });
}

// Optional client-side router transition hook for Sentry tracing. Required
// by the Sentry Next.js v10 SDK so router errors are captured even if
// performance tracing is disabled.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;