/**
 * Waitlist signup name shape validator.
 *
 * Real names almost always either contain whitespace ("First Last") or are
 * short single words ("Madonna", "Bono", "Cher"). Bot-stuffed waitlist
 * names tend to be long no-space strings of mixed-case random letters —
 * see the live cases that prompted this guard: "ccBLBPrVViYauVjkl",
 * "aPahulVDDWRyOuiW", "fCIUZyVRixYcTNpmRJRD".
 *
 * This function is pure so it's unit-testable without standing up a
 * route. Used by /api/waitlist POST to reject the obvious garbage before
 * it lands in the DB.
 */

export function looksLikeRandomName(input: string | null | undefined): boolean {
  if (!input) return false;
  const name = input.trim();
  if (name.length === 0) return false;

  // Names with whitespace are almost always legitimate. False positives on
  // a "First Last" rule are too damaging to tolerate, so we let them through
  // even if each word looks unusual.
  if (/\s/.test(name)) return false;

  // Short single-word names (Madonna, Bono, Cher, JoAnne) are common and
  // legitimate. Anything under 8 chars passes regardless of shape.
  if (name.length < 8) return false;

  // Case-transition density. Real long single-word names have at most a
  // few case changes (e.g. "MacDonald" = 2, "McGregor" = 2). Random
  // mixed-case strings flip case many times — "ccBLBPrVViYauVjkl" has 8
  // in 17 chars. Four or more transitions in a no-space string with
  // length ≥ 8 is the bot signature.
  let transitions = 0;
  for (let i = 1; i < name.length; i++) {
    const prev = name[i - 1];
    const curr = name[i];
    if (!/[a-zA-Z]/.test(prev) || !/[a-zA-Z]/.test(curr)) continue;
    if ((prev === prev.toLowerCase() && curr === curr.toUpperCase()) ||
        (prev === prev.toUpperCase() && curr === curr.toLowerCase())) {
      transitions++;
    }
  }
  if (transitions >= 4) return true;

  // Pure-consonant runs of 6+ characters are vanishingly rare in human
  // language. Bot strings often produce them because they sample letters
  // uniformly rather than respecting consonant-vowel alternation.
  if (/[bcdfghjklmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ]{6,}/.test(name)) return true;

  return false;
}

/**
 * Public-friendly error message for the API response when a name is
 * rejected. Deliberately vague — we don't want to leak the detection
 * heuristics back to a bot author.
 */
export const RANDOM_NAME_ERROR =
  "Please enter your real first name (and surname if you have one) so we know who's joining.";
