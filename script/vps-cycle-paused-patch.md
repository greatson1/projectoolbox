# VPS-side `cyclePaused` patch

The Vercel side of Projectoolbox respects `AgentDeployment.cyclePaused` (default
`true`) so paused agents never run autonomous cycles from cron. The VPS bot
polls Supabase independently via its own equivalent of `getDueDeployments`
and currently does NOT apply the same filter — so a paused deployment on
the VPS will still cycle every 40 min, burning Claude credits.

This file holds three paste-ready forms of the same one-line fix. Apply
whichever matches the VPS bot's query style.

---

## 1. Postgres / Supabase REST direct query

If the VPS runs raw SQL or the Supabase HTTP API:

```sql
SELECT *
FROM "AgentDeployment" d
JOIN "Agent" a ON a.id = d."agentId"
WHERE d."isActive" = true
  AND d."cyclePaused" = false           -- ADD THIS LINE
  AND a.status = 'ACTIVE'
  AND (d."nextCycleAt" IS NULL OR d."nextCycleAt" <= NOW());
```

Supabase REST equivalent:

```bash
curl "$SUPABASE_URL/rest/v1/AgentDeployment?isActive=eq.true&cyclePaused=eq.false&nextCycleAt=lte.$(date -u +%FT%TZ)" \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
```

The new query-string parameter is `&cyclePaused=eq.false`.

---

## 2. Prisma JS (matches the Vercel side)

If the VPS bot uses Prisma against the same DB:

```js
await prisma.agentDeployment.findMany({
  where: {
    isActive: true,
    cyclePaused: false,                  // ADD THIS LINE
    agent: { status: "ACTIVE" },
    OR: [
      { nextCycleAt: null },
      { nextCycleAt: { lte: new Date() } },
    ],
  },
  include: { agent: true, project: true },
});
```

Identical to `src/lib/agents/job-queue.ts:getDueDeployments`.

---

## 3. supabase-js client

```js
const { data } = await supabase
  .from("AgentDeployment")
  .select("*, agent:Agent(*), project:Project(*)")
  .eq("isActive", true)
  .eq("cyclePaused", false)              // ADD THIS LINE
  .or(`nextCycleAt.is.null,nextCycleAt.lte.${new Date().toISOString()}`);
```

---

## Verification

After applying, check that paused deployments are excluded:

```sql
-- Should return zero rows IF the deployment is paused
SELECT id, "cyclePaused", "isActive", "nextCycleAt"
FROM "AgentDeployment"
WHERE id = '<paused deployment id>';

-- And should NOT appear in the bot's "due" list anymore.
```

To unpause for a specific deployment:

```sql
UPDATE "AgentDeployment"
SET "cyclePaused" = false
WHERE id = '<deployment id>';
```

The toggle is also exposed in the UI via the per-deployment Cycle Toggle
card on the agent's live page — users can flip it without SQL.

## Schema note

The `cyclePaused` column was added in the migration alongside the per-
deployment cycle toggle work. If the VPS Prisma client is older than that,
run `prisma generate` against the latest schema before deploying the patch
or the field won't be in the generated types.
