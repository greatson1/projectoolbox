/**
 * Type-only file extracted so research-query-builder doesn't need to
 * import the heavy feasibility-research module (which would create a
 * circular dependency).
 */

export interface ProjectContext {
  id?: string;
  name: string;
  description: string | null;
  category: string | null;
  budget: number | null;
  startDate: Date | string | null;
  endDate: Date | string | null;
  methodology?: string | null;
}
