import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { HEAVY_MODEL_REQUEST } from "@/lib/ai-models";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const CREDIT_COST = 5;

// Engagement quadrant from the classic power/interest grid — computed in
// CODE from the live register values, never asked of the LLM.
function quadrant(power: number, interest: number): string {
  if (power >= 60 && interest >= 60) return "Manage Closely";
  if (power >= 60) return "Keep Satisfied";
  if (interest >= 60) return "Keep Informed";
  return "Monitor";
}

/**
 * POST /api/projects/:projectId/stakeholders/comms-plan
 *
 * Generates a Communications Plan artefact from the LIVE stakeholder
 * register — names, roles, power/interest quadrants (computed), and current
 * sentiment all come from real data, so the plan reflects the project as it
 * is today rather than as the kickoff documents imagined it. Lands as a
 * DRAFT artefact for normal review/approval.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const { projectId } = await params;
  const project = await db.project.findFirst({
    where: { id: projectId, orgId },
    select: { id: true, name: true, description: true, methodology: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const stakeholders = await db.stakeholder.findMany({
    where: { projectId },
    orderBy: [{ power: "desc" }, { interest: "desc" }],
  });
  if (stakeholders.length === 0) {
    return NextResponse.json(
      { error: "No stakeholders on the register yet — add stakeholders first, then generate the plan." },
      { status: 400 },
    );
  }

  const { CreditService } = await import("@/lib/credits/service");
  const hasCredits = await CreditService.checkBalance(orgId, CREDIT_COST);
  if (!hasCredits) {
    return NextResponse.json({ error: `Insufficient credits. Comms plan costs ${CREDIT_COST} credits.` }, { status: 402 });
  }

  const registerLines = stakeholders.map((s) => {
    const q = quadrant(s.power ?? 50, s.interest ?? 50);
    const senti = s.sentiment ? ` · sentiment: ${s.sentiment}${typeof s.sentimentScore === "number" ? ` (${s.sentimentScore.toFixed(2)})` : ""}` : "";
    return `- ${s.name}${s.role ? ` — ${s.role}` : ""}${s.organisation ? ` (${s.organisation})` : ""} · power ${s.power}/100, interest ${s.interest}/100 → [CALCULATED] ${q}${senti}${s.email ? " · email on file" : " · no contact details on file"}`;
  });

  const prompt = `You are drafting a Communications Plan for the project "${project.name}" (methodology: ${project.methodology}).
${project.description ? `Project description: ${project.description}\n` : ""}
LIVE STAKEHOLDER REGISTER (canonical — use these EXACT names, never invent people, organisations or contact details):
${registerLines.join("\n")}

The engagement quadrant per stakeholder is already CALCULATED from the power/interest grid above — do not re-derive or contradict it.

Produce a markdown Communications Plan with:
1. A short purpose paragraph (2-3 sentences, grounded in this project).
2. "## Communication Matrix" — a table with columns: Stakeholder | Role | Engagement ([CALCULATED] quadrant) | Information Needs | Channel | Frequency | Owner. One row per stakeholder from the register. For Channel use "[TBC]" unless contact details are on file (then "Email" is acceptable); Owner should be a role title (e.g. "Project Manager"), not an invented name. Where sentiment is negative or concerned, reflect it in Information Needs / Frequency (more frequent, more personal).
3. "## Cadence Summary" — the regular communication rhythm (bullets).
4. "## Escalation Path" — 3-4 numbered steps using role titles only.
5. End with "## Items Awaiting Confirmation" listing every [TBC] used.

Rules: no invented names, dates, venues or contact details; label derived figures [CALCULATED]; keep it under 900 words.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        ...HEAVY_MODEL_REQUEST,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("[comms-plan] model call failed:", response.status, detail.slice(0, 300));
      return NextResponse.json({ error: "Generation failed — model unavailable. No credits were charged." }, { status: 502 });
    }
    const data = await response.json();
    const content = (data.content?.[0]?.text || "").trim();
    if (!content) {
      return NextResponse.json({ error: "Generation returned no content. No credits were charged." }, { status: 502 });
    }

    const deployment = await db.agentDeployment.findFirst({
      where: { projectId, isActive: true },
      select: { agentId: true, currentPhase: true },
    });
    const anyAgent = deployment?.agentId
      ? null
      : await db.agent.findFirst({ where: { orgId }, select: { id: true } });
    const agentId = deployment?.agentId ?? anyAgent?.id;
    if (!agentId) return NextResponse.json({ error: "No agent available to own the artefact" }, { status: 400 });

    const dateLabel = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const artefact = await db.agentArtefact.create({
      data: {
        agentId,
        projectId,
        name: `Communications Plan (live register) — ${dateLabel}`,
        content,
        format: "markdown",
        status: "DRAFT",
        ...(deployment?.currentPhase ? { phaseId: deployment.currentPhase } : {}),
        metadata: {
          source: "stakeholder-register",
          stakeholderCount: stakeholders.length,
          generatedBy: `user:${(session.user as any).id || "?"}`,
        } as any,
      },
    });

    // Bill only after a successful generation (P0 billing-integrity rule).
    await CreditService.deduct(orgId, CREDIT_COST, `Communications Plan generated for "${project.name}"`, agentId).catch(() => {});

    await db.agentActivity.create({
      data: {
        agentId,
        type: "document",
        summary: `Communications Plan drafted from the live stakeholder register (${stakeholders.length} stakeholders) — ready for review`,
      },
    }).catch(() => {});

    return NextResponse.json({ data: { artefactId: artefact.id, name: artefact.name } }, { status: 201 });
  } catch (e: any) {
    console.error("[comms-plan] failed:", e);
    return NextResponse.json({ error: e?.message || "Comms plan generation failed" }, { status: 500 });
  }
}
