# CI workflows

Two GitHub Actions workflows wire the three test tiers into automatic
runs. See `tests/integration/README.md` and `tests/e2e/README.md` for
the test details themselves; this file is just about CI plumbing.

## ci.yml — runs on every push + PR

No secrets required. Spins up a Postgres service container, then in
order:

1. `npm ci`
2. `prisma db push` (against the service container)
3. `npm run lint`
4. `npx tsc --noEmit`
5. `npm test` (tier 1, 107 unit tests)
6. `npx playwright install chromium`
7. `npm run build` + start dev server
8. `npm run test:e2e -- smoke` (tier 3 smoke, 3 tests)

Total runtime: ~5–8 min cold cache, ~3–4 min with cache hit.

If the smoke E2E fails, the Playwright report is uploaded as an
artifact (`playwright-report-smoke`) — download from the run summary
in GitHub Actions.

## ci-integration.yml — runs on PRs to master/main

Uses repository secrets. Two jobs:

### `integration` — tier 2 contract tests
Always runs. Uses the same Postgres service container approach.
Asserts cross-surface helper consistency (artefact counts,
phase-next-action resolver, etc).

### `golden-path` — tier 3 authenticated E2E
**Skipped automatically** if `E2E_AUTH_BYPASS_TOKEN` isn't configured —
keeps the workflow green on forks and first-time contributors. To
enable, set the secret (see below).

## Required repository secrets

Set these in **Settings → Secrets and variables → Actions** for the
golden-path job to run:

| Secret | What it is | How to generate |
|---|---|---|
| `E2E_AUTH_BYPASS_TOKEN` | 32+ char shared secret. Used by both the dev server (env var) and the test runner (form post). Constant-time compared in `auth.ts`. | `openssl rand -hex 32` |

Optional repository **variable** (not secret):

| Variable | Purpose |
|---|---|
| `HAS_E2E_BYPASS_TOKEN` | Set to `true` to force the golden-path job to attempt to run even on a fork that can't read the secret — useful for triaging unexpected skips. |

The CI workflow seeds its own test user on each run (the seed step is
inline in `ci-integration.yml`), so `E2E_TEST_USER_ID` doesn't need to
be a stored secret — it's captured from the seed step's stdout and
piped into the test runner via `${{ steps.seed.outputs.USER_ID }}`.

## Local repro of a failed CI run

```bash
# Match the CI Postgres setup
docker run --name pgci -e POSTGRES_PASSWORD=test -e POSTGRES_DB=projectoolbox_ci -p 5432:5432 -d postgres:16

export DATABASE_URL=postgres://postgres:test@localhost:5432/projectoolbox_ci
export NEXTAUTH_SECRET=ci-only-not-a-real-secret-just-needs-to-exist-32chars
export AUTH_SECRET=$NEXTAUTH_SECRET
export ANTHROPIC_FAKE=1
export PERPLEXITY_FAKE=1

npm ci
npx prisma db push --accept-data-loss
npm run lint
npx tsc --noEmit
npm test
npx playwright install chromium
npm run build
npm run start &
sleep 8
E2E=1 BASE_URL=http://localhost:3000 npm run test:e2e -- smoke
```

This mirrors `ci.yml` exactly — same env, same order. If something
passes locally and fails in CI, the difference is almost always
cache state or service-container timing — not the test itself.

## Adding a new workflow

Keep the CI / integration split honest:
- **No-secrets work** → `ci.yml`. Runs on every push, gates merges.
- **Secret-dependent work** → new file. Runs on PR-only or
  `workflow_dispatch`. Document the secret in this README.
