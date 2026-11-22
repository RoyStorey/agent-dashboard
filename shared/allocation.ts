import { CUSTOM_BUDGET_WEIGHT, findTemplate } from "./templates.ts";
import type { Agent, AllocationSettings, Cents, FulfillmentMode } from "./types.ts";

/** What the recommended shares depend on: how you ship and where you mainly sell. */
export interface AllocationSetup {
  fulfillmentMode: FulfillmentMode | null;
  primaryChannel: string | null;
}

export const RECOMMENDED_RESERVE_BPS = 1500;

export interface AllocationLine {
  agentId: string;
  weight: number;
  shareBps: number;
  addCents: Cents;
  reason: string;
}

export interface AllocationPlan {
  poolCents: Cents;
  reserveCents: Cents;
  distributableCents: Cents;
  lines: AllocationLine[];
}

type AgentLike = Pick<Agent, "id" | "role" | "status" | "actions" | "guardrails">;

/** Agents that can actually spend money (have an allowed spending action). */
export function canSpend(a: AgentLike): boolean {
  return a.actions.some((x) => x.spends && a.guardrails.allowedActions.includes(x.key));
}

/**
 * The recommended share for an agent: a fixed starting point per job,
 * adjusted for how you ship and where you mainly sell. These are rules of
 * thumb for a new store, not a calculation from your data.
 */
export function recommendedWeight(a: AgentLike, setup?: AllocationSetup): { weight: number; reason: string } {
  const t = findTemplate(a.role);
  if (!t) return { weight: CUSTOM_BUDGET_WEIGHT, reason: "Custom agent with spending actions." };
  if (a.role === "inventory" && setup?.fulfillmentMode === "self") {
    return { weight: 10, reason: "Packing supplies and stock reorders; no warehouse freight because you ship yourself." };
  }
  if (a.role === "marketing" && setup?.primaryChannel === "shopify") {
    return { weight: 25, reason: "Your own store has no built-in shoppers, so ads bring the first visitors." };
  }
  if (a.role === "marketing" && setup?.primaryChannel === "etsy") {
    return { weight: 15, reason: "Etsy brings its own shoppers; ads are a boost rather than a must." };
  }
  return { weight: t.budgetWeight, reason: t.budgetReason };
}

export function defaultWeight(a: AgentLike, setup?: AllocationSetup): number {
  return recommendedWeight(a, setup).weight;
}

export function weightFor(a: AgentLike, settings: AllocationSettings, setup?: AllocationSetup): number {
  const w = settings.weights[a.id];
  return w !== undefined ? w : defaultWeight(a, setup);
}

export function reasonFor(a: AgentLike, setup?: AllocationSetup): string {
  return recommendedWeight(a, setup).reason;
}

/**
 * Splits `availableCents` (normally the unallocated cash) across agents that
 * can spend, keeping `reserveBps` of total cash back. Uses the largest
 * remainder method so the parts always add up exactly.
 */
export function planAllocation(input: {
  agents: AgentLike[];
  settings: AllocationSettings;
  availableCents: Cents;
  cashBalanceCents: Cents;
  setup?: AllocationSetup;
}): AllocationPlan {
  const { agents, settings, availableCents, cashBalanceCents, setup } = input;
  const reserveCents = Math.max(0, Math.round((Math.max(0, cashBalanceCents) * settings.reserveBps) / 10_000));
  const poolCents = Math.max(0, availableCents);
  const distributableCents = Math.max(0, poolCents - reserveCents);

  const eligible = agents
    .filter((a) => a.status !== "paused" && canSpend(a))
    .map((a) => ({ a, weight: Math.max(0, weightFor(a, settings, setup)) }))
    .filter((x) => x.weight > 0);
  const totalWeight = eligible.reduce((s, x) => s + x.weight, 0);

  if (totalWeight === 0 || distributableCents === 0) {
    return {
      poolCents,
      reserveCents,
      distributableCents,
      lines: eligible.map(({ a, weight }) => ({ agentId: a.id, weight, shareBps: totalWeight ? Math.round((weight * 10_000) / totalWeight) : 0, addCents: 0, reason: reasonFor(a, setup) })),
    };
  }

  const raw = eligible.map(({ a, weight }) => {
    const exact = (distributableCents * weight) / totalWeight;
    return { a, weight, floor: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let leftover = distributableCents - raw.reduce((s, x) => s + x.floor, 0);
  const order = [...raw].sort((x, y) => y.rem - x.rem || y.weight - x.weight);
  for (const x of order) {
    if (leftover <= 0) break;
    x.floor += 1;
    leftover -= 1;
  }

  return {
    poolCents,
    reserveCents,
    distributableCents,
    lines: raw.map((x) => ({
      agentId: x.a.id,
      weight: x.weight,
      shareBps: Math.round((x.weight * 10_000) / totalWeight),
      addCents: x.floor,
      reason: reasonFor(x.a, setup),
    })),
  };
}

export interface RebalanceLine {
  agentId: string;
  currentBudgetCents: Cents;
  spentCents: Cents;
  newBudgetCents: Cents;
  deltaCents: Cents;
  shareBps: number;
  reason: string;
  locked: boolean;
}

export interface RebalancePlan {
  cashBalanceCents: Cents;
  reserveCents: Cents;
  distributableCents: Cents;
  lines: RebalanceLine[];
}

/**
 * Re-splits all unspent money (unspent budgets + unallocated cash, minus the
 * reserve) across agents by weight. Paused agents keep what they have.
 * A budget never drops below what the agent has already spent or reserved.
 */
export function planRebalance(input: {
  agents: AgentLike[];
  settings: AllocationSettings;
  cashBalanceCents: Cents;
  finance: Array<{ agentId: string; budgetCents: Cents; spentCents: Cents; remainingCents: Cents }>;
  setup?: AllocationSetup;
}): RebalancePlan {
  const { agents, settings, cashBalanceCents, finance, setup } = input;
  const fin = (id: string) => finance.find((f) => f.agentId === id) ?? { agentId: id, budgetCents: 0, spentCents: 0, remainingCents: 0 };
  const locked = agents.filter((a) => a.status === "paused");
  const lockedRemaining = locked.reduce((s, a) => s + fin(a.id).remainingCents, 0);
  const reserveCents = Math.max(0, Math.round((Math.max(0, cashBalanceCents) * settings.reserveBps) / 10_000));
  const distributableCents = Math.max(0, cashBalanceCents - lockedRemaining - reserveCents);

  const open = agents.filter((a) => a.status !== "paused");
  const plan = planAllocation({ agents: open, settings, availableCents: distributableCents, cashBalanceCents: 0, setup });

  const lines: RebalanceLine[] = agents.map((a) => {
    const f = fin(a.id);
    const isLocked = a.status === "paused";
    const line = plan.lines.find((l) => l.agentId === a.id);
    const newBudget = isLocked ? f.budgetCents : f.spentCents + (line?.addCents ?? 0);
    return {
      agentId: a.id,
      currentBudgetCents: f.budgetCents,
      spentCents: f.spentCents,
      newBudgetCents: newBudget,
      deltaCents: newBudget - f.budgetCents,
      shareBps: line?.shareBps ?? 0,
      reason: isLocked
        ? "Paused: keeps its current budget."
        : line
          ? reasonFor(a, setup)
          : canSpend(a)
            ? "Weight is 0, so it gets no new money."
            : "Has no spending actions, so it needs no budget.",
      locked: isLocked,
    };
  });
  return { cashBalanceCents, reserveCents, distributableCents, lines };
}

export function setupOf(b: { fulfillmentMode: FulfillmentMode | null; channels: string[] }): AllocationSetup {
  return { fulfillmentMode: b.fulfillmentMode, primaryChannel: b.channels[0] ?? null };
}
