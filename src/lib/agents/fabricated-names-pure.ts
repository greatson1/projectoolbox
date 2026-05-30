/**
 * Pure half of fabricated-name detection — no Prisma client, safe to test
 * in isolation. The KB-aware async variant lives in fabricated-names.ts
 * and is the right import for production code paths that already have
 * the DB available.
 */

const ROLE_KEYWORDS =
  /\b(manager|lead|director|sponsor|owner|team|member|representative|analyst|head|officer|coordinator|chair|agent|provider|supplier|contractor|partner|client|user|stakeholder|body|department|commission|authority|board|council|ministry|traveller|family|spouse|child|parent|guardian|companion|host|contact|emergency|insurance|airline|hotel|agency|primary|secondary|self|tbd|unassigned)\b/i;

const ORG_KEYWORDS =
  /\b(ltd|inc|corp|llc|plc|gmbh|airlines?|hotel|resort|clinic|hospital|bank|airways|ventures?|group|services?|solutions?|systems?|consultancy|consulting|agency|centre|center|commission|embassy|high commission|authority|department|ministry)\b/i;

export function looksLikeFabricatedName(s: string | null | undefined): boolean {
  if (!s) return false;
  const trimmed = s.trim();
  if (!trimmed) return false;
  if (ROLE_KEYWORDS.test(trimmed)) return false;
  if (ORG_KEYWORDS.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every(w => /^[A-Z][a-z]+/.test(w));
}

// Placeholder phrases that capitalised-word regexes will happily accept as
// "names" (e.g. "Sponsor: To Be Assigned" → "To Be Assigned" passes the
// FirstName-LastName pattern). These must NEVER reach the Stakeholder
// table — they're either filler text from an artefact draft or a deploy-
// wizard field the user left blank with a default.
const PLACEHOLDER_NAME_PATTERNS = [
  /^t[\s.]*b[\s.]*[adc]\.?$/i,                   // TBD / TBA / TBC / T.B.D. / T B D
  /^to\s+be\s+(assigned|confirmed|decided|determined|announced|named|hired|appointed)$/i,
  /^(not|un|yet)\s+assigned$/i,
  /^unassigned$/i,
  /^pending(\s+(assignment|approval|review|confirmation|hire|appointment))?$/i,
  /^awaiting\s+(approval|confirmation|assignment|review|hire|appointment)$/i,
  /^placeholder$/i,
  /^name\s+(here|tbc|pending)$/i,
  /^\[?(tbc|tba|tbd|n\/a|na|none|null|nil)\]?$/i,
];

// Category nouns that occasionally get scraped as "names" by the harvester
// when an artefact says "Sponsor: Approval Dependencies" or similar.
// These words being present anywhere in the candidate string is enough to
// reject it as a person — they describe process/governance areas, not
// people.
const CATEGORY_NOUN_REGEX =
  /\b(dependencies|dependency|approvals?|requirements?|deliverables?|milestones?|baselines?|escalations?|exceptions?|deviations?|stakeholders?|prerequisites?|prereqs?|criteria|conditions?|standards?|policies|procedures?|frameworks?|guidelines?|principles?|gates?|thresholds?|tolerances?)\b/i;

/**
 * True when the candidate string is a placeholder, category noun, or
 * other clearly-non-person value that nonetheless passes the
 * capitalised-word regex used by stakeholder-extractor harvesters.
 *
 * Use BEFORE looksLikeFabricatedName in any code path that might persist
 * a Stakeholder row from harvested content OR from user-supplied form
 * input — a user typing "To Be Assigned" into the deploy wizard's
 * sponsor field should not produce a stakeholder named "To Be Assigned".
 */
export function looksLikePlaceholderName(s: string | null | undefined): boolean {
  if (!s) return false;
  const trimmed = s.trim();
  if (!trimmed) return false;
  // Empty after collapsing all non-alphanumerics → reject.
  if (!/[A-Za-z]/.test(trimmed)) return true;
  for (const re of PLACEHOLDER_NAME_PATTERNS) {
    if (re.test(trimmed)) return true;
  }
  if (CATEGORY_NOUN_REGEX.test(trimmed)) return true;
  return false;
}
