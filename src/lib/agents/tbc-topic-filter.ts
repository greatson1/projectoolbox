/**
 * Artefact-aware TBC topic filter.
 *
 * Background: the generic artefact prompt tells Claude to write
 * `[TBC — <description>]` for any fact it doesn't know. That's fine
 * for artefacts that genuinely need personnel / dates / budget data,
 * but Claude was emitting nonsense placements like:
 *
 *   • "Definition of Done" containing `[TBC — compliance lead]`
 *     (a DoD is a completion-criteria list; it has no personnel)
 *   • "Product Backlog" containing `[TBC — sponsor]`
 *     (a backlog is a list of user stories; sponsor goes elsewhere)
 *
 * Those TBCs then flow into the clarification queue, so the user
 * gets a 20-question session that includes "What is the compliance
 * lead?" tagged to "Definition of Done" — confusing and useless.
 *
 * This module classifies each TBC topic into a coarse category
 * (person / date / amount / vendor / criteria / scope / other) and
 * filters out categories that don't fit the artefact's purpose. The
 * mapping is conservative — we only DROP TBCs that clearly don't
 * belong; if we're unsure we keep them so the user can still answer.
 *
 * Pure function, no DB, no LLM. Testable.
 */

export type TopicClass = "person" | "date" | "amount" | "vendor" | "criteria" | "scope" | "yesno" | "other";

const PERSON_HINTS = /\b(lead|leader|owner|manager|director|sponsor|stakeholder|approver|signatory|champion|head|chair|chairperson|contact|representative|liaison|coordinator|officer|administrator|author|person|individual|name)\b/i;
const DATE_HINTS = /\b(date|deadline|kickoff|kick-off|launch|milestone|due|start|end|completion|delivery|target date|go-live|cutover|schedule)\b/i;
const AMOUNT_HINTS = /\b(budget|cost|fee|rate|amount|total|price|salary|hours|days|weeks|months|count|number of|headcount|team size|fte|capacity|threshold|limit|quantity|allocation)\b/i;
const VENDOR_HINTS = /\b(supplier|vendor|partner|provider|consultant|contractor|venue|hotel|host|company|firm|organisation)\b/i;
const CRITERIA_HINTS = /\b(criteria|requirement|standard|threshold|definition|policy|condition|metric|kpi|sla|acceptance|test|review)\b/i;
const SCOPE_HINTS = /\b(scope|deliverable|objective|goal|exclusion|in[\s-]?scope|out[\s-]?of[\s-]?scope|outcome)\b/i;
const YESNO_HINTS = /\b(booked|confirmed|signed|approved|completed|in place|available|required|received|issued|granted|in scope|done)\b/i;

export function classifyTBCTopic(topic: string): TopicClass {
  const t = topic.toLowerCase();
  // Order matters — "team size" should be amount, not person. Check
  // amount-class numerics before person-hints because "team size"
  // contains neither personHints nor explicitly but is in AMOUNT.
  if (AMOUNT_HINTS.test(t)) return "amount";
  if (DATE_HINTS.test(t)) return "date";
  if (VENDOR_HINTS.test(t)) return "vendor";
  if (PERSON_HINTS.test(t)) return "person";
  if (CRITERIA_HINTS.test(t)) return "criteria";
  if (SCOPE_HINTS.test(t)) return "scope";
  if (YESNO_HINTS.test(t)) return "yesno";
  return "other";
}

/**
 * Artefact-purpose map: which topic classes are LEGITIMATE for each
 * artefact. A topic class outside this list is treated as misplaced
 * and dropped from the clarification queue.
 *
 * Conservative — when in doubt we include "other" so genuinely free-
 * text gaps still get asked.
 *
 * The match is on substring of the artefact name (lowercased), so
 * "Definition of Done" and "Initial Definition of Done" both hit the
 * same rule.
 */
interface ArtefactPurpose {
  match: RegExp;
  allowed: TopicClass[];
  description: string;
}

const ARTEFACT_PURPOSES: ArtefactPurpose[] = [
  // ── Criteria / standards artefacts ────────────────────────────────
  // No personnel — DoD is a checklist, not an org chart.
  {
    match: /definition of done|acceptance criteria framework|quality standards/i,
    allowed: ["criteria", "amount", "yesno", "other"],
    description: "completion criteria + thresholds only",
  },
  // ── Backlog / story-list artefacts ────────────────────────────────
  // Empty by default — no upfront TBCs of any class belong here.
  {
    match: /product backlog|initial.*backlog|sprint.*backlog|story map/i,
    allowed: [],
    description: "story list — populated incrementally, no upfront TBCs",
  },
  // ── Personnel / roster artefacts ──────────────────────────────────
  {
    match: /stakeholder register|stakeholder analysis|raci|responsibility|team roster|resource plan/i,
    allowed: ["person", "vendor", "scope", "other"],
    description: "personnel and responsibility mapping",
  },
  // ── Plan / strategy artefacts (broad scope, most topics valid) ────
  {
    match: /project charter|project brief|outline business case|business case|project management plan|project plan|communication plan|risk management plan|stakeholder engagement plan|change management plan|procurement plan|quality (management )?plan|cost management plan|schedule management plan|resource management plan/i,
    allowed: ["person", "date", "amount", "vendor", "criteria", "scope", "yesno", "other"],
    description: "broad project plan",
  },
  // ── Schedule / WBS artefacts ──────────────────────────────────────
  {
    match: /schedule|gantt|work breakdown|wbs|milestone|critical path/i,
    allowed: ["date", "amount", "person", "scope", "other"],
    description: "time + task structure",
  },
  // ── Risk / Issue artefacts ────────────────────────────────────────
  {
    match: /risk register|issue log|issue register|risk matrix/i,
    allowed: ["person", "amount", "yesno", "other"],
    description: "risk/issue items with owners + scores",
  },
  // ── Sprint artefacts (Scrum/SAFe) ─────────────────────────────────
  {
    match: /sprint plan|iteration plan|sprint goal|sprint backlog/i,
    allowed: ["amount", "date", "scope", "other"],
    description: "sprint capacity + goal",
  },
  // ── Reports / closure artefacts ───────────────────────────────────
  {
    match: /status report|end project report|closure report|lessons learn(ed|t)|acceptance certificate|sources & assumptions/i,
    allowed: ["amount", "date", "scope", "yesno", "other"],
    description: "retrospective / closure data",
  },
];

/**
 * Returns true if the topic is appropriate for the artefact, false
 * if it should be dropped from the clarification queue.
 *
 * For unrecognised artefact names, returns true (no filter) so we
 * never accidentally drop TBCs from an artefact we don't have a
 * rule for. Add a new entry to ARTEFACT_PURPOSES when a misplaced
 * TBC pattern is reported.
 */
export function isTopicAppropriateForArtefact(artefactName: string, topic: string): boolean {
  const purpose = ARTEFACT_PURPOSES.find(p => p.match.test(artefactName));
  if (!purpose) return true; // unrecognised — keep, don't silently drop
  const cls = classifyTBCTopic(topic);
  return purpose.allowed.includes(cls);
}

/**
 * Filter a list of TBC items to those appropriate for their parent
 * artefact. Returns the filtered list AND a summary of what was
 * dropped (for logging / audit).
 */
export function filterTBCItemsByArtefactPurpose(
  items: Array<{ artefactName: string; item: string }>,
): {
  kept: Array<{ artefactName: string; item: string }>;
  dropped: Array<{ artefactName: string; item: string; topicClass: TopicClass }>;
} {
  const kept: Array<{ artefactName: string; item: string }> = [];
  const dropped: Array<{ artefactName: string; item: string; topicClass: TopicClass }> = [];
  for (const x of items) {
    if (isTopicAppropriateForArtefact(x.artefactName, x.item)) {
      kept.push(x);
    } else {
      dropped.push({ ...x, topicClass: classifyTBCTopic(x.item) });
    }
  }
  return { kept, dropped };
}
