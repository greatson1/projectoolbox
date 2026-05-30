/**
 * Merge duplicate Stakeholder rows for a single project.
 *
 * Background: before the stakeholder-name normaliser landed, the extractor
 * upserted by exact name match — so "Ty Beetseh" / "Ty  Beetseh" (extra
 * space) / "TY Beetseh" (different case) ended up as separate rows. The
 * People page shows them as three identical-looking entries.
 *
 * This script:
 *   1. Finds duplicates within the target project — same normalised key.
 *   2. Keeps the "best" row of each group (richest non-null fields, then
 *      oldest by id when tied).
 *   3. Updates the keeper's name to the trimmed/collapsed form.
 *   4. Optionally overrides power + interest (POWER, INTEREST env vars).
 *   5. Deletes the other rows in the group.
 *   6. Logs every keep / merge / delete decision.
 *
 * Usage:
 *   # Find duplicates project-wide, see what would happen, no writes:
 *   DRY_RUN=1 npx tsx -r dotenv/config script/merge-duplicate-stakeholders.ts "<project name substring>"
 *
 *   # Execute the merge:
 *   npx tsx -r dotenv/config script/merge-duplicate-stakeholders.ts "<project name substring>"
 *
 *   # Execute + set power/interest on the kept row for every group:
 *   POWER=5 INTEREST=4 npx tsx -r dotenv/config script/merge-duplicate-stakeholders.ts "Family Trip"
 *
 *   # Scope to one stakeholder name (case-insensitive) within the project:
 *   NAME="Ty Beetseh" POWER=5 INTEREST=4 npx tsx -r dotenv/config script/merge-duplicate-stakeholders.ts "Family Trip"
 *
 * POWER / INTEREST take 1-5 (Pi grid scale) or 0-100 (DB raw scale).
 * Values 1-5 are auto-mapped: 1=10, 2=30, 3=50, 4=70, 5=90.
 */

import { db } from "../src/lib/db";
import { normaliseStakeholderName, stakeholderNameKey } from "../src/lib/agents/stakeholder-name";

function mapScale(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  if (n >= 0 && n <= 5) return [10, 10, 30, 50, 70, 90][n] ?? null;
  if (n > 5 && n <= 100) return n;
  return null;
}

function scoreRichness(s: {
  role: string | null;
  organisation: string | null;
  email: string | null;
  sentiment: string | null;
  power: number;
  interest: number;
}): number {
  let score = 0;
  if (s.role && s.role.trim()) score += 4;
  if (s.organisation && s.organisation.trim()) score += 3;
  if (s.email && s.email.trim()) score += 3;
  if (s.sentiment && s.sentiment !== "unknown") score += 2;
  if (s.power !== 50) score += 1;
  if (s.interest !== 50) score += 1;
  return score;
}

async function main() {
  const projectQuery = process.argv[2];
  if (!projectQuery) {
    console.error('Usage: npx tsx script/merge-duplicate-stakeholders.ts "<project name substring>"');
    process.exit(1);
  }
  const dryRun = process.env.DRY_RUN === "1";
  const targetName = process.env.NAME?.trim().toLowerCase() || null;
  const overridePower = mapScale(process.env.POWER);
  const overrideInterest = mapScale(process.env.INTEREST);

  console.log(`\n${dryRun ? "🔍 DRY RUN" : "🧹 MERGING"} duplicate stakeholders` +
    ` on projects matching "${projectQuery}"` +
    (targetName ? ` (filter name: "${targetName}")` : "") +
    (overridePower !== null ? ` · power=${overridePower}` : "") +
    (overrideInterest !== null ? ` · interest=${overrideInterest}` : "") + `\n`);

  const projects = await db.project.findMany({
    where: { name: { contains: projectQuery, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (projects.length === 0) {
    console.log("No projects matched.");
    return;
  }

  let totalGroups = 0;
  let totalKept = 0;
  let totalDeleted = 0;
  let totalRenamed = 0;
  let totalTuned = 0;

  for (const project of projects) {
    const stakeholders = await db.stakeholder.findMany({
      where: { projectId: project.id },
      select: {
        id: true, name: true, role: true, organisation: true,
        power: true, interest: true, sentiment: true, email: true,
      },
    });

    const groups = new Map<string, typeof stakeholders>();
    for (const s of stakeholders) {
      const key = stakeholderNameKey(s.name);
      if (!key) continue;
      if (targetName && key !== targetName) continue;
      const list = groups.get(key) || [];
      list.push(s);
      groups.set(key, list);
    }

    const dupGroups = Array.from(groups.entries()).filter(([, list]) => list.length > 1);
    const lonelyOverride = Array.from(groups.entries()).filter(
      ([, list]) => list.length === 1 && (overridePower !== null || overrideInterest !== null),
    );

    if (dupGroups.length === 0 && lonelyOverride.length === 0) continue;

    console.log(`📁 ${project.name} (${project.id}) — ` +
      (dupGroups.length > 0 ? `${dupGroups.length} duplicate group${dupGroups.length === 1 ? "" : "s"}` : "no duplicates") +
      (lonelyOverride.length > 0 ? `, ${lonelyOverride.length} singleton(s) to tune` : ""));

    for (const [key, list] of dupGroups) {
      totalGroups++;
      // Rank by richness, then by oldest id (id sorts roughly by creation time for CUIDs)
      const sorted = [...list].sort((a, b) => {
        const sb = scoreRichness(b);
        const sa = scoreRichness(a);
        if (sb !== sa) return sb - sa;
        return a.id.localeCompare(b.id);
      });
      const keeper = sorted[0];
      const losers = sorted.slice(1);

      const cleanName = normaliseStakeholderName(keeper.name);
      const willRename = cleanName !== keeper.name;
      const newPower = overridePower !== null ? overridePower : keeper.power;
      const newInterest = overrideInterest !== null ? overrideInterest : keeper.interest;
      const willTune = newPower !== keeper.power || newInterest !== keeper.interest;

      console.log(`   group "${key}" (${list.length} rows):`);
      console.log(`     KEEP   ${keeper.id} ${JSON.stringify({ name: keeper.name, role: keeper.role, power: keeper.power, interest: keeper.interest })}`);
      for (const l of losers) {
        console.log(`     DELETE ${l.id} ${JSON.stringify({ name: l.name, role: l.role, power: l.power, interest: l.interest })}`);
      }
      if (willRename) console.log(`     RENAME keeper.name -> "${cleanName}"`);
      if (willTune)   console.log(`     TUNE   keeper.power=${newPower} interest=${newInterest}`);

      if (!dryRun) {
        if (willRename || willTune) {
          await db.stakeholder.update({
            where: { id: keeper.id },
            data: {
              ...(willRename ? { name: cleanName } : {}),
              ...(willTune ? { power: newPower, interest: newInterest } : {}),
            },
          });
          if (willRename) totalRenamed++;
          if (willTune) totalTuned++;
        }
        if (losers.length > 0) {
          await db.stakeholder.deleteMany({ where: { id: { in: losers.map(l => l.id) } } });
        }
      }
      totalKept++;
      totalDeleted += losers.length;
    }

    for (const [key, [singleton]] of lonelyOverride) {
      const cleanName = normaliseStakeholderName(singleton.name);
      const willRename = cleanName !== singleton.name;
      const newPower = overridePower !== null ? overridePower : singleton.power;
      const newInterest = overrideInterest !== null ? overrideInterest : singleton.interest;
      const willTune = newPower !== singleton.power || newInterest !== singleton.interest;
      if (!willRename && !willTune) continue;
      console.log(`   singleton "${key}":`);
      console.log(`     TUNE   ${singleton.id} power=${newPower} interest=${newInterest}` +
        (willRename ? `, rename -> "${cleanName}"` : ""));
      if (!dryRun) {
        await db.stakeholder.update({
          where: { id: singleton.id },
          data: {
            ...(willRename ? { name: cleanName } : {}),
            ...(willTune ? { power: newPower, interest: newInterest } : {}),
          },
        });
        if (willRename) totalRenamed++;
        if (willTune) totalTuned++;
      }
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Duplicate groups:   ${totalGroups}`);
  console.log(`   Kept (one per group): ${totalKept}`);
  console.log(`   ${dryRun ? "Would delete" : "Deleted"}:    ${totalDeleted}`);
  console.log(`   Renamed (whitespace/case): ${totalRenamed}`);
  console.log(`   Tuned (power/interest):    ${totalTuned}`);
  console.log();
}

main()
  .catch(e => { console.error("\n❌ Failed:", e); process.exit(1); })
  .finally(() => db.$disconnect());
