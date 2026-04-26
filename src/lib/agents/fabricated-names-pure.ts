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
