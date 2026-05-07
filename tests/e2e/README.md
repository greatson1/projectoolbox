# E2E tests (tier 3 — Playwright)

Full user-journey browser tests. Skipped by default — only run when
`E2E=1` is set. Designed to gate PR merges, not every commit.

## What's actually runnable today

After commit `<this PR>`, two suites genuinely exercise the live app:

1. **`smoke.spec.ts`** — public-route smoke (login renders, 404 is
   clean, dashboard bounces unauthenticated users). **No env wiring
   needed beyond a running dev server.**
2. **`golden-path.spec.ts`** — authenticated dashboard via the E2E
   auth-bypass provider. Skipped until `E2E_AUTH_BYPASS_TOKEN` and
   `E2E_TEST_USER_ID` are set.

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
