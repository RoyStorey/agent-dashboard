import type { Cents, UnitEconomics } from "./types.ts";

/** Applies basis points to cents, rounding half away from zero to the nearest cent. */
export function bpsOf(cents: Cents, bps: number): Cents {
  const raw = (cents * bps) / 10_000;
  return raw < 0 ? -Math.round(-raw) : Math.round(raw);
}

/** Ratio as basis points (e.g. 0.2534 -> 2534), or null when the denominator is 0. */
export function ratioBps(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator * 10_000) / denominator);
}

export function formatBps(bps: number | null, digits = 1): string {
  if (bps === null || !Number.isFinite(bps)) return "—";
  return `${(bps / 100).toFixed(digits)}%`;
}

/** Parses "15", "2.9", "12.5%" into basis points. Returns null if invalid. */
export function parsePercent(input: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(input.trim().replace(/%$/, "").trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}

export function bpsToInput(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? `${whole}` : `${whole}.${frac.toString().padStart(2, "0").replace(/0$/, "")}`;
}

export const EMPTY_ECONOMICS: UnitEconomics = {
  salePriceCents: 0,
  unitCostCents: 0,
  inboundShippingCents: 0,
  otherPerUnitCents: 0,
  fulfillmentFeeCents: 0,
  marketplaceFeeBps: 1500,
  paymentFeeBps: 0,
  perOrderFeeCents: 0,
  adSpendBps: 1500,
  returnRateBps: 500,
  fixedMonthlyCents: 0,
  monthlyUnits: 0,
};

export interface UnitBreakdown {
  /** Per unit sold. */
  grossSales: Cents;
  refunds: Cents;
  netSales: Cents;
  landedCost: Cents;
  grossProfit: Cents;
  grossMarginBps: number | null;
  marketplaceFees: Cents;
  paymentFees: Cents;
  perOrderFees: Cents;
  fulfillment: Cents;
  advertising: Cents;
  contribution: Cents;
  contributionMarginBps: number | null;
  /** Return on the cash tied up in one unit of inventory. */
  roiBps: number | null;
  /** Lowest price at which a unit still breaks even (after ads), rounded up to the cent. */
  breakEvenPrice: Cents | null;
  /** Highest ad spend (as % of sales) before each unit loses money. */
  breakEvenAdBps: number | null;
}

/**
 * Per-unit economics. Assumptions (stated in the UI too):
 * - Returned units are refunded in full and cannot be resold (conservative).
 * - Marketplace/payment fees are charged on the full sale price and not refunded.
 * - Ad spend is a share of gross sales (TACoS).
 */
export function unitBreakdown(e: UnitEconomics): UnitBreakdown {
  const grossSales = e.salePriceCents;
  const refunds = bpsOf(grossSales, e.returnRateBps);
  const netSales = grossSales - refunds;
  const landedCost = e.unitCostCents + e.inboundShippingCents + e.otherPerUnitCents;
  const grossProfit = netSales - landedCost;
  const marketplaceFees = bpsOf(grossSales, e.marketplaceFeeBps);
  const paymentFees = bpsOf(grossSales, e.paymentFeeBps);
  const perOrderFees = e.perOrderFeeCents ?? 0;
  const fulfillment = e.fulfillmentFeeCents;
  const advertising = bpsOf(grossSales, e.adSpendBps);
  const contribution = grossProfit - marketplaceFees - paymentFees - perOrderFees - fulfillment - advertising;

  const variableBps = e.returnRateBps + e.marketplaceFeeBps + e.paymentFeeBps + e.adSpendBps;
  const fixedPerUnit = landedCost + fulfillment + perOrderFees;
  const breakEvenPrice = variableBps < 10_000 ? Math.ceil((fixedPerUnit * 10_000) / (10_000 - variableBps)) : null;

  const beforeAds = contribution + advertising;
  const breakEvenAdBps = grossSales > 0 ? Math.max(0, Math.floor((beforeAds * 10_000) / grossSales)) : null;

  return {
    grossSales,
    refunds,
    netSales,
    landedCost,
    grossProfit,
    grossMarginBps: ratioBps(grossProfit, netSales),
    marketplaceFees,
    paymentFees,
    perOrderFees,
    fulfillment,
    advertising,
    contribution,
    contributionMarginBps: ratioBps(contribution, netSales),
    roiBps: ratioBps(contribution, landedCost),
    breakEvenPrice,
    breakEvenAdBps,
  };
}

export interface MonthlyProjection {
  units: number;
  grossSales: Cents;
  netSales: Cents;
  grossProfit: Cents;
  contribution: Cents;
  fixed: Cents;
  netProfit: Cents;
  netMarginBps: number | null;
  /** Cash for one month of inventory at landed cost. */
  inventoryCash: Cents;
}

export function project(e: UnitEconomics, units: number): MonthlyProjection {
  const u = unitBreakdown(e);
  const netSales = u.netSales * units;
  const contribution = u.contribution * units;
  const netProfit = contribution - e.fixedMonthlyCents;
  return {
    units,
    grossSales: u.grossSales * units,
    netSales,
    grossProfit: u.grossProfit * units,
    contribution,
    fixed: e.fixedMonthlyCents,
    netProfit,
    netMarginBps: ratioBps(netProfit, netSales),
    inventoryCash: u.landedCost * units,
  };
}

/** Units per month needed to cover fixed costs, or null if each unit loses money. */
export function breakEvenUnits(e: UnitEconomics): number | null {
  const c = unitBreakdown(e).contribution;
  if (c <= 0) return e.fixedMonthlyCents === 0 && c === 0 ? 0 : null;
  return Math.ceil(e.fixedMonthlyCents / c);
}

export function economicsComplete(e: UnitEconomics): boolean {
  return e.salePriceCents > 0 && e.unitCostCents > 0;
}
