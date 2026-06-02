# E2E tests (tier 3 — Playwright)

Full user-journey browser tests. Skipped by default — only run when
`E2E=1` is set. Designed to gate PR merges, not every commit.

## What's actually runnable today

Four suites — all green at 62/62 against `http://localhost:3030`
(local walkthrough), and 57/57 against `https://projectoolbox.com`
(live monitoring):

1. **`smoke.spec.ts`** — public-route smoke (login renders, 404 is
   clean, dashboard bounces unauthenticated users). **No env wiring
   needed beyond a running server at BASE_URL.**
2. **`public-surface.spec.ts`** — value-prop verification + homepage
   screenshot. Asserts the marketing copy matches what the deploy
   wizard offers (Traditional, Scrum, Waterfall, SAFe, Kanban, Hybrid;
   no PRINCE2 / PMI-Style).
3. **`unhappy-paths.spec.ts`** — 20 protected pages redirect on no
   auth; 6 protected APIs return 401/403/302/404/405 (never leak data);
   malformed URLs handled; XSS-in-query-params guarded; static metadata
   (favicon / robots / sitemap / `<title>` / OG tags) served.
4. **`live-walkthrough.spec.ts`** — authenticated journey: signup →
   onboarding → create project → visit every project sub-page (27)
   and every dashboard page (15) → create a real risk via the UI.
   Requires a local dev server with `ADMIN_SECRET`, a non-prod DB,
   and LLM fakes; see "Quick local walkthrough" below.

## Quick local walkthrough — full authenticated suite

Verified working on Windows + Next.js 16 (Turbopack) after the
`next.config.ts` `turbopack.root` pin landed.

```bash
# 0. Browser binary (one-time)
npx playwright install chromium

# 1. Throwaway Postgres
docker run --name pgwalk -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=projectoolbox_walk -p 5433:5432 -d postgres:16

# 2. Push schema to the walkthrough DB
npx prisma db push \
  --url postgresql://postgres:test@localhost:5433/projectoolbox_walk \
  --accept-data-loss

# 3. Throwaway env file (DO NOT COMMIT — already in .gitignore)
cat > .env.walk <<EOF
DATABASE_URL=postgresql://postgres:test@localhost:5433/projectoolbox_walk
DIRECT_URL=postgresql://postgres:test@localhost:5433/projectoolbox_walk
NEXTAUTH_SECRET=walk-only-not-a-real-secret-just-needs-to-exist-32chars
AUTH_SECRET=walk-only-not-a-real-secret-just-needs-to-exist-32chars
NEXTAUTH_URL=http://localhost:3030
ADMIN_SECRET=$(grep '^ADMIN_SECRET=' .env | cut -d= -f2)
ANTHROPIC_FAKE=1
PERPLEXITY_FAKE=1
NEXT_TELEMETRY_DISABLED=1
PORT=3030
EOF

# 4. Start dev server with raised heap (avoids the 11-worker OOM
#    on the page-data collection step)
set -a && . .env.walk && set +a
npm run dev:walk &   # script wires --max-old-space-size=8192

# 5. Wait for it to boot, then run all four suites
until curl -sf -o /dev/null http://localhost:3030/login; do sleep 5; done
E2E=1 BASE_URL=http://localhost:3030 npx playwright test \
  tests/e2e/smoke.spec.ts \
  tests/e2e/public-surface.spec.ts \
  tests/e2e/unhappy-paths.spec.ts \
  tests/e2e/live-walkthrough.spec.ts

# 6. Teardown
docker rm -f pgwalk
rm -f .env.walk dev.log
```

The signup-gate test relaxes its URL assertion to accept either
`/signup` or `/waitlist` because `INVITE_ONLY=true` in your env will
redirect through proxy.ts middleware. Both are valid; the test only
enforces no 5xx.

## Auth-bypass golden-path (for CI)

`golden-path.spec.ts` is a leaner alternative used by CI when the
full live-walkthrough's invite + onboarding APIs aren't desired.
Authenticates via the E2E bypass provider. Skipped until
`E2E_AUTH_BYPASS_TOKEN` and `E2E_TEST_USER_ID` are set.

## Setup

### One-time

```bash
# Playwright is already installed via package.json.
# But the chromium browser binary is separate:
npx playwright install chromium
```

### Per-run env

```bash
# Generate a one-time bypass token (32+ chars):
export E2E_AUTH_BYPASS_TOKEN="$(openssl rand -hex 32)"

# A seeded user that exists in your dev DB:
export E2E_TEST_USER_ID="cm..."   # paste any real user.id from your dev DB
```

## Running the smoke suite (no auth, no DB seeding)

```bash
# Terminal 1 — dev server
npm run dev

# Terminal 2 — tests
E2E=1 npm run test:e2e -- smoke
```

If the dev server is healthy, all three smoke tests should pass within
seconds. If they fail, the next-tier tests can't possibly pass —
debug here first.

## Running the golden-path suite (auth bypass + LLM fakes)

```bash
# Terminal 1 — dev server with bypass + fakes
E2E_AUTH_BYPASS=1 \
  E2E_AUTH_BYPASS_TOKEN="$E2E_AUTH_BYPASS_TOKEN" \
  ANTHROPIC_FAKE=1 \
  PERPLEXITY_FAKE=1 \
  npm run dev

# Terminal 2 — tests
E2E=1 \
  E2E_AUTH_BYPASS_TOKEN="$E2E_AUTH_BYPASS_TOKEN" \
  E2E_TEST_USER_ID="$E2E_TEST_USER_ID" \
  npm run test:e2e -- golden-path
```

The dev server will print:

```
[auth] ⚠️ E2E AUTH BYPASS ACTIVE — accept-by-token credential provider registered.
[llm-fake] FAKE LLM MODE ACTIVE — Anthropic=true, Perplexity=true.
```

If you don't see those, the env flags aren't being read by Next.js
(check spelling, restart dev server).

## How the wiring works

### 1. LLM fakes (`src/instrumentation.ts` → `src/lib/agents/llm-fake.ts`)

Next.js calls `register()` once on server boot. When `ANTHROPIC_FAKE=1`
or `PERPLEXITY_FAKE=1`, `installLLMFakes()` monkey-patches
`globalThis.fetch` to short-circuit `api.anthropic.com/v1/messages`
and `api.perplexity.ai/chat/completions` with canned, deterministic
responses. Other URLs pass through.

Hard-guarded: the wrapper isn't installed unless an env flag is set.
A boot-time `console.warn` makes the fake mode loud.

### 2. Auth bypass (`src/lib/auth.ts`)

When `E2E_AUTH_BYPASS=1`, an additional `e2e-bypass` `CredentialsProvider`
is registered. It accepts `userId` + `token`, validates the token via
constant-time comparison against `E2E_AUTH_BYPASS_TOKEN`, and signs
the user in if they exist. Hard-guarded:

- Refuses to boot if `E2E_AUTH_BYPASS=1` and `NODE_ENV=production`.
- Refuses to boot if `E2E_AUTH_BYPASS=1` and the token is `<32` chars.
- The provider isn't even REGISTERED unless the flag is set — there's
  nothing to attack in production builds.

The Playwright test signs in by POSTing to `/api/auth/callback/e2e-bypass`
with `csrfToken + userId + token`, then carries the resulting session
cookie into `page.goto()`.

### 3. Helpers

- `tests/e2e/helpers/llm-mock.ts` — browser-side `page.route` wrapper
  for the rare path where the BROWSER (not the server) calls an LLM
  directly. Most code paths use server-side fetch, intercepted by the
  global hook above.

## Adding a new E2E test

1. Decide: does it need auth? If yes, follow the golden-path pattern.
2. Decide: does it touch agent / chat / research code paths? If yes,
   set `ANTHROPIC_FAKE=1` and / or `PERPLEXITY_FAKE=1` on the dev server
   so calls don't hit the real APIs.
3. Keep tests focused on **shape consistency between surfaces** — that's
   what tier 3 uniquely catches. Deep functional coverage belongs in
   tier 2.

## CI

```yaml
# Suggested PR-merge gate
- name: E2E
  run: |
    docker compose up -d postgres
    npm install
    npx playwright install --with-deps chromium
    E2E_AUTH_BYPASS=1 \
      E2E_AUTH_BYPASS_TOKEN="$E2E_AUTH_BYPASS_TOKEN" \
      ANTHROPIC_FAKE=1 PERPLEXITY_FAKE=1 \
      npm run dev &
    sleep 10
    E2E=1 \
      E2E_AUTH_BYPASS_TOKEN="$E2E_AUTH_BYPASS_TOKEN" \
      E2E_TEST_USER_ID="${{ secrets.E2E_TEST_USER_ID }}" \
      npm run test:e2e
  env:
    E2E_AUTH_BYPASS_TOKEN: ${{ secrets.E2E_AUTH_BYPASS_TOKEN }}
```

## Safety reminders

- `E2E_AUTH_BYPASS` MUST NEVER be set in production. The auth.ts boot
  check enforces this.
- `ANTHROPIC_FAKE` / `PERPLEXITY_FAKE` MUST NEVER be set in production
  unless you actually want the agent to lie to users.
- The bypass token MUST be rotated if it ever leaks. The auth.ts boot
  check requires `>=32` chars; treat it like any other secret.
