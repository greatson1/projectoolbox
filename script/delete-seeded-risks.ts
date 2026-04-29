/**
 * One-shot: delete the 3 universal placeholder risks that lifecycle-init.ts
 * used to seed at deploy time ("Budget overrun" / "Schedule slippage" /
 * "Stakeholder availability"). The seed has been removed in code, but
 * existing projects still carry the placeholders. This script removes them
 * from a single project (or all projects if PROJECT name omitted).
 *
 * Filters: only risks with the EXACT placeholder title AND the seed's exact
 * description prefix, AND with no responseActions attached. That guards
 * against deleting a risk a user has since meaningfully edited or worked.
 *
 * Usage:
 *   DRY_RUN=1 npx tsx -r dotenv/config script/delete-seeded-risks.ts
 *   DRY_RUN=1 npx tsx -r dotenv/config script/delete-seeded-risks.ts "Training Programme"
 *   npx tsx -r dotenv/config script/delete-seeded-risks.ts "Training Programme"
 */

import { db } from "../src/lib/db";

// Exact title + description-prefix tuples from the old getSeedRisks().
const PLACEHOLDER_SIGNATURES: Array<{ title: string; descPrefix: string }> = [
  { title: "Budget overrun", descPrefix: "Risk of exceeding the £" },
  { title: "Schedule slippage", descPrefix: "Key milestones may be delayed due to dependency chains" },
  { title: "Stakeholder availability", descPrefix: "Key decision-makers may be unavailable for timely approvals" },
];

async function main() {
  const projectQuery = process.argv[2];
  const dryRun = process.env.DRY_RUN === "1";

  console.log(`\n${dryRun ? "🔍 DRY RUN" : "🗑️  DELETING"} seeded placeholder risks${projectQuery ? ` on projects matching "${projectQuery}"` : " across ALL projects"}\n`);

  const projects = await db.project.findMany({
    where: projectQuery
      ? { name: { contains: projectQuery, mode: "insensitive" } }
      : {},
    select: { id: true, name: true },
  });

  if (projects.length === 0) {
    console.log("No projects matched.");
    return;
  }

  let totalCandidates = 0;
  let totalSkipped = 0;
  let totalDeleted = 0;

  for (const project of projects) {
    const candidates: Array<{ id: string; title: string; description: string | null; status: string }> = [];

    const candidateRows: Array<{ id: string; title: string; description: string | null; status: string; responseLog: unknown }> = [];
    for (const sig of PLACEHOLDER_SIGNATURES) {
      const found = await db.risk.findMany({
        where: {
          projectId: project.id,
          title: sig.title,
          description: { startsWith: sig.descPrefix },
        },
        select: { id: true, title: true, description: true, status: true, responseLog: true },
      });
      candidateRows.push(...found);
    }
    candidates.push(...candidateRows);

    if (candidates.length === 0) continue;
    totalCandidates += candidates.length;

    console.log(`📁 ${project.name} (${project.id}) — ${candidates.length} candidate(s):`);

    for (const r of candidateRows) {
      // Skip if user has logged response actions OR moved off OPEN status.
      const log = Array.isArray(r.responseLog) ? r.responseLog : [];
      const responseCount = log.length;
      if (responseCount > 0 || r.status !== "OPEN") {
        console.log(`   ⏭️  SKIP "${r.title}" — has ${responseCount} response actions, status=${r.status}`);
        totalSkipped++;
        continue;
      }

      console.log(`   ${dryRun ? "WOULD DELETE" : "DELETING"}: "${r.title}" (${r.id})`);
      if (!dryRun) {
        await db.risk.delete({ where: { id: r.id } });
        totalDeleted++;
      }
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Candidates found: ${totalCandidates}`);
  console.log(`   Skipped (touched): ${totalSkipped}`);
  console.log(`   ${dryRun ? "Would delete" : "Deleted"}: ${dryRun ? totalCandidates - totalSkipped : totalDeleted}`);
  console.log();
}

main()
  .catch(e => { console.error("\n❌ Failed:", e); process.exit(1); })
  .finally(() => db.$disconnect());
