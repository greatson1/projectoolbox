/**
 * Allowed-names registry — the canonical list of person + organisation
 * names that artefact generation is permitted to use.
 *
 * Built from authoritative sources (in priority order):
 *   1. Stakeholder table — sponsors, project managers, team, key contacts
 *      with their organisations
 *   2. KB items tagged "user_confirmed" — facts the user has explicitly
 *      confirmed (sponsor name from clarification, etc)
 *   3. KB items tagged "research" + "user_confirmed" — research findings
 *      the user has approved (vendor names, commission names, etc) — these
 *      come from the research-finding approval flow we built earlier
 *
 * Any name appearing in an artefact draft that is NOT in this registry
 * is treated as fabricated and blocks approval. The validator exposes
 * this list to the LLM as a hard constraint up-front, and runs again
 * post-generation to catch any drift.
 *
 * The registry intentionally INCLUDES role/organisation generic terms
 * (Project Manager, Sponsor, Steering Committee, Team Lead, etc) so the
 * agent can use those when no actual person is known. Those terms are
 * filtered by the existing looksLikeFabricatedName ROLE_KEYWORDS regex
 * before they ever reach the validator — but listing them explicitly
 * makes the prompt unambiguous.
 */

import { db } from "@/lib/db";

export interface AllowedNamesRegistry {
  people: string[];
  organisations: string[];
  /** Generic role / placeholder terms that are always acceptable. */
  rolePlaceholders: string[];
}

const ROLE_PLACEHOLDERS = [
  "Project Manager",
  "Project Sponsor",
  "Sponsor",
  "Project Lead",
  "Team Lead",
  "Steering Committee",
  "Project Board",
  "Project Team",
  "Stakeholder",
  "Senior Management",
  "Executive Sponsor",
  "Client",
  "End User",
  "Subject Matter Expert",
  "SME",
  "Vendor",
  "Supplier",
  "Contractor",
  "Account Manager",
  "Product Owner",
  "Scrum Master",
  "Quality Manager",
  "Risk Owner",
  "Budget Holder",
  "Finance",
  "HR",
  "Legal",
  "Compliance",
  "IT",
  "Operations",
  "TBC",
  "TBD",
  "Unassigned",
];

export async function getAllowedNamesRegistry(projectId: string): Promise<AllowedNamesRegistry> {
  const [stakeholders, kbItems] = await Promise.all([
    db.stakeholder.findMany({
      where: { projectId },
      select: { name: true, organisation: true },
    }).catch(() => []),
    // Names embedded in user-confirmed KB facts. These are sponsor/contact
    // answers from clarification, plus research findings the user
    // explicitly approved via the research-finding approval flow.
    db.knowledgeBaseItem.findMany({
      where: {
        projectId,
        tags: { hasSome: ["user_confirmed", "user_answer"] },
      },
      select: { title: true, content: true },
      take: 100,
    }).catch(() => []),
  ]);

  const people = new Set<string>();
  const organisations = new Set<string>();

  for (const s of stakeholders) {
    if (s.name && s.name.trim()) people.add(s.name.trim());
    if (s.organisation && s.organisation.trim()) organisations.add(s.organisation.trim());
  }

  // Extract proper-name-shaped tokens (capitalised 2-4 word patterns) from
  // user-confirmed KB content. The detector lives downstream in the
  // validator — here we simply collect any sequence that looks like a
  // proper name so we don't false-positive on fields the user genuinely
  // confirmed.
  const properNameRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
  for (const it of kbItems) {
    const blob = `${it.title}\n${it.content || ""}`;
    let m: RegExpExecArray | null;
    while ((m = properNameRegex.exec(blob)) !== null) {
      const candidate = m[1];
      // Don't treat dates / "Pre Project Research" style strings as names.
      if (/^(January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Pre|Phase|Project|Programme|Sprint)\b/i.test(candidate)) continue;
      people.add(candidate);
    }
  }

  return {
    people: Array.from(people).sort(),
    organisations: Array.from(organisations).sort(),
    rolePlaceholders: ROLE_PLACEHOLDERS,
  };
}

/**
 * Format the registry as a prompt block — used at the top of every
 * artefact-generation prompt so the LLM sees the allow-list before it
 * starts writing.
 */
export function formatAllowedNamesBlock(reg: AllowedNamesRegistry): string {
  const lines = [
    "── ALLOWED NAMES — HARD CONSTRAINT ──",
    "You MAY only use the following PERSON or ORGANISATION names in this artefact. Any name not on this list is FABRICATION and will cause the artefact to be REJECTED.",
    "",
  ];
  if (reg.people.length > 0) {
    lines.push(`**People** (use exact spelling): ${reg.people.join(", ")}`);
  } else {
    lines.push(`**People**: NONE on file. Use role placeholders only — never invent a person.`);
  }
  if (reg.organisations.length > 0) {
    lines.push(`**Organisations** (use exact spelling): ${reg.organisations.join(", ")}`);
  } else {
    lines.push(`**Organisations**: NONE on file. Use role/category labels only — never invent a vendor or company.`);
  }
  lines.push(`**Always-acceptable role placeholders**: ${reg.rolePlaceholders.join(", ")}`);
  lines.push("");
  lines.push("**RULES** (mandatory):");
  lines.push("- For ANY field that asks for a person's name (Owner, Sponsor, Assigned To, Responsible, etc) — if no allowed person fits, write `[TBC — <role>]` (e.g. `[TBC — Sponsor]`, `[TBC — Risk Owner]`).");
  lines.push("- For ANY organisation field — if no allowed organisation fits, write `[TBC — <type>]` (e.g. `[TBC — Vendor]`, `[TBC — Insurance Provider]`).");
  lines.push("- Do NOT write 'Sarah Mitchell', 'Marcus Chen', 'Westminster Council', 'Atlantis The Palm', or any other name that is not in the lists above. The validator will catch them and the artefact will be rejected.");
  lines.push("- Role placeholders (Project Manager, Sponsor, Team Lead, etc) are always fine — use them when no specific name is on file.");
  lines.push("");
  return lines.join("\n");
}
