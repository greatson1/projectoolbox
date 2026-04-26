/**
 * Extract artefact action items into Task rows.
 *
 * Every artefact prompt template asks the LLM to produce a `## Summary and
 * Next Actions` table with columns Action | Owner | Due Date | Status.
 * Before this module existed those rows lived only as text inside the
 * artefact's HTML and never became real tracked work — the user couldn't
 * tick them off, the Agile Board didn't see them, the phase-completion
 * gate didn't count them.
 *
 * On approval (and on regeneration) we parse the table out and create /
 * update Task rows linked back to the artefact via Task.sourceArtefactId
 * + Task.sourceRowKey. The keying scheme means the SAME action across
 * artefact versions updates the existing task instead of duplicating.
 *
 * The extracted tasks are tagged "from_artefact" + "action_item" so they
 * show up under "Delivery Tasks" on the PM Tracker (and count toward the
 * phase-completion delivery-tasks gate that runPhaseAdvanceFlow checks).
 */

import { db } from "@/lib/db";

interface ParsedAction {
  action: string;
  owner: string | null;
  dueDate: string | null; // raw text — may be "[TBC]" or a real date
  status: string | null;
}

/** Heuristic markdown/HTML parser for the "Summary and Next Actions" table. */
export function parseNextActionsTable(content: string): ParsedAction[] {
  if (!content) return [];

  // 1. Find the "Summary and Next Actions" or "Next Actions" section.
  // Tolerate variants: "## Summary and Next Actions", "Next Actions", "Action Items".
  const sectionRegex = /(##+\s*(Summary[\s\S]*?Next\s+Actions|Next\s+Actions|Action\s+Items))([\s\S]*?)(?=\n##|\n<h[1-6]|$)/i;
  const sectionMatch = content.match(sectionRegex);
  // If no clear heading, also try HTML <h2> variants
  let body = sectionMatch?.[3] || "";
  if (!body) {
    const htmlMatch = content.match(/<h[1-6][^>]*>\s*(?:Summary[\s\S]*?Next\s+Actions|Next\s+Actions|Action\s+Items)\s*<\/h[1-6]>([\s\S]*?)(?=<h[1-6]|$)/i);
    body = htmlMatch?.[1] || "";
  }
  if (!body) return [];

  const rows: ParsedAction[] = [];

  // 2. Try HTML <table> first (richer, more reliable).
  const htmlTableMatch = body.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (htmlTableMatch) {
    const trMatches = htmlTableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    let isHeader = true; // first row is the header
    for (const tr of trMatches) {
      const cells = Array.from(tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map(m => stripHtml(m[1]).trim());
      if (cells.length < 2) continue;
      if (isHeader && cells.some(c => /^action$/i.test(c))) { isHeader = false; continue; }
      isHeader = false;
      // Conventional column order: Action, Owner, Due Date, Status
      const [action, owner, dueDate, status] = cells;
      if (!action || action.length < 3) continue;
      rows.push({
        action: action.slice(0, 280),
        owner: owner?.trim() || null,
        dueDate: dueDate?.trim() || null,
        status: status?.trim() || null,
      });
    }
    return rows;
  }

  // 3. Fall back to markdown pipe tables.
  const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let inTable = false;
  for (const line of lines) {
    // Skip the header separator line (---|---|...)
    if (/^\|?\s*[:-]+\s*\|/.test(line)) { inTable = true; continue; }
    if (!line.startsWith("|")) continue;
    if (!inTable) {
      // First |...| line is the header — only count subsequent ones.
      inTable = true;
      // If this line LOOKS like data (not "Action"), include it
      if (!/Action\b/i.test(line)) {
        // fall through
      } else {
        continue;
      }
    }
    const cells = line.split("|").map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
    if (cells.length < 2) continue;
    const [action, owner, dueDate, status] = cells;
    if (!action || action.length < 3 || /^Action$/i.test(action)) continue;
    rows.push({
      action: action.slice(0, 280),
      owner: owner?.trim() || null,
      dueDate: dueDate?.trim() || null,
      status: status?.trim() || null,
    });
  }

  return rows;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** Stable hash of the action+owner so re-extraction matches the same task row. */
function rowKey(action: string, owner: string | null): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return `${norm(action)}::${norm(owner || "")}`.slice(0, 200);
}

function mapStatus(raw: string | null): string {
  if (!raw) return "TODO";
  const s = raw.toLowerCase();
  if (/done|complete|complet/i.test(s)) return "DONE";
  if (/progress|started|doing|active/i.test(s)) return "IN_PROGRESS";
  if (/block|stuck|wait/i.test(s)) return "BLOCKED";
  return "TODO";
}

function parseDueDate(raw: string | null): Date | null {
  if (!raw) return null;
  if (/\[?\s*TBC|TBD|to be confirmed|dependent on|pending/i.test(raw)) return null;
  // Try several formats — ISO, dd/mm/yyyy, "30 June 2026", etc.
  const native = new Date(raw);
  if (!isNaN(native.getTime()) && native.getFullYear() > 2000) return native;
  // dd/mm/yyyy
  const dmyMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  }
  return null;
}

interface ExtractResult {
  parsed: number;
  created: number;
  updated: number;
  unchanged: number;
}

/**
 * Extract action items from an artefact and upsert as Task rows.
 * Idempotent — safe to call multiple times. Re-extraction matches the
 * existing task by sourceArtefactId + sourceRowKey.
 */
export async function extractAndPersistArtefactActions(artefactId: string): Promise<ExtractResult> {
  const artefact = await db.agentArtefact.findUnique({
    where: { id: artefactId },
    select: {
      id: true,
      projectId: true,
      agentId: true,
      phaseId: true,
      name: true,
      content: true,
    },
  });
  if (!artefact) return { parsed: 0, created: 0, updated: 0, unchanged: 0 };

  const parsed = parseNextActionsTable(artefact.content || "");
  if (parsed.length === 0) return { parsed: 0, created: 0, updated: 0, unchanged: 0 };

  // Existing tasks from this artefact, keyed by sourceRowKey for upsert.
  const existing = await db.task.findMany({
    where: { sourceArtefactId: artefact.id },
    select: { id: true, sourceRowKey: true, title: true, status: true, assigneeName: true, endDate: true },
  });
  const existingByKey = new Map(existing.map(t => [t.sourceRowKey || "", t]));

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const seenKeys = new Set<string>();

  for (const p of parsed) {
    const key = rowKey(p.action, p.owner);
    seenKeys.add(key);
    const due = parseDueDate(p.dueDate);
    const status = mapStatus(p.status);
    const desc = `[from-artefact:${artefact.name}] Auto-extracted from the artefact's "Next Actions" table on approval. Edit the artefact and re-approve to update.`;

    const ex = existingByKey.get(key);
    if (ex) {
      // Only update if something visibly changed
      const wantsUpdate =
        ex.title !== p.action ||
        ex.assigneeName !== (p.owner || null) ||
        (due && (!ex.endDate || ex.endDate.getTime() !== due.getTime()));
      if (wantsUpdate) {
        await db.task.update({
          where: { id: ex.id },
          data: {
            title: p.action,
            assigneeName: p.owner || null,
            endDate: due,
            // Don't overwrite a status the user has manually changed —
            // only sync status if the user hasn't touched it.
            ...(ex.status === "TODO" && status !== "TODO" ? { status } : {}),
          },
        });
        updated++;
      } else {
        unchanged++;
      }
    } else {
      await db.task.create({
        data: {
          projectId: artefact.projectId,
          title: p.action,
          description: desc,
          status,
          priority: "MEDIUM",
          type: "task",
          phaseId: artefact.phaseId || null,
          assigneeName: p.owner || null,
          endDate: due,
          createdBy: `agent:${artefact.agentId}`,
          sourceArtefactId: artefact.id,
          sourceRowKey: key,
          labels: ["from_artefact", "action_item"] as any,
        },
      });
      created++;
    }
  }

  // Note: we DON'T delete tasks for action rows that disappeared on
  // re-extraction. The user may have already started the work. Leave them
  // and let the PM tick them done manually.

  return { parsed: parsed.length, created, updated, unchanged };
}
