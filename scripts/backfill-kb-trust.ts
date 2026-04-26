/**
 * Retroactive fix for KB items that were auto-extracted from artefacts before
 * the source-aware trust mapping landed. The original extractor stamped every
 * item HIGH_TRUST, so default-template stakeholder lists (Sarah Mitchell,
 * Marcus Chen, Westminster Council, …) ended up being cited as canonical
 * facts in downstream generation prompts.
 *
 * What this does:
 *   1. Find all KnowledgeBaseItem rows tagged "auto-extracted" or
 *      "approved-artefact".
 *   2. For each row, parse the artefact-style source summary from its content.
 *      If most rows look default-template/research-thin, downgrade trust to
 *      REFERENCE_ONLY.
 *   3. For any row whose content includes ≥ 50% fabricated personal names
 *      (defined in fabricated-names-pure.ts), force REFERENCE_ONLY and add
 *      "placeholder" + "needs-confirmation" tags.
 *
 * Idempotent — running twice is safe; rows already at REFERENCE_ONLY with the
 * placeholder tag are skipped.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/backfill-kb-trust.ts            # dry-run
 *   node --env-file=.env --import tsx scripts/backfill-kb-trust.ts --apply    # apply
 */

import { db } from "@/lib/db";
import { looksLikeFabricatedName } from "@/lib/agents/fabricated-names-pure";
import { summariseArtefactSource } from "@/lib/agents/source-prefix-pure";

const APPLY = process.argv.includes("--apply");

function placeholderHeavy(content: string): boolean {
  // Pull bullet-point names ("• Sarah Mitchell (Event Host)") and CSV name
  // cells ("Sarah Mitchell,Event Host,…") and run them through the detector.
  const bulletNames = (content.match(/^[•\-\*]\s*([^()\n,]+)/gm) || [])
    .map(s => s.replace(/^[•\-\*]\s*/, "").trim());
  const csvNames = content
    .split(/\r?\n/)
    .flatMap(line => line.split(","))
    .map(s => s.trim());
  const candidates = [...bulletNames, ...csvNames]
    .filter(s => s.length >= 4 && s.length <= 60 && /^[A-Z][a-z]+\s+[A-Z]/.test(s));

  if (candidates.length === 0) return false;
  const fabricated = candidates.filter(n => looksLikeFabricatedName(n)).length;
  return fabricated >= candidates.length * 0.5;
}

async function main() {
  const items = await db.knowledgeBaseItem.findMany({
    where: {
      OR: [
        { tags: { has: "auto-extracted" } },
        { tags: { has: "approved-artefact" } },
      ],
    },
    select: { id: true, title: true, content: true, tags: true, trustLevel: true, projectId: true },
  });

  console.log(`Scanning ${items.length} auto-extracted KB items…`);

  let downgraded = 0;
  let skipped = 0;

  for (const item of items) {
    const summary = summariseArtefactSource(item.content);
    const isPlaceholder = placeholderHeavy(item.content);

    // Decide the desired trust level
    let desiredTrust: "HIGH_TRUST" | "STANDARD" | "REFERENCE_ONLY" | null = null;
    if (isPlaceholder) desiredTrust = "REFERENCE_ONLY";
    else if (summary === "low") desiredTrust = "REFERENCE_ONLY";
    else if (summary === "high") desiredTrust = "HIGH_TRUST";
    else if (summary === "mixed" || summary === "unknown") {
      // Don't touch unknowns — they might genuinely be old high-trust items.
      // We only act when we have an explicit signal that something is wrong.
      desiredTrust = null;
    }

    if (!desiredTrust || desiredTrust === item.trustLevel) {
      skipped++;
      continue;
    }

    // Only act on downgrades — never upgrade trust automatically.
    const trustRank: Record<string, number> = { REFERENCE_ONLY: 0, STANDARD: 1, HIGH_TRUST: 2 };
    if ((trustRank[desiredTrust] ?? 0) >= (trustRank[item.trustLevel] ?? 0)) {
      skipped++;
      continue;
    }

    const newTags = Array.from(new Set([
      ...item.tags,
      ...(isPlaceholder ? ["placeholder", "needs-confirmation"] : []),
    ]));

    console.log(`  ↓ "${item.title}" — ${item.trustLevel} → ${desiredTrust}${isPlaceholder ? " (placeholders detected)" : " (low source summary)"}`);
    downgraded++;

    if (APPLY) {
      await db.knowledgeBaseItem.update({
        where: { id: item.id },
        data: { trustLevel: desiredTrust, tags: newTags },
      });
    }
  }

  console.log(`\n${APPLY ? "Applied" : "Would apply"}: ${downgraded} downgrades. Skipped: ${skipped}.`);
  if (!APPLY) console.log("Re-run with --apply to commit changes.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(() => db.$disconnect());