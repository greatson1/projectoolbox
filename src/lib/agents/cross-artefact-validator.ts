/**
 * Cross-Artefact Consistency Validator
 *
 * After all phase artefacts are generated, this validator compares them
 * to catch discrepancies:
 *   - WBS work packages not reflected in Cost Plan line items
 *   - Schedule tasks not matching WBS entries
 *   - Stakeholder names inconsistent across artefacts
 *   - Risk Register items not referenced in Risk Management Plan
 *   - Budget totals mismatching between Cost Plan and Business Case
 *
 * Uses Claude Haiku for fast, cheap comparison. Results are stored as
 * metadata on each artefact and surfaced in the DocumentEditor banner.
 */

import { db } from "@/lib/db";

import { MODELS } from "@/lib/ai-models";

export interface ConsistencyIssue {
  severity: "error" | "warning";
  artefact1: string;
  artefact2: string;
  description: string;
}

export interface ConsistencyReport {
  issues: ConsistencyIssue[];
  checkedAt: string;
  artefactsCompared: number;
}

export async function validateCrossArtefactConsistency(
  projectId: string,
  agentId: string,
  phaseName: string,
): Promise<ConsistencyReport> {
  const report: ConsistencyReport = {
    issues: [],
    checkedAt: new Date().toISOString(),
    artefactsCompared: 0,
  };

  try {
    const artefacts = await db.agentArtefact.findMany({
      where: { projectId, agentId, status: { in: ["DRAFT", "PENDING_REVIEW", "APPROVED"] } },
      select: { id: true, name: true, content: true, format: true },
      orderBy: { createdAt: "desc" },
    });

    if (artefacts.length < 2) return report;
    report.artefactsCompared = artefacts.length;

    // Build a summary of each artefact (first 2000 chars to keep prompt small)
    const summaries = artefacts.map(a => {
      const preview = (a.content || "").slice(0, 2000);
      return `### ${a.name} (${a.format})\n${preview}`;
    }).join("\n\n---\n\n");

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return report;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELS.light,
        max_tokens: 2048,
        messages: [{
          role: "user",
          content: `You are a project quality auditor. Compare these ${artefacts.length} artefacts from the "${phaseName}" phase and identify CONCRETE inconsistencies between them.

Only flag REAL discrepancies — not missing data or stylistic differences. Focus on:
1. Work packages in WBS not reflected as line items in Cost Plan or Schedule
2. Task names that differ between WBS and Schedule (same task, different name)
3. Stakeholder roles/names inconsistent across documents
4. Risk items in Risk Register not covered in Risk Management Plan
5. Budget totals that don't match between documents
6. Dates in Schedule that contradict dates in other artefacts
7. Resource assignments in Resource Plan not matching task owners in WBS/Schedule

Return a JSON array of objects: [{"severity":"error"|"warning", "artefact1":"name", "artefact2":"name", "description":"specific discrepancy"}]

Return [] if no inconsistencies found. JSON only, no markdown.

${summaries}`,
        }],
      }),
    });

    if (!res.ok) {
      console.error("[cross-artefact-validator] API error:", res.status);
      return report;
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        report.issues = parsed.filter(
          (i: any) => i.severity && i.artefact1 && i.artefact2 && i.description
        );
      }
    }

    // Persist results to each affected artefact's metadata
    const issuesByArtefact = new Map<string, ConsistencyIssue[]>();
    for (const issue of report.issues) {
      for (const name of [issue.artefact1, issue.artefact2]) {
        const existing = issuesByArtefact.get(name) || [];
        existing.push(issue);
        issuesByArtefact.set(name, existing);
      }
    }

    for (const [artName, issues] of issuesByArtefact.entries()) {
      const artefact = artefacts.find(a => a.name.toLowerCase() === artName.toLowerCase());
      if (!artefact) continue;

      const existing = await db.agentArtefact.findUnique({
        where: { id: artefact.id },
        select: { metadata: true },
      });
      const meta = (existing?.metadata as Record<string, unknown>) || {};

      await db.agentArtefact.update({
        where: { id: artefact.id },
        data: {
          metadata: {
            ...meta,
            consistencyIssues: issues,
            consistencyCheckedAt: report.checkedAt,
          } as any,
        },
      });
    }

    // Post a chat message summarising findings
    if (report.issues.length > 0) {
      const errorCount = report.issues.filter(i => i.severity === "error").length;
      const warnCount = report.issues.filter(i => i.severity === "warning").length;

      const issueList = report.issues.slice(0, 8).map((i, idx) =>
        `${idx + 1}. **${i.severity === "error" ? "❌" : "⚠️"} ${i.artefact1} ↔ ${i.artefact2}**: ${i.description}`
      ).join("\n");

      await db.chatMessage.create({
        data: {
          agentId,
          role: "assistant",
          content: `## Cross-Artefact Consistency Check\n\nI've compared all ${report.artefactsCompared} artefacts in the ${phaseName} phase and found **${report.issues.length} inconsistenc${report.issues.length === 1 ? "y" : "ies"}** (${errorCount} error${errorCount === 1 ? "" : "s"}, ${warnCount} warning${warnCount === 1 ? "" : "s"}):\n\n${issueList}${report.issues.length > 8 ? `\n\n…and ${report.issues.length - 8} more. Review each artefact for the full list.` : ""}\n\nPlease review and correct these before approving. I can regenerate affected artefacts if needed.`,
          metadata: { type: "__CONSISTENCY_CHECK__", issues: report.issues } as any,
        },
      });

      await db.agentActivity.create({
        data: {
          agentId,
          type: "document",
          summary: `Cross-artefact check: ${report.issues.length} inconsistenc${report.issues.length === 1 ? "y" : "ies"} found across ${report.artefactsCompared} artefacts in ${phaseName}`,
        },
      }).catch(() => {});
    } else {
      await db.agentActivity.create({
        data: {
          agentId,
          type: "document",
          summary: `Cross-artefact check: all ${report.artefactsCompared} artefacts in ${phaseName} are consistent ✓`,
        },
      }).catch(() => {});
    }

    console.log(`[cross-artefact-validator] ${phaseName}: ${report.issues.length} issues across ${report.artefactsCompared} artefacts`);
  } catch (e) {
    console.error("[cross-artefact-validator] failed:", e);
  }

  return report;
}
