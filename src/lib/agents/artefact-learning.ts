/**
 * Artefact Learning — extracts structured knowledge from approved/saved
 * artefacts and stores it in the KnowledgeBase so subsequent generations
 * can use real names, decisions, policies, and constraints.
 *
 * Two exports:
 *   extractAndStoreArtefactKnowledge(artefact, agentId, projectId, orgId)
 *     — called on every PATCH (save or approve)
 *
 *   getProjectKnowledgeContext(agentId, projectId, orgId)
 *     — called before each generation prompt to inject KB into Claude
 */

import { db } from "@/lib/db";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ArtefactRecord {
  id: string;
  name: string;
  format: string;
  content: string;
  status: string;
}

interface KBFact {
  title: string;
  content: string;
  tags: string[];
}

// ─── Extraction dispatcher ────────────────────────────────────────────────────

/**
 * Extract structured facts from an artefact and upsert them into the KB.
 * Called whenever an artefact is saved (content changed) or approved.
 * Fire-and-forget — errors are caught so they never block the API response.
 */
export async function extractAndStoreArtefactKnowledge(
  artefact: ArtefactRecord,
  agentId: string,
  projectId: string,
  orgId: string,
): Promise<void> {
  try {
    const facts = await extractFacts(artefact);
    if (facts.length === 0) return;

    for (const fact of facts) {
      // Upsert by title — prevents duplicates on repeated saves
      const existing = await db.knowledgeBaseItem.findFirst({
        where: { agentId, projectId, title: fact.title },
        select: { id: true },
      });

      if (existing) {
        await db.knowledgeBaseItem.update({
          where: { id: existing.id },
          data: { content: fact.content, updatedAt: new Date(), tags: fact.tags },
        });
      } else {
        await db.knowledgeBaseItem.create({
          data: {
            orgId,
            agentId,
            projectId,
            layer: "PROJECT",
            type: "TEXT",
            title: fact.title,
            content: fact.content,
            trustLevel: "HIGH_TRUST",   // user-edited content = highest trust
            tags: fact.tags,
            metadata: {
              sourceArtefact: artefact.id,
              sourceArtefactName: artefact.name,
              extractedAt: new Date().toISOString(),
            },
          },
        });
      }
    }

    // Log that learning happened
    await db.agentActivity.create({
      data: {
        agentId,
        type: "document",
        summary: `Learnt from "${artefact.name}" — ${facts.length} knowledge item${facts.length === 1 ? "" : "s"} updated`,
      },
    });
  } catch (e) {
    console.error("[artefact-learning] extraction failed:", e);
  }
}

// ─── Context builder ──────────────────────────────────────────────────────────

/**
 * Builds a compact knowledge context string for injection into generation prompts.
 * Pulls the most recent HIGH_TRUST KB items for this project, plus workspace-level items.
 * Designed to be prepended to both buildSpreadsheetPrompt and buildArtefactPrompt.
 */
export async function getProjectKnowledgeContext(
  agentId: string,
  projectId: string,
  orgId: string,
): Promise<string> {
  try {
    const [projectItems, workspaceItems] = await Promise.all([
      // Project-level items (high-trust first — user-edited artefacts)
      db.knowledgeBaseItem.findMany({
        where: { projectId, orgId, confidential: false },
        orderBy: [{ trustLevel: "desc" }, { updatedAt: "desc" }],
        take: 30,
        select: { title: true, content: true, trustLevel: true, tags: true, type: true },
      }),
      // Workspace-level items (templates, policies, org standards)
      db.knowledgeBaseItem.findMany({
        where: { orgId, layer: "WORKSPACE", agentId: null, confidential: false },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: { title: true, content: true, trustLevel: true, tags: true, type: true },
      }),
    ]);

    if (projectItems.length === 0 && workspaceItems.length === 0) return "";

    const lines: string[] = [
      "━━━ PROJECT KNOWLEDGE BASE (use this information — do NOT invent alternatives) ━━━",
      "The following facts, names, decisions, and policies have been established for this project.",
      "ALWAYS use this information in preference to generating new names or data.",
      "",
    ];

    // Group by tag category for readability
    const stakeholderItems = projectItems.filter(i => i.tags.includes("stakeholders") || i.tags.includes("stakeholder-register"));
    const policyItems = [...projectItems, ...workspaceItems].filter(i => i.tags.includes("policy") || i.tags.includes("template") || i.tags.includes("org-standard"));
    const factItems = projectItems.filter(i => !stakeholderItems.includes(i) && !policyItems.includes(i));

    if (stakeholderItems.length > 0) {
      lines.push("── KNOWN PEOPLE & STAKEHOLDERS (use these exact names) ──");
      for (const item of stakeholderItems) {
        lines.push(`• ${item.title}: ${truncate(item.content, 400)}`);
      }
      lines.push("");
    }

    if (policyItems.length > 0) {
      lines.push("── POLICIES, TEMPLATES & ORG STANDARDS ──");
      for (const item of policyItems) {
        lines.push(`• ${item.title}: ${truncate(item.content, 400)}`);
      }
      lines.push("");
    }

    if (factItems.length > 0) {
      lines.push("── PROJECT FACTS, DECISIONS & CONSTRAINTS ──");
      for (const item of factItems) {
        lines.push(`• ${item.title}: ${truncate(item.content, 300)}`);
      }
      lines.push("");
    }

    lines.push("━━━ END KNOWLEDGE BASE ━━━");
    lines.push("");

    return lines.join("\n");
  } catch (e) {
    console.error("[artefact-learning] getProjectKnowledgeContext failed:", e);
    return "";
  }
}

// ─── Fact extractors ──────────────────────────────────────────────────────────

async function extractFacts(artefact: ArtefactRecord): Promise<KBFact[]> {
  const lname = artefact.name.toLowerCase();

  // Route to specialised extractor based on artefact type
  if (lname.includes("stakeholder")) {
    return extractStakeholderFacts(artefact);
  }
  if (lname.includes("resource management") || lname.includes("resource plan") || lname.includes("raci")) {
    return extractResourceFacts(artefact);
  }
  if (lname.includes("risk register") || lname.includes("risk log")) {
    return extractRiskFacts(artefact);
  }
  if (lname.includes("charter") || lname.includes("brief") || lname.includes("business case") || lname.includes("feasibility")) {
    return extractProjectBrief(artefact);
  }
  if (lname.includes("budget") || lname.includes("cost") || lname.includes("evm")) {
    return extractBudgetFacts(artefact);
  }
  if (lname.includes("communication plan")) {
    return extractCommunicationFacts(artefact);
  }

  // Generic: use Claude to extract key facts if API key is available
  return extractGenericFacts(artefact);
}

// ── Stakeholder Register ──────────────────────────────────────────────────────

function extractStakeholderFacts(artefact: ArtefactRecord): KBFact[] {
  const facts: KBFact[] = [];
  const content = artefact.content;

  if (artefact.format === "csv") {
    // Parse CSV rows — columns: ID, Name, Role/Type, ...
    const rows = parseCSV(content);
    if (rows.length > 1) {
      const header = rows[0].map(h => h.toLowerCase().trim());
      const nameIdx = header.findIndex(h => h.includes("name") || h.includes("person"));
      const roleIdx = header.findIndex(h => h.includes("role") || h.includes("type") || h.includes("organisation"));
      const interestIdx = header.findIndex(h => h.includes("interest") || h.includes("influence"));

      const people: string[] = [];
      for (const row of rows.slice(1)) {
        if (!row.length) continue;
        const name = nameIdx >= 0 ? row[nameIdx]?.trim() : "";
        const role = roleIdx >= 0 ? row[roleIdx]?.trim() : "";
        if (name && name !== "TBD" && name.length > 1) {
          people.push(role ? `${name} (${role})` : name);
        }
      }

      if (people.length > 0) {
        facts.push({
          title: `Stakeholder List — ${artefact.name}`,
          content: `Known stakeholders for this project:\n${people.map(p => `• ${p}`).join("\n")}`,
          tags: ["stakeholders", "stakeholder-register", "people", "auto-extracted"],
        });
      }
    }
  } else {
    // HTML/markdown — extract names from table cells or lines
    const names = extractNamesFromText(content);
    if (names.length > 0) {
      facts.push({
        title: `Stakeholder List — ${artefact.name}`,
        content: `Known stakeholders for this project:\n${names.map(n => `• ${n}`).join("\n")}`,
        tags: ["stakeholders", "stakeholder-register", "people", "auto-extracted"],
      });
    }
  }

  // Store the full approved content as a high-trust reference
  facts.push({
    title: `Approved: ${artefact.name}`,
    content: truncate(stripHtml(content), 3000),
    tags: ["stakeholder-register", "approved-artefact", "auto-extracted"],
  });

  return facts;
}

// ── Resource Management Plan ──────────────────────────────────────────────────

function extractResourceFacts(artefact: ArtefactRecord): KBFact[] {
  const facts: KBFact[] = [];
  const content = artefact.content;

  if (artefact.format === "csv") {
    const rows = parseCSV(content);
    if (rows.length > 1) {
      const header = rows[0].map(h => h.toLowerCase().trim());
      const nameIdx = header.findIndex(h => h.includes("name") || h.includes("person"));
      const roleIdx = header.findIndex(h => h.includes("role"));

      const people: string[] = [];
      for (const row of rows.slice(1)) {
        if (!row.length) continue;
        const name = nameIdx >= 0 ? row[nameIdx]?.trim() : "";
        const role = roleIdx >= 0 ? row[roleIdx]?.trim() : "";
        if (name && !name.toLowerCase().startsWith("tbd") && name.length > 2) {
          people.push(role ? `${role}: ${name}` : name);
        }
      }

      if (people.length > 0) {
        facts.push({
          title: `Resource Assignments — ${artefact.name}`,
          content: `Named resources assigned to this project:\n${people.map(p => `• ${p}`).join("\n")}`,
          tags: ["resources", "people", "assignments", "auto-extracted"],
        });
      }
    }
  }

  facts.push({
    title: `Approved: ${artefact.name}`,
    content: truncate(stripHtml(content), 3000),
    tags: ["resource-plan", "approved-artefact", "auto-extracted"],
  });

  return facts;
}

// ── Risk Register ─────────────────────────────────────────────────────────────

function extractRiskFacts(artefact: ArtefactRecord): KBFact[] {
  const facts: KBFact[] = [];
  const content = artefact.content;
  const truncated = truncate(stripHtml(content), 4000);

  facts.push({
    title: `Approved: ${artefact.name}`,
    content: truncated,
    tags: ["risk-register", "risks", "approved-artefact", "auto-extracted"],
  });

  return facts;
}

// ── Project Charter / Brief / Business Case ───────────────────────────────────

function extractProjectBrief(artefact: ArtefactRecord): KBFact[] {
  const clean = stripHtml(artefact.content);

  // Extract sponsor/owner names from common patterns
  const sponsorMatch = clean.match(/(?:sponsor|owner|director|manager)[:\s]+([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)/i);
  const facts: KBFact[] = [];

  if (sponsorMatch) {
    facts.push({
      title: `Project Sponsor / Owner`,
      content: `Project sponsor/owner identified as: ${sponsorMatch[1]}`,
      tags: ["people", "sponsor", "auto-extracted"],
    });
  }

  facts.push({
    title: `Approved: ${artefact.name}`,
    content: truncate(clean, 4000),
    tags: ["charter", "brief", "approved-artefact", "auto-extracted"],
  });

  return facts;
}

// ── Budget / Cost facts ───────────────────────────────────────────────────────

function extractBudgetFacts(artefact: ArtefactRecord): KBFact[] {
  return [{
    title: `Approved: ${artefact.name}`,
    content: truncate(stripHtml(artefact.content), 3000),
    tags: ["budget", "cost", "approved-artefact", "auto-extracted"],
  }];
}

// ── Communication Plan ────────────────────────────────────────────────────────

function extractCommunicationFacts(artefact: ArtefactRecord): KBFact[] {
  const facts: KBFact[] = [];
  const content = artefact.content;

  if (artefact.format === "csv") {
    const rows = parseCSV(content);
    if (rows.length > 1) {
      const header = rows[0].map(h => h.toLowerCase().trim());
      const nameIdx = header.findIndex(h => h.includes("name") || h.includes("stakeholder"));
      const roleIdx = header.findIndex(h => h.includes("role"));
      const people: string[] = [];
      for (const row of rows.slice(1)) {
        const name = nameIdx >= 0 ? row[nameIdx]?.trim() : "";
        const role = roleIdx >= 0 ? row[roleIdx]?.trim() : "";
        if (name && !name.toLowerCase().startsWith("tbd") && name.length > 2) {
          people.push(role ? `${role}: ${name}` : name);
        }
      }
      if (people.length > 0) {
        facts.push({
          title: `Communication Contacts — ${artefact.name}`,
          content: `Communication plan contacts:\n${people.map(p => `• ${p}`).join("\n")}`,
          tags: ["stakeholders", "people", "communication", "auto-extracted"],
        });
      }
    }
  }

  facts.push({
    title: `Approved: ${artefact.name}`,
    content: truncate(stripHtml(content), 3000),
    tags: ["communication-plan", "approved-artefact", "auto-extracted"],
  });

  return facts;
}

// ── Generic Claude-powered extractor ─────────────────────────────────────────

async function extractGenericFacts(artefact: ArtefactRecord): Promise<KBFact[]> {
  const clean = truncate(stripHtml(artefact.content), 6000);

  // Always store the approved content itself
  const base: KBFact = {
    title: `Approved: ${artefact.name}`,
    content: clean,
    tags: ["approved-artefact", "auto-extracted"],
  };

  if (!process.env.ANTHROPIC_API_KEY || clean.length < 100) return [base];

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: `Extract key facts from this project management document that future documents should know about.
Focus on: people's names and roles, decisions made, constraints, deadlines, budgets, policies.
Return JSON only (no markdown):
{ "facts": [{ "title": "short title", "content": "fact detail" }] }
Max 8 facts. Only extract explicitly stated facts — no inference.

DOCUMENT: ${artefact.name}
CONTENT:
${clean}`,
        }],
      }),
    });

    if (!res.ok) return [base];

    const data = await res.json();
    const text = (data.content?.[0]?.text || "").trim()
      .replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(text);

    const extracted: KBFact[] = (parsed.facts || []).slice(0, 8).map((f: any) => ({
      title: f.title,
      content: f.content,
      tags: ["auto-extracted", "key-fact"],
    }));

    return [base, ...extracted];
  } catch {
    return [base];
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h[1-6]|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

/** Simple CSV parser — handles quoted fields */
function parseCSV(csv: string): string[][] {
  const rows: string[][] = [];
  const lines = csv.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        cols.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur);
    rows.push(cols);
  }
  return rows;
}

/** Extract names matching "Firstname Lastname" pattern from text */
function extractNamesFromText(text: string): string[] {
  const clean = stripHtml(text);
  const lines = clean.split("\n");
  const names: string[] = [];
  for (const line of lines) {
    // Look for cells/values with proper name patterns (2+ capital words, not TBD)
    const matches = line.match(/\b([A-Z][a-z]{1,15}(?:\s[A-Z][a-z]{1,15})+)\b/g);
    if (matches) {
      for (const m of matches) {
        if (!m.startsWith("TBD") && !["Project", "Phase", "Status", "Version", "Draft"].includes(m.split(" ")[0])) {
          if (!names.includes(m)) names.push(m);
        }
      }
    }
  }
  return names.slice(0, 20);
}
