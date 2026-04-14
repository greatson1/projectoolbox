/**
 * Schedule Parser — converts approved Schedule Baseline / WBS artefacts
 * into structured Task records in the database.
 *
 * Hierarchy strategy
 * ──────────────────
 * WBS artefacts:       WBS ID dot-notation  ("1", "1.1", "1.1.2") encodes depth.
 *                      Parent of "1.2.3" is the nearest ancestor whose ID is a
 *                      prefix — i.e. "1.2". Tasks are created in two passes:
 *                      pass-1 creates every row and records {sourceId → dbId},
 *                      pass-2 sets parentId by walking up the dot-notation tree.
 *
 * Schedule Baseline:   No explicit hierarchy in the CSV. We synthesise one level
 *                      of parent tasks from the Category / Phase column — one
 *                      parent per unique category, children beneath it.
 *
 * Both strategies produce the `parentId` values that the Scope/WBS page's
 * `buildTree()` function needs to render a nested tree.
 */

import { db } from "@/lib/db";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedTask {
  title: string;
  description?: string;
  phase?: string;           // category / phase name → used for phaseId lookup
  assigneeLabel?: string;
  startDate?: Date;
  endDate?: Date;
  estimatedHours?: number;
  progress: number;
  status: string;
  isCriticalPath: boolean;
  isMilestone: boolean;
  dependencies: string[];
  sourceId?: string;        // raw WBS ID / Task ID from CSV
  parentSourceId?: string;  // resolved parent source ID (WBS dot-notation parent)
  isSyntheticParent?: boolean; // true for category-group rows we inject
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function parseScheduleArtefactIntoTasks(
  artefact: { id: string; name: string; format: string; content: string; projectId: string },
  agentId: string,
): Promise<{ created: number; replaced: number }> {
  const lname = artefact.name.toLowerCase();
  const isRelevant =
    lname.includes("schedule") ||
    lname.includes("wbs") ||
    lname.includes("work breakdown");

  if (!isRelevant || !artefact.content) return { created: 0, replaced: 0 };

  const rows = parseCSV(artefact.content);
  if (rows.length === 0) return { created: 0, replaced: 0 };

  const isWBS = lname.includes("wbs") || lname.includes("work breakdown");
  const tasks = isWBS ? buildWBSTasks(rows) : buildScheduleTasks(rows);
  if (tasks.length === 0) return { created: 0, replaced: 0 };

  // ── Resolve phase IDs ──
  const phaseNameSet = new Set(tasks.map(t => t.phase).filter(Boolean) as string[]);
  const phaseRows = phaseNameSet.size > 0
    ? await db.phase.findMany({
        where: { projectId: artefact.projectId, name: { in: [...phaseNameSet] } },
        select: { id: true, name: true },
      })
    : [];
  const phaseMap = Object.fromEntries(phaseRows.map(p => [p.name.toLowerCase(), p.id]));

  // ── Replace agent-generated tasks with the real WBS/Schedule data ──
  // When a WBS or Schedule artefact is approved, it becomes the source of truth.
  // Delete both previously seeded tasks AND scaffolded placeholder tasks — the
  // artefact data supersedes the generic scaffolding.
  const sourceTag = isWBS ? "[source:wbs]" : "[source:schedule]";
  const deleted = await db.task.deleteMany({
    where: {
      projectId: artefact.projectId,
      createdBy: `agent:${agentId}`,
      OR: [
        { description: { contains: sourceTag } },
        { description: { contains: "[scaffolded]" } },
      ],
    },
  });

  // ── Two-pass creation ──────────────────────────────────────────────────────
  // Pass 1: Create all tasks (parentId = null), record sourceId → dbId mapping.
  // Pass 2: Update parentId on tasks that have a parentSourceId.
  const sourceIdToDbId = new Map<string, string>();
  let created = 0;

  for (const t of tasks) {
    const phaseId = t.phase ? (phaseMap[t.phase.toLowerCase()] ?? null) : null;
    try {
      const record = await db.task.create({
        data: {
          projectId: artefact.projectId,
          title: t.title.slice(0, 255),
          description: `${sourceTag} ${buildDescription(t)}`,
          status: t.status,
          startDate: t.startDate ?? null,
          endDate: t.endDate ?? null,
          progress: t.progress,
          estimatedHours: t.estimatedHours ?? null,
          isCriticalPath: t.isCriticalPath,
          dependencies: t.dependencies.length > 0 ? t.dependencies : undefined,
          phaseId,
          parentId: null,   // set in pass 2
          createdBy: `agent:${agentId}`,
          lastEditedBy: `agent:${agentId}`,
        },
      });
      if (t.sourceId) sourceIdToDbId.set(t.sourceId, record.id);
      created++;
    } catch (e) {
      console.error("[schedule-parser] Failed to create task:", t.title, e);
    }
  }

  // Pass 2: wire up parentId
  let linked = 0;
  for (const t of tasks) {
    if (!t.parentSourceId || !t.sourceId) continue;
    const childDbId  = sourceIdToDbId.get(t.sourceId);
    const parentDbId = sourceIdToDbId.get(t.parentSourceId);
    if (!childDbId || !parentDbId) continue;
    try {
      await db.task.update({ where: { id: childDbId }, data: { parentId: parentDbId } });
      linked++;
    } catch (e) {
      console.error("[schedule-parser] Failed to link parentId:", t.title, e);
    }
  }

  console.log(
    `[schedule-parser] "${artefact.name}": ${deleted.count} old tasks removed, ` +
    `${created} created, ${linked} parent links set`,
  );
  return { created, replaced: deleted.count };
}

// ─── WBS hierarchy builder ────────────────────────────────────────────────────
/**
 * Build tasks from a WBS CSV.
 * WBS IDs like "1", "1.1", "1.2", "1.2.1" encode depth.
 * Parent of "1.2.1" is the task whose sourceId is "1.2".
 * If "1.2" doesn't exist as a row, we walk up ("1") until we find one.
 */
function buildWBSTasks(rows: Record<string, string>[]): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  const seenIds = new Set<string>();

  for (const row of rows) {
    const deliverable = col(row, ["Deliverable", "Work Package", "Task", "Activity", "Name"]);
    if (!deliverable) continue;

    const sourceId    = col(row, ["WBS ID", "ID", "Task ID"]).trim();
    const description = col(row, ["Description"]);
    const startRaw    = col(row, ["Planned Start", "Start Date", "Start"]);
    const endRaw      = col(row, ["Planned End",   "End Date",   "End"]);
    const durationRaw = col(row, ["Est. Duration (days)", "Duration (days)", "Duration"]);
    const progressRaw = col(row, ["% Complete", "Progress"]);
    const statusRaw   = col(row, ["Status"]);
    const ownerRaw    = col(row, ["Owner", "Assigned To"]);
    const depRaw      = col(row, ["Dependencies"]);

    const progress = parseProgress(progressRaw);
    const status   = resolveStatus(statusRaw, null, progress);

    // Resolve parent from dot-notation
    const parentSourceId = resolveWBSParent(sourceId, seenIds);
    if (sourceId) seenIds.add(sourceId);

    tasks.push({
      title: deliverable,
      description: description || undefined,
      phase: undefined,
      assigneeLabel: ownerRaw || undefined,
      startDate: parseDate(startRaw),
      endDate: parseDate(endRaw),
      estimatedHours: parseDurationToHours(durationRaw),
      progress,
      status,
      isCriticalPath: false,
      isMilestone: false,
      dependencies: parseDependencies(depRaw),
      sourceId: sourceId || `wbs-${tasks.length}`,
      parentSourceId: parentSourceId || undefined,
    });
  }
  return tasks;
}

/**
 * For a WBS ID like "1.2.3", return the nearest existing ancestor ID.
 * Walks up: "1.2.3" → tries "1.2" → tries "1" → gives up (root).
 */
function resolveWBSParent(id: string, seenIds: Set<string>): string | null {
  if (!id || !id.includes(".")) return null;
  const parts = id.split(".");
  // Try successively shorter prefixes
  for (let len = parts.length - 1; len >= 1; len--) {
    const candidate = parts.slice(0, len).join(".");
    if (seenIds.has(candidate)) return candidate;
  }
  return null;
}

// ─── Schedule Baseline hierarchy builder ─────────────────────────────────────
/**
 * Build tasks from a Schedule Baseline CSV.
 * There's no explicit WBS hierarchy so we synthesise one level of parents
 * from the Category / Phase column.
 *
 * Result:
 *   Project Setup (synthetic parent, no dates)
 *     ├─ Define project objectives
 *     ├─ Set up project tools
 *     └─ Kick-off meeting
 *   Design
 *     ├─ Create wireframes
 *     └─ …
 */
function buildScheduleTasks(rows: Record<string, string>[]): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  const categoryParentIds = new Map<string, string>(); // category → synthetic sourceId
  let syntheticCounter = 0;

  for (const row of rows) {
    const activity    = col(row, ["Activity", "Task", "Task Name", "Name"]);
    if (!activity) continue;

    const startRaw    = col(row, ["Baseline Start", "Planned Start", "Start Date", "Start"]);
    const endRaw      = col(row, ["Baseline End",   "Planned End",   "End Date",   "End"]);
    const durationRaw = col(row, ["Duration (days)", "Duration", "Est. Duration (days)"]);
    const progressRaw = col(row, ["% Complete", "Progress", "Completion %"]);
    const statusRaw   = col(row, ["Status"]);
    const ragRaw      = col(row, ["RAG"]);
    const milestoneRaw= col(row, ["Milestone?", "Milestone", "Is Milestone"]);
    const criticalRaw = col(row, ["Critical Path", "Critical"]);
    const depRaw      = col(row, ["Dependencies", "Predecessors"]);
    const categoryRaw = col(row, ["Category", "Phase", "Work Package", "Group"]);
    const ownerRaw    = col(row, ["Owner", "Assigned To", "Assignee"]);
    const sourceId    = col(row, ["Task ID", "ID"]) || `sched-${tasks.length}`;

    const progress = parseProgress(progressRaw);
    const status   = resolveStatus(statusRaw, ragRaw, progress);
    const category = categoryRaw.trim();

    // Ensure a synthetic parent task exists for this category
    if (category && !categoryParentIds.has(category)) {
      const syntheticId = `__cat_${syntheticCounter++}`;
      categoryParentIds.set(category, syntheticId);
      tasks.push({
        title: category,
        phase: category,
        progress: 0,
        status: "TODO",
        isCriticalPath: false,
        isMilestone: false,
        dependencies: [],
        sourceId: syntheticId,
        isSyntheticParent: true,
      });
    }

    tasks.push({
      title: activity,
      phase: category || undefined,
      assigneeLabel: ownerRaw || undefined,
      startDate: parseDate(startRaw),
      endDate: parseDate(endRaw),
      estimatedHours: parseDurationToHours(durationRaw),
      progress,
      status,
      isCriticalPath: isTruthy(criticalRaw),
      isMilestone: isTruthy(milestoneRaw),
      dependencies: parseDependencies(depRaw),
      sourceId,
      parentSourceId: category ? (categoryParentIds.get(category) ?? undefined) : undefined,
    });
  }

  // Recalculate synthetic parent progress as average of children
  for (const [cat, parentSrcId] of categoryParentIds.entries()) {
    const children = tasks.filter(t => t.parentSourceId === parentSrcId && !t.isSyntheticParent);
    if (children.length === 0) continue;
    const avgProgress = Math.round(children.reduce((s, c) => s + c.progress, 0) / children.length);
    const parent = tasks.find(t => t.sourceId === parentSrcId);
    if (parent) {
      parent.progress = avgProgress;
      parent.status = children.every(c => c.status === "DONE") ? "DONE"
        : children.some(c => c.status === "IN_PROGRESS" || c.status === "AT_RISK") ? "IN_PROGRESS"
        : "TODO";
      // Date span = earliest start → latest end of children
      const starts = children.map(c => c.startDate).filter(Boolean) as Date[];
      const ends   = children.map(c => c.endDate).filter(Boolean) as Date[];
      if (starts.length) parent.startDate = new Date(Math.min(...starts.map(d => d.getTime())));
      if (ends.length)   parent.endDate   = new Date(Math.max(...ends.map(d => d.getTime())));
    }
  }

  return tasks;
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────

function parseCSV(raw: string): Record<string, string>[] {
  const cleaned = raw.replace(/^```[a-z]*\n?/im, "").replace(/```\s*$/im, "").trim();
  const lines = splitCSVLines(cleaned);
  if (lines.length < 2) return [];
  const headers = parseCSVRow(lines[0]).map(h => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVRow(lines[i]);
    if (cells.every(c => !c.trim())) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = (cells[idx] ?? "").trim(); });
    rows.push(obj);
  }
  return rows;
}

function splitCSVLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { inQuote = !inQuote; current += ch; }
    else if ((ch === "\n" || ch === "\r") && !inQuote) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      if (current.trim()) lines.push(current);
      current = "";
    } else { current += ch; }
  }
  if (current.trim()) lines.push(current);
  return lines;
}

function parseCSVRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { current += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === "," && !inQuote) { fields.push(current); current = ""; }
    else { current += ch; }
  }
  fields.push(current);
  return fields;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function col(row: Record<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    const key = Object.keys(row).find(k => k.toLowerCase() === alias.toLowerCase());
    if (key && row[key]) return row[key].trim();
  }
  return "";
}

function parseDate(raw: string): Date | undefined {
  if (!raw || raw === "TBD" || raw === "-" || raw === "N/A") return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? undefined : d;
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(raw)) {
    const [day, month, year] = raw.split("/");
    const d = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
    return isNaN(d.getTime()) ? undefined : d;
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}

function parseDurationToHours(raw: string): number | undefined {
  if (!raw) return undefined;
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? undefined : n * 8;
}

function parseProgress(raw: string): number {
  if (!raw) return 0;
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : Math.min(100, Math.max(0, Math.round(n)));
}

function resolveStatus(statusRaw: string, ragRaw: string | null, progress: number): string {
  const s   = (statusRaw || "").toLowerCase();
  const rag = (ragRaw    || "").toLowerCase();
  if (s.includes("complete") || s.includes("done") || s.includes("closed") || progress >= 100) return "DONE";
  if (rag === "red" || s.includes("at risk") || s.includes("delayed") || s.includes("overdue"))  return "AT_RISK";
  if (rag === "amber" || s.includes("in progress") || s.includes("active") || (progress > 0 && progress < 100)) return "IN_PROGRESS";
  return "TODO";
}

function parseDependencies(raw: string): string[] {
  if (!raw || raw === "-" || raw === "N/A") return [];
  return raw.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
}

function isTruthy(raw: string): boolean {
  return /^(yes|true|y|✓|x|1)$/i.test((raw || "").trim());
}

function buildDescription(t: ParsedTask): string {
  const parts: string[] = [];
  if (t.description) parts.push(t.description);
  if (t.assigneeLabel && t.assigneeLabel !== "TBD") parts.push(`Owner: ${t.assigneeLabel}`);
  if (t.isMilestone) parts.push("📍 Milestone");
  if (t.isSyntheticParent) parts.push("Phase group");
  if (t.sourceId && !t.isSyntheticParent) parts.push(`Ref: ${t.sourceId}`);
  return parts.join(" | ");
}
