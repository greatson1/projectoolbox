/**
 * Promote stakeholders mentioned in approved-artefact content to the
 * Stakeholder table.
 *
 * The Stakeholders page reads only from `db.stakeholder`, so names that
 * appear in prose ("Sponsored by Sarah Chen, Head of L&D") inside the
 * Project Brief or Business Case never made it onto the People page —
 * they only landed when an Initial Stakeholder Register artefact was
 * generated and approved (an Initiation-phase artefact, not Pre-Project).
 *
 * This module scans approved artefacts for "Role: Name" patterns common
 * to Charters, Briefs, Business Cases, and Communication Plans, and
 * upserts the matched stakeholders into the canonical table.
 *
 * Idempotent — upserts by (projectId, name); re-running on the same
 * artefact set is a no-op. Never overwrites a richer role/email/org the
 * user (or another path) already set.
 *
 * Fabricated names are filtered using the shared looksLikeFabricatedName
 * detector — a chunk that matches the FirstName-LastName pattern with no
 * role-keyword and isn't in the user-confirmed KB is dropped.
 */

import { db } from "@/lib/db";
import { looksLikeFabricatedName, looksLikePlaceholderName } from "./fabricated-names-pure";
import { normaliseStakeholderName, stakeholderNameKey } from "./stakeholder-name";

export interface StakeholderExtractResult {
  scanned: number;
  added: number;
  matched: number;     // existed already, no change
}

interface FoundStakeholder {
  name: string;
  role: string;
  source: string;      // artefact name for traceability
}

/**
 * Patterns we look for in artefact prose. Each captures (role, name) and
 * we filter the name through the fabricated-name detector before persisting.
 *
 * The patterns are conservative — we only fire on explicit role labels
 * ("Sponsor: …", "Project Manager: …", "**Sponsor**: …") rather than any
 * capitalised name in the document. Otherwise the extractor would flood
 * the table with random names mentioned in passing.
 */
const ROLE_PATTERNS: Array<{ re: RegExp; role: string }> = [
  { re: /\b(?:executive\s+)?sponsor[:\s]+([A-Z][a-z'\-]+(?:\s+[A-Z][a-z'\-]+){1,3})\b/gi,                role: "Project Sponsor"   },
  { re: /\bproject[\s-]*manager[:\s]+([A-Z][a-z'\-]+(?:\s+[A-Z][a-z'\-]+){1,3})\b/gi,                    role: "Project Manager"   },
  { re: /\bprogram(?:me)?[\s-]*manager[:\s]+([A-Z][a-z'\-]+(?:\s+[A-Z][a-z'\-]+){1,3})\b/gi,             role: "Programme Manager" },
  { re: /\b(?:product|business)\s+owner[:\s]+([A-Z][a-z'\-]+(?:\s+[A-Z][a-z'\-]+){1,3})\b/gi,            role: "Product Owner"     },
  { re: /\b(?:tech(?:nical)?\s+)?lead[:\s]+([A-Z][a-z'\-]+(?:\s+[A-Z][a-z'\-]+){1,3})\b/gi,              role: "Team Lead"         },
  { re: /\b(?:lead\s+)?architect[:\s]+([A-Z][a-z'\-]+(?:\s+[A-Z][a-z'\-]+){1,3})\b/gi,                   role: "Lead Architect"    },
  { re: /\b(?:risk|compliance|finance|procurement|delivery)\s+lead[:\s]+([A-Z][a-z'\-]+(?:\s+[A-Z][a-z'\-]+){1,3})\b/gi, role: "Lead" },
  { re: /\bchampion[:\s]+([A-Z][a-z'\-]+(?:\s+[A-Z][a-z'\-]+){1,3})\b/gi,                                role: "Project Champion"  },
];

/**
 * Pull explicit "Sponsored by Name" / "Approved by Name" prose patterns —
 * common in Project Brief / Business Case templates.
 */
const ATTRIBUTION_PATTERNS: Array<{ re: RegExp; role: string }> = [
  { re: /\bsponsored\s+by[:\s]+([A-Z][a-z'\-]+(?:\s+[A-Z][a-z'\-]+){1,3})\b/gi,    role: "Project Sponsor" },
  { re: /\bapproved\s+by[:\s]+([A-Z][a-z'\-]+(?:\s+[A-Z][a-z'\-]+){1,3})\b/gi,     role: "Approver" },
  { re: /\bauthorized\s+by[:\s]+([A-Z][a-z'\-]+(?:\s+[A-Z][a-z'\-]+){1,3})\b/gi,   role: "Approver" },
  { re: /\bprepared\s+by[:\s]+([A-Z][a-z'\-]+(?:\s+[A-Z][a-z'\-]+){1,3})\b/gi,     role: "Author" },
];

function harvestNames(content: string): FoundStakeholder[] {
  if (!content) return [];
  // Strip HTML tags / markdown stars to keep the regexes happy
  const cleaned = content
    .replace(/<[^>]+>/g, " ")
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ");

  const out: FoundStakeholder[] = [];
  const seenInDoc = new Set<string>();

  const apply = (patterns: typeof ROLE_PATTERNS, source: string) => {
    for (const { re, role } of patterns) {
      // Reset since we may re-use the same regex object across artefacts
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(cleaned)) !== null) {
        const name = m[1].trim();
        if (!name) continue;
        const key = `${name.toLowerCase()}::${role}`;
        if (seenInDoc.has(key)) continue;
        seenInDoc.add(key);
        out.push({ name, role, source });
      }
    }
  };
  // Use a placeholder source — caller supplies the artefact name. We pass
  // through harvestNames first then attach source above.
  apply(ROLE_PATTERNS, "");
  apply(ATTRIBUTION_PATTERNS, "");
  return out;
}

/**
 * Main entry. Scans every approved artefact for the project, harvests
 * stakeholder mentions, filters fabricated patterns, and upserts the rest.
 */
export async function promoteArtefactStakeholders(projectId: string): Promise<StakeholderExtractResult> {
  const result: StakeholderExtractResult = { scanned: 0, added: 0, matched: 0 };

  const artefacts = await db.agentArtefact.findMany({
    where: { projectId, status: "APPROVED" },
    select: { name: true, content: true },
    take: 30,
  });
  result.scanned = artefacts.length;
  if (artefacts.length === 0) return result;

  // Pull user-confirmed names so we know which 2-word capitalised tokens
  // are real (user told us "Sarah Chen") vs fabricated (agent invented
  // "Marcus Williams"). The fabricated-name detector skips names found
  // here.
  const confirmedKB = await db.knowledgeBaseItem.findMany({
    where: {
      projectId,
      tags: { hasSome: ["user_confirmed", "user_answer"] },
    },
    select: { content: true, title: true },
  }).catch(() => []);
  const confirmedText = confirmedKB
    .map(i => `${i.title}\n${i.content}`)
    .join("\n")
    .toLowerCase();

  // Aggregate harvested names across all approved artefacts
  type Aggregated = { name: string; role: string; sources: string[] };
  const byKey = new Map<string, Aggregated>();
  for (const art of artefacts) {
    const found = harvestNames(art.content);
    for (const f of found) {
      // Normalise BEFORE the fabricated-name check so trailing whitespace
      // doesn't sneak a name past it.
      const cleanName = normaliseStakeholderName(f.name);
      if (!cleanName) continue;
      // Placeholder filter — "To Be Assigned" / "TBC" / "approval
      // Dependencies" pass the capitalised-word regex but are never a
      // real person. Drop them unconditionally; the user-knows escape
      // hatch below doesn't apply since the user couldn't possibly
      // "confirm" a placeholder as a stakeholder.
      if (looksLikePlaceholderName(cleanName)) continue;
      const isFab = looksLikeFabricatedName(cleanName);
      const userKnows = confirmedText.includes(cleanName.toLowerCase());
      if (isFab && !userKnows) continue;
      // Dedup key: case-folded + whitespace-collapsed. Closes the
      // "Ty Beetseh" vs "Ty  Beetseh" vs "TY Beetseh" gap that previously
      // produced duplicate Stakeholder rows.
      const key = stakeholderNameKey(cleanName);
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.sources.includes(art.name)) existing.sources.push(art.name);
      } else {
        byKey.set(key, { name: cleanName, role: f.role, sources: [art.name] });
      }
    }
  }

  if (byKey.size === 0) return result;

  // Sponsor-ish power/interest defaults vs everyone else
  const ROLE_DEFAULTS: Record<string, { power: number; interest: number }> = {
    "Project Sponsor":   { power: 90, interest: 80 },
    "Project Manager":   { power: 70, interest: 80 },
    "Programme Manager": { power: 80, interest: 80 },
    "Product Owner":     { power: 70, interest: 80 },
    "Lead Architect":    { power: 60, interest: 70 },
    "Team Lead":         { power: 50, interest: 70 },
    "Project Champion":  { power: 60, interest: 80 },
    "Approver":          { power: 80, interest: 50 },
    "Author":            { power: 30, interest: 60 },
    "Lead":              { power: 60, interest: 70 },
  };

  // Pull every existing stakeholder once and index by normalised name —
  // case- and whitespace-insensitive. Doing exact `findFirst({ name })`
  // per agg used to miss "Ty Beetseh" when a previous run had stored
  // "ty beetseh", producing the duplicate rows reported on the People page.
  const allExisting = await db.stakeholder.findMany({
    where: { projectId },
    select: { id: true, name: true, role: true, organisation: true },
  });
  const existingByKey = new Map(
    allExisting.map(s => [stakeholderNameKey(s.name), s] as const),
  );

  for (const agg of byKey.values()) {
    try {
      const existing = existingByKey.get(stakeholderNameKey(agg.name));
      if (existing) {
        // Only fill in role if it's still blank — never overwrite a richer
        // value the user set on the People page or via clarification.
        if (!existing.role) {
          await db.stakeholder.update({
            where: { id: existing.id },
            data: { role: agg.role },
          });
        }
        result.matched++;
      } else {
        const defaults = ROLE_DEFAULTS[agg.role] || { power: 50, interest: 50 };
        await db.stakeholder.create({
          data: {
            projectId,
            name: agg.name,
            role: agg.role,
            power: defaults.power,
            interest: defaults.interest,
          },
        });
        result.added++;
      }
    } catch (e) {
      console.error("[stakeholder-extractor] upsert failed:", agg.name, e);
    }
  }

  return result;
}
