import { planAllocation, planRebalance, setupOf } from "../shared/allocation.ts";
import { formatCents } from "../shared/money.ts";
import type { DashboardState } from "../shared/types.ts";
import { computeFinance } from "./finance.ts";
import { log } from "./store.ts";

/**
 * Splits unallocated cash (above the reserve) across agents by weight.
 * Only ever adds to budgets, so manual adjustments are kept.
 */
export function autoAllocate(s: DashboardState, now: Date, trigger: "deposit" | "revenue" | "manual"): number {
  const f = computeFinance(s, now);
  const plan = planAllocation({ agents: s.agents, settings: s.allocation, availableCents: f.unallocatedCents, cashBalanceCents: f.cashBalanceCents, setup: setupOf(s.business) });
  let total = 0;
  const parts: string[] = [];
  for (const line of plan.lines) {
    if (line.addCents <= 0) continue;
    const agent = s.agents.find((a) => a.id === line.agentId);
    if (!agent) continue;
    agent.budgetCents += line.addCents;
    total += line.addCents;
    parts.push(`${agent.name} +${formatCents(line.addCents)}`);
  }
  if (total > 0) {
    const why = trigger === "deposit" ? "new deposit" : trigger === "revenue" ? "new revenue" : "your request";
    log(s, "System", "info", `Auto-allocated ${formatCents(total)} from ${why} (keeping ${formatCents(plan.reserveCents)} in reserve): ${parts.join(", ")}.`, now);
  }
  return total;
}

/** Applies a full rebalance of unspent money. Returns the number of budgets changed. */
export function applyRebalance(s: DashboardState, now: Date): number {
  const f = computeFinance(s, now);
  const plan = planRebalance({ agents: s.agents, settings: s.allocation, cashBalanceCents: f.cashBalanceCents, finance: f.agents, setup: setupOf(s.business) });
  let changed = 0;
  const parts: string[] = [];
  for (const line of plan.lines) {
    if (line.deltaCents === 0) continue;
    const agent = s.agents.find((a) => a.id === line.agentId);
    if (!agent) continue;
    agent.budgetCents = line.newBudgetCents;
    changed++;
    parts.push(`${agent.name} ${line.deltaCents > 0 ? "+" : "−"}${formatCents(Math.abs(line.deltaCents))}`);
  }
  if (changed > 0) {
    log(s, "Owner", "info", `Rebalanced budgets (reserve ${formatCents(plan.reserveCents)}): ${parts.join(", ")}.`, now);
  }
  return changed;
}
