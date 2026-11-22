import { useEffect, useState } from "react";
import { canSpend, defaultWeight, planAllocation, planRebalance } from "../../../shared/allocation.ts";
import { formatBps } from "../../../shared/economics.ts";
import { formatCents } from "../../../shared/money.ts";
import type { AgentView, FundingType } from "../../../shared/types.ts";
import type { SectionProps } from "../App.tsx";
import { api } from "../api.ts";
import { Badge, Card, EmptyState, Field, Money, MoneyInput, PageHeader, PercentInput, ProgressBar, Stat, formatDateTime } from "../components/ui.tsx";

function BudgetCell({ agent, dash }: { agent: AgentView; dash: SectionProps["dash"] }) {
  const [value, setValue] = useState<number | null>(agent.budgetCents);
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
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
    );
  }
  return (
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
      <button className="btn btn-sm" onClick={() => setEditing(false)} aria-label="Cancel">
        ×
      </button>
    </div>
  );
}

function Allocation({ state, dash }: Pick<SectionProps, "state" | "dash">) {
  const a = state.allocation;
  const f = state.finance;
  const savedKey = JSON.stringify(a);
  const [reserve, setReserve] = useState(a.reserveBps);
  const [weights, setWeights] = useState<Record<string, string>>({});
  useEffect(() => {
    setReserve(a.reserveBps);
    setWeights({});
  }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preview with unsaved edits applied.
  const draftWeights: Record<string, number> = { ...a.weights };
  for (const [id, w] of Object.entries(weights)) {
    const n = Number(w);
    if (w.trim() !== "" && Number.isFinite(n) && n >= 0) draftWeights[id] = n;
  }
  const settings = { ...a, reserveBps: reserve, weights: draftWeights };
  const rebalance = planRebalance({ agents: state.agents, settings, cashBalanceCents: f.cashBalanceCents, finance: f.agents });
  const distribute = planAllocation({ agents: state.agents, settings, availableCents: f.unallocatedCents, cashBalanceCents: f.cashBalanceCents });
  const dirty = reserve !== a.reserveBps || Object.keys(weights).length > 0;
  const toDistribute = distribute.lines.reduce((s, l) => s + l.addCents, 0);
  const rebalanceChanges = rebalance.lines.filter((l) => l.deltaCents !== 0).length;

  return (
    <Card
      title={
        <span className="row">
          Agent budgets {a.auto ? <Badge tone="good">Auto-allocate on</Badge> : <Badge>Auto-allocate off</Badge>}
        </span>
      }
      actions={
        <label className="check">
          <input type="checkbox" checked={a.auto} onChange={() => void dash.run(() => api.updateAllocation({ auto: !a.auto }), a.auto ? "Auto-allocate off." : "Auto-allocate on.")} />
          Split new deposits & revenue automatically
        </label>
      }
    >
      <p className="muted">
        New money is split by each agent's share below, keeping a cash reserve untouched. Change any budget by hand at any time; auto-allocation only adds to budgets, so your changes are kept. “Rebalance” re-splits all unspent money to match the shares.
      </p>
      <div className="form-grid">
        <Field label="Cash reserve (never allocated)" help={`Currently ${formatCents(rebalance.reserveCents)} of ${formatCents(f.cashBalanceCents)} cash`}>
          <PercentInput value={reserve} onChange={setReserve} ariaLabel="Reserve percent" />
        </Field>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th className="right">Weight</th>
              <th className="right">Share</th>
              <th className="right">Spent</th>
              <th className="right">Remaining</th>
              <th className="right">Total budget</th>
              <th className="right">After rebalance</th>
            </tr>
          </thead>
          <tbody>
            {state.agents.map((ag) => {
              const af = f.agents.find((x) => x.agentId === ag.id);
              const line = rebalance.lines.find((l) => l.agentId === ag.id);
              const spends = canSpend(ag);
              const current = a.weights[ag.id] ?? defaultWeight(ag);
              return (
                <tr key={ag.id}>
                  <td>
                    <div className="title">{ag.name}</div>
                    <div className="help">{line?.reason}</div>
                    <ProgressBar value={af?.spentCents ?? 0} max={ag.budgetCents} label={`${ag.name} budget used`} />
                  </td>
                  <td className="right">
                    {spends ? (
                      <input
                        aria-label={`${ag.name} weight`}
                        inputMode="decimal"
                        style={{ width: 70, textAlign: "right" }}
                        value={weights[ag.id] ?? String(current)}
                        onChange={(e) => setWeights({ ...weights, [ag.id]: e.target.value })}
                      />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="right num">{line && line.shareBps > 0 ? formatBps(line.shareBps, 0) : "—"}</td>
                  <td className="right num">{formatCents(af?.spentCents ?? 0)}</td>
                  <td className="right num">{formatCents(af?.remainingCents ?? 0)}</td>
                  <td className="right">
                    <BudgetCell agent={ag} dash={dash} />
                  </td>
                  <td className={`right num ${line && line.deltaCents > 0 ? "tone-good" : line && line.deltaCents < 0 ? "tone-bad" : "muted"}`}>
                    {line ? formatCents(line.newBudgetCents) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="form-actions">
        {dirty && (
          <button
            className="btn"
            onClick={() =>
              void dash.run(
                () =>
                  api.updateAllocation({
                    reserveBps: reserve,
                    weights: Object.fromEntries(Object.keys(weights).map((id) => [id, draftWeights[id] ?? null])),
                  }),
                "Shares saved.",
              )
            }
          >
            Save shares
          </button>
        )}
        <button className="btn" disabled={toDistribute === 0} onClick={() => void dash.run(() => api.distribute(), `Distributed ${formatCents(toDistribute)}.`)}>
          Distribute unallocated ({formatCents(toDistribute)})
        </button>
        <button
          className="btn btn-primary"
          disabled={rebalanceChanges === 0 || dirty}
          title={dirty ? "Save shares first" : ""}
          onClick={() => void dash.run(() => api.rebalance(), "Budgets rebalanced.")}
        >
          Rebalance all budgets
        </button>
      </div>
    </Card>
  );
}

const TYPE_LABEL: Record<FundingType, string> = { deposit: "Deposit", withdrawal: "Withdrawal", revenue: "Sales payout" };

export function Funding({ state, dash }: SectionProps) {
  const f = state.finance;
  const [type, setType] = useState<"deposit" | "withdrawal">("deposit");
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState("");

  const submit = async () => {
    if (amount === null || amount <= 0) {
      dash.notify("error", "Enter an amount greater than $0.00.");
      return;
    }
    if (type === "withdrawal" && !window.confirm(`Withdraw ${formatCents(amount)} from the project?`)) return;
    const ok = await dash.run(
      () => api.addFunding(type, amount, note),
      type === "deposit" && state.allocation.auto ? `Deposited ${formatCents(amount)} and split it across agents.` : `${TYPE_LABEL[type]} of ${formatCents(amount)} recorded.`,
    );
    if (ok) {
      setAmount(null);
      setNote("");
    }
  };

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
      <PageHeader title="Funding" subtitle="Put money in once; it is split across agents automatically. Agents can never spend more than their budget or the cash on hand." />

      <div className="stats">
        <Stat label="Cash balance" value={<Money cents={f.cashBalanceCents} />} hint="Deposits + payouts − withdrawals − spend" />
        <Stat label="Allocated to agents (unspent)" value={<Money cents={f.allocatedRemainingCents} />} />
        <Stat label="Unallocated" value={<Money cents={f.unallocatedCents} />} tone={f.unallocatedCents < 0 ? "bad" : undefined} hint="Includes the reserve" />
        <Stat label="Total deposited" value={<Money cents={f.depositedCents} />} hint={<>Withdrawn <Money cents={f.withdrawnCents} /></>} />
      </div>

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
              <select id="f-type" value={type} onChange={(e) => setType(e.target.value as "deposit" | "withdrawal")}>
                <option value="deposit">Deposit (add funding)</option>
                <option value="withdrawal">Withdrawal (take money out)</option>
              </select>
            </Field>
            <Field label="Amount" htmlFor="f-amount" required>
              <MoneyInput id="f-amount" value={amount} onChange={setAmount} />
            </Field>
            <Field label="Note" htmlFor="f-note">
              <input id="f-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Initial funding from savings" />
            </Field>
          </div>
          <p className="help">
            This records money you set aside for the business so budgets can be enforced; it doesn't move money in your bank. Record sales on the Financials page.
          </p>
          <div className="form-actions">
            <button className="btn btn-primary" type="submit">
              Record {type}
            </button>
          </div>
        </form>
      </Card>

      {state.agents.length === 0 ? <EmptyState title="Add agents to allocate budgets" /> : <Allocation state={state} dash={dash} />}

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
