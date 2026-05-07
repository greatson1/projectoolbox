# E2E tests (tier 3 — Playwright)

Full user-journey browser tests. Skipped by default — only run when
`E2E=1` is set. Designed to gate PR merges, not every commit.

## Why so guarded?

- Slow (minutes per scenario)
- Need a running Next.js dev server
- Need a seeded test DB
- Need LLM endpoints mocked at the network layer (deterministic)

When integration tests (tier 2) and unit tests (tier 1) catch most of
the bugs, E2E exists to protect against full-flow regressions:
auth → deploy → answer questions → approve artefacts → advance phase.

## One-time setup

```bash
# Install Playwright (NOT a default dependency to keep install lean)
npm install --save-dev @playwright/test
npx playwright install chromium
```

## Running locally

```bash
# Terminal 1: dev server with LLM-fake mode
ANTHROPIC_FAKE=1 PERPLEXITY_FAKE=1 npm run dev

# Terminal 2: tests
E2E=1 BASE_URL=http://localhost:3000 npx playwright test
```

`ANTHROPIC_FAKE` / `PERPLEXITY_FAKE` are the env-flag check the
server-side code consults before falling back to a local fake response
that mirrors the shape `stubLLM` (in `helpers/llm-mock.ts`) returns.
Without them, server-side `fetch` calls to anthropic.com escape
Playwright's `page.route` interceptor (which only catches browser
fetches).

> ⚠️ The fake-mode hooks aren't wired in the production code yet —
> when adding the first real E2E scenario, drop a small env-check
> guard at the top of `src/lib/agents/llm.ts` and
> `src/lib/agents/feasibility-research.ts` to short-circuit to a
> local fixture when `ANTHROPIC_FAKE === "1"` /
> `PERPLEXITY_FAKE === "1"`.

## Writing a new E2E test

1. Add a new `*.spec.ts` under `tests/e2e/`.
2. Use `stubLLM(page, scenario)` in `beforeEach` to canned-response
   the Anthropic + Perplexity calls.
3. Drive a single user journey end-to-end. Keep it tight — no deep
   functional coverage; that belongs in tier 2.
4. Assert on **shape consistency** between surfaces (banner +
   pipeline + page) — that's where E2E uniquely shines.

## Existing tests

- `golden-path.spec.ts` — placeholder smoke. Two tests both currently
  `test.skip` until you set `E2E_DEPLOYMENT_URL` / `E2E_PROJECT_ID`.
  Implement the seeding flow in a `beforeAll` hook before flipping
  these to required.

## CI integration

```yaml
# Suggested GitHub Actions step (run on PR merge queue, not every push)
- name: E2E
  if: github.event_name == 'pull_request' && github.event.pull_request.head.ref != 'main'
  run: |
    docker compose up -d postgres
    npm install
    npx playwright install --with-deps chromium
    ANTHROPIC_FAKE=1 PERPLEXITY_FAKE=1 npm run dev &
    sleep 10
    E2E=1 BASE_URL=http://localhost:3000 npx playwright test
```
