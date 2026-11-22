import { useEffect, useState } from "react";
import { breakEvenUnits, economicsComplete, formatBps, project, unitBreakdown } from "../../../shared/economics.ts";
import { formatCents } from "../../../shared/money.ts";
import { PERIOD_LABEL, SPEND_LABEL, computePnL, type Period } from "../../../shared/pnl.ts";
import type { SpendCategory, UnitEconomics } from "../../../shared/types.ts";
import type { SectionProps } from "../App.tsx";
import { api } from "../api.ts";
import { Card, Field, MoneyBadge, MoneyInput, PageHeader, PercentInput, Stat } from "../components/ui.tsx";

const PERIODS: Period[] = ["this_month", "last_month", "last_30", "all"];

const money = (c: number) => formatCents(c);
const neg = (c: number) => (c === 0 ? formatCents(0) : `(${formatCents(c)})`);
const tone = (c: number) => (c > 0 ? "tone-good" : c < 0 ? "tone-bad" : "");

export function Financials({ state, dash }: SectionProps) {
  const [period, setPeriod] = useState<Period>("this_month");
  const now = new Date(state.serverTime);
  const p = computePnL({ funding: state.funding, requests: state.requests, agents: state.agents, economics: state.economics, period, now });
  const last30 = computePnL({ funding: state.funding, requests: state.requests, agents: state.agents, economics: state.economics, period: "last_30", now });
  const cash = state.finance.cashBalanceCents;
  const runwayDays = last30.avgDailySpend > 0 ? Math.floor(cash / last30.avgDailySpend) : null;

  return (
    <>
      <PageHeader
        title="Financials"
        subtitle="Profit & loss, cash flow and unit economics. Sales come from what the Finance agent (or you) reports; costs come from every approved agent purchase."
        actions={
          <div className="segmented" role="tablist" aria-label="Period">
            {PERIODS.map((x) => (
              <button key={x} role="tab" aria-selected={period === x} className={period === x ? "active" : ""} onClick={() => setPeriod(x)}>
                {PERIOD_LABEL[x]}
              </button>
            ))}
          </div>
        }
      />

      <div className="stats">
        <Stat label="Gross sales" value={money(p.grossSales)} hint={`${p.unitsSold} units · avg ${p.averageSellingPrice === null ? "—" : money(p.averageSellingPrice)}`} />
        <Stat label="Net sales" value={money(p.netSales)} hint={`Refunds ${money(p.refunds)} (${formatBps(p.refundRateBps)})`} />
        <Stat label="Gross profit" value={money(p.grossProfit)} hint={`Gross margin ${formatBps(p.grossMarginBps)}`} tone={p.grossProfit < 0 ? "bad" : undefined} />
        <Stat label="Net profit" value={money(p.netProfit)} hint={`Net margin ${formatBps(p.netMarginBps)}`} tone={p.netProfit > 0 ? "good" : p.netProfit < 0 ? "bad" : undefined} />
        <Stat label="Ad spend" value={money(p.advertising)} hint={`TACoS ${formatBps(p.tacosBps)} · ROAS ${p.roasX100 === null ? "—" : `${(p.roasX100 / 100).toFixed(2)}x`}`} />
        <Stat label="Cash runway" value={runwayDays === null ? "—" : `${runwayDays} days`} hint={`Cash ${money(cash)} ÷ ${money(last30.avgDailySpend)}/day (30-day avg)`} />
      </div>

      <div className="grid grid-2">
        <Card title={`Profit & loss: ${PERIOD_LABEL[period].toLowerCase()}`}>
          <div className="table-wrap">
            <table className="pnl">
              <tbody>
                <tr>
                  <td>Gross sales</td>
                  <td className="right num">{money(p.grossSales)}</td>
                </tr>
                <tr>
                  <td className="indent">Refunds & returns</td>
                  <td className="right num">{neg(p.refunds)}</td>
                </tr>
                <tr className="sub">
                  <td>Net sales</td>
                  <td className="right num">{money(p.netSales)}</td>
                </tr>
                <tr>
                  <td className="indent">Cost of goods sold {p.cogsMethod === "unit_cost" ? `(${p.unitsSold} × landed cost)` : "(inventory purchased)"}</td>
                  <td className="right num">{neg(p.cogs)}</td>
                </tr>
                <tr className="sub">
                  <td>Gross profit · {formatBps(p.grossMarginBps)}</td>
                  <td className={`right num ${tone(p.grossProfit)}`}>{money(p.grossProfit)}</td>
                </tr>
                <tr>
                  <td className="indent">Marketplace & payment fees</td>
                  <td className="right num">{neg(p.marketplaceFees)}</td>
                </tr>
                <tr>
                  <td className="indent">Advertising & creative</td>
                  <td className="right num">{neg(p.advertising)}</td>
                </tr>
                <tr>
                  <td className="indent">Freight & shipping</td>
                  <td className="right num">{neg(p.shipping)}</td>
                </tr>
                <tr>
                  <td className="indent">Samples & product development</td>
                  <td className="right num">{neg(p.samples)}</td>
                </tr>
                <tr>
                  <td className="indent">Software & data</td>
                  <td className="right num">{neg(p.software)}</td>
                </tr>
                <tr>
                  <td className="indent">Other expenses</td>
                  <td className="right num">{neg(p.other)}</td>
                </tr>
                <tr>
                  <td className="indent">Fixed overhead ({p.days} days of {money(state.economics.fixedMonthlyCents)}/month)</td>
                  <td className="right num">{neg(p.fixedOverhead)}</td>
                </tr>
                <tr className="sub">
                  <td>Total operating expenses</td>
                  <td className="right num">{neg(p.totalOpex)}</td>
                </tr>
                <tr className="total">
                  <td>Net profit · {formatBps(p.netMarginBps)}</td>
                  <td className={`right num ${tone(p.netProfit)}`}>{money(p.netProfit)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="help">
            {p.cogsMethod === "unit_cost"
              ? "COGS uses units sold × your planned landed cost, so inventory you bought but haven't sold yet isn't counted as an expense (it shows under cash flow)."
              : "No units sold reported yet (or no unit cost), so COGS is inventory purchased in the period."}{" "}
            Agent API/model usage isn't tracked automatically; include it in fixed overhead.
          </p>
        </Card>

        <div className="stack">
          <Card title="Cash flow">
            <div className="table-wrap">
              <table className="pnl">
                <tbody>
                  <tr>
                    <td>Owner deposits</td>
                    <td className="right num">{money(p.deposits)}</td>
                  </tr>
                  <tr>
                    <td>Marketplace payouts (net)</td>
                    <td className="right num">{money(p.payouts)}</td>
                  </tr>
                  <tr>
                    <td>Owner withdrawals</td>
                    <td className="right num">{neg(p.withdrawals)}</td>
                  </tr>
                  {(Object.keys(SPEND_LABEL) as SpendCategory[])
                    .filter((k) => p.spendByCategory[k] > 0)
                    .map((k) => (
                      <tr key={k}>
                        <td>{SPEND_LABEL[k]}</td>
                        <td className="right num">{neg(p.spendByCategory[k])}</td>
                      </tr>
                    ))}
                  <tr className="total">
                    <td>Net cash flow</td>
                    <td className={`right num ${tone(p.netCashFlow)}`}>{money(p.netCashFlow)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
          <RecordSales dash={dash} />
        </div>
      </div>

      <UnitPlan state={state} dash={dash} actual={p} />
    </>
  );
}

function RecordSales({ dash }: Pick<SectionProps, "dash">) {
  const [gross, setGross] = useState<number | null>(null);
  const [refunds, setRefunds] = useState<number | null>(0);
  const [fees, setFees] = useState<number | null>(0);
  const [units, setUnits] = useState("");
  const [note, setNote] = useState("");
  const net = (gross ?? 0) - (refunds ?? 0) - (fees ?? 0);
  return (
    <Card title={<span className="row">Record sales yourself <MoneyBadge kind="records" /></span>}>
      <p className="muted">The Finance agent reports these automatically. Use this for a payout you entered by hand.</p>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (gross === null || gross <= 0) return dash.notify("error", "Enter gross sales above $0.00.");
          const u = units.trim() === "" ? undefined : Number(units);
          if (u !== undefined && (!Number.isSafeInteger(u) || u < 0)) return dash.notify("error", "Units must be a whole number.");
          const ok = await dash.run(() => api.recordSales({ grossSalesCents: gross, refundsCents: refunds ?? 0, feesCents: fees ?? 0, unitsSold: u, note }), `Recorded ${formatCents(net)} net payout.`);
          if (ok) {
            setGross(null);
            setRefunds(0);
            setFees(0);
            setUnits("");
            setNote("");
          }
        }}
      >
        <div className="form-grid">
          <Field label="Gross sales">
            <MoneyInput value={gross} onChange={setGross} ariaLabel="Gross sales" />
          </Field>
          <Field label="Refunds">
            <MoneyInput value={refunds} onChange={setRefunds} ariaLabel="Refunds" />
          </Field>
          <Field label="Marketplace fees">
            <MoneyInput value={fees} onChange={setFees} ariaLabel="Marketplace fees" />
          </Field>
          <Field label="Units sold" htmlFor="rs-units">
            <input id="rs-units" inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value)} />
          </Field>
        </div>
        <Field label="Note" htmlFor="rs-note">
          <input id="rs-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Amazon settlement Nov 1–14" />
        </Field>
        <div className="row between">
          <span className="muted">Net payout: {formatCents(net)}</span>
          <button className="btn btn-primary" type="submit">
            Record sales
          </button>
        </div>
      </form>
    </Card>
  );
}

type Actual = ReturnType<typeof computePnL>;

function UnitPlan({ state, dash, actual }: Pick<SectionProps, "state" | "dash"> & { actual: Actual }) {
  const savedKey = JSON.stringify(state.economics);
  const [e, setE] = useState<UnitEconomics>(state.economics);
  useEffect(() => setE(state.economics), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(e) !== savedKey;
  const u = unitBreakdown(e);
  const be = breakEvenUnits(e);
  const set = <K extends keyof UnitEconomics>(k: K) => (v: UnitEconomics[K] | null) => setE({ ...e, [k]: v ?? 0 });
  const scenarioUnits = [...new Set([be ?? 0, 50, 100, e.monthlyUnits, 250, 500, 1000].filter((x) => x > 0))].sort((a, b) => a - b);

  return (
    <Card title="Unit economics plan">
      <p className="muted">
        Your per-unit numbers. They drive the break-even price agents must respect, budget suggestions and the projections below. Assumes returned units are refunded in full and can't be resold, and fees aren't refunded.
      </p>
      <div className="form-grid">
        <Field label="Sale price">
          <MoneyInput value={e.salePriceCents} onChange={set("salePriceCents")} ariaLabel="Sale price" />
        </Field>
        <Field label="Supplier cost / unit">
          <MoneyInput value={e.unitCostCents} onChange={set("unitCostCents")} ariaLabel="Supplier cost per unit" />
        </Field>
        <Field label="Freight & duties / unit">
          <MoneyInput value={e.inboundShippingCents} onChange={set("inboundShippingCents")} ariaLabel="Freight and duties per unit" />
        </Field>
        <Field label="Packaging & other / unit">
          <MoneyInput value={e.otherPerUnitCents} onChange={set("otherPerUnitCents")} ariaLabel="Packaging per unit" />
        </Field>
        <Field label="Fulfillment fee / unit" help="e.g. FBA or 3PL pick, pack & ship">
          <MoneyInput value={e.fulfillmentFeeCents} onChange={set("fulfillmentFeeCents")} ariaLabel="Fulfillment fee per unit" />
        </Field>
        <Field label="Marketplace fee" help="Amazon's referral fee is 15% in many categories; check yours">
          <PercentInput value={e.marketplaceFeeBps} onChange={set("marketplaceFeeBps")} ariaLabel="Marketplace fee percent" />
        </Field>
        <Field label="Payment processing" help="0% on Amazon; card fees on your own store">
          <PercentInput value={e.paymentFeeBps} onChange={set("paymentFeeBps")} ariaLabel="Payment processing percent" />
        </Field>
        <Field label="Per-order fees" help="Fixed fees per order, e.g. card fee 30¢, Etsy listing renewal">
          <MoneyInput value={e.perOrderFeeCents} onChange={set("perOrderFeeCents")} ariaLabel="Per-order fees" />
        </Field>
        <Field label="Ad spend (% of sales)">
          <PercentInput value={e.adSpendBps} onChange={set("adSpendBps")} ariaLabel="Ad spend percent" />
        </Field>
        <Field label="Return rate">
          <PercentInput value={e.returnRateBps} onChange={set("returnRateBps")} ariaLabel="Return rate percent" />
        </Field>
        <Field label="Fixed costs / month" help="Seller plan, software, AI usage">
          <MoneyInput value={e.fixedMonthlyCents} onChange={set("fixedMonthlyCents")} ariaLabel="Fixed costs per month" />
        </Field>
        <Field label="Expected units / month" htmlFor="e-units">
          <input
            id="e-units"
            inputMode="numeric"
            value={String(e.monthlyUnits)}
            onChange={(ev) => {
              const n = Number(ev.target.value.replace(/[^\d]/g, "") || "0");
              setE({ ...e, monthlyUnits: Math.min(10_000_000, n) });
            }}
          />
        </Field>
      </div>
      <div className="form-actions">
        <button className="btn" disabled={!dirty} onClick={() => setE(state.economics)}>
          Discard changes
        </button>
        <button
          className="btn btn-primary"
          disabled={!dirty}
          onClick={() => void dash.run(() => api.updateEconomics({ ...e } as unknown as Record<string, number>), "Plan saved. Agent price floors updated.")}
        >
          Save plan
        </button>
      </div>

      {!economicsComplete(e) ? (
        <p className="muted">Enter a sale price and supplier cost to see the breakdown.</p>
      ) : (
        <div className="grid grid-2">
          <div className="table-wrap">
            <table className="pnl">
              <thead>
                <tr>
                  <th>Per unit</th>
                  <th className="right">Amount</th>
                  <th className="right">% of net sales</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Sale price", u.grossSales, ""],
                    ["Refunds (return rate)", -u.refunds, "indent"],
                    ["Net sales", u.netSales, "sub"],
                    ["Landed cost", -u.landedCost, "indent"],
                    ["Gross profit", u.grossProfit, "sub"],
                    ["Marketplace fee", -u.marketplaceFees, "indent"],
                    ["Payment fee", -u.paymentFees, "indent"],
                    ["Per-order fees", -u.perOrderFees, "indent"],
                    ["Fulfillment", -u.fulfillment, "indent"],
                    ["Advertising", -u.advertising, "indent"],
                    ["Contribution (profit per unit)", u.contribution, "total"],
                  ] as Array<[string, number, string]>
                ).map(([label, v, cls]) => (
                  <tr key={label} className={cls === "sub" || cls === "total" ? cls : ""}>
                    <td className={cls === "indent" ? "indent" : ""}>{label}</td>
                    <td className={`right num ${cls === "total" ? tone(v) : ""}`}>{v < 0 ? neg(-v) : money(v)}</td>
                    <td className="right num muted">{u.netSales ? formatBps(Math.round((Math.abs(v) * 10_000) / u.netSales)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="stack">
            <div className="kv">
              <div>
                <span>Gross margin</span>
                <strong>{formatBps(u.grossMarginBps)}</strong>
              </div>
              <div>
                <span>Contribution margin</span>
                <strong>{formatBps(u.contributionMarginBps)}</strong>
              </div>
              <div>
                <span>ROI per unit</span>
                <strong>{formatBps(u.roiBps)}</strong>
              </div>
              <div>
                <span>Break-even price</span>
                <strong>{u.breakEvenPrice === null ? "—" : money(u.breakEvenPrice)}</strong>
              </div>
              <div>
                <span>Max ad spend before loss</span>
                <strong>{formatBps(u.breakEvenAdBps)}</strong>
              </div>
              <div>
                <span>Break-even volume</span>
                <strong>{be === null ? "never (loses money per unit)" : be === 0 ? "from the first unit (no fixed costs)" : `${be} units/month`}</strong>
              </div>
            </div>
            <div className="kv">
              <div>
                <span>Plan: units this month</span>
                <strong>{e.monthlyUnits}</strong>
              </div>
              <div>
                <span>Actual: units ({PERIOD_LABEL[actual.period].toLowerCase()})</span>
                <strong>{actual.unitsSold}</strong>
              </div>
              <div>
                <span>Plan: net profit / month</span>
                <strong>{money(project(e, e.monthlyUnits).netProfit)}</strong>
              </div>
              <div>
                <span>Actual: net profit</span>
                <strong className={tone(actual.netProfit)}>{money(actual.netProfit)}</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {economicsComplete(e) && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="right">Units / month</th>
                <th className="right">Gross sales</th>
                <th className="right">Net sales</th>
                <th className="right">Gross profit</th>
                <th className="right">Contribution</th>
                <th className="right">Fixed costs</th>
                <th className="right">Net profit</th>
                <th className="right">Net margin</th>
                <th className="right">Inventory cash</th>
              </tr>
            </thead>
            <tbody>
              {scenarioUnits.map((n) => {
                const pr = project(e, n);
                return (
                  <tr key={n} style={n === e.monthlyUnits ? { background: "var(--accent-soft)" } : undefined}>
                    <td className="right num">
                      {n}
                      {n === be ? " (break-even)" : n === e.monthlyUnits ? " (plan)" : ""}
                    </td>
                    <td className="right num">{money(pr.grossSales)}</td>
                    <td className="right num">{money(pr.netSales)}</td>
                    <td className="right num">{money(pr.grossProfit)}</td>
                    <td className="right num">{money(pr.contribution)}</td>
                    <td className="right num">{neg(pr.fixed)}</td>
                    <td className={`right num ${tone(pr.netProfit)}`}>{money(pr.netProfit)}</td>
                    <td className="right num">{formatBps(pr.netMarginBps)}</td>
                    <td className="right num">{money(pr.inventoryCash)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
