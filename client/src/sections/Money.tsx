import { SERVICES } from "../../../shared/services.ts";
import { MONEY_INTEGRATIONS } from "../../../shared/templates.ts";
import type { SectionProps } from "../App.tsx";
import { Badge, Card, MoneyBadge, MoneyLegend, PageHeader, ProgressBar } from "../components/ui.tsx";
import { isVaultSet } from "../lib.ts";
import { TaskRow } from "./Todo.tsx";

/** True when anything in the dashboard is connected to a real money rail. */
export function realMoneyConnected(): boolean {
  return MONEY_INTEGRATIONS.some((i) => i.key !== "sales_reporting" && i.built);
}

export function Money({ state, dash, go }: SectionProps) {
  const tasks = state.tasks.filter((t) => t.category === "money");
  const done = tasks.filter((t) => t.status === "done").length;
  const spendingKeys = SERVICES.filter((s) => s.money === "spends" && isVaultSet(state, s.key));

  return (
    <>
      <PageHeader
        title="Money setup"
        subtitle="What's real money and what's bookkeeping, and the exact steps to connect real money safely."
      />

      {!realMoneyConnected() && (
      <Card className="banner-info">
        <div className="stack" style={{ gap: 6 }}>
          <div className="row">
            <strong>Right now this dashboard is accounting only.</strong> <MoneyBadge kind="records" />
          </div>
          <p>
            Deposits, withdrawals, budgets, sales you record and every number on Financials are records the dashboard keeps so it can enforce
            your limits. Clicking them never moves a cent. Real money moves only when an agent pays with a card or account you gave it.
          </p>
        </div>
      </Card>
      )}

      <div className="grid grid-2">
        <Card title="What each tag means">
          <MoneyLegend />
        </Card>

        <Card title="Where the dashboard touches money today">
          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
              <MoneyBadge kind="records" />
              <span>Funding (deposits, withdrawals, budgets, auto-allocation), Financials and recorded sales.</span>
            </div>
            <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
              <MoneyBadge kind="moves" />
              <span>
                <strong>Approving a request.</strong> Approval lets the agent go ahead and pay with whatever card or account its program holds. The
                dashboard can't stop a payment made outside it until agent cards are built (below).
              </span>
            </div>
            <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
              <MoneyBadge kind="moves" />
              <span>
                <strong>Credentials that can spend:</strong>{" "}
                {spendingKeys.length === 0 ? "none saved yet." : spendingKeys.map((s) => s.label).join(", ") + "."} Agents given these can spend or refund real
                money directly.{" "}
                <button className="btn btn-sm" onClick={() => go("credentials")}>
                  Review credentials
                </button>
              </span>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Dashboard features for real money">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Feature</th>
                <th>Type</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {MONEY_INTEGRATIONS.map((i) => (
                <tr key={i.key}>
                  <td>
                    <div className="title">{i.name}</div>
                    <div className="muted">{i.what}</div>
                  </td>
                  <td>
                    <MoneyBadge kind={i.money} />
                  </td>
                  <td>{i.built ? <Badge tone="good">Built</Badge> : <Badge tone="warn">Not built yet</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="help">
          “Not built yet” features need code in this dashboard. The steps that depend on them are marked “Waiting on”; everything else you can do now, so
          your accounts are approved and ready when the feature lands.
        </p>
      </Card>

      <Card title={`Steps to connect real money (${done}/${tasks.length})`}>
        <ProgressBar value={done} max={tasks.length} label="Money setup progress" kind="progress" />
        <p className="muted">In order. Steps that tick themselves: recording the deposit, saving the Stripe key, saving the Plaid keys.</p>
        <div className="list">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} dash={dash} />
          ))}
        </div>
      </Card>
    </>
  );
}
