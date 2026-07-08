/**
 * One-off cleanup for the 2026-06 runaway ingestion incident + membership backfill.
 *
 * 1. Deletes risks created by the risk-extractor's document-shredding bug:
 *    default 3×3 score, "Identified during …" description, plus any risk whose
 *    title is markup/error text or a mid-clause fragment.
 * 2. Deletes stakeholders whose "name" is a shredded sentence fragment.
 * 3. Backfills UserOrganisation rows for users linked only via User.orgId
 *    (fixes OWNER getting 403 on membership-gated routes).
 *
 * Usage:
 *   node scripts/purge-shredded-registers.mjs <projectId> --dry-run
 *   node scripts/purge-shredded-registers.mjs <projectId> --execute
 * The membership backfill (org-wide) runs in both modes' reports; writes only on --execute.
 */
import pg from "pg";
import fs from "fs";

const projectId = process.argv[2];
const execute = process.argv.includes("--execute");
if (!projectId) { console.error("usage: node scripts/purge-shredded-registers.mjs <projectId> [--dry-run|--execute]"); process.exit(1); }

const url = fs.readFileSync(".env", "utf8").match(/^DIRECT_URL="(.+)"$/m)[1];
const c = new pg.Client({ connectionString: url });
await c.connect();

const FUNCTION_WORDS = ["to","for","of","with","from","by","as","in","on","at","the","a","an","and","or","is","are","was","were","will","must","should","it","this","that","these","those","up","down","not","be","has","have","had"];
const fw = (w) => FUNCTION_WORDS.includes((w || "").toLowerCase());
const isFragment = (s) => {
  const t = (s || "").trim();
  if (!t || t.length < 2 || !/[a-zA-Z]/.test(t)) return true;
  if (/[`<>|#]/.test(t)) return true;
  const words = t.split(/\s+/);
  if (words.length > 6) return true;
  if (fw(words[0])) return true;
  if (words.length > 1 && fw(words[words.length - 1])) return true;
  if (/^[a-z]/.test(words[0])) return true;
  return false;
};
const isNonRiskTitle = (s) => {
  const t = (s || "").trim();
  if (/^#{1,6}\s|^\||^```|^</.test(t) || t.includes("`")) return true;
  if (/\b(prisma|traceback|stack ?trace|typeerror|referenceerror|syntaxerror)\b/i.test(t)) return true;
  if (/^(low|medium|high|critical)?\s*priority risks?$/i.test(t)) return true;
  if (/^(to|for|of|with|and|or|the|a|an)\s/i.test(t)) return true;
  return false;
};

// ── 1. Risks ──
const risks = (await c.query(
  `select id, title, probability, impact, description from "Risk" where "projectId"=$1 and status='OPEN'`,
  [projectId],
)).rows;
const riskVictims = risks.filter((r) =>
  isNonRiskTitle(r.title) ||
  (r.probability === 3 && r.impact === 3 && /^identified during/i.test(r.description || "")),
);
console.log(`Risks: ${risks.length} open, ${riskVictims.length} flagged for deletion. Survivors: ${risks.length - riskVictims.length}`);
for (const r of riskVictims.slice(0, 10)) console.log(`  DEL: ${r.title.slice(0, 70)}`);
if (riskVictims.length > 10) console.log(`  … and ${riskVictims.length - 10} more`);

// ── 2. Stakeholders ──
// Stricter than the seeder guard (this is a cleanup of known-shredded data):
// keep a row only if the name is a pure role title (every word from the role
// lexicon) or a two-word proper name with no content-noun words. Everything
// else in a shredded register is a sentence fragment.
const ROLE_WORDS = new Set([
  "project","executive","programme","program","technical","development","delivery",
  "compliance","change","business","product","scrum","team","senior","junior",
  "lead","architect","analyst","manager","master","owner","sponsor","champion",
  "director","adviser","advisor","engineer","designer","tester","coordinator",
  "officer","head","client","organisation","organization","stakeholder","end","user","users",
]);
const isPureRoleTitle = (name) => {
  const words = name.trim().split(/\s+/);
  return words.length >= 1 && words.length <= 4 && words.every((w) => ROLE_WORDS.has(w.toLowerCase()));
};
const isProperName = (name) => {
  const words = name.trim().split(/\s+/);
  return words.length === 2 &&
    words.every((w) => /^[A-Z][a-z'-]+$/.test(w)) &&
    words.every((w) => !ROLE_WORDS.has(w.toLowerCase()));
};
const stakeholders = (await c.query(
  `select id, name, role from "Stakeholder" where "projectId"=$1`,
  [projectId],
)).rows;
const stakeVictims = stakeholders.filter(
  (s) => isFragment(s.name) || !(isPureRoleTitle(s.name) || isProperName(s.name)),
);
console.log(`\nStakeholders: ${stakeholders.length} total, ${stakeVictims.length} flagged. Survivors:`);
for (const s of stakeholders.filter((x) => !stakeVictims.includes(x))) console.log(`  KEEP: ${s.name} (${s.role ?? "-"})`);

// ── 3. Membership backfill (org-wide, all orgs) ──
const missing = (await c.query(`
  select u.id, u.email, u.role, u."orgId" from "User" u
  where u."orgId" is not null
    and not exists (select 1 from "UserOrganisation" uo where uo."userId" = u.id and uo."orgId" = u."orgId")
`)).rows;
console.log(`\nUserOrganisation backfill: ${missing.length} user(s) missing membership rows:`);
for (const m of missing) console.log(`  ${m.email} → role ${m.role}`);

if (!execute) {
  console.log("\nDRY RUN — nothing deleted. Re-run with --execute to apply.");
} else {
  if (riskVictims.length) {
    await c.query(`delete from "Risk" where id = any($1::text[])`, [riskVictims.map((r) => r.id)]);
    console.log(`\nDeleted ${riskVictims.length} risks.`);
  }
  if (stakeVictims.length) {
    await c.query(`delete from "Stakeholder" where id = any($1::text[])`, [stakeVictims.map((s) => s.id)]);
    console.log(`Deleted ${stakeVictims.length} stakeholders.`);
  }
  for (const m of missing) {
    await c.query(
      `insert into "UserOrganisation" (id, "userId", "orgId", role, "joinedAt")
       values ('uo' || substr(md5(random()::text), 1, 22), $1, $2, $3::"UserRole", now())
       on conflict ("userId", "orgId") do nothing`,
      [m.id, m.orgId, m.role || "MEMBER"],
    );
  }
  if (missing.length) console.log(`Backfilled ${missing.length} UserOrganisation row(s).`);
}
await c.end();
