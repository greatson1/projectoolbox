/**
 * Feasibility Research — first step after agent deployment.
 *
 * Before generating any artefacts or asking questions, the agent researches
 * the project context using Perplexity AI. This builds a foundational
 * knowledge base so that:
 *   1. Clarification questions are smarter (informed by real-world context)
 *   2. Artefacts are grounded in actual data, not generic templates
 *   3. Risks, costs, and stakeholder considerations are evidence-based
 *
 * Flow: Deploy → Research (this module) → Clarification Questions → Generate Artefacts
 */

import { db } from "@/lib/db";
import { isN8nEnabled, forwardToN8n } from "@/lib/n8n";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ResearchSection {
  label: string;
  content: string;
}

interface ResearchFact {
  title: string;
  content: string;
}

export interface ResearchResult {
  factsDiscovered: number;
  queries: string[];
  summary: string;
  sections: ResearchSection[];
  facts: ResearchFact[];
}

interface ProjectContext {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  budget: number | null;
  startDate: Date | string | null;
  endDate: Date | string | null;
  methodology: string | null;
}

// ─── Perplexity API ──────────────────────────────────────────────────────────

async function queryPerplexity(query: string): Promise<string> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY not set");

  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        {
          role: "system",
          content: "You are a project management research assistant. Provide specific, factual, actionable information. Include real costs, timelines, regulations, and requirements where available. Always cite sources. Be concise — bullet points preferred over paragraphs.",
        },
        { role: "user", content: query },
      ],
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "unknown");
    throw new Error(`Perplexity API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// ─── Research Query Builder ──────────────────────────────────────────────────

function buildResearchQueries(project: ProjectContext): string[] {
  const name = project.name || "the project";
  const desc = project.description || "";
  const category = (project.category || "general").toLowerCase();
  const budget = project.budget ? `£${project.budget.toLocaleString()}` : null;

  const queries: string[] = [];

  // Resolve time context — used across all queries so data is current-year-specific
  const startDate = (project as any).startDate ? new Date((project as any).startDate) : null;
  const endDate = (project as any).endDate ? new Date((project as any).endDate) : null;
  const nowYear = new Date().getFullYear();
  const projectYear = startDate ? startDate.getFullYear() : nowYear;
  const projectMonth = startDate ? startDate.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : `${nowYear}`;
  const duration = startDate && endDate ? Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000) + " days" : "unknown duration";

  // Query 1: Core feasibility — now with explicit quantitative + temporal focus
  queries.push(
    `Project feasibility analysis for: "${name}". ${desc ? `Context: ${desc.slice(0, 300)}` : ""} ${budget ? `Budget: ${budget}.` : ""} Timing: ${projectMonth}, duration ${duration}.
Provide SPECIFIC, CURRENT (${nowYear}) data on:
(1) QUANTIFIED costs — actual current prices, not ranges from past years
(2) Real timelines — how long similar projects actually take today
(3) Top 5 risks with frequency data where available
(4) Current market conditions affecting this project type
Cite sources and avoid generic advice.`
  );

  // Query 2: Category-specific research — every category explicitly covers
  // time-sensitive factors (current rates, current regulations, current trends)
  // that Claude is most likely to hallucinate about if missing.
  if (category === "travel" || desc.toLowerCase().includes("trip") || desc.toLowerCase().includes("travel")) {
    const destination = extractDestination(desc) || name;
    queries.push(
      `Comprehensive travel planning for ${destination} in ${projectMonth}:
(1) CLIMATE AND WEATHER — temperature, humidity, rainfall, sandstorm/monsoon/hurricane risk in this specific month. Peak/shoulder/off-season status?
(2) Visa and entry requirements for UK passport holders as of ${nowYear}
(3) Typical accommodation costs in this season (per night, 4-star and 5-star)
(4) Transport options and current costs
(5) FCDO/FCO travel advisory status as of ${nowYear}
(6) Local regulations affecting visitors (including alcohol/dress codes)
(7) Cultural considerations
(8) Health and vaccination requirements
Cite current sources. Do not rely on pre-${nowYear - 1} descriptions.`
    );
  } else if (category === "training" || desc.toLowerCase().includes("training") || desc.toLowerCase().includes("course")) {
    queries.push(
      `Training programme planning for "${name}" in the UK as of ${nowYear}:
(1) CURRENT market rates for trainers and training venues (per day, per attendee)
(2) Accreditation/certification body requirements and fees
(3) Venue options with typical capacities and costs (hotels, dedicated training centres, hybrid)
(4) Materials and equipment costs (printed, digital, licences)
(5) Accessibility and inclusivity requirements
(6) Common evaluation methods and expected completion/pass rates
(7) Lead times for booking venues and recruiting delegates
${budget ? `Budget context: ${budget}.` : ""} Cite current sources.`
    );
  } else if (category === "event" || desc.toLowerCase().includes("event") || desc.toLowerCase().includes("conference")) {
    queries.push(
      `Event planning for "${name}" in ${projectMonth}:
(1) CURRENT venue market rates (capacity ranges and price bands)
(2) Catering costs per head (current ${nowYear} rates)
(3) AV and production costs
(4) Date conflicts — major public/industry events on/around this date to avoid
(5) Insurance requirements (public liability, event cancellation)
(6) Health & safety regulations (COVID-era practices still required?)
(7) Registration platform options and fees
(8) Typical lead times for booking key elements
${budget ? `Budget context: ${budget}.` : ""} Cite current sources.`
    );
  } else if (category === "construction" || desc.toLowerCase().includes("build") || desc.toLowerCase().includes("renovation") || desc.toLowerCase().includes("fit-out")) {
    queries.push(
      `Construction/renovation planning for "${name}" in the UK as of ${nowYear}:
(1) CURRENT material cost trends (steel, timber, concrete, glass, aggregates) — are prices rising or falling?
(2) Current labour rates (day rates for key trades: builder, electrician, plumber, plasterer)
(3) Planning permission requirements and typical timelines
(4) Building regulations (Part L, Part B, fire safety post-Grenfell)
(5) Typical contractor cost breakdowns for this project type
(6) Common delay causes and mitigation strategies
(7) Insurance and warranty requirements (NHBC, JCT contracts)
(8) Supply chain conditions affecting lead times
${budget ? `Budget context: ${budget}.` : ""} Cite sources from ${nowYear - 1}-${nowYear}.`
    );
  } else if (category === "it" || category === "software" || desc.toLowerCase().includes("software") || desc.toLowerCase().includes("app") || desc.toLowerCase().includes("system") || desc.toLowerCase().includes("servicenow") || desc.toLowerCase().includes("migration")) {
    queries.push(
      `IT/Software project considerations for "${name}" as of ${nowYear}:
(1) CURRENT technology landscape — which stacks/tools/versions are production-ready TODAY (not 2022)
(2) Typical licence / SaaS costs per user per month
(3) Cloud infrastructure costs (AWS/Azure/GCP current rates)
(4) Current developer day rates (contract vs permanent, by seniority, UK)
(5) Realistic delivery timelines for similar projects
(6) Security/compliance requirements (GDPR, SOC 2, ISO 27001)
(7) Common vendor/platform risks (deprecations, acquisitions, pricing changes in ${nowYear})
(8) Integration patterns and typical gotchas
${budget ? `Budget context: ${budget}.` : ""} Cite current sources.`
    );
  } else {
    queries.push(
      `Domain analysis for "${name}" as of ${nowYear}: ${desc ? `Description: ${desc.slice(0, 300)}` : ""}
(1) CURRENT market/industry conditions for this project type
(2) Actual ${nowYear} benchmarks for cost, timeline, team size
(3) Top 5 risks with frequency/likelihood data
(4) Common pitfalls and how similar projects fail
(5) Key success factors with measurable outcomes
(6) Regulatory or compliance considerations
Cite current sources. Avoid generic advice.`
    );
  }

  // Query 3: Regulatory/compliance — year-specific so we catch recent changes
  queries.push(
    `UK regulatory and compliance requirements for "${name}" as of ${nowYear}. ${desc ? `Context: ${desc.slice(0, 200)}` : ""}
Include:
(1) Permits, licences, certifications needed
(2) Insurance requirements (professional indemnity, employer's liability, public liability)
(3) Health & safety (CDM 2015 for construction, HSG for events, etc)
(4) Data protection (UK GDPR post-${nowYear - 2})
(5) Any recent regulatory changes in ${nowYear - 1}-${nowYear} affecting this project type
(6) Industry-specific standards (ISO, BSI, sector-regulators)
Cite current sources.`
  );

  return queries;
}

function extractDestination(description: string): string | null {
  // Simple extraction of destination from description
  const patterns = [
    /(?:to|in|at|visiting)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:trip|travel|visit|holiday)/,
  ];
  for (const p of patterns) {
    const match = description.match(p);
    if (match) return match[1];
  }
  return null;
}

// ─── Fact Extraction ─────────────────────────────────────────────────────────

async function extractAndStoreFacts(
  agentId: string,
  projectId: string,
  orgId: string,
  researchText: string,
  queryLabel: string,
): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY || !researchText.trim()) return 0;

  // Use Claude to extract structured facts from the research
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: `Extract the key facts from this research that would be useful for project planning. Return ONLY a JSON array of objects with "title" and "content" fields. Title should be a short label (2-5 words), content should be the specific detail.

Only include facts that are:
- Specific and actionable (not generic advice)
- Relevant to project planning, budgeting, risk management, or logistics
- Based on the research data (not your own knowledge)

Research text:
${researchText.slice(0, 4000)}

Return ONLY the JSON array, no other text.`,
      }],
    }),
  });

  if (!response.ok) return 0;

  const data = await response.json();
  const text = data.content?.[0]?.text || "";

  let facts: Array<{ title: string; content: string }> = [];
  try {
    // Extract JSON array — handle cases where Claude wraps in markdown
    const jsonStr = text.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();
    facts = JSON.parse(jsonStr);
    if (!Array.isArray(facts)) facts = [];
  } catch {
    return 0;
  }

  // ── Confidence cross-check (validation pass) ───────────────────────────
  // Before storing, ask Claude a second time to flag any extracted fact
  // that (a) contradicts an existing HIGH_TRUST KB item or (b) is
  // suspiciously specific without sourcing in the research text. Flagged
  // facts get tagged "pending_user_confirmation" so they're EXCLUDED from
  // artefact generation until the user confirms in chat. Untagged facts
  // proceed straight in as STANDARD trust (existing behaviour).
  const flaggedTitles = new Set<string>();
  try {
    const existingHighTrust = await db.knowledgeBaseItem.findMany({
      where: { agentId, projectId, trustLevel: "HIGH_TRUST" },
      select: { title: true, content: true },
      take: 30,
    });
    if (facts.length > 0) {
      const validationPrompt = `You are validating research-extracted facts against existing project knowledge.

EXISTING USER-CONFIRMED / HIGH-TRUST FACTS:
${existingHighTrust.length > 0 ? existingHighTrust.map(f => `• ${f.title}: ${f.content.slice(0, 200)}`).join("\n") : "(none yet)"}

NEW RESEARCH-EXTRACTED FACTS (need validation):
${facts.slice(0, 20).map((f, i) => `${i + 1}. ${f.title}: ${f.content.slice(0, 240)}`).join("\n")}

ORIGINAL RESEARCH TEXT (for verification):
${researchText.slice(0, 3000)}

For each NEW fact, decide if it should be flagged for user confirmation. Flag if ANY of:
  • The fact contradicts an existing HIGH_TRUST fact
  • The fact is suspiciously specific (a price, name, date, or stat) but is NOT clearly stated in the original research text
  • The fact makes a strong claim ("X is the best", "Y is impossible") without supporting evidence in the research

Return ONLY a JSON array of the 1-based indices to flag, e.g. [2, 5, 7]. If none should be flagged, return []. Do not return any other text.`;

      const validationResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 200,
          messages: [{ role: "user", content: validationPrompt }],
        }),
      }).catch(() => null);

      if (validationResponse?.ok) {
        const vData = await validationResponse.json();
        const vText = (vData.content?.[0]?.text || "").trim();
        try {
          const flaggedIdx: number[] = JSON.parse(vText.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim());
          if (Array.isArray(flaggedIdx)) {
            for (const i of flaggedIdx) {
              const fact = facts[i - 1];
              if (fact?.title) flaggedTitles.add(fact.title);
            }
          }
        } catch { /* if parsing fails, all facts proceed un-flagged */ }
      }
    }
  } catch (e) {
    console.error("[research-validation] cross-check failed (storing all as STANDARD):", e);
  }

  // Store each fact to KB. ALL research facts now land tagged
  // pending_user_confirmation so getProjectKnowledgeContext excludes them
  // from artefact prompts until the user signs off via the approval queue.
  // Previously only "flagged" (low-confidence) facts were gated; the rest
  // silently became inputs to artefact generation. Now every fact follows
  // the same human-in-the-loop path.
  let stored = 0;
  let flaggedCount = 0;
  const createdIds: string[] = [];
  for (const fact of facts.slice(0, 20)) {
    if (!fact.title || !fact.content) continue;
    try {
      const existing = await db.knowledgeBaseItem.findFirst({
        where: { agentId, projectId, title: fact.title },
        select: { id: true },
      });
      if (existing) continue; // Don't duplicate

      const isFlagged = flaggedTitles.has(fact.title);
      const created = await db.knowledgeBaseItem.create({
        data: {
          orgId,
          agentId,
          projectId,
          layer: "PROJECT",
          type: "TEXT",
          title: fact.title,
          content: `[Research — ${queryLabel}${isFlagged ? " · NEEDS REVIEW" : ""}] ${fact.content}`,
          trustLevel: "STANDARD",
          tags: [
            "research",
            "feasibility",
            "perplexity",
            queryLabel.toLowerCase().replace(/\s+/g, "_"),
            "pending_user_confirmation",
            ...(isFlagged ? ["needs_review"] : []),
          ],
          metadata: { source: "perplexity_research", extractedAt: new Date().toISOString(), flaggedForReview: isFlagged } as any,
        },
      });
      stored++;
      if (isFlagged) flaggedCount++;
      createdIds.push(created.id);
    } catch {}
  }

  // Bundle the findings into a single approval row so the user reviews them
  // through the approval queue instead of digging through the KB. Keeping
  // the chat heads-up too for the flagged subset.
  if (createdIds.length > 0) {
    try {
      const { createResearchApproval } = await import("@/lib/agents/research-approval");
      await createResearchApproval({
        agentId,
        projectId,
        kbItemIds: createdIds,
        source: "perplexity_research",
        query: queryLabel,
        flaggedCount,
      });
    } catch (e) {
      console.error("[feasibility-research] createResearchApproval failed:", e);
    }
  }

  if (flaggedCount > 0) {
    await db.chatMessage.create({
      data: {
        agentId,
        role: "agent",
        content: `Research returned ${stored} fact${stored !== 1 ? "s" : ""} (${queryLabel}). I've flagged **${flaggedCount}** as low-confidence. The full batch is now in the Approvals queue for your review — nothing influences artefact generation until you approve.`,
      },
    }).catch(() => {});
  }

  return stored;
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Run feasibility research for a newly deployed project.
 * Queries Perplexity AI for real-world context, extracts facts, stores to KB.
 * Returns a summary that can be used to inform clarification questions.
 */
export async function runFeasibilityResearch(
  agentId: string,
  projectId: string,
  orgId: string,
): Promise<ResearchResult> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, description: true, category: true, budget: true, startDate: true, endDate: true, methodology: true },
  });
  if (!project) return { factsDiscovered: 0, queries: [], summary: "Project not found", sections: [], facts: [] };

  // ── n8n forwarding gate ──────────────────────────────────────────
  // If configured, let n8n orchestrate the Perplexity → Claude → KB pipeline.
  // n8n should call back to /api/webhooks/n8n-callback with store_kb actions.
  if (await isN8nEnabled("feasibility_research")) {
    const forwarded = await forwardToN8n("feasibility_research", {
      agentId,
      projectId,
      orgId,
      project: {
        name: project.name,
        description: project.description,
        category: project.category,
        budget: (project as any).budget,
        startDate: (project as any).startDate,
        endDate: (project as any).endDate,
        methodology: (project as any).methodology,
      },
    }, { timeout: 30_000 });
    if (forwarded) {
      // n8n will handle research and callback with results.
      // Return a placeholder — lifecycle-init will proceed to clarification.
      return {
        factsDiscovered: 0,
        queries: [],
        summary: "Research forwarded to n8n workflow — facts will be stored via callback.",
        sections: [],
        facts: [],
      };
    }
  }

  const queries = buildResearchQueries(project as ProjectContext);
  const queryLabels = ["Core feasibility", "Domain-specific research", "Regulatory & compliance"];

  let totalFacts = 0;
  const allResearch: string[] = [];

  for (let i = 0; i < queries.length; i++) {
    try {
      const result = await queryPerplexity(queries[i]);
      if (result) {
        allResearch.push(result);

        // Store the raw research as a KB item too
        await db.knowledgeBaseItem.create({
          data: {
            orgId, agentId, projectId,
            layer: "PROJECT", type: "TEXT",
            title: `Feasibility Research: ${queryLabels[i]}`,
            content: result.slice(0, 5000),
            trustLevel: "STANDARD",
            tags: ["research", "feasibility", "perplexity", "raw_research"],
            metadata: { source: "perplexity", query: queries[i].slice(0, 200), researchedAt: new Date().toISOString() } as any,
          },
        }).catch(() => {});

        // Extract and store individual facts
        const facts = await extractAndStoreFacts(agentId, projectId, orgId, result, queryLabels[i]);
        totalFacts += facts;
      }
    } catch (e) {
      console.error(`[feasibility-research] Query ${i} failed:`, e);
    }
  }

  // Build a compact summary for the clarification session prompt
  const summary = allResearch.length > 0
    ? allResearch.map((r, i) => `### ${queryLabels[i]}\n${r}`).join("\n\n").slice(0, 6000)
    : "No research results available.";

  await db.agentActivity.create({
    data: {
      agentId,
      type: "document",
      summary: `Feasibility research complete — ${totalFacts} facts discovered from ${allResearch.length} queries. Knowledge base enriched.`,
    },
  }).catch(() => {});

  // Build sections for the research card
  const sections: ResearchSection[] = allResearch.map((r, i) => ({
    label: queryLabels[i],
    content: r,
  }));

  // Fetch extracted facts for the card
  const storedFacts = await db.knowledgeBaseItem.findMany({
    where: { agentId, projectId, tags: { has: "feasibility" }, NOT: { tags: { has: "raw_research" } } },
    select: { title: true, content: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const facts: ResearchFact[] = storedFacts.map(f => ({
    title: f.title,
    content: f.content.replace(/^\[Research.*?\]\s*/i, ""),
  }));

  return { factsDiscovered: totalFacts, queries, summary, sections, facts };
}

// ─── Phase-Specific Research ────────────────────────────────────────────────

/**
 * Phase-specific research queries — what's relevant at each stage.
 * Called when advancing to a new phase to capture latest context.
 */
const PHASE_RESEARCH_QUERIES: Record<string, (project: ProjectContext) => string[]> = {
  "requirements": (p) => [
    `Latest requirements gathering best practices for "${p.name}": stakeholder analysis techniques, requirements elicitation methods, tools and frameworks. ${p.description?.slice(0, 200) || ""}`,
  ],
  "design": (p) => [
    `Current best practices for project planning and design for "${p.name}": WBS techniques, scheduling methods, resource planning approaches, cost estimation methods for ${p.category || "general"} projects. Budget: ${p.budget ? `£${p.budget}` : "TBC"}.`,
    `Current market rates and availability for resources and materials needed for: "${p.name}". ${p.description?.slice(0, 200) || ""}`,
  ],
  "initiation": (p) => [
    `Project initiation best practices for "${p.name}": charter development, stakeholder engagement strategies, governance frameworks for ${p.category || "general"} projects.`,
  ],
  "planning": (p) => [
    `Current cost benchmarks and schedule norms for "${p.name}": typical durations, cost ranges, critical path considerations for ${p.category || "general"} projects. Budget: ${p.budget ? `£${p.budget}` : "TBC"}.`,
    `Resource availability and market rates for: "${p.name}". ${p.description?.slice(0, 200) || ""}`,
  ],
  "build": (p) => [
    `Current risks, common issues, and mitigation strategies during execution phase for projects like "${p.name}": quality assurance approaches, vendor management, progress tracking methods.`,
    `Latest regulatory or compliance updates that may affect: "${p.name}". ${p.description?.slice(0, 200) || ""}`,
  ],
  "execution": (p) => [
    `Current risks, common issues, and mitigation strategies during execution for "${p.name}": deliverable tracking, scope creep prevention, stakeholder communication. ${p.description?.slice(0, 200) || ""}`,
  ],
  "test": (p) => [
    `Testing and quality assurance best practices for "${p.name}": acceptance criteria frameworks, defect management, UAT approaches for ${p.category || "general"} projects.`,
  ],
  "deploy": (p) => [
    `Deployment and go-live best practices for "${p.name}": rollback strategies, cutover planning, training and handover approaches.`,
  ],
  "closing": (p) => [
    `Project closure best practices: lessons learned frameworks, benefits realisation tracking, handover checklists, contract closure requirements for ${p.category || "general"} projects.`,
  ],
  // ── SAFe methodology phases ────────────────────────────────────────────
  "pi planning": (p) => [
    `SAFe Program Increment (PI) Planning best practices for "${p.name}": typical PI objectives structure, feature decomposition approaches, team capacity planning, risk ROAMing techniques. ${p.description?.slice(0, 200) || ""}`,
    `Current PI planning benchmarks and resource allocation norms for ${p.category || "enterprise"} projects: typical sprint velocity, team sizes, capacity buffers, dependency management. Budget: ${p.budget ? `£${p.budget}` : "TBC"}.`,
  ],
  "iteration cadence": (p) => [
    `SAFe iteration cadence best practices for "${p.name}": sprint duration choices, iteration goals, continuous delivery patterns, DevOps integration. ${p.description?.slice(0, 200) || ""}`,
  ],
  "inspect and adapt": (p) => [
    `SAFe Inspect & Adapt ceremony best practices: retrospective structures, improvement backlog management, metrics review approaches for ${p.category || "enterprise"} projects.`,
  ],
  "inspect & adapt": (p) => [
    `SAFe Inspect & Adapt ceremony best practices: retrospective structures, improvement backlog management, metrics review approaches for ${p.category || "enterprise"} projects.`,
  ],
  "release": (p) => [
    `Release management best practices for "${p.name}": deployment strategies, release notes, rollback planning, stakeholder communication. ${p.description?.slice(0, 200) || ""}`,
  ],
  "sprint zero": (p) => [
    `Sprint Zero best practices for "${p.name}": initial team setup, tooling, definition of done, architectural runway establishment.`,
  ],
  "foundation": (p) => [
    `Project foundation phase best practices for "${p.name}": initial charter, stakeholder identification, tooling setup, team onboarding. ${p.description?.slice(0, 200) || ""}`,
  ],
  "pre-project": (p) => [
    `Pre-project feasibility best practices for "${p.name}": business case development, risk scanning, stakeholder identification. ${p.description?.slice(0, 200) || ""}`,
  ],
  // ── Agile / Scrum phases ───────────────────────────────────────────────
  "sprint cadence": (p) => [
    `Scrum sprint cadence best practices for "${p.name}": sprint length selection, velocity stabilisation, daily stand-up patterns, retrospective approaches. ${p.description?.slice(0, 200) || ""}`,
    `Current norms for sprint planning and backlog refinement in ${p.category || "enterprise"} projects: typical story point estimation, sprint goal framing, definition-of-done evolution.`,
  ],
  // ── Kanban phases ──────────────────────────────────────────────────────
  "setup": (p) => [
    `Kanban setup best practices for "${p.name}": board column design, WIP limit determination, definition of done, service level expectations. ${p.description?.slice(0, 200) || ""}`,
  ],
  "continuous delivery": (p) => [
    `Continuous delivery and Kanban flow management best practices for "${p.name}": cycle time optimisation, WIP limit tuning, bottleneck identification, lean metrics. ${p.description?.slice(0, 200) || ""}`,
    `Current DevOps patterns for ${p.category || "enterprise"} projects: deployment pipeline automation, feature flags, canary releases, observability practices.`,
  ],
  "review": (p) => [
    `Project review and continuous improvement best practices for "${p.name}": retrospective techniques, metrics analysis, kaizen approaches for ${p.category || "enterprise"} projects.`,
  ],
  // ── Disciplined Agile / Hybrid phases ──────────────────────────────────
  "iterative delivery": (p) => [
    `Iterative delivery best practices for "${p.name}": iteration planning, incremental feature release, feedback loop design, MVP approaches. ${p.description?.slice(0, 200) || ""}`,
  ],
  "closure": (p) => [
    `Project closure best practices for "${p.name}": benefit realisation tracking, lessons learned frameworks, handover to BAU teams, contract closure, team transition. ${p.description?.slice(0, 200) || ""}`,
  ],
  // ── PRINCE2-specific phase aliases (PRINCE2 uses these names) ──────────
  "directing": (p) => [
    `PRINCE2 "Directing a Project" process best practices for "${p.name}": Project Board governance, stage boundary decisions, exception management, senior user/supplier engagement. ${p.description?.slice(0, 200) || ""}`,
  ],
  "starting up": (p) => [
    `PRINCE2 "Starting Up a Project" (SU) best practices for "${p.name}": Project Brief development, Executive and Project Manager appointments, project approach selection. ${p.description?.slice(0, 200) || ""}`,
  ],
  "controlling a stage": (p) => [
    `PRINCE2 "Controlling a Stage" best practices for "${p.name}": work package authorisation, stage progress reporting, issue and risk management, exception handling. ${p.description?.slice(0, 200) || ""}`,
  ],
  "managing product delivery": (p) => [
    `PRINCE2 "Managing Product Delivery" best practices for "${p.name}": work package acceptance, product quality review, team management across suppliers. ${p.description?.slice(0, 200) || ""}`,
  ],
  "managing a stage boundary": (p) => [
    `PRINCE2 "Managing a Stage Boundary" best practices for "${p.name}": stage plan preparation, lessons report, next stage authorisation, business case update. ${p.description?.slice(0, 200) || ""}`,
  ],
};

/**
 * Run phase-specific research when advancing to a new phase.
 * Lighter than full feasibility research — 1-2 targeted queries.
 */
export async function runPhaseResearch(
  agentId: string,
  projectId: string,
  orgId: string,
  phaseName: string,
): Promise<ResearchResult> {
  // Explicit check for missing API key — otherwise research silently fails
  if (!process.env.PERPLEXITY_API_KEY) {
    return {
      factsDiscovered: 0,
      queries: [],
      summary: `Research unavailable: PERPLEXITY_API_KEY is not configured in the server environment. Add it in Vercel → Settings → Environment Variables to enable phase research.`,
      sections: [],
      facts: [],
    };
  }

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, description: true, category: true, budget: true, startDate: true, endDate: true, methodology: true },
  });
  if (!project) return { factsDiscovered: 0, queries: [], summary: "", sections: [], facts: [] };

  // Find phase-specific queries
  const normalised = phaseName.toLowerCase().replace(/[^a-z0-9]/g, " ").trim().split(/\s+/).join(" ");
  const queryBuilder = PHASE_RESEARCH_QUERIES[normalised]
    || PHASE_RESEARCH_QUERIES[normalised.split(" ")[0]]
    || null;

  // Fallback: generic query for unknown phase names (e.g. custom methodologies)
  const effectiveBuilder = queryBuilder || ((p: ProjectContext) => [
    `Best practices and current considerations for the "${phaseName}" phase of project "${p.name}": deliverables typically produced, common risks, resource needs, and success criteria. ${p.description?.slice(0, 200) || ""}`,
    `Industry benchmarks and real-world examples for "${phaseName}" phase of ${p.category || "general"} projects. Budget context: ${p.budget ? `£${p.budget}` : "TBC"}.`,
  ]);

  // Check existing KB to avoid re-researching covered topics
  const existingKB = await db.knowledgeBaseItem.findMany({
    where: {
      projectId, agentId,
      tags: { hasSome: ["research", "feasibility", "phase_research"] },
    },
    select: { title: true, content: true, tags: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const existingTopics = existingKB.map((k) => k.title.toLowerCase()).join(" ");

  const rawQueries = effectiveBuilder(project as ProjectContext);
  // Filter out queries already covered by existing KB
  const queries = rawQueries.filter((q) => {
    const keywords = q.toLowerCase().split(/\s+/).filter((w) => w.length > 4).slice(0, 5);
    const alreadyCovered = keywords.filter((k) => existingTopics.includes(k)).length;
    // Skip if >60% of keywords are already in KB topics
    return keywords.length === 0 || alreadyCovered / keywords.length < 0.6;
  });

  if (queries.length === 0) {
    // KB already covers this phase's topics — count as research done so the
    // resolver doesn't loop us back to "needs research".
    try {
      const { markResearchComplete } = await import("@/lib/agents/phase-next-action");
      await markResearchComplete(projectId, phaseName);
    } catch {}
    return {
      factsDiscovered: 0, queries: [], summary: `KB already covers topics for "${phaseName}" — skipping redundant research.`,
      sections: [], facts: existingKB.filter((k) => (k.tags || []).includes(phaseName.toLowerCase())).map((k) => ({ title: k.title, content: k.content.slice(0, 300) })),
    };
  }

  const queryLabels = queries.map((_, i) => `${phaseName} research ${i + 1}`);

  let totalFacts = 0;
  const allResearch: string[] = [];

  for (let i = 0; i < queries.length; i++) {
    try {
      const result = await queryPerplexity(queries[i]);
      if (result) {
        allResearch.push(result);

        await db.knowledgeBaseItem.create({
          data: {
            orgId, agentId, projectId,
            layer: "PROJECT", type: "TEXT",
            title: `Phase Research (${phaseName}): ${queryLabels[i]}`,
            content: result.slice(0, 5000),
            trustLevel: "STANDARD",
            tags: ["research", "phase_research", "perplexity", phaseName.toLowerCase()],
            metadata: { source: "perplexity", phase: phaseName, query: queries[i].slice(0, 200), researchedAt: new Date().toISOString() } as any,
          },
        }).catch(() => {});

        const facts = await extractAndStoreFacts(agentId, projectId, orgId, result, queryLabels[i]);
        totalFacts += facts;
      }
    } catch (e) {
      console.error(`[phase-research] ${phaseName} query ${i} failed:`, e);
    }
  }

  const summary = allResearch.length > 0
    ? allResearch.map((r, i) => `### ${queryLabels[i]}\n${r}`).join("\n\n").slice(0, 6000)
    : "";

  await db.agentActivity.create({
    data: {
      agentId,
      type: "document",
      summary: `Phase research for "${phaseName}" complete — ${totalFacts} new facts from ${allResearch.length} queries.`,
    },
  }).catch(() => {});

  // Audit-trail mark for the phase-next-action resolver. Records that
  // research has been run for this phase so downstream gate checks can
  // distinguish "research never ran" from "research ran but found no facts".
  try {
    const { markResearchComplete } = await import("@/lib/agents/phase-next-action");
    await markResearchComplete(projectId, phaseName);
  } catch (e) {
    console.error(`[phase-research] markResearchComplete failed for ${phaseName}:`, e);
  }

  const sections: ResearchSection[] = allResearch.map((r, i) => ({ label: queryLabels[i], content: r }));
  const storedFacts = await db.knowledgeBaseItem.findMany({
    where: { agentId, projectId, tags: { has: phaseName.toLowerCase() }, NOT: { tags: { has: "raw_research" } } },
    select: { title: true, content: true },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return {
    factsDiscovered: totalFacts,
    queries,
    summary,
    sections,
    facts: storedFacts.map((f) => ({ title: f.title, content: f.content.slice(0, 300) })),
  };
}
