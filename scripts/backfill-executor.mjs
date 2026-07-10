/**
 * One-off backfill: classify executor (AGENT | HUMAN) on existing tasks of
 * ACTIVE projects. New tasks are classified at creation (schedule-parser,
 * criteria-ingest, extract-artefact-actions); this covers rows that predate
 * the field-work loop (review P1, docs/REVIEW-2026-07-10.md).
 *
 * Keep the patterns in sync with src/lib/agents/executor-classify.ts.
 *
 * Usage:
 *   node scripts/backfill-executor.mjs --dry-run
 *   node scripts/backfill-executor.mjs --execute
 */
import pg from "pg";
import fs from "fs";

const AGENT_PATTERNS = [
  /\b(generate|draft|write|prepare|produce|compile|author)\b.*\b(report|plan|register|charter|backlog|document|documentation|log|matrix|brief|pack|summary|notes?|vision|criteria|definition)\b/i,
  /\b(update|maintain|revise)\b.*\b(register|log|backlog|plan|document|schedule|matrix)\b/i,
  /\b(analy[sz]e|summari[sz]e|research|assess|estimate|calculate|forecast)\b/i,
  /\b(document|record)\b.*\b(lessons|decisions?|minutes|outcomes?)\b/i,
];
const HUMAN_PATTERNS = [
  /\b(install|procure|purchase|buy|order|ship|deliver|relocate|move|build|construct|fit|wire|paint|clean|repair|assemble|dismantle|transport)\b/i,
  /\b(site|venue|office|warehouse|premises|on-?site)\b/i,
  /\b(conduct|facilitate|host|run|attend|schedule|hold)\b.*\b(meeting|workshop|session|training|kick-?off|interview|walkthrough|stand-?up|ceremony|demo)\b/i,
  /\b(train|coach|onboard)\b.*\b(team|staff|users?|people)\b/i,
  /\b(hire|recruit|appoint|negotiate|sign|contract|engage)\b/i,
  /\b(obtain|secure|get)\b.*\b(approval|sign-?off|permission|consent|authori[sz]ation)\b/i,
  /\b(approve|authori[sz]e|validate|confirm)\b.*\b(with|from)\b.*\b(stakeholders?|sponsor|board|client|vendor)\b/i,
  /\b(configure|deploy|set ?up|provision|integrate|migrate|test)\b.*\b(system|platform|hardware|equipment|environment|infrastructure|network|server|erp|crm|tool)\b/i,
];
const classify = (title, description) => {
  const text = `${title} ${description ?? ""}`;
  for (const p of HUMAN_PATTERNS) if (p.test(text)) return "HUMAN";
  for (const p of AGENT_PATTERNS) if (p.test(text)) return "AGENT";
  return "HUMAN";
};

const execute = process.argv.includes("--execute");
const url = fs.readFileSync(".env", "utf8").match(/^DIRECT_URL="(.+)"$/m)[1];
const c = new pg.Client({ connectionString: url });
await c.connect();

const rows = (
  await c.query(`
    SELECT t.id, t.title, t.description, t."parentId"
    FROM "Task" t JOIN "Project" p ON p.id = t."projectId"
    WHERE p.status = 'ACTIVE' AND p."archivedAt" IS NULL AND t.executor IS NULL
  `)
).rows;

// Parents (containers) stay unclassified — same rule as schedule-parser.
const parentIds = new Set(rows.map((r) => r.parentId).filter(Boolean));
let agent = 0, human = 0, skipped = 0;
for (const r of rows) {
  if (parentIds.has(r.id)) { skipped++; continue; }
  // Scaffolded PM tasks are the agent's own process tracking.
  const scaffolded = (r.description || "").includes("[scaffolded]");
  const executor = scaffolded ? "AGENT" : classify(r.title, r.description);
  executor === "AGENT" ? agent++ : human++;
  console.log(`  ${executor.padEnd(5)} ${r.title.slice(0, 60)}`);
  if (execute) {
    await c.query(`UPDATE "Task" SET executor = $1 WHERE id = $2`, [executor, r.id]);
  }
}
console.log(`\n${rows.length} unclassified tasks on active projects → AGENT ${agent}, HUMAN ${human}, containers skipped ${skipped}`);
console.log(execute ? "APPLIED" : "(dry run — pass --execute to apply)");
await c.end();
