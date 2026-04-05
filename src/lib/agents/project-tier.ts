/**
 * Project Tier System
 *
 * Auto-detects project complexity from budget, duration, and task count.
 * Scales agent behaviour: phases, artefacts, EVM, reporting cadence.
 *
 * Tiers:
 *   TASK        — <5 tasks, no budget, <2 weeks. Simple to-do tracking.
 *   LIGHTWEIGHT — <£50K or <8 weeks. Plan + Execute only. Weekly status.
 *   STANDARD    — £50K-£500K or 2-12 months. Full lifecycle.
 *   COMPLEX     — >£500K or >12 months. Full + portfolio, exec reports.
 */

export type ProjectTier = "TASK" | "LIGHTWEIGHT" | "STANDARD" | "COMPLEX";

export interface TierConfig {
  tier: ProjectTier;
  label: string;
  description: string;
  // Lifecycle
  phasesEnabled: boolean;
  phaseGatesEnabled: boolean;
  maxPhases: number;
  // Artefacts
  generateCharter: boolean;
  generateWBS: boolean;
  generateGantt: boolean;
  generateRiskRegister: boolean;
  generateCommsplan: boolean;
  generateHighlightReports: boolean;
  generateClosureReport: boolean;
  // Monitoring
  evmEnabled: boolean;
  ragEnabled: boolean;
  scorecardEnabled: boolean;
  reportingCadence: "none" | "weekly" | "fortnightly" | "monthly";
  // Agent behaviour
  autonomousCycleMinutes: number;
  proactiveAlertsEnabled: boolean;
  stakeholderCommsEnabled: boolean;
  pestelEnabled: boolean;
}

const TIER_CONFIGS: Record<ProjectTier, TierConfig> = {
  TASK: {
    tier: "TASK",
    label: "Quick Task",
    description: "Simple task tracking — no formal project management overhead",
    phasesEnabled: false,
    phaseGatesEnabled: false,
    maxPhases: 0,
    generateCharter: false,
    generateWBS: false,
    generateGantt: false,
    generateRiskRegister: false,
    generateCommsplan: false,
    generateHighlightReports: false,
    generateClosureReport: false,
    evmEnabled: false,
    ragEnabled: false,
    scorecardEnabled: false,
    reportingCadence: "none",
    autonomousCycleMinutes: 60, // Check every hour, not every 10 min
    proactiveAlertsEnabled: false,
    stakeholderCommsEnabled: false,
    pestelEnabled: false,
  },
  LIGHTWEIGHT: {
    tier: "LIGHTWEIGHT",
    label: "Lightweight Project",
    description: "Simplified project management — plan, execute, close",
    phasesEnabled: true,
    phaseGatesEnabled: false, // No formal gates
    maxPhases: 3, // Plan → Execute → Close
    generateCharter: true,
    generateWBS: true,
    generateGantt: false, // Simple task list, no Gantt
    generateRiskRegister: true,
    generateCommsplan: false,
    generateHighlightReports: true,
    generateClosureReport: true,
    evmEnabled: false, // No EVM for small projects
    ragEnabled: true,
    scorecardEnabled: false,
    reportingCadence: "weekly",
    autonomousCycleMinutes: 30,
    proactiveAlertsEnabled: true,
    stakeholderCommsEnabled: false,
    pestelEnabled: false,
  },
  STANDARD: {
    tier: "STANDARD",
    label: "Standard Project",
    description: "Full project management lifecycle with all controls",
    phasesEnabled: true,
    phaseGatesEnabled: true,
    maxPhases: 10,
    generateCharter: true,
    generateWBS: true,
    generateGantt: true,
    generateRiskRegister: true,
    generateCommsplan: true,
    generateHighlightReports: true,
    generateClosureReport: true,
    evmEnabled: true,
    ragEnabled: true,
    scorecardEnabled: true,
    reportingCadence: "weekly",
    autonomousCycleMinutes: 10,
    proactiveAlertsEnabled: true,
    stakeholderCommsEnabled: true,
    pestelEnabled: true,
  },
  COMPLEX: {
    tier: "COMPLEX",
    label: "Complex / Programme",
    description: "Enterprise-grade with portfolio roll-up and executive reporting",
    phasesEnabled: true,
    phaseGatesEnabled: true,
    maxPhases: 20,
    generateCharter: true,
    generateWBS: true,
    generateGantt: true,
    generateRiskRegister: true,
    generateCommsplan: true,
    generateHighlightReports: true,
    generateClosureReport: true,
    evmEnabled: true,
    ragEnabled: true,
    scorecardEnabled: true,
    reportingCadence: "weekly",
    autonomousCycleMinutes: 10,
    proactiveAlertsEnabled: true,
    stakeholderCommsEnabled: true,
    pestelEnabled: true,
  },
};

/**
 * Auto-detect project tier from budget, duration, and task count.
 */
export function detectProjectTier(params: {
  budget?: number | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  taskCount?: number;
}): ProjectTier {
  const budget = params.budget || 0;
  const taskCount = params.taskCount || 0;

  // Duration in weeks
  let durationWeeks = 0;
  if (params.startDate && params.endDate) {
    const start = new Date(params.startDate);
    const end = new Date(params.endDate);
    durationWeeks = Math.max(0, (end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
  }

  // TASK: no budget, few tasks, short duration
  if (budget === 0 && taskCount < 5 && durationWeeks < 2) return "TASK";

  // COMPLEX: large budget or long duration
  if (budget > 500000 || durationWeeks > 52) return "COMPLEX";

  // STANDARD: medium budget or medium duration
  if (budget >= 50000 || durationWeeks >= 8) return "STANDARD";

  // LIGHTWEIGHT: everything else
  return "LIGHTWEIGHT";
}

/**
 * Get the tier configuration for a given tier.
 */
export function getTierConfig(tier: ProjectTier): TierConfig {
  return TIER_CONFIGS[tier] || TIER_CONFIGS.STANDARD;
}

/**
 * Get tier config for a project from its data.
 */
export function getProjectTierConfig(project: {
  tier?: string | null;
  budget?: number | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
}): TierConfig {
  const tier = (project.tier as ProjectTier) || detectProjectTier(project);
  return getTierConfig(tier);
}

/**
 * Get LLM system prompt modifier based on tier.
 * Injected into the agent's system prompt to adapt behaviour.
 */
export function getTierPromptModifier(tier: ProjectTier): string {
  switch (tier) {
    case "TASK":
      return `PROJECT TIER: Quick Task. This is a simple task, NOT a formal project. Do NOT generate project charters, WBS, Gantt charts, EVM reports, or phase gates. Simply track tasks to completion. Keep responses brief and action-oriented. No PM ceremony.`;

    case "LIGHTWEIGHT":
      return `PROJECT TIER: Lightweight Project. This is a small project. Use simplified project management: create a brief plan, track tasks, manage basic risks, send weekly status updates. Do NOT generate EVM metrics, formal phase gate packages, or PESTLE scans. Keep overhead minimal.`;

    case "STANDARD":
      return `PROJECT TIER: Standard Project. Use full project management lifecycle. Generate all required artefacts, track EVM, manage phase gates, engage stakeholders, and produce regular reports. This is the default PM approach.`;

    case "COMPLEX":
      return `PROJECT TIER: Complex / Programme. This is a major initiative requiring enterprise-grade management. Generate comprehensive artefacts, detailed EVM with forecasting, executive-level reports, and cross-project dependency awareness. Consider portfolio-level impacts in all decisions.`;
  }
}
