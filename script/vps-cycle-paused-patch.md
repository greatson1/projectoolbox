# VPS-side `cyclePaused` patch

The Vercel side of Projectoolbox respects `AgentDeployment.cyclePaused` (default
`true`) so paused agents never run autonomous cycles from cron. The VPS bot
polls Supabase independently via its own equivalent of `getDueDeployments`
and currently does NOT apply the same filter — so a paused deployment on
the VPS will still cycle every 40 min, burning Claude credits.

This file holds three paste-ready forms of the same one-line fix. Apply
whichever matches the VPS bot's query style.

---

## ⚡ Quickest path — paste this into SSH

```bash
# 1. SSH to the VPS (key from MEMORY.md)
ssh -i ~/.ssh/pmgtsclaw_v2 root@187.77.182.159

# 2. Identify which file holds the autonomous-cycle dispatcher.
#    Search the running container for a query that pulls
#    AgentDeployment rows with nextCycleAt:
docker exec openclaw-zj3a-openclaw-1 sh -c \
  "grep -rEl 'AgentDeployment.*nextCycleAt|getDueDeployments' /data/openclaw 2>/dev/null"

# 3. For each file the grep returns, find the WHERE block that
#    queries AgentDeployment and add ONE line so paused deployments
#    are excluded. Examples by query style:
#
#    Prisma:       cyclePaused: false,
#    supabase-js:  .eq("cyclePaused", false)
#    Raw SQL:      AND "cyclePaused" = false
#
# 4. Restart the container so the new code takes effect:
cd /docker/openclaw-zj3a && docker compose restart

# 5. Verify by listing what the bot now considers "due":
docker exec openclaw-zj3a-openclaw-1 sh -c \
  "node -e 'const{PrismaClient}=require(\"@prisma/client\");(async()=>{const db=new PrismaClient();console.log(await db.agentDeployment.findMany({where:{isActive:true,cyclePaused:false,OR:[{nextCycleAt:null},{nextCycleAt:{lte:new Date()}}]},select:{id:true,agentId:true,cyclePaused:true}}));})()'"
```

If the verification command returns paused deployments, the patch
didn't take. Re-check the file the grep flagged and confirm the
filter is in the same Prisma `where` block (or `.eq()` chain, etc.)
NOT a separate query.

### Sanity check before/after

```bash
# Cycles burned in the last 24h (BEFORE patch — expect numbers in the dozens):
docker exec openclaw-zj3a-openclaw-1 sh -c \
  "node -e 'const{PrismaClient}=require(\"@prisma/client\");(async()=>{const db=new PrismaClient();const since=new Date(Date.now()-24*3600000);console.log(\"autonomous_cycle activities in last 24h:\",await db.agentActivity.count({where:{type:\"autonomous_cycle\",createdAt:{gte:since}}}));})()'"
```

After the patch, that count should fall to roughly (number of NON-paused
deployments) × (cycles per day) — and zero for any deployment with
`cyclePaused: true`.

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
