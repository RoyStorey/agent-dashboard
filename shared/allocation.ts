import { CUSTOM_BUDGET_WEIGHT, findTemplate } from "./templates.ts";
import type { Agent, AllocationSettings, Cents } from "./types.ts";

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

export function defaultWeight(a: AgentLike): number {
  const t = findTemplate(a.role);
  return t ? t.budgetWeight : CUSTOM_BUDGET_WEIGHT;
}

export function weightFor(a: AgentLike, settings: AllocationSettings): number {
  const w = settings.weights[a.id];
  return w !== undefined ? w : defaultWeight(a);
}

export function reasonFor(a: AgentLike): string {
  return findTemplate(a.role)?.budgetReason ?? "Custom agent with spending actions.";
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
}): AllocationPlan {
  const { agents, settings, availableCents, cashBalanceCents } = input;
  const reserveCents = Math.max(0, Math.round((Math.max(0, cashBalanceCents) * settings.reserveBps) / 10_000));
  const poolCents = Math.max(0, availableCents);
  const distributableCents = Math.max(0, poolCents - reserveCents);

  const eligible = agents
    .filter((a) => a.status !== "paused" && canSpend(a))
    .map((a) => ({ a, weight: Math.max(0, weightFor(a, settings)) }))
    .filter((x) => x.weight > 0);
  const totalWeight = eligible.reduce((s, x) => s + x.weight, 0);

  if (totalWeight === 0 || distributableCents === 0) {
    return {
      poolCents,
      reserveCents,
      distributableCents,
      lines: eligible.map(({ a, weight }) => ({ agentId: a.id, weight, shareBps: totalWeight ? Math.round((weight * 10_000) / totalWeight) : 0, addCents: 0, reason: reasonFor(a) })),
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
      reason: reasonFor(x.a),
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
}): RebalancePlan {
  const { agents, settings, cashBalanceCents, finance } = input;
  const fin = (id: string) => finance.find((f) => f.agentId === id) ?? { agentId: id, budgetCents: 0, spentCents: 0, remainingCents: 0 };
  const locked = agents.filter((a) => a.status === "paused");
  const lockedRemaining = locked.reduce((s, a) => s + fin(a.id).remainingCents, 0);
  const reserveCents = Math.max(0, Math.round((Math.max(0, cashBalanceCents) * settings.reserveBps) / 10_000));
  const distributableCents = Math.max(0, cashBalanceCents - lockedRemaining - reserveCents);

  const open = agents.filter((a) => a.status !== "paused");
  const plan = planAllocation({ agents: open, settings, availableCents: distributableCents, cashBalanceCents: 0 });

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
          ? reasonFor(a)
          : canSpend(a)
            ? "Weight is 0, so it gets no new money."
            : "Has no spending actions, so it needs no budget.",
      locked: isLocked,
    };
  });
  return { cashBalanceCents, reserveCents, distributableCents, lines };
}
