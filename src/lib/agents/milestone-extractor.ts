/**
 * Promote research-surfaced lead-times and milestone hints to scaffolded
 * Task rows, so the Schedule / Agile Board / WBS pages are not empty until
 * a Schedule artefact is generated and approved.
 *
 * Research routinely surfaces concrete timeline items —
 *   "Book venues 6 weeks ahead"
 *   "Procurement long-leads averages 3-6 months"
 *   "Start pre-project phase in April"
 *   "Training delivery typically scheduled 2 weeks after sign-off"
 * They inform the agent's prompt context but never become Task rows. This
 * extractor parses lead-time patterns out of research-tagged KB items and
 * creates scaffolded Task rows offset from project.startDate (or "today"
 * if unset), tagged with a [scaffolded:research] marker so they're easy to
 * distinguish from real WBS work.
 *
 * Patterns we match:
 *   • "(book|order|finalise|arrange|schedule|confirm|secure) X N (weeks|months|days) (ahead|before|prior to|in advance)"
 *   • "X has a N-month lead time"
 *   • "Procurement long-leads averages N-N months"
 *   • Bare numbered lead-time hints inside a known action title
 *
 * Idempotent — promoted KB items get a "milestone_promoted" tag and the
 * Task row carries a stable sourceArtefactId-ish marker (description prefix)
 * so re-runs upsert by title rather than duplicate.
 */

import { db } from "@/lib/db";

export interface PromoteMilestonesResult {
  scanned: number;
  created: number;
}

interface MilestoneFinding {
  title: string;
  leadDays: number;       // positive = days BEFORE project start
  description: string;
  sourceItemId: string;
}

/**
 * Convert a number + unit ("6 weeks", "3 months", "21 days") into days.
 * Months use 30-day months — fine for milestone-level lead times.
 */
function unitToDays(num: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith("week")) return num * 7;
  if (u.startsWith("month")) return num * 30;
  if (u.startsWith("year")) return num * 365;
  return num; // days, default
}

/**
 * Extract one milestone candidate per match. Returns the longest leadDays
 * for each KB item — research usually expresses ranges and the larger
 * value is the safest milestone trigger.
 */
function extractMilestones(item: { id: string; title: string; content: string }): MilestoneFinding[] {
  const text = `${item.title}\n${item.content}`
    .replace(/\[(?:research|user confirmed)[^\]]*\]\s*/gi, "")
    .replace(/<[^>]+>/g, " ");

  const out: MilestoneFinding[] = [];
  const seen = new Set<number>(); // de-dupe by leadDays within one item

  // Pattern A — verb + lead-time ahead/before
  // "Book venues 6 weeks ahead", "Confirm catering 4 weeks before delivery"
  const verbAhead = /\b(book|order|finalise|finalize|arrange|schedule|confirm|secure|sign|negotiate|reserve|procure)\b[^.!?]{0,80}?(\d+(?:\.\d+)?)\s*(week|month|day|year)s?\s+(?:ahead|before|prior\s+to|in\s+advance)/gi;
  let m: RegExpExecArray | null;
  while ((m = verbAhead.exec(text)) !== null) {
    const verb = m[1].toLowerCase();
    const num = parseFloat(m[2]);
    const days = unitToDays(num, m[3]);
    if (days < 1 || days > 730) continue;
    if (seen.has(days)) continue;
    seen.add(days);
    // Title becomes "Book venues" or similar — first verb phrase up to comma/dot
    const start = Math.max(0, m.index);
    const window = text.slice(start, Math.min(text.length, start + 80));
    const titleMatch = window.match(/^(\w[^.,;]+?\s+\d+\s*(?:week|month|day|year)s?)/);
    const title = titleMatch ? titleMatch[1].trim() : `${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${num} ${m[3]}${num !== 1 ? "s" : ""} ahead`;
    out.push({
      title: title.slice(0, 200),
      leadDays: days,
      description: `Research-surfaced lead time: ${title}`,
      sourceItemId: item.id,
    });
  }

  // Pattern B — N-month/N-week lead time / averages N-N months
  // "Procurement long-leads averages 3-6 months", "Permit takes 8 weeks"
  const leadTime = /\b(?:lead[\s-]*time[s]?|long[\s-]*leads?|averages?|takes?|requires?)\b[^.!?]{0,40}?(\d+)\s*[-–]?\s*(\d+)?\s*(week|month|day|year)s?/gi;
  while ((m = leadTime.exec(text)) !== null) {
    const lo = parseFloat(m[1]);
    const hi = m[2] ? parseFloat(m[2]) : lo;
    const days = unitToDays(Math.max(lo, hi), m[3]); // worst-case lead time
    if (days < 1 || days > 730) continue;
    if (seen.has(days)) continue;
    seen.add(days);
    out.push({
      title: `${item.title.replace(/\b(timeline|benchmark|lead[\s-]*time)\b/i, "").trim().slice(0, 100)} — ${hi} ${m[3]}${hi !== 1 ? "s" : ""} lead time`,
      leadDays: days,
      description: `Research-surfaced lead time from "${item.title}"`,
      sourceItemId: item.id,
    });
  }

  return out;
}

/**
 * Main entry. Scans research-tagged KB items for lead-time patterns,
 * creates scaffolded Task rows offset from project.startDate, tagged
 * [scaffolded:research] so they don't pollute delivery-task counts.
 */
export async function promoteResearchMilestonesToTasks(projectId: string): Promise<PromoteMilestonesResult> {
  const all = await db.knowledgeBaseItem.findMany({
    where: {
      projectId,
      tags: { hasSome: ["research", "feasibility"] },
    },
    select: { id: true, title: true, content: true, tags: true },
    take: 80,
  });
  const items = all.filter(i =>
    !i.title.startsWith("__") &&
    !i.tags.includes("milestone_promoted"),
  );

  if (items.length === 0) return { scanned: 0, created: 0 };

  // Anchor — project startDate, falling back to today if unset. Lead-time
  // milestones get an endDate of (anchor - leadDays).
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { startDate: true },
  });
  const anchor = project?.startDate ? new Date(project.startDate) : new Date();

  // Pre-Project / first phase row — bind milestones to the right phase so
  // they show up under the active phase on the Schedule page.
  const firstPhase = await db.phase.findFirst({
    where: { projectId },
    orderBy: { order: "asc" },
    select: { id: true, name: true },
  });

  const findings: MilestoneFinding[] = [];
  for (const item of items) {
    findings.push(...extractMilestones(item));
  }

  let created = 0;
  for (const f of findings) {
    // De-dupe by title within the project — never two scaffolded milestones
    // with the same name. User-added tasks with matching names are also
    // respected (we don't create a duplicate even if it wasn't scaffolded).
    const exists = await db.task.findFirst({
      where: { projectId, title: f.title },
      select: { id: true },
    });
    if (exists) continue;

    const dueDate = new Date(anchor.getTime() - f.leadDays * 86_400_000);

    try {
      await db.task.create({
        data: {
          projectId,
          phaseId: firstPhase?.id ?? null,
          title: f.title.slice(0, 255),
          description: `[scaffolded:research] ${f.description}`,
          status: "TODO",
          type: "milestone",
          priority: "medium",
          startDate: dueDate,
          endDate: dueDate,
          progress: 0,
          createdBy: "agent:milestone-extractor",
        },
      });
      created++;
    } catch (e) {
      console.error("[milestone-extractor] create failed:", f.title, e);
    }
  }

  // Tag promoted items even when no milestone was created — re-running is
  // then a no-op against a settled KB.
  for (const item of items) {
    await db.knowledgeBaseItem.update({
      where: { id: item.id },
      data: { tags: Array.from(new Set([...item.tags, "milestone_promoted"])) },
    }).catch(() => {});
  }

  return { scanned: items.length, created };
}
