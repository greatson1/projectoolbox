// Executor classification — is a task something the AGENT can produce
// itself (documents, analysis, registers) or real-world HUMAN work the
// platform can only track (procurement, installs, workshops, sign-offs)?
//
// Deterministic keyword heuristic, deliberately NOT an LLM call: it runs on
// every artefact→task sync, must be free, reproducible and testable, and a
// misclassification is cheap (an unnecessary check-in, or a missing one).
// HUMAN is the default for ambiguous execution work — the agent genuinely
// cannot do anything outside the platform, so claiming AGENT is the only
// dangerous error.

const AGENT_PATTERNS: RegExp[] = [
  // document production — the agent's actual capability
  /\b(generate|draft|write|prepare|produce|compile|author)\b.*\b(report|plan|register|charter|backlog|document|documentation|log|matrix|brief|pack|summary|notes?|vision|criteria|definition)\b/i,
  /\b(update|maintain|revise)\b.*\b(register|log|backlog|plan|document|schedule|matrix)\b/i,
  /\b(analy[sz]e|summari[sz]e|research|assess|estimate|calculate|forecast)\b/i,
  /\b(document|record)\b.*\b(lessons|decisions?|minutes|outcomes?)\b/i,
];

const HUMAN_PATTERNS: RegExp[] = [
  // physical / real-world
  /\b(install|procure|purchase|buy|order|ship|deliver|relocate|move|build|construct|fit|wire|paint|clean|repair|assemble|dismantle|transport)\b/i,
  /\b(site|venue|office|warehouse|premises|on-?site)\b/i,
  // people-facing events
  /\b(conduct|facilitate|host|run|attend|schedule|hold)\b.*\b(meeting|workshop|session|training|kick-?off|interview|walkthrough|stand-?up|ceremony|demo)\b/i,
  /\b(train|coach|onboard)\b.*\b(team|staff|users?|people)\b/i,
  // org / commercial acts only a person can perform
  /\b(hire|recruit|appoint|negotiate|sign|contract|engage)\b/i,
  /\b(obtain|secure|get)\b.*\b(approval|sign-?off|permission|consent|authori[sz]ation)\b/i,
  /\b(approve|authori[sz]e|validate|confirm)\b.*\b(with|from)\b.*\b(stakeholders?|sponsor|board|client|vendor)\b/i,
  // hardware / environments / integrations someone must actually operate
  /\b(configure|deploy|set ?up|provision|integrate|migrate|test)\b.*\b(system|platform|hardware|equipment|environment|infrastructure|network|server|erp|crm|tool)\b/i,
];

export function classifyExecutor(title: string, description?: string | null): "AGENT" | "HUMAN" {
  const text = `${title} ${description ?? ""}`;
  // HUMAN patterns win: claiming the agent can do real-world work is the
  // only harmful misclassification.
  for (const p of HUMAN_PATTERNS) if (p.test(text)) return "HUMAN";
  for (const p of AGENT_PATTERNS) if (p.test(text)) return "AGENT";
  return "HUMAN";
}
