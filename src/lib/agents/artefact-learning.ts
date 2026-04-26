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
import { looksLikeFabricatedName } from "./fabricated-names-pure";
import { summariseArtefactSource, trustFromArtefactSource } from "./source-prefix-pure";

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
  // Per-fact trust override. If unset, the artefact-wide source trust applies.
  // Use this to downgrade an individual fact below the artefact average — e.g.
  // skipping a stakeholder list whose names look fabricated even when the rest
  // of the artefact is research-anchored.
  trust?: "HIGH_TRUST" | "STANDARD" | "REFERENCE_ONLY";
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

    // Trust level is derived from the artefact's universal source prefix
    // (Research-anchored / User-confirmed → HIGH_TRUST, Default-template /
    // Research-thin → REFERENCE_ONLY, mixed/unknown → STANDARD). This stops
    // approved-but-fabricated content from poisoning downstream generations.
    // Individual facts can override via fact.trust when the extractor knows
    // a specific row is unsafe (e.g. a fabricated stakeholder list inside an
    // otherwise research-anchored artefact).
    const sourceSummary = summariseArtefactSource(artefact.content);
    const artefactTrust = trustFromArtefactSource(sourceSummary);

    for (const fact of facts) {
      const trustLevel = fact.trust ?? artefactTrust;
      // Upsert by title — prevents duplicates on repeated saves
      const existing = await db.knowledgeBaseItem.findFirst({
        where: { agentId, projectId, title: fact.title },
        select: { id: true },
      });

      if (existing) {
        await db.knowledgeBaseItem.update({
          where: { id: existing.id },
          data: { content: fact.content, updatedAt: new Date(), tags: fact.tags, trustLevel },
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
            trustLevel,
            tags: fact.tags,
            metadata: {
              sourceArtefact: artefact.id,
              sourceArtefactName: artefact.name,
              sourceSummary,
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
    const [projectItems, workspaceItems, stakeholderRows, approvedArtefacts, project] = await Promise.all([
      // Project-level items (high-trust first — user answers, then artefact knowledge)
      // Exclude internal session metadata items AND items still awaiting user
      // verification — claims ingested from inbound email/external sources are
      // tagged "pending_user_confirmation" so they're not used to generate or
      // mutate artefacts until the user has explicitly confirmed them in chat.
      db.knowledgeBaseItem.findMany({
        where: {
          projectId, orgId, confidential: false,
          NOT: [
            { title: { startsWith: "__" } },
            { tags: { has: "pending_user_confirmation" } },
          ],
        },
        orderBy: [{ trustLevel: "desc" }, { updatedAt: "desc" }],
        take: 60,
        select: { title: true, content: true, trustLevel: true, tags: true, type: true },
      }),
      // Workspace-level items (templates, policies, org standards)
      db.knowledgeBaseItem.findMany({
        where: { orgId, layer: "WORKSPACE", agentId: null, confidential: false },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: { title: true, content: true, trustLevel: true, tags: true, type: true },
      }),
      // Structured stakeholders — the Stakeholder table is the canonical
      // source for who the sponsor / project manager / key contacts are.
      // Without this, KB-only context misses sponsor info that lives in
      // the Stakeholder Register artefact's seeded rows.
      db.stakeholder.findMany({
        where: { projectId },
        select: { name: true, role: true, organisation: true, email: true, power: true, interest: true, sentiment: true },
      }),
      // Approved artefacts — names + first paragraph so the agent can refer
      // back to "what the Project Brief said" when generating later phases.
      db.agentArtefact.findMany({
        where: { projectId, agentId, status: "APPROVED" },
        orderBy: { updatedAt: "desc" },
        take: 12,
        select: { name: true, content: true, format: true, updatedAt: true },
      }),
      db.project.findUnique({
        where: { id: projectId },
        select: { name: true, description: true, category: true, budget: true, startDate: true, endDate: true, methodology: true },
      }),
    ]);

    // ── Cross-project priors ────────────────────────────────────────────
    // Pull HIGH_TRUST KB items from the top 3 most-similar past projects in
    // the same org. Same idea as the dashboard's similar-projects widget,
    // but feeding the agent's prompt instead of just the UI. Items are
    // tagged with the source project name in the rendered context so the
    // agent can cite them as priors rather than treating them as facts
    // about the current project.
    let crossProjectPriors: { sourceProject: string; title: string; content: string; trustLevel: string }[] = [];
    try {
      const { findSimilarProjects } = await import("@/lib/ml/similar-projects");
      const similar = await findSimilarProjects(projectId, 3);
      const validSimilar = similar.filter((s: any) => s.similarity >= 0.55).slice(0, 3);
      if (validSimilar.length > 0) {
        const priorItems = await db.knowledgeBaseItem.findMany({
          where: {
            orgId,
            projectId: { in: validSimilar.map((s: any) => s.projectId) },
            trustLevel: "HIGH_TRUST",
            confidential: false,
            NOT: [
              { title: { startsWith: "__" } },
              { tags: { has: "pending_user_confirmation" } },
            ],
          },
          orderBy: { updatedAt: "desc" },
          take: 12,
          select: { title: true, content: true, trustLevel: true, projectId: true },
        });
        const projectNameById = new Map(validSimilar.map((s: any) => [s.projectId, s.name]));
        crossProjectPriors = priorItems.map((p) => ({
          sourceProject: projectNameById.get(p.projectId) || "past project",
          title: p.title,
          content: p.content,
          trustLevel: p.trustLevel,
        }));
      }
    } catch (e) {
      // Cross-project priors are a nice-to-have; never block generation on failure
      console.error("[artefact-learning] cross-project priors lookup failed:", e);
    }

    // ── Bucket items by trust level so the prompt can weight them ────────
    // Previously every KB item rendered in one flat list with no indication
    // of how reliable it was — a STANDARD Perplexity hunch sat next to a
    // HIGH_TRUST user-confirmed fact and the LLM had no signal to prefer
    // one over the other. Split into three explicit tiers and tell the
    // agent in the prompt how to use them.
    const userAnswers = projectItems.filter(i => i.tags.includes("user_confirmed") || i.tags.includes("user_answer"));
    const highTrustNonUser = projectItems.filter(i => i.trustLevel === "HIGH_TRUST" && !userAnswers.includes(i));
    const standardItems = projectItems.filter(i => i.trustLevel === "STANDARD" && !userAnswers.includes(i));
    const referenceItems = projectItems.filter(i => i.trustLevel === "REFERENCE_ONLY");
    const otherItems = projectItems.filter(i => !userAnswers.includes(i) && !highTrustNonUser.includes(i) && !standardItems.includes(i) && !referenceItems.includes(i));

    const lines: string[] = [
      "━━━ PROJECT KNOWLEDGE BASE (use this information — do NOT invent alternatives) ━━━",
      "Every fact below is canonical. Use these EXACT names, dates, organisations, and decisions.",
      "If a fact you need is NOT below, write [TBC — what's needed] rather than inventing one.",
      "",
    ];

    // ── Project facts (always first — these are the canonical baselines) ──
    if (project) {
      lines.push("── PROJECT BASELINE ──");
      lines.push(`• Project name: ${project.name}`);
      if (project.description) lines.push(`• Description: ${truncate(project.description, 400)}`);
      if (project.category) lines.push(`• Category: ${project.category}`);
      if (project.budget) lines.push(`• Budget: £${project.budget.toLocaleString()}`);
      if (project.startDate) lines.push(`• Start: ${new Date(project.startDate).toLocaleDateString("en-GB")}`);
      if (project.endDate) lines.push(`• End: ${new Date(project.endDate).toLocaleDateString("en-GB")}`);
      if (project.methodology) lines.push(`• Methodology: ${project.methodology}`);
      lines.push("");
    }

    // ── Structured stakeholders (sponsor, PM, contacts) ──
    // Lifted from the Stakeholder table directly so the agent never
    // "doesn't know the sponsor" while generating downstream artefacts.
    if (stakeholderRows.length > 0) {
      lines.push("── PROJECT STAKEHOLDERS (canonical roster — use these EXACT names) ──");
      // Sponsors / decision-makers first
      const sponsors = stakeholderRows.filter(s => /sponsor|owner|executive|director|principal/i.test(s.role || ""));
      const others = stakeholderRows.filter(s => !sponsors.includes(s));
      const renderRow = (s: typeof stakeholderRows[number]) => {
        const parts = [s.name];
        if (s.role) parts.push(s.role);
        if (s.organisation) parts.push(s.organisation);
        if (s.email) parts.push(s.email);
        return `• ${parts.join(" — ")}${s.power && s.interest ? ` (Power ${s.power}/Interest ${s.interest})` : ""}`;
      };
      for (const s of sponsors) lines.push(renderRow(s));
      for (const s of others)   lines.push(renderRow(s));
      lines.push("");
    }

    // User-confirmed answers next — direct answers the user gave during clarification
    if (userAnswers.length > 0) {
      lines.push("── USER-CONFIRMED FACTS (HIGHEST PRIORITY — the user explicitly told you these) ──");
      for (const item of userAnswers) {
        lines.push(`• ${item.title}: ${truncate(item.content, 500)}`);
      }
      lines.push("");
    }

    // ── Approved artefacts — let the agent see what was already documented ──
    // Split into canonical vs placeholder-heavy so default-template artefacts
    // (often approved without anyone noticing the names are fabricated) don't
    // get injected as "do not contradict" canonical content. They still appear
    // in a flagged section so the agent knows they exist but won't cite them.
    if (approvedArtefacts.length > 0) {
      const canonical: typeof approvedArtefacts = [];
      const placeholderHeavy: typeof approvedArtefacts = [];
      for (const a of approvedArtefacts) {
        if (summariseArtefactSource(a.content) === "low") placeholderHeavy.push(a);
        else canonical.push(a);
      }

      if (canonical.length > 0) {
        lines.push("── PREVIOUSLY APPROVED ARTEFACTS (canonical content — do not contradict) ──");
        for (const a of canonical) {
          const preview = a.format === "csv"
            ? truncate(a.content, 600)
            : truncate(stripHtml(a.content), 600);
          lines.push(`• ${a.name} [approved ${new Date(a.updatedAt).toLocaleDateString("en-GB")}]:\n  ${preview.replace(/\n/g, "\n  ")}`);
        }
        lines.push("");
      }

      if (placeholderHeavy.length > 0) {
        lines.push("── APPROVED-BUT-PLACEHOLDER ARTEFACTS (names/values are default templates — confirm with user before citing) ──");
        for (const a of placeholderHeavy) {
          lines.push(`• ${a.name} — needs real names/values, do NOT quote contents as facts`);
        }
        lines.push("");
      }
    }

    // ── HIGH_TRUST research / verified facts (system-classified, not user-spoken) ──
    if (highTrustNonUser.length > 0) {
      lines.push("── HIGH_TRUST FACTS (verified by source — treat as authoritative unless they conflict with USER-CONFIRMED above) ──");
      for (const item of highTrustNonUser) {
        lines.push(`• ${item.title}: ${truncate(item.content, 400)}`);
      }
      lines.push("");
    }

    // Group remaining STANDARD items by tag category for readability
    const stakeholderItems = standardItems.filter(i => i.tags.includes("stakeholders") || i.tags.includes("stakeholder-register"));
    const policyItems = [...standardItems, ...otherItems, ...workspaceItems].filter(i => i.tags.includes("policy") || i.tags.includes("template") || i.tags.includes("org-standard"));
    const factItems = [...standardItems, ...otherItems].filter(i => !stakeholderItems.includes(i) && !policyItems.includes(i));

    if (stakeholderItems.length > 0) {
      lines.push("── EXTRACTED STAKEHOLDER FACTS (STANDARD trust — verify if critical) ──");
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
      lines.push("── STANDARD-TRUST FACTS, DECISIONS & CONSTRAINTS (best-effort — do NOT use to contradict USER-CONFIRMED or HIGH_TRUST above) ──");
      for (const item of factItems) {
        lines.push(`• ${item.title}: ${truncate(item.content, 300)}`);
      }
      lines.push("");
    }

    // ── REFERENCE_ONLY items (raw transcripts etc.) — listed last, with a
    // strong "lookup-only" caveat. The agent shouldn't quote these as
    // facts; they exist so it knows what was discussed in raw form.
    if (referenceItems.length > 0) {
      lines.push("── REFERENCE-ONLY MATERIAL (raw source — do NOT cite as fact, lookup only) ──");
      for (const item of referenceItems) {
        lines.push(`• ${item.title}: ${truncate(item.content, 200)}`);
      }
      lines.push("");
    }

    // ── Cross-project priors ──
    // Render last (lowest priority among real signals). Marked clearly so
    // the agent knows these came from a SIBLING project — useful as a
    // template / "how it was handled before" but never canonical for the
    // current project.
    if (crossProjectPriors.length > 0) {
      lines.push("── PRIORS FROM SIMILAR PAST PROJECTS (use as templates / reference only — they are NOT facts about THIS project) ──");
      for (const p of crossProjectPriors) {
        lines.push(`• [from past project: ${p.sourceProject}] ${p.title}: ${truncate(p.content, 250)}`);
      }
      lines.push("");
    }

    // ── Trust-tier guidance — restate at the bottom so it's the last
    // thing the agent reads before generating. Order is intentional and
    // the LLM is told to honour it explicitly. ──
    lines.push("── HOW TO USE THIS KNOWLEDGE ──");
    lines.push("Trust order (highest → lowest): USER-CONFIRMED > HIGH_TRUST > STANDARD > REFERENCE-ONLY > PRIORS-FROM-PAST-PROJECTS.");
    lines.push("If two facts conflict, the higher-trust one wins. NEVER let a STANDARD or PAST-PROJECT fact override a USER-CONFIRMED fact.");
    lines.push("Recency tie-breaker: if two facts are at the SAME tier and they conflict, prefer the more recent one — UNLESS the older one is USER-CONFIRMED, in which case the user's explicit answer always wins regardless of age.");
    lines.push("If a needed fact is not in any tier above, write [TBC — what's needed] — do NOT invent.");
    lines.push("");
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

  // Collect raw names + roles, then filter out fabricated placeholders before
  // promoting any of them into KB. We only emit the per-name "Stakeholder List"
  // fact when we have at least one real-looking name; if every row looks
  // fabricated we skip the list entirely so default-template stakeholders
  // (Sarah Mitchell, Marcus Chen, Westminster Council) never get cited as
  // confirmed stakeholders downstream.
  let rawCount = 0;
  const realPeople: string[] = [];
  const fabricatedPeople: string[] = [];

  if (artefact.format === "csv") {
    const rows = parseCSV(content);
    if (rows.length > 1) {
      const header = rows[0].map(h => h.toLowerCase().trim());
      const nameIdx = header.findIndex(h => h.includes("name") || h.includes("person"));
      const roleIdx = header.findIndex(h => h.includes("role") || h.includes("type") || h.includes("organisation"));

      for (const row of rows.slice(1)) {
        if (!row.length) continue;
        const name = nameIdx >= 0 ? row[nameIdx]?.trim() : "";
        const role = roleIdx >= 0 ? row[roleIdx]?.trim() : "";
        if (!name || name === "TBD" || name.length <= 1) continue;
        rawCount++;
        const display = role ? `${name} (${role})` : name;
        if (looksLikeFabricatedName(name)) fabricatedPeople.push(display);
        else realPeople.push(display);
      }
    }
  } else {
    const names = extractNamesFromText(content);
    rawCount = names.length;
    for (const n of names) {
      if (looksLikeFabricatedName(n)) fabricatedPeople.push(n);
      else realPeople.push(n);
    }
  }

  if (realPeople.length > 0) {
    facts.push({
      title: `Stakeholder List — ${artefact.name}`,
      content: `Known stakeholders for this project:\n${realPeople.map(p => `• ${p}`).join("\n")}`,
      tags: ["stakeholders", "stakeholder-register", "people", "auto-extracted"],
    });
  }

  // If most rows were fabricated, surface a low-trust flag so the agent and
  // human reviewers can see the artefact still needs real names. We never
  // promote the fabricated names themselves — REFERENCE_ONLY items are
  // excluded from generation context in getProjectKnowledgeContext.
  if (fabricatedPeople.length > 0 && fabricatedPeople.length >= rawCount * 0.5) {
    facts.push({
      title: `Stakeholder List (placeholders only) — ${artefact.name}`,
      content:
        `Stakeholder register currently uses placeholder names — confirm with the user before relying on these:\n` +
        fabricatedPeople.map(p => `• ${p}`).join("\n"),
      tags: ["stakeholders", "stakeholder-register", "placeholder", "needs-confirmation", "auto-extracted"],
      trust: "REFERENCE_ONLY",
    });
  }

  // Store the full approved content as a reference. Trust defaults to the
  // artefact-wide source summary, but if half-or-more of the names look
  // fabricated we hard-cap it to REFERENCE_ONLY — the artefact's own source
  // prefixes can lie ("User-confirmed — Sarah Mitchell" written by a default
  // template), so we trust the per-row name detector over the prefix here.
  const placeholderHeavy = fabricatedPeople.length > 0 && fabricatedPeople.length >= rawCount * 0.5;
  facts.push({
    title: `Approved: ${artefact.name}`,
    content: truncate(stripHtml(content), 3000),
    tags: placeholderHeavy
      ? ["stakeholder-register", "approved-artefact", "placeholder", "needs-confirmation", "auto-extracted"]
      : ["stakeholder-register", "approved-artefact", "auto-extracted"],
    ...(placeholderHeavy ? { trust: "REFERENCE_ONLY" as const } : {}),
  });

  return facts;
}

// ── Resource Management Plan ──────────────────────────────────────────────────

function extractResourceFacts(artefact: ArtefactRecord): KBFact[] {
  const facts: KBFact[] = [];
  const content = artefact.content;

  let rawCount = 0;
  const realPeople: string[] = [];
  const fabricatedPeople: string[] = [];

  if (artefact.format === "csv") {
    const rows = parseCSV(content);
    if (rows.length > 1) {
      const header = rows[0].map(h => h.toLowerCase().trim());
      const nameIdx = header.findIndex(h => h.includes("name") || h.includes("person"));
      const roleIdx = header.findIndex(h => h.includes("role"));

      for (const row of rows.slice(1)) {
        if (!row.length) continue;
        const name = nameIdx >= 0 ? row[nameIdx]?.trim() : "";
        const role = roleIdx >= 0 ? row[roleIdx]?.trim() : "";
        if (!name || name.toLowerCase().startsWith("tbd") || name.length <= 2) continue;
        rawCount++;
        const display = role ? `${role}: ${name}` : name;
        if (looksLikeFabricatedName(name)) fabricatedPeople.push(display);
        else realPeople.push(display);
      }

      if (realPeople.length > 0) {
        facts.push({
          title: `Resource Assignments — ${artefact.name}`,
          content: `Named resources assigned to this project:\n${realPeople.map(p => `• ${p}`).join("\n")}`,
          tags: ["resources", "people", "assignments", "auto-extracted"],
        });
      }
    }
  }

  const placeholderHeavy = fabricatedPeople.length > 0 && fabricatedPeople.length >= rawCount * 0.5;
  facts.push({
    title: `Approved: ${artefact.name}`,
    content: truncate(stripHtml(content), 3000),
    tags: placeholderHeavy
      ? ["resource-plan", "approved-artefact", "placeholder", "needs-confirmation", "auto-extracted"]
      : ["resource-plan", "approved-artefact", "auto-extracted"],
    ...(placeholderHeavy ? { trust: "REFERENCE_ONLY" as const } : {}),
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
