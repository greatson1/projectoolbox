/**
 * Closing-phase context scan.
 *
 * Replaces the outward-looking Perplexity research ("project closure best
 * practices") that the front-of-project pipeline runs. By Closing, the
 * project is wrapping up — what the user needs is an *inward* sweep of
 * their own project: which loose ends remain open, what lessons have
 * been captured, whether benefits-realisation evidence exists, and how
 * the final budget compares to plan.
 *
 * Same shape as runExecutionProgressScan + runPhaseResearch so the chat
 * card and clarification seeder consume it unchanged.
 */

import { db } from "@/lib/db";
import type { ResearchResult } from "./feasibility-research";

function gbp(n: number): string {
  return `£${Math.round(n).toLocaleString("en-GB")}`;
}

export async function runClosureScan(
  agentId: string,
  projectId: string,
  phaseName: string,
): Promise<ResearchResult> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, budget: true },
  });
  if (!project) {
    return { factsDiscovered: 0, queries: [], summary: "Project not found", sections: [], facts: [] };
  }

  const [artefacts, openRisks, openIssues, openTasks, costsByType] = await Promise.all([
    db.agentArtefact.findMany({
      where: { projectId, status: "APPROVED" },
      select: { name: true },
    }),
    db.risk.count({ where: { projectId, status: "OPEN" } }),
    db.issue.count({ where: { projectId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    db.task.count({ where: { projectId, status: { notIn: ["DONE", "COMPLETED", "CANCELLED"] } } }),
    db.costEntry.groupBy({
      by: ["entryType"],
      where: { projectId },
      _sum: { amount: true },
    }),
  ]);

  const approvedNames = artefacts.map(a => a.name.toLowerCase());
  const has = (substr: string) => approvedNames.some(n => n.includes(substr.toLowerCase()));

  // Closure-critical artefact presence — surface the explicit gaps that
  // most often block a clean signoff.
  const lessonsCaptured = has("lessons") || has("retrospective");
  const benefitsArtefact = has("benefit") || has("realisation") || has("outcome");
  const handoverArtefact = has("handover") || has("transition") || has("hand-over");
  const finalReport = has("closure") || has("end project report") || has("project closure report");

  const sumOf = (t: string) => Number(costsByType.find(c => c.entryType === t)?._sum.amount ?? 0);
  const actual = sumOf("ACTUAL");
  const committed = sumOf("COMMITMENT");
  const budget = project.budget ?? 0;
  const finalSpend = actual + committed;
  const variance = budget > 0 ? budget - finalSpend : null;

  const sectionData: { label: string; bullets: string[] }[] = [
    {
      label: "Outstanding work",
      bullets: [
        openTasks === 0 ? "All tasks are DONE / COMPLETED / CANCELLED." : `${openTasks} task${openTasks === 1 ? "" : "s"} still open — close, transfer to BAU, or cancel before signoff`,
        openIssues === 0 ? "No open issues." : `${openIssues} open issue${openIssues === 1 ? "" : "s"} — resolve or document as accepted before closure`,
        openRisks === 0 ? "No open risks." : `${openRisks} open risk${openRisks === 1 ? "" : "s"} — close, transfer to BAU risk register, or document residual risk for sponsor acceptance`,
      ],
    },
    {
      label: "Closure artefact presence",
      bullets: [
        `${lessonsCaptured ? "✓" : "✗"} Lessons learned / retrospective`,
        `${benefitsArtefact ? "✓" : "✗"} Benefits realisation / outcome tracker`,
        `${handoverArtefact ? "✓" : "✗"} Handover / transition document`,
        `${finalReport ? "✓" : "✗"} End-project / closure report`,
      ],
    },
    {
      label: "Final budget position",
      bullets: budget > 0 ? [
        `Budget: ${gbp(budget)} · Final spend (actual + committed): ${gbp(finalSpend)}`,
        variance !== null
          ? variance >= 0
            ? `${gbp(variance)} unspent — confirm whether to release to portfolio or transfer to BAU`
            : `${gbp(Math.abs(variance))} OVER budget — closure report must explain the variance to sponsor`
          : "Variance not calculable",
      ] : ["Project budget not set — cost variance cannot be calculated."],
    },
    {
      label: "Artefact surface",
      bullets: [
        `${artefacts.length} approved artefact${artefacts.length === 1 ? "" : "s"} on record — this is the deliverable trail the closure report should reference.`,
      ],
    },
  ];
  const sections = sectionData.map(s => ({
    label: s.label,
    content: s.bullets.map(b => `• ${b}`).join("\n"),
  }));

  // Items demanding direct attention before signoff.
  const facts: { title: string; content: string }[] = [];
  if (!lessonsCaptured) {
    facts.push({
      title: "Lessons not captured",
      content: "No lessons-learned or retrospective artefact is on the approved list. Closure should not complete without one — it's the input to future projects.",
    });
  }
  if (!benefitsArtefact) {
    facts.push({
      title: "Benefits realisation not tracked",
      content: "No benefits / outcome / realisation artefact found. The original business case probably committed to measurable benefits — closure should evidence what was actually delivered.",
    });
  }
  if (openRisks + openIssues + openTasks > 0) {
    facts.push({
      title: "Open items block clean signoff",
      content: `${openTasks} task${openTasks === 1 ? "" : "s"}, ${openIssues} issue${openIssues === 1 ? "" : "s"} and ${openRisks} risk${openRisks === 1 ? "" : "s"} are still open. Each needs a disposition (closed / accepted / transferred to BAU) before the project can be marked complete.`,
    });
  }
  if (variance !== null && variance < 0) {
    facts.push({
      title: "Closure budget variance",
      content: `Project ran ${gbp(Math.abs(variance))} over budget. The closure report needs an explanation suitable for the sponsor.`,
    });
  }

  const factsDiscovered = sectionData.reduce((n, s) => n + s.bullets.length, 0) + facts.length;

  return {
    factsDiscovered,
    queries: [`Internal closure readiness scan for "${phaseName}" of "${project.name}"`],
    summary: `Closure sweep: ${artefacts.length} approved artefacts on record, ${openTasks + openIssues + openRisks} item${openTasks + openIssues + openRisks === 1 ? "" : "s"} still open, ${facts.length} blocker${facts.length === 1 ? "" : "s"} flagged for your attention before generating ${phaseName} artefacts.`,
    sections,
    facts,
  };
}
