# Integration tests (tier 2 — API contract)

These tests exercise the helpers that API routes depend on
(`getPhaseCompletion`, `getNextRequiredStep`, `methodology-definitions`,
etc.) against a real Postgres. They catch the **cross-surface
inconsistency** class of bug — the kind where page A and page B both
read from the DB but report different totals because they rolled
their own derivation.

## Why a separate tier?

| Tier | What it catches | Speed |
|---|---|---|
| Unit (`src/**/*.test.ts`) | Pure-function logic — regex edge cases, sanitiser bypasses | ~500 ms total |
| **Integration (this dir)** | DB-derived state divergence across helpers — the "3 vs 4 artefact" bug | 5–30 s |
| E2E (`tests/e2e/`) | Full user journey breakage — login → deploy → approve | minutes |

## Setup

These tests refuse to run without `TEST_DATABASE_URL`. Use a
**separate** Postgres instance — the cleanup helpers issue real
DELETEs scoped to test-prefix orgs.

Two safe options:

1. **Local Postgres** — fastest. Spin up a container:
   ```bash
   docker run --name pgtest -e POSTGRES_PASSWORD=test -p 5433:5432 -d postgres:16
   export TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/postgres"
   npx prisma db push --schema prisma/schema.prisma
   ```

2. **Separate Supabase project** — slower but matches prod shape.
   Create a fresh project, copy its connection string into
   `.env.test`, run `prisma db push` against it.

## Running

```bash
TEST_DATABASE_URL="<connection string>" npm run test:integration
```

Watch mode:

```bash
TEST_DATABASE_URL="<connection string>" npx vitest --config vitest.integration.config.ts
```

## Writing a new test

1. Import helpers from `./helpers/test-db`.
2. In `beforeAll`, call `createTestOrg(label)` then
   `createTestProject(orgId, opts)` to seed scenario state.
3. Exercise the helper under test.
4. In `afterAll`, call `cleanupTestOrg(orgId)` — drops every row scoped
   to that org.

Example: `artefact-counts.integration.test.ts` — pins the contract
that methodology total ≥ phase-completion total when an artefact is
missing, and that no surface should derive totals from `required:true`.

## If a previous run crashed

Leftover test orgs are easy to spot — slug starts with `__test_`.
Sweep them all:

```ts
import { sweepAllTestOrgs } from "./helpers/test-db";
console.log(`Cleaned ${await sweepAllTestOrgs()} orphan test orgs`);
```

Or via SQL:

```sql
-- Inspect
SELECT id, slug, name FROM "Organisation" WHERE slug LIKE '__test_%';

-- Cleanup (cascade-safe via the helper, NOT this raw DELETE)
```

## What integration tests don't cover

- HTTP layer (auth, request parsing) — would need a session-mock
  helper. Add when the first auth-related bug surfaces.
- React components — covered by tier 1 component tests with React
  Testing Library.
- LLM-dependent endpoints (chat-stream, research) — those need the
  Anthropic / Perplexity calls mocked. Easier to do at tier 3 with
  Playwright's `page.route` than mid-test here.
