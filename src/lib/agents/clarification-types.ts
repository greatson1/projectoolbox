/**
 * Shared types for the clarification session machinery. Lives in its own
 * file so pure helpers (phrase-tbc-question, future siblings) can import
 * them without pulling Prisma in through clarification-session.ts.
 */

export type QuestionType =
  | "text"       // free text — name, venue, description
  | "choice"     // single select from a list of options
  | "multi"      // pick several from a list
  | "yesno"      // simple yes / no
  | "number"     // numeric value (budget, count, etc.)
  | "date";      // a specific date
