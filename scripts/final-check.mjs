import pkg from 'pg';
const { Pool } = pkg;

const DB_URL = process.env.DATABASE_URL.replace(/^["']|["']$/g, '');
const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

const PROJECT_ID = 'cmnlcjhz30000v8j0jhqwqvaa';
const AGENT_ID = 'cmnlcjoq2000lv8j07vjqj3r5';

const client = await pool.connect();
try {
  // Delete stray artefacts (< 200 chars content = not a real document)
  const del = await client.query(
    `DELETE FROM "AgentArtefact" WHERE "projectId" = $1 AND length(content) < 200 RETURNING name`,
    [PROJECT_ID]
  );
  if (del.rows.length) console.log('Deleted stray:', del.rows.map(r => r.name));

  // Final state
  const arts = await client.query(
    `SELECT name, length(content) as chars, status FROM "AgentArtefact" WHERE "projectId" = $1 ORDER BY "createdAt"`,
    [PROJECT_ID]
  );
  console.log(`\nPre-Project artefacts (${arts.rows.length}):`);
  arts.rows.forEach(a => console.log(`  [${a.status}] ~${Math.round(a.chars/5)}w | ${a.name}`));

  const risks = await client.query(
    `SELECT title, category, probability * impact as score FROM "Risk" WHERE "projectId" = $1 ORDER BY probability * impact DESC`,
    [PROJECT_ID]
  );
  console.log(`\nRisks (${risks.rows.length}):`);
  risks.rows.forEach(r => console.log(`  score=${r.score} | ${r.category} | ${r.title}`));

  const dep = await client.query(
    `SELECT "currentPhase", "phaseStatus", "lastCycleAt", "nextCycleAt" FROM "AgentDeployment" WHERE id = 'cmnlcjoy4000mv8j06ojkc1bu'`
  );
  console.log('\nDeployment:', JSON.stringify(dep.rows[0]));

  const agent = await client.query(
    `SELECT "monthlyBudget", "autonomyLevel" FROM "Agent" WHERE id = $1`,
    [AGENT_ID]
  );
  console.log('Agent monthlyBudget:', agent.rows[0].monthlyBudget, '| autonomyLevel:', agent.rows[0].autonomyLevel);

  const org = await client.query(
    `SELECT "creditBalance", plan FROM "Organisation" WHERE id = (SELECT "orgId" FROM "Agent" WHERE id = $1)`,
    [AGENT_ID]
  );
  console.log('Org:', JSON.stringify(org.rows[0]));

} finally {
  client.release();
  await pool.end();
}
