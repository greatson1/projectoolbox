/**
 * Procurement Engine
 *
 * Full vendor lifecycle: identify needs → research vendors → build evaluation
 * matrix → draft RFQ → send to vendors → process quotes → recommend → issue PO.
 *
 * Steps 1-6 are autonomous. Steps 7-8 (selection + PO) are always HITL.
 */

import { db } from "@/lib/db";

const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";

// ─── Types ───

export interface ProcurementNeed {
  id: string;
  projectId: string;
  category: string;         // SOFTWARE | HARDWARE | SERVICES | CONTRACTOR
  description: string;
  estimatedBudget: number;
  urgency: "LOW" | "MEDIUM" | "HIGH";
  status: "IDENTIFIED" | "RESEARCHING" | "RFQ_SENT" | "QUOTES_RECEIVED" | "RECOMMENDED" | "APPROVED" | "PO_ISSUED";
}

export interface VendorOption {
  name: string;
  website?: string;
  priceRange: string;
  features: string[];
  pros: string[];
  cons: string[];
  rating?: number;        // 1-5
  marketPosition: string; // leader | challenger | niche
}

export interface EvaluationMatrix {
  criteria: { name: string; weight: number }[];
  vendors: { name: string; scores: Record<string, number>; totalScore: number }[];
  recommendation: string;
  rationale: string;
}

// ─── Step 1: Identify Procurement Needs ───

/**
 * Scan project cost entries and tasks to identify items that need procurement.
 * Called during the monitoring loop.
 */
export async function identifyProcurementNeeds(projectId: string, agentId: string): Promise<ProcurementNeed[]> {
  const costEntries = await db.costEntry.findMany({
    where: { projectId, category: { in: ["MATERIALS", "SERVICES"] }, entryType: "ESTIMATE" },
    select: { id: true, category: true, description: true, amount: true, vendorName: true },
  });

  // Filter to items without a vendor assigned and above £500
  const needs: ProcurementNeed[] = costEntries
    .filter(e => !e.vendorName && e.amount >= 500)
    .map(e => ({
      id: e.id,
      projectId,
      category: e.category === "MATERIALS" ? "SOFTWARE" : "SERVICES",
      description: e.description || "Unspecified procurement need",
      estimatedBudget: e.amount,
      urgency: e.amount > 10000 ? "HIGH" : e.amount > 2000 ? "MEDIUM" : "LOW",
      status: "IDENTIFIED" as const,
    }));

  if (needs.length > 0) {
    await db.agentActivity.create({
      data: {
        agentId,
        type: "proactive_alert",
        summary: `Identified ${needs.length} procurement need(s) totalling £${needs.reduce((s, n) => s + n.estimatedBudget, 0).toLocaleString()}: ${needs.map(n => n.description).slice(0, 3).join(", ")}`,
        metadata: { type: "procurement_needs", count: needs.length, needs },
      },
    });
  }

  return needs;
}

// ─── Step 2: Research Vendors ───

/**
 * Research vendors for a specific procurement need using Perplexity.
 */
export async function researchVendors(
  need: { description: string; category: string; estimatedBudget: number },
  context: { orgId: string; agentId: string; projectId: string },
): Promise<VendorOption[]> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return fallbackVendors(need);

  // Check cache
  const cacheKey = `vendor-research:${need.description.slice(0, 50)}`;
  const cached = await db.knowledgeBaseItem.findFirst({
    where: { orgId: context.orgId, title: cacheKey, cachedUntil: { gte: new Date() } },
    select: { content: true },
  });
  if (cached) { try { return JSON.parse(cached.content); } catch {} }

  const searchQuery = `Compare top 5 vendors for ${need.description} in the UK. Budget: £${need.estimatedBudget.toLocaleString()}. Category: ${need.category}. For each vendor provide: name, website, pricing, key features, pros, cons, market position (leader/challenger/niche), and a rating out of 5.`;

  try {
    const response = await fetch(PERPLEXITY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: "You are a procurement analyst. Compare vendors objectively with specific pricing. Output valid JSON array only." },
          { role: "user", content: searchQuery + '\n\nOutput as JSON array: [{"name":"...","website":"...","priceRange":"...","features":["..."],"pros":["..."],"cons":["..."],"rating":4.5,"marketPosition":"leader"}]' },
        ],
        max_tokens: 2000,
        return_citations: true,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const text = data.content?.[0]?.text || data.choices?.[0]?.message?.content || "[]";
      const clean = text.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
      let vendors: VendorOption[] = [];
      try { vendors = JSON.parse(clean); } catch {}

      if (vendors.length > 0) {
        // Cache for 7 days
        await db.knowledgeBaseItem.create({
          data: {
            orgId: context.orgId, agentId: context.agentId, projectId: context.projectId,
            layer: "PROJECT", type: "URL",
            title: cacheKey, content: JSON.stringify(vendors),
            tags: ["vendor-research", "procurement", "auto-generated"],
            cachedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
        return vendors;
      }
    }
  } catch (e) {
    console.error("Vendor research failed:", e);
  }

  return fallbackVendors(need);
}

// ─── Step 3: Build Evaluation Matrix ───

/**
 * Build a weighted evaluation matrix comparing vendors.
 */
export async function buildEvaluationMatrix(
  need: { description: string; estimatedBudget: number },
  vendors: VendorOption[],
  agentId: string,
): Promise<EvaluationMatrix> {
  if (!process.env.ANTHROPIC_API_KEY || vendors.length === 0) {
    return { criteria: [], vendors: [], recommendation: "No vendors to evaluate", rationale: "" };
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: `Build a weighted evaluation matrix for: ${need.description} (budget £${need.estimatedBudget.toLocaleString()})

Vendors: ${JSON.stringify(vendors.map(v => ({ name: v.name, priceRange: v.priceRange, features: v.features, pros: v.pros, cons: v.cons, rating: v.rating })))}

Output ONLY valid JSON:
{
  "criteria": [{"name": "Price/Value", "weight": 30}, {"name": "Features", "weight": 25}, ...],
  "vendors": [{"name": "...", "scores": {"Price/Value": 8, "Features": 7, ...}, "totalScore": 78}],
  "recommendation": "Vendor X",
  "rationale": "2-3 sentence justification"
}

Criteria should include: Price/Value (weight 30), Features (25), Support (15), Integration (15), Scalability (15). Score each 1-10.`,
        }],
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const text = data.content[0]?.text || "{}";
      const clean = text.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
      return JSON.parse(clean);
    }
  } catch (e) {
    console.error("Evaluation matrix failed:", e);
  }

  // Simple fallback: rank by rating
  const sorted = [...vendors].sort((a, b) => (b.rating || 3) - (a.rating || 3));
  return {
    criteria: [{ name: "Overall Rating", weight: 100 }],
    vendors: sorted.map(v => ({ name: v.name, scores: { "Overall Rating": (v.rating || 3) * 2 }, totalScore: (v.rating || 3) * 20 })),
    recommendation: sorted[0]?.name || "None",
    rationale: `Recommended based on highest rating (${sorted[0]?.rating || "N/A"}/5)`,
  };
}

// ─── Step 4: Draft RFQ ───

/**
 * Generate a Request for Quotation document.
 */
export async function draftRFQ(
  need: { description: string; estimatedBudget: number; category: string },
  vendors: VendorOption[],
  project: { name: string; description: string | null },
  agentName: string,
): Promise<string> {
  const vendorNames = vendors.slice(0, 5).map(v => v.name).join(", ");
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const deadline = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return `
REQUEST FOR QUOTATION (RFQ)

Date: ${today}
Project: ${project.name}
Ref: RFQ-${Date.now().toString(36).toUpperCase()}
Response Deadline: ${deadline}

1. OVERVIEW
We are seeking quotations for: ${need.description}
This is for the "${project.name}" project${project.description ? `: ${project.description.slice(0, 200)}` : ""}.

2. REQUIREMENTS
Category: ${need.category}
Estimated Budget: £${need.estimatedBudget.toLocaleString()} (indicative — please provide your best pricing)

3. SCOPE
Please provide:
- Detailed pricing breakdown (licensing, implementation, support, training)
- Implementation timeline
- Key features and deliverables
- Support and SLA terms
- References from similar projects

4. EVALUATION CRITERIA
Responses will be evaluated on:
- Price and value for money (30%)
- Feature completeness (25%)
- Support and SLA quality (15%)
- Integration capability (15%)
- Scalability and future-proofing (15%)

5. SUBMISSION
Please respond by ${deadline} to the project agent email.
For questions, contact the project team via the reply address.

Sent by ${agentName} (AI Project Manager) on behalf of the project team.
This RFQ was generated by Projectoolbox — an AI project management platform.
  `.trim();
}

// ─── Step 5: Send RFQ via Email ───

/**
 * Send RFQ to vendor contacts via agent email.
 */
export async function sendRFQ(
  agentId: string,
  rfqContent: string,
  vendorEmails: string[],
  subject: string,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  try {
    const { EmailService } = await import("@/lib/email");

    for (const email of vendorEmails) {
      try {
        await EmailService.sendAgentEmail(agentId, {
          to: email,
          subject,
          html: `<div style="font-family: Inter, sans-serif; max-width: 700px; margin: 0 auto; white-space: pre-line; font-size: 14px; color: #334155;">${rfqContent.replace(/\n/g, "<br>")}</div>`,
        });
        sent++;
      } catch {
        failed++;
      }
    }
  } catch {
    failed = vendorEmails.length;
  }

  // Log activity
  await db.agentActivity.create({
    data: {
      agentId,
      type: "document",
      summary: `Sent RFQ to ${sent} vendor(s)${failed > 0 ? ` (${failed} failed)` : ""}: ${subject}`,
      metadata: { type: "rfq_sent", sent, failed, vendors: vendorEmails },
    },
  });

  return { sent, failed };
}

// ─── Step 6: Process Incoming Quotes ───

/**
 * Extract pricing data from a vendor quote email.
 * Called from the inbound email webhook when a quote is detected.
 */
export async function processVendorQuote(
  emailContent: string,
  senderEmail: string,
  subject: string,
  projectId: string,
  agentId: string,
): Promise<void> {
  // Use Claude to extract structured quote data
  if (!process.env.ANTHROPIC_API_KEY) return;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        messages: [{
          role: "user",
          content: `Extract pricing from this vendor quote email. Output ONLY valid JSON.

From: ${senderEmail}
Subject: ${subject}
Content: ${emailContent.slice(0, 3000)}

Extract: {"vendorName": "...", "totalPrice": number, "currency": "GBP", "breakdown": [{"item": "...", "amount": number}], "timeline": "...", "validUntil": "...", "keyTerms": ["..."]}`,
        }],
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const text = data.content[0]?.text || "{}";
      const clean = text.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
      const quote = JSON.parse(clean);

      // Save as cost entry (COMMITMENT type — pending approval)
      if (quote.totalPrice) {
        await db.costEntry.create({
          data: {
            projectId,
            entryType: "COMMITMENT",
            category: "SERVICES",
            amount: quote.totalPrice,
            currency: quote.currency || "GBP",
            description: `Vendor quote: ${quote.vendorName || senderEmail} — ${subject}`,
            vendorName: quote.vendorName || senderEmail,
            createdBy: `agent:${agentId}`,
          },
        });
      }

      // Save to knowledge base
      await db.knowledgeBaseItem.create({
        data: {
          orgId: (await db.agent.findUnique({ where: { id: agentId }, select: { orgId: true } }))?.orgId || "",
          agentId, projectId,
          layer: "PROJECT", type: "EMAIL",
          title: `Vendor Quote: ${quote.vendorName || senderEmail}`,
          content: JSON.stringify(quote, null, 2),
          tags: ["vendor-quote", "procurement", "auto-generated"],
        },
      });

      // Notify
      await db.agentActivity.create({
        data: {
          agentId,
          type: "proactive_alert",
          summary: `Vendor quote received from ${quote.vendorName || senderEmail}: £${(quote.totalPrice || 0).toLocaleString()}. ${quote.breakdown?.length || 0} line items. Valid until ${quote.validUntil || "not specified"}.`,
          metadata: { type: "vendor_quote", quote },
        },
      });
    }
  } catch (e) {
    console.error("Quote processing failed:", e);
  }
}

// ─── Step 7: Recommend (creates HITL approval) ───

/**
 * Submit vendor recommendation to HITL for approval.
 */
export async function recommendVendor(
  projectId: string,
  agentId: string,
  evaluation: EvaluationMatrix,
  need: { description: string; estimatedBudget: number },
): Promise<string> {
  const approval = await db.approval.create({
    data: {
      projectId,
      requestedById: agentId,
      type: "PROCUREMENT",
      title: `Vendor Selection: ${need.description}`,
      description: `Agent recommends ${evaluation.recommendation} for "${need.description}" (budget £${need.estimatedBudget.toLocaleString()}). ${evaluation.rationale}`,
      status: "PENDING",
      urgency: "MEDIUM",
      impactScores: { schedule: 1, cost: 3, scope: 1, stakeholder: 2 } as any,
      reasoningChain: `Evaluated ${evaluation.vendors.length} vendors across ${evaluation.criteria.length} weighted criteria. Top scorer: ${evaluation.recommendation} (${evaluation.vendors[0]?.totalScore || 0}/100). ${evaluation.rationale}`,
      suggestedAlternatives: evaluation.vendors.slice(1, 3).map(v => ({ description: `${v.name} (score: ${v.totalScore}/100)` })) as any,
    },
  });

  return approval.id;
}

// ─── Fallback ───

function fallbackVendors(need: { description: string; category: string }): VendorOption[] {
  return [
    { name: "Vendor A (research unavailable)", priceRange: "Contact for pricing", features: ["Standard features"], pros: ["Established provider"], cons: ["Pricing unknown"], rating: 3, marketPosition: "unknown" },
  ];
}

// ─── Full Procurement Pipeline ───

/**
 * Run the full procurement pipeline for a single need.
 * Steps 1-6 autonomous, Step 7 creates HITL approval.
 */
export async function runProcurementPipeline(
  need: { description: string; estimatedBudget: number; category: string },
  project: { id: string; name: string; description: string | null },
  context: { orgId: string; agentId: string },
): Promise<{ vendors: VendorOption[]; evaluation: EvaluationMatrix; rfq: string; approvalId: string }> {
  // Step 2: Research vendors
  const vendors = await researchVendors(need, { ...context, projectId: project.id });

  // Step 3: Build evaluation matrix
  const evaluation = await buildEvaluationMatrix(need, vendors, context.agentId);

  // Step 4: Draft RFQ
  const agent = await db.agent.findUnique({ where: { id: context.agentId }, select: { name: true } });
  const rfq = await draftRFQ(need, vendors, project, agent?.name || "Agent");

  // Step 5: Send RFQ (if agent has email and vendors have contact info)
  // In practice, vendor emails would come from the research or user input
  // For now, save the RFQ as an artefact for the user to send manually
  await db.agentArtefact.create({
    data: {
      agentId: context.agentId,
      projectId: project.id,
      name: `RFQ — ${need.description}`,
      format: "text",
      content: rfq,
      status: "DRAFT",
    },
  });

  // Step 7: Submit recommendation to HITL
  const approvalId = await recommendVendor(project.id, context.agentId, evaluation, need);

  // Log
  await db.agentActivity.create({
    data: {
      agentId: context.agentId,
      type: "document",
      summary: `Procurement pipeline complete: "${need.description}" — ${vendors.length} vendors researched, evaluation matrix built, RFQ drafted, recommendation submitted for approval (${evaluation.recommendation})`,
      metadata: { type: "procurement_pipeline", vendorCount: vendors.length, recommendation: evaluation.recommendation, approvalId },
    },
  });

  return { vendors, evaluation, rfq, approvalId };
}
