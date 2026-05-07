import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config for API contract / integration tests.
 *
 * These tests hit a real Postgres (set via TEST_DATABASE_URL) and exercise
 * the helpers that API routes rely on — getPhaseCompletion, getNextRequiredStep,
 * methodology-definitions vs phase-tracker, etc. — to catch the cross-surface
 * inconsistency class of bug.
 *
 * Run with:
 *   TEST_DATABASE_URL=postgres://… npm run test:integration
 *
 * Tests will refuse to run without TEST_DATABASE_URL — guards against
 * accidentally polluting the dev database. Use a separate Supabase project
 * for the test DB, OR a local Postgres instance.
 */
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.integration.test.ts"],
    environment: "node",
    globals: false,
    // Integration tests touch the DB — single-thread avoids deadlocks
    // on Prisma's connection pool when multiple suites seed at once.
    pool: "threads",
    fileParallelism: false,
    // Some tests seed several rows; give them headroom but not infinity.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
