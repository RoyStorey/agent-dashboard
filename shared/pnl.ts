import { unitBreakdown } from "./economics.ts";
import { actionCategory } from "./templates.ts";
import type { ActionRequest, Agent, AiUsageEntry, Cents, FundingEntry, SpendCategory, UnitEconomics } from "./types.ts";

export type Period = "this_month" | "last_month" | "last_30" | "all";

export const PERIOD_LABEL: Record<Period, string> = {
  this_month: "This month",
  last_month: "Last month",
  last_30: "Last 30 days",
  all: "All time",
};

export function periodRange(period: Period, now: Date, earliest: Date | null): { start: Date; end: Date } {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case "this_month":
      return { start: new Date(y, m, 1), end: now };
    case "last_month":
      return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
    case "last_30":
      return { start: new Date(now.getTime() - 30 * 86_400_000), end: now };
    case "all":
      return { start: earliest ?? now, end: now };
  }
}

export function committed(r: ActionRequest): Cents {
  if (r.status === "approved") return r.amountCents;
  if (r.status === "completed") return r.actualAmountCents ?? r.amountCents;
  return 0;
}

export const SPEND_LABEL: Record<SpendCategory, string> = {
  inventory: "Inventory purchases",
  samples: "Samples & product development",
  shipping: "Freight & fulfillment shipping",
  advertising: "Advertising & creative",
  refunds: "Refunds issued by agents",
  software: "Software & data",
  fees: "Fees",
  other: "Other expenses",
};

export interface PnL {
  period: Period;
  start: string;
  end: string;
  days: number;
  /* Sales */
  unitsSold: number;
  grossSales: Cents;
  refunds: Cents;
  netSales: Cents;
  /* Cost of goods */
  cogs: Cents;
  cogsMethod: "unit_cost" | "cash_purchases";
  grossProfit: Cents;
  grossMarginBps: number | null;
  /* Operating expenses */
  marketplaceFees: Cents;
  shipping: Cents;
  advertising: Cents;
  samples: Cents;
  software: Cents;
  other: Cents;
  /** Estimated AI model usage reported by agents and research. */
  aiUsage: Cents;
  fixedOverhead: Cents;
  totalOpex: Cents;
  netProfit: Cents;
  netMarginBps: number | null;
  /* Cash */
  deposits: Cents;
  withdrawals: Cents;
  payouts: Cents;
  spendByCategory: Record<SpendCategory, Cents>;
  totalSpend: Cents;
  netCashFlow: Cents;
  inventoryPurchased: Cents;
  /* KPIs */
  averageSellingPrice: Cents | null;
  refundRateBps: number | null;
  tacosBps: number | null;
  /** Blended return on ad spend, in hundredths (250 = 2.50x). */
  roasX100: number | null;
  avgDailySpend: Cents;
}

function inRange(iso: string, start: Date, end: Date): boolean {
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t < end.getTime() + 1;
}

/**
 * Profit & loss for a period.
 * - Revenue comes from revenue entries (gross/refunds/fees when reported; otherwise the payout is treated as gross).
 * - COGS = units sold × planned landed cost per unit when both are known; otherwise inventory cash purchased in the period.
 * - Fixed overhead is the monthly figure from the plan, prorated by days.
 */
export function computePnL(input: {
  funding: FundingEntry[];
  requests: ActionRequest[];
  agents: Pick<Agent, "id" | "actions">[];
  economics: UnitEconomics;
  period: Period;
  now: Date;
  aiUsage?: Pick<AiUsageEntry, "at" | "costCents">[];
}): PnL {
  const { funding, requests, agents, economics, period, now } = input;
  const times = [...funding.map((f) => f.createdAt), ...requests.map((r) => r.createdAt)].map((t) => new Date(t).getTime());
  const earliest = times.length > 0 ? new Date(Math.min(...times)) : null;
  const { start, end } = periodRange(period, now, earliest);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));

  let unitsSold = 0;
  let grossSales = 0;
  let refunds = 0;
  let marketplaceFees = 0;
  let deposits = 0;
  let withdrawals = 0;
  let payouts = 0;
  for (const f of funding) {
    if (!inRange(f.createdAt, start, end)) continue;
    if (f.type === "deposit") deposits += f.amountCents;
    else if (f.type === "withdrawal") withdrawals += f.amountCents;
    else {
      payouts += f.amountCents;
      const fees = f.feesCents ?? 0;
      const ref = f.refundsCents ?? 0;
      grossSales += f.grossSalesCents ?? f.amountCents + fees + ref;
      refunds += ref;
      marketplaceFees += fees;
      unitsSold += f.unitsSold ?? 0;
    }
  }

  const spendByCategory: Record<SpendCategory, Cents> = {
    inventory: 0,
    samples: 0,
    shipping: 0,
    advertising: 0,
    refunds: 0,
    software: 0,
    fees: 0,
    other: 0,
  };
  for (const r of requests) {
    const amount = committed(r);
    if (amount === 0 || !inRange(r.createdAt, start, end)) continue;
    const def = agents.find((a) => a.id === r.agentId)?.actions.find((a) => a.key === r.action);
    spendByCategory[actionCategory(def, r.action)] += amount;
  }
  const totalSpend = Object.values(spendByCategory).reduce((a, b) => a + b, 0);

  refunds += spendByCategory.refunds;
  marketplaceFees += spendByCategory.fees;
  const netSales = grossSales - refunds;

  const landed = unitBreakdown(economics).landedCost;
  const useUnitCost = unitsSold > 0 && landed > 0;
  const cogs = useUnitCost ? unitsSold * landed : spendByCategory.inventory;
  const grossProfit = netSales - cogs;

  const fixedOverhead = Math.round((economics.fixedMonthlyCents * days) / 30);
  let aiUsage = 0;
  for (const u of input.aiUsage ?? []) if (inRange(u.at, start, end)) aiUsage += u.costCents;
  // When COGS is estimated from units, inventory purchases are an asset (cash), not an expense.
  const totalOpex =
    marketplaceFees +
    spendByCategory.shipping +
    spendByCategory.advertising +
    spendByCategory.samples +
    spendByCategory.software +
    spendByCategory.other +
    aiUsage +
    fixedOverhead;
  const netProfit = grossProfit - totalOpex;

  const ratio = (a: number, b: number) => (b === 0 ? null : Math.round((a * 10_000) / b));

  return {
    period,
    start: start.toISOString(),
    end: end.toISOString(),
    days,
    unitsSold,
    grossSales,
    refunds,
    netSales,
    cogs,
    cogsMethod: useUnitCost ? "unit_cost" : "cash_purchases",
    grossProfit,
    grossMarginBps: ratio(grossProfit, netSales),
    marketplaceFees,
    shipping: spendByCategory.shipping,
    advertising: spendByCategory.advertising,
    samples: spendByCategory.samples,
    software: spendByCategory.software,
    other: spendByCategory.other,
    aiUsage,
    fixedOverhead,
    totalOpex,
    netProfit,
    netMarginBps: ratio(netProfit, netSales),
    deposits,
    withdrawals,
    payouts,
    spendByCategory,
    totalSpend,
    netCashFlow: deposits - withdrawals + payouts - totalSpend,
    inventoryPurchased: spendByCategory.inventory,
    averageSellingPrice: unitsSold > 0 ? Math.round(grossSales / unitsSold) : null,
    refundRateBps: ratio(refunds, grossSales),
    tacosBps: ratio(spendByCategory.advertising, grossSales),
    roasX100: spendByCategory.advertising > 0 ? Math.round((grossSales * 100) / spendByCategory.advertising) : null,
    avgDailySpend: Math.round(totalSpend / days),
  };
}
