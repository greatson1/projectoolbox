import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import path from "node:path";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // Pin Turbopack's workspace root to THIS directory. Without this,
  // Next.js infers the nearest ancestor that contains a package-lock —
  // and on developer machines that may be a sibling project at
  // C:\Users\info\package.json (a stray Vite app), which causes
  // tailwindcss + every other dep to fail resolution from the wrong
  // node_modules tree. Pinning fixes both `next dev` and `next build`
  // when Turbopack would otherwise OOM trying to traverse the wrong
  // tree.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Note: for audio uploads > 4.5 MB on Vercel free tier,
  // set BODY_SIZE_LIMIT=25mb in Vercel dashboard environment variables.
  // On Pro+, configure in vercel.json under functions.maxDuration.
};

// Wrap with Sentry. No-op at runtime when SENTRY_DSN is unset; the build-time
// uploads (source maps, release tagging) only run when SENTRY_AUTH_TOKEN +
// SENTRY_ORG + SENTRY_PROJECT are set in CI/Vercel, so local dev builds stay
// clean.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  silent: !process.env.CI,
  // Don't widen request bodies — we set sendDefaultPii: false in the runtime configs.
  widenClientFileUpload: true,
  // Source-map upload is skipped automatically when authToken is unset.
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  // Tunnels Sentry traffic through your domain to bypass ad-blockers; safe to
  // leave on — adds one rewrite, no behaviour change without DSN.
  tunnelRoute: "/monitoring",
  disableLogger: true,
  automaticVercelMonitors: false,
});