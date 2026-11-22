import type { ActionRequest, AgentFinance, DashboardState, FinanceSummary } from "../shared/types.ts";

/** Money a request has actually committed (reserved or spent). */
export function committedCents(req: ActionRequest): number {
  if (req.status === "approved") return req.amountCents;
  if (req.status === "completed") return req.actualAmountCents ?? req.amountCents;
  return 0;
}

export function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function sumSince(requests: ActionRequest[], since: Date, agentId?: string): number {
  const t = since.getTime();
  let total = 0;
  for (const r of requests) {
    if (agentId !== undefined && r.agentId !== agentId) continue;
    if (new Date(r.createdAt).getTime() < t) continue;
    total += committedCents(r);
  }
  return total;
}

export function agentSpent(state: DashboardState, agentId: string): number {
  let total = 0;
  for (const r of state.requests) if (r.agentId === agentId) total += committedCents(r);
  return total;
}

export function agentSpentToday(state: DashboardState, agentId: string, now: Date): number {
  return sumSince(state.requests, startOfDay(now), agentId);
}

export function spentToday(state: DashboardState, now: Date): number {
  return sumSince(state.requests, startOfDay(now));
}

export function spentThisMonth(state: DashboardState, now: Date): number {
  return sumSince(state.requests, startOfMonth(now));
}

export function computeFinance(state: DashboardState, now: Date): FinanceSummary {
  let depositedCents = 0;
  let withdrawnCents = 0;
  let revenueCents = 0;
  for (const f of state.funding) {
    if (f.type === "deposit") depositedCents += f.amountCents;
    else if (f.type === "withdrawal") withdrawnCents += f.amountCents;
    else revenueCents += f.amountCents;
  }
  let spentCents = 0;
  for (const r of state.requests) spentCents += committedCents(r);

  const agents: AgentFinance[] = state.agents.map((a) => {
    const spent = agentSpent(state, a.id);
    return {
      agentId: a.id,
      budgetCents: a.budgetCents,
      spentCents: spent,
      remainingCents: Math.max(0, a.budgetCents - spent),
      spentTodayCents: agentSpentToday(state, a.id, now),
    };
  });
  const allocatedRemainingCents = agents.reduce((s, a) => s + a.remainingCents, 0);
  const cashBalanceCents = depositedCents - withdrawnCents + revenueCents - spentCents;

  return {
    depositedCents,
    withdrawnCents,
    revenueCents,
    spentCents,
    cashBalanceCents,
    allocatedRemainingCents,
    unallocatedCents: cashBalanceCents - allocatedRemainingCents,
    spentTodayCents: spentToday(state, now),
    spentThisMonthCents: spentThisMonth(state, now),
    profitCents: revenueCents - spentCents,
    agents,
  };
}
