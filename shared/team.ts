import type { AgentRuntime, AgentSchedule, Phase } from "./types.ts";

export const PHASES: Phase[] = ["research", "sourcing", "store", "launch", "operate"];

export const PHASE_LABEL: Record<Phase, string> = {
  research: "Research",
  sourcing: "Sourcing & samples",
  store: "Build the store",
  launch: "Launch",
  operate: "Run & grow",
};

export const PHASE_GOAL: Record<Phase, string> = {
  research: "Confirm the product, customers and numbers.",
  sourcing: "Find a certified supplier, get quotes and order samples.",
  store: "Create product listings and store pages as drafts for the owner to approve.",
  launch: "Go live: publish approved listings and start a small ad test.",
  operate: "Fulfil orders, keep stock up, watch margins and improve.",
};

/** Which phase each role starts working in. Before that it stays idle, at no cost. */
export const ROLE_FIRST_PHASE: Record<string, Phase> = {
  orchestrator: "research",
  research: "research",
  sourcing: "sourcing",
  finance: "sourcing",
  storefront: "store",
  inventory: "store",
  marketing: "launch",
  support: "launch",
  custom: "research",
};

export function phaseIndex(p: Phase): number {
  return PHASES.indexOf(p);
}

export function roleActiveIn(role: string, phase: Phase): boolean {
  return phaseIndex(phase) >= phaseIndex(ROLE_FIRST_PHASE[role] ?? "research");
}

/**
 * How often each role checks for new work. Checks are free; a model call
 * only happens when something changed for that agent.
 */
export const DEFAULT_SCHEDULE_MINUTES: Record<string, number> = {
  orchestrator: 360,
  research: 1440,
  sourcing: 720,
  storefront: 360,
  inventory: 240,
  finance: 1440,
  marketing: 1440,
  support: 240,
  custom: 1440,
};

export const SCHEDULE_CHOICES: Array<{ minutes: number; label: string }> = [
  { minutes: 60, label: "every hour" },
  { minutes: 120, label: "every 2 hours" },
  { minutes: 240, label: "every 4 hours" },
  { minutes: 360, label: "every 6 hours" },
  { minutes: 720, label: "twice a day" },
  { minutes: 1440, label: "daily" },
  { minutes: 10080, label: "weekly" },
];

export function defaultSchedule(role: string): AgentSchedule {
  return { enabled: true, everyMinutes: DEFAULT_SCHEDULE_MINUTES[role] ?? 1440 };
}

export function idleRuntime(): AgentRuntime {
  return { state: "idle", step: null, runId: null, since: null, lastRunAt: null, lastCheckedAt: null, lastSkip: null, nextCheckAt: null };
}

/**
 * How hard each role thinks and how many steps a run may take. Routine
 * roles use low effort; planning, research and writing use medium.
 */
export const ROLE_BUDGET: Record<string, { effort: "low" | "medium" | "high"; maxIterations: number; maxTokens: number; webSearches: number }> = {
  orchestrator: { effort: "medium", maxIterations: 6, maxTokens: 4000, webSearches: 0 },
  research: { effort: "medium", maxIterations: 8, maxTokens: 4000, webSearches: 4 },
  sourcing: { effort: "medium", maxIterations: 8, maxTokens: 4000, webSearches: 4 },
  storefront: { effort: "medium", maxIterations: 8, maxTokens: 6000, webSearches: 0 },
  marketing: { effort: "medium", maxIterations: 6, maxTokens: 4000, webSearches: 3 },
  inventory: { effort: "low", maxIterations: 5, maxTokens: 3000, webSearches: 0 },
  finance: { effort: "low", maxIterations: 5, maxTokens: 3000, webSearches: 0 },
  support: { effort: "low", maxIterations: 4, maxTokens: 3000, webSearches: 0 },
  custom: { effort: "medium", maxIterations: 6, maxTokens: 4000, webSearches: 0 },
};

export function roleBudget(role: string) {
  return ROLE_BUDGET[role] ?? ROLE_BUDGET.custom!;
}
