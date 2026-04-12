/**
 * Bidirectional Artefact ↔ Task Sync
 *
 * Keeps WBS/Schedule artefacts and the Task table in sync:
 *
 *   1. Forward sync (artefact → tasks):
 *      Already handled by schedule-parser.ts on artefact approval.
 *
 *   2. Reverse sync (tasks → artefact):
 *      When a user edits a task (dates, progress, status) on the Gantt/board,
 *      the corresponding WBS/Schedule artefact CSV is updated to match.
 *
 *   3. Staleness tracking:
 *      When a source artefact changes, downstream artefacts that depend on it
 *      are flagged as potentially stale (e.g., WBS change → Cost Plan may be stale).
 *
 *   4. Agent row updates:
 *      The agent can update specific rows in a CSV artefact without regenerating
 *      the entire document — preserving structure while updating progress/status.
 */

import { db } from "@/lib/db";

// ─── Artefact dependency graph ───────────────────────────────────────────────
// If artefact A changes, artefacts B that depend on A may be stale.

const DEPENDENCY_MAP: Record<string, string[]> = {
  "Work Breakdown Structure": ["Schedule with Dependencies", "Cost Management Plan", "Resource Management Plan"],
  "Schedule with Dependencies": ["Cost Management Plan", "Resource Management Plan"],
  "Initial Risk Register": ["Risk Management Plan"],
  "Stakeholder Register": ["Communication Plan"],
  "Requirements Specification": ["Design Document", "Work Breakdown Structure"],
};

// ─── 1. Reverse sync: tasks → WBS/Schedule artefact ──────────────────────────

/**
 * After a task is edited, finds the WBS or Schedule artefact for the project
 * and updates the matching CSV row. Called from the task PATCH API.
 */
export async function syncTaskToArtefact(
  projectId: string,
  taskId: string,
  changedFields: Record<string, any>,
): Promise<void> {
  try {
    const task = await db.task.findUnique({ where: { id: taskId } });
    if (!task) return;

    // Only sync tasks that came from a WBS or Schedule artefact
    const desc = task.description || "";
    const isWbsTask = desc.includes("[source:wbs]");
    const isScheduleTask = desc.includes("[source:schedule]");
    if (!isWbsTask && !isScheduleTask) return;

    // Find the source artefact
    const artefactName = isWbsTask ? "Work Breakdown Structure" : "Schedule with Dependencies";
    const artefact = await db.agentArtefact.findFirst({
      where: {
        projectId,
        name: { contains: artefactName.split(" ")[0] }, // fuzzy match "Work" or "Schedule"
        format: "csv",
      },
      orderBy: { updatedAt: "desc" },
    });
    if (!artefact || !artefact.content) return;

    // Parse CSV, find matching row, update it
    const rows = parseCSV(artefact.content);
    if (rows.length < 2) return; // header + at least 1 data row

    const header = rows[0];
    const updatedRows = [header];
    let rowUpdated = false;

    for (let i = 1; i < rows.length; i++) {
      const row = [...rows[i]];
      // Match by task title (best we have — WBS ID may not be stored on the task)
      const titleIdx = findColIndex(header, ["Activity", "Work Package", "Deliverable", "Task", "User Story"]);
      if (titleIdx >= 0 && normalise(row[titleIdx]) === normalise(task.title)) {
        // Update the row with changed fields
        applyChangesToRow(header, row, task, changedFields);
        rowUpdated = true;
      }
      updatedRows.push(row);
    }

    if (!rowUpdated) {
      // Task title didn't match any row — skip
      return;
    }

    // Write updated CSV back to artefact
    const newCsv = updatedRows.map(r => r.map(c => csvEscape(c)).join(",")).join("\n");
    await db.agentArtefact.update({
      where: { id: artefact.id },
      data: { content: newCsv, version: { increment: 1 } },
    });

    // Flag downstream artefacts as stale
    await flagDependentsStale(projectId, artefactName);
  } catch (e) {
    console.error("[artefact-sync] syncTaskToArtefact failed:", e);
  }
}

// ─── 2. Agent row updater ────────────────────────────────────────────────────

/**
 * Updates a specific row in a CSV artefact by matching on a key column.
 * Used by the agent to update progress/status without regenerating.
 */
export async function updateArtefactRow(
  artefactId: string,
  matchColumn: string,
  matchValue: string,
  updates: Record<string, string>,
): Promise<boolean> {
  try {
    const artefact = await db.agentArtefact.findUnique({ where: { id: artefactId } });
    if (!artefact || !artefact.content || artefact.format !== "csv") return false;

    const rows = parseCSV(artefact.content);
    if (rows.length < 2) return false;

    const header = rows[0];
    const matchIdx = findColIndex(header, [matchColumn]);
    if (matchIdx < 0) return false;

    let updated = false;
    for (let i = 1; i < rows.length; i++) {
      if (normalise(rows[i][matchIdx]) === normalise(matchValue)) {
        // Apply each update
        for (const [col, val] of Object.entries(updates)) {
          const colIdx = findColIndex(header, [col]);
          if (colIdx >= 0) {
            while (rows[i].length <= colIdx) rows[i].push("");
            rows[i][colIdx] = val;
          }
        }
        updated = true;
        break;
      }
    }

    if (!updated) return false;

    const newCsv = rows.map(r => r.map(c => csvEscape(c)).join(",")).join("\n");
    await db.agentArtefact.update({
      where: { id: artefactId },
      data: { content: newCsv, version: { increment: 1 } },
    });

    // Flag dependents
    await flagDependentsStale(artefact.projectId, artefact.name);
    return true;
  } catch (e) {
    console.error("[artefact-sync] updateArtefactRow failed:", e);
    return false;
  }
}

// ─── 3. Staleness tracking ──────────────────────────────────────────────────

/**
 * When a source artefact changes, flag its dependents as potentially stale.
 * Sets a "staleReason" in the artefact's metadata JSON.
 */
async function flagDependentsStale(projectId: string, changedArtefactName: string): Promise<void> {
  const dependents = DEPENDENCY_MAP[changedArtefactName];
  if (!dependents || dependents.length === 0) return;

  for (const depName of dependents) {
    const dep = await db.agentArtefact.findFirst({
      where: { projectId, name: { contains: depName.split(" ")[0] } },
      orderBy: { updatedAt: "desc" },
    });
    if (!dep) continue;

    const existingMeta = (dep.metadata as any) || {};
    await db.agentArtefact.update({
      where: { id: dep.id },
      data: {
        metadata: {
          ...existingMeta,
          stale: true,
          staleReason: `${changedArtefactName} was updated on ${new Date().toLocaleDateString("en-GB")}`,
          staleSince: new Date().toISOString(),
        } as any,
      },
    });
  }
}

/**
 * Check if an artefact is flagged as stale.
 */
export async function isArtefactStale(artefactId: string): Promise<{ stale: boolean; reason?: string }> {
  const artefact = await db.agentArtefact.findUnique({
    where: { id: artefactId },
    select: { metadata: true },
  });
  const meta = (artefact?.metadata as any) || {};
  return { stale: !!meta.stale, reason: meta.staleReason };
}

/**
 * Clear the stale flag (called after the artefact is regenerated/updated).
 */
export async function clearStaleFlag(artefactId: string): Promise<void> {
  const artefact = await db.agentArtefact.findUnique({
    where: { id: artefactId },
    select: { metadata: true },
  });
  const meta = (artefact?.metadata as any) || {};
  delete meta.stale;
  delete meta.staleReason;
  delete meta.staleSince;
  await db.agentArtefact.update({
    where: { id: artefactId },
    data: { metadata: meta as any },
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseCSV(csv: string): string[][] {
  return csv.split("\n").filter(l => l.trim()).map(line => {
    const cells: string[] = [];
    let cur = "";
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { cells.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    cells.push(cur.trim());
    return cells;
  });
}

function csvEscape(val: string): string {
  if (!val) return "";
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function normalise(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

function findColIndex(header: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const norm = normalise(candidate);
    const idx = header.findIndex(h => normalise(h) === norm);
    if (idx >= 0) return idx;
  }
  return -1;
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function applyChangesToRow(
  header: string[],
  row: string[],
  task: any,
  changedFields: Record<string, any>,
): void {
  // Ensure row has enough columns
  while (row.length < header.length) row.push("");

  // Map task fields to CSV columns
  const mappings: Array<{ taskField: string; csvColumns: string[] }> = [
    { taskField: "progress", csvColumns: ["% Complete", "Progress", "Completion"] },
    { taskField: "status", csvColumns: ["Status", "State"] },
    { taskField: "startDate", csvColumns: ["Planned Start", "Start Date", "Start", "Actual Start"] },
    { taskField: "endDate", csvColumns: ["Planned End", "End Date", "End", "Actual End"] },
    { taskField: "estimatedHours", csvColumns: ["Est. Duration (days)", "Duration (days)", "Duration", "Hours"] },
    { taskField: "assigneeId", csvColumns: ["Owner", "Assigned To", "Assignee"] },
    { taskField: "isCriticalPath", csvColumns: ["Critical Path"] },
  ];

  for (const { taskField, csvColumns } of mappings) {
    if (!(taskField in changedFields)) continue;
    const colIdx = findColIndex(header, csvColumns);
    if (colIdx < 0) continue;

    const val = task[taskField];
    if (taskField === "progress") {
      row[colIdx] = `${val || 0}%`;
    } else if (taskField === "startDate" || taskField === "endDate") {
      row[colIdx] = formatDate(val);
    } else if (taskField === "isCriticalPath") {
      row[colIdx] = val ? "Yes" : "No";
    } else if (taskField === "estimatedHours") {
      // Convert hours to days (8h/day)
      row[colIdx] = val ? `${(val / 8).toFixed(1)}` : "";
    } else {
      row[colIdx] = String(val ?? "");
    }
  }

  // Also map RAG status
  const ragIdx = findColIndex(header, ["RAG"]);
  if (ragIdx >= 0 && "status" in changedFields) {
    const s = (task.status || "").toUpperCase();
    row[ragIdx] = s === "DONE" ? "🟢" : s === "IN_PROGRESS" ? "🟡" : s === "BLOCKED" ? "🔴" : "🟡";
  }
}
