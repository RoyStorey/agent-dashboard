import { useState } from "react";
import { formatCents } from "../../../shared/money.ts";
import type { AgentView, FundingType } from "../../../shared/types.ts";
import type { SectionProps } from "../App.tsx";
import { api } from "../api.ts";
import { Badge, Card, EmptyState, Field, Money, MoneyInput, PageHeader, ProgressBar, Stat, formatDateTime } from "../components/ui.tsx";

function BudgetRow({ agent, state, dash }: { agent: AgentView } & Pick<SectionProps, "state" | "dash">) {
  const af = state.finance.agents.find((a) => a.agentId === agent.id);
  const [value, setValue] = useState<number | null>(agent.budgetCents);
  const [editing, setEditing] = useState(false);
  const spent = af?.spentCents ?? 0;

  return (
    <tr>
      <td>
        <div className="title">{agent.name}</div>
        <ProgressBar value={spent} max={agent.budgetCents} label={`${agent.name} budget used`} />
      </td>
      <td className="right num">{formatCents(spent)}</td>
      <td className="right num">{formatCents(af?.remainingCents ?? 0)}</td>
      <td className="right">
        {editing ? (
          <div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
            <div style={{ width: 130 }}>
              <MoneyInput value={value} onChange={setValue} ariaLabel={`${agent.name} total budget`} />
            </div>
            <button
              className="btn btn-sm btn-primary"
              disabled={value === null}
              onClick={async () => {
                if (value === null) return;
                if (await dash.run(() => api.setBudget(agent.id, value), `${agent.name} budget set to ${formatCents(value)}.`)) setEditing(false);
              }}
            >
              Save
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                setValue(agent.budgetCents);
                setEditing(false);
              }}
            >
              ×
            </button>
          </div>
        ) : (
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <span className="num">{formatCents(agent.budgetCents)}</span>
            <button
              className="btn btn-sm"
              onClick={() => {
                setValue(agent.budgetCents);
                setEditing(true);
              }}
            >
              Change
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

const TYPE_LABEL: Record<FundingType, string> = { deposit: "Deposit", withdrawal: "Withdrawal", revenue: "Revenue" };

export function Funding({ state, dash }: SectionProps) {
  const f = state.finance;
  const [type, setType] = useState<FundingType>("deposit");
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState("");

  const submit = async () => {
    if (amount === null || amount <= 0) {
      dash.notify("error", "Enter an amount greater than $0.00.");
      return;
    }
    if (type === "withdrawal" && !window.confirm(`Withdraw ${formatCents(amount)} from the project?`)) return;
    const ok = await dash.run(() => api.addFunding(type, amount, note), `${TYPE_LABEL[type]} of ${formatCents(amount)} recorded.`);
    if (ok) {
      setAmount(null);
      setNote("");
    }
  };

  // Ledger: funding entries plus money committed by agent requests, newest first.
  const ledger = [
    ...state.funding.map((e) => ({
      id: e.id,
      at: e.createdAt,
      label: TYPE_LABEL[e.type],
      who: e.agentId ? (state.agents.find((a) => a.id === e.agentId)?.name ?? "Removed agent") : "Owner",
      note: e.note,
      delta: e.type === "withdrawal" ? -e.amountCents : e.amountCents,
      pending: false,
    })),
    ...state.requests
      .filter((r) => r.status === "approved" || r.status === "completed")
      .map((r) => {
        const agent = state.agents.find((a) => a.id === r.agentId);
        return {
          id: r.id,
          at: r.createdAt,
          label: agent?.actions.find((a) => a.key === r.action)?.label ?? r.action,
          who: agent?.name ?? "Removed agent",
          note: r.description,
          delta: -(r.status === "completed" ? (r.actualAmountCents ?? r.amountCents) : r.amountCents),
          pending: r.status === "approved",
        };
      })
      .filter((x) => x.delta !== 0),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <>
      <PageHeader
        title="Funding"
        subtitle="Put money into the project, then give each agent a budget. Agents can never spend more than their remaining budget or the cash on hand."
      />

      <div className="stats">
        <Stat label="Cash balance" value={<Money cents={f.cashBalanceCents} />} hint="Deposits + revenue − withdrawals − spend" />
        <Stat label="Allocated to agents (unspent)" value={<Money cents={f.allocatedRemainingCents} />} />
        <Stat label="Unallocated" value={<Money cents={f.unallocatedCents} />} tone={f.unallocatedCents < 0 ? "bad" : undefined} hint="Free to allocate or withdraw" />
        <Stat label="Total deposited" value={<Money cents={f.depositedCents} />} hint={<>Withdrawn <Money cents={f.withdrawnCents} /></>} />
      </div>

      <div className="grid grid-2">
        <Card title="Add or withdraw funds">
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="form-grid">
              <Field label="Type" htmlFor="f-type">
                <select id="f-type" value={type} onChange={(e) => setType(e.target.value as FundingType)}>
                  <option value="deposit">Deposit (add funding)</option>
                  <option value="withdrawal">Withdrawal (take money out)</option>
                  <option value="revenue">Revenue (record a sale yourself)</option>
                </select>
              </Field>
              <Field label="Amount" htmlFor="f-amount" required>
                <MoneyInput id="f-amount" value={amount} onChange={setAmount} />
              </Field>
            </div>
            <Field label="Note" htmlFor="f-note">
              <input id="f-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Initial funding from savings" />
            </Field>
            <p className="help">
              This records money you have set aside for the business so the dashboard can enforce budgets. It does not move money in your bank.
            </p>
            <div className="form-actions">
              <button className="btn btn-primary" type="submit">
                Record {TYPE_LABEL[type].toLowerCase()}
              </button>
            </div>
          </form>
        </Card>

        <Card title="Where the money is">
          <div className="stack" style={{ gap: 8 }}>
            <div className="row between">
              <span>Agents' unspent budgets</span>
              <span className="num">{formatCents(f.allocatedRemainingCents)}</span>
            </div>
            <ProgressBar value={f.allocatedRemainingCents} max={Math.max(f.cashBalanceCents, 1)} label="Share of cash allocated" />
            <div className="row between">
              <span>Spent so far</span>
              <span className="num">{formatCents(f.spentCents)}</span>
            </div>
            <div className="row between">
              <span>Revenue so far</span>
              <span className="num">{formatCents(f.revenueCents)}</span>
            </div>
            <div className="row between">
              <strong>Profit</strong>
              <strong className={`num ${f.profitCents > 0 ? "tone-good" : f.profitCents < 0 ? "tone-bad" : ""}`}>{formatCents(f.profitCents)}</strong>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Agent budgets">
        {state.agents.length === 0 ? (
          <EmptyState title="No agents yet" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th className="right">Spent</th>
                  <th className="right">Remaining</th>
                  <th className="right">Total budget</th>
                </tr>
              </thead>
              <tbody>
                {state.agents.map((a) => (
                  <BudgetRow key={a.id} agent={a} state={state} dash={dash} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="help">
          A budget is the total an agent may ever spend. Raise it to top the agent up. It cannot go below what the agent has already spent.
        </p>
      </Card>

      <Card title="Ledger">
        {ledger.length === 0 ? (
          <EmptyState title="No money has moved yet" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th>Who</th>
                  <th>Note</th>
                  <th className="right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((x) => (
                  <tr key={x.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(x.at)}
                    </td>
                    <td>
                      {x.label} {x.pending && <Badge tone="info">reserved</Badge>}
                    </td>
                    <td>{x.who}</td>
                    <td className="muted">{x.note}</td>
                    <td className={`right num ${x.delta < 0 ? "tone-bad" : "tone-good"}`}>
                      {x.delta > 0 ? "+" : ""}
                      {formatCents(x.delta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
