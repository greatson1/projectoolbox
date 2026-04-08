/**
 * Direct fix script using raw pg (not Prisma) to avoid adapter issues.
 * Run: node --env-file=.env scripts/fix-lagos-direct.mjs
 */

import pkg from 'pg';
const { Pool } = pkg;

const PROJECT_ID = "cmnlcjhz30000v8j0jhqwqvaa";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("DATABASE_URL not set");

// Strip surrounding quotes if present
const connectionString = dbUrl.replace(/^["']|["']$/g, "");

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 3,
  connectionTimeoutMillis: 10000,
});

async function main() {
  const client = await pool.connect();
  try {
    console.log("✓ Connected to database");

    // Show current artefacts
    const { rows: artefacts } = await client.query(
      `SELECT id, name, "createdAt", length(content) as chars FROM "AgentArtefact" WHERE "projectId" = $1 ORDER BY "createdAt" ASC`,
      [PROJECT_ID]
    );
    console.log(`\nCurrent artefacts (${artefacts.length}):`);
    for (const a of artefacts) {
      const words = Math.round(a.chars / 5);
      console.log(`  [${a.createdAt.toISOString().slice(0,19)}] ~${words}w | ${a.name}`);
    }

    // Delete all artefacts and phases
    const { rowCount: delArt } = await client.query(
      `DELETE FROM "AgentArtefact" WHERE "projectId" = $1`, [PROJECT_ID]
    );
    const { rowCount: delPhase } = await client.query(
      `DELETE FROM "Phase" WHERE "projectId" = $1`, [PROJECT_ID]
    );
    console.log(`\nDeleted ${delArt} artefacts, ${delPhase} phases`);

    // Verify project methodology
    const { rows: [proj] } = await client.query(
      `SELECT id, name, methodology FROM "Project" WHERE id = $1`, [PROJECT_ID]
    );
    console.log(`Project: ${proj.name} | Methodology: ${proj.methodology}`);

    if (proj.methodology !== 'PRINCE2') {
      await client.query(`UPDATE "Project" SET methodology = 'PRINCE2' WHERE id = $1`, [PROJECT_ID]);
      console.log("Updated methodology → PRINCE2");
    }

    console.log("\n✓ Database cleaned. Now run the generate endpoint or reset-lifecycle via the browser.");
    console.log("  POST /api/projects/cmnlcjhz30000v8j0jhqwqvaa/reset-lifecycle");
    console.log("  Body: {}");

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
