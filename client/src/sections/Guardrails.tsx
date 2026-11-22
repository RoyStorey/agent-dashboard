import { useEffect, useState } from "react";
import { formatCents } from "../../../shared/money.ts";
import type { GlobalGuardrails } from "../../../shared/types.ts";
import type { SectionProps } from "../App.tsx";
import { api } from "../api.ts";
import { Badge, Card, Field, MoneyInput, PageHeader, ProgressBar } from "../components/ui.tsx";

type Limits = Omit<GlobalGuardrails, "killSwitch">;

export function Guardrails({ state, dash, go }: SectionProps) {
  const g = state.guardrails;
  const saved: Limits = {
    perTransactionLimitCents: g.perTransactionLimitCents,
    dailySpendLimitCents: g.dailySpendLimitCents,
    monthlySpendLimitCents: g.monthlySpendLimitCents,
    approvalThresholdCents: g.approvalThresholdCents,
    aiMonthlyLimitCents: g.aiMonthlyLimitCents,
  };
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState<Limits>(saved);
  useEffect(() => setDraft(saved), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== savedKey;
  const f = state.finance;

  return (
    <>
      <PageHeader
        title="Guardrails"
        subtitle="Hard rules the dashboard enforces on every agent request. They apply on top of each agent's own limits; the stricter rule always wins."
      />

      <Card className={g.killSwitch ? "banner-bad" : ""}>
        <div className="row between">
          <div>
            <h3>Kill switch {g.killSwitch ? <Badge tone="bad">ON</Badge> : <Badge tone="good">off</Badge>}</h3>
            <p className="muted">Instantly denies every agent request, including ones that cost nothing. Use it if anything looks wrong.</p>
          </div>
          <button
            className={`btn ${g.killSwitch ? "btn-good-solid" : "btn-danger-solid"}`}
            onClick={() => {
              if (!g.killSwitch && !window.confirm("Turn ON the kill switch? Every agent request will be denied.")) return;
              void dash.run(() => api.updateGuardrails({ killSwitch: !g.killSwitch }), g.killSwitch ? "Agents may resume." : "All agents stopped.");
            }}
          >
            {g.killSwitch ? "Turn off — let agents resume" : "Stop all agents now"}
          </button>
        </div>
      </Card>

      <Card title="Global spending limits">
        <p className="muted">Leave a field empty for no limit. Limits use calendar days and months in this computer's time zone.</p>
        <div className="form-grid">
          <Field label="Max per transaction" help="No single request may exceed this.">
            <MoneyInput nullable value={draft.perTransactionLimitCents} onChange={(v) => setDraft({ ...draft, perTransactionLimitCents: v })} ariaLabel="Global max per transaction" />
          </Field>
          <Field label="Max spend per day" help="Across all agents combined.">
            <MoneyInput nullable value={draft.dailySpendLimitCents} onChange={(v) => setDraft({ ...draft, dailySpendLimitCents: v })} ariaLabel="Global max per day" />
          </Field>
          <Field label="Max spend per month" help="Across all agents combined.">
            <MoneyInput nullable value={draft.monthlySpendLimitCents} onChange={(v) => setDraft({ ...draft, monthlySpendLimitCents: v })} ariaLabel="Global max per month" />
          </Field>
          <Field label="Ask me before any spend of at least" help="Empty = never ask by amount (agent thresholds still apply).">
            <MoneyInput nullable placeholder="Never" value={draft.approvalThresholdCents} onChange={(v) => setDraft({ ...draft, approvalThresholdCents: v })} ariaLabel="Global approval threshold" />
          </Field>
          <Field label="AI usage cap per month" help="Estimated Claude/AI cost agents report. When reached, agent requests and AI research stop until next month.">
            <MoneyInput nullable value={draft.aiMonthlyLimitCents} onChange={(v) => setDraft({ ...draft, aiMonthlyLimitCents: v })} ariaLabel="AI usage cap per month" />
          </Field>
        </div>
        <p className="help">
          Also set a monthly spending limit in your AI provider's own account (e.g. Anthropic Console → Billing/Limits): that one is enforced by the provider
          even if an agent stops reporting its usage.
        </p>
        <div className="form-actions">
          <button
            className="btn"
            disabled={state.finance.cashBalanceCents <= 0}
            title="Monthly cap = 75% of cash, daily cap = 35% of cash"
            onClick={() => void dash.run(() => api.recommendedGuardrails(), "Recommended caps applied.")}
          >
            Apply recommended caps
          </button>
          <button className="btn" disabled={!dirty} onClick={() => setDraft(saved)}>
            Discard changes
          </button>
          <button className="btn btn-primary" disabled={!dirty} onClick={() => void dash.run(() => api.updateGuardrails({ ...draft }), "Guardrails saved.")}>
            Save limits
          </button>
        </div>
      </Card>

      <div className="grid grid-2">
        <Card title="Today">
          <div className="row between">
            <span className="num">{formatCents(f.spentTodayCents)} spent</span>
            <span className="muted">{g.dailySpendLimitCents === null ? "no daily cap" : `cap ${formatCents(g.dailySpendLimitCents)}`}</span>
          </div>
          {g.dailySpendLimitCents !== null && <ProgressBar value={f.spentTodayCents} max={g.dailySpendLimitCents} label="Daily cap used" />}
        </Card>
        <Card title="This month">
          <div className="row between">
            <span className="num">{formatCents(f.spentThisMonthCents)} spent</span>
            <span className="muted">{g.monthlySpendLimitCents === null ? "no monthly cap" : `cap ${formatCents(g.monthlySpendLimitCents)}`}</span>
          </div>
          {g.monthlySpendLimitCents !== null && <ProgressBar value={f.spentThisMonthCents} max={g.monthlySpendLimitCents} label="Monthly cap used" />}
        </Card>
        <Card title="AI usage this month">
          <div className="row between">
            <span className="num">{formatCents(f.aiThisMonthCents)} estimated</span>
            <span className="muted">{g.aiMonthlyLimitCents === null ? "no AI cap" : `cap ${formatCents(g.aiMonthlyLimitCents)}`}</span>
          </div>
          {g.aiMonthlyLimitCents !== null && <ProgressBar value={f.aiThisMonthCents} max={g.aiMonthlyLimitCents} label="AI cap used" />}
          <p className="help">Counts only what agents and product research report. Your provider's bill is the final word.</p>
        </Card>
      </div>

      <Card title="Per-agent guardrails">
        {state.agents.length === 0 ? (
          <p className="muted">No agents yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th className="right">Per transaction</th>
                  <th className="right">Per day</th>
                  <th className="right">Ask me at</th>
                  <th>Always ask for</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.agents.map((a) => {
                  const ag = a.guardrails;
                  const show = (c: number | null, none = "—") => (c === null ? none : formatCents(c));
                  return (
                    <tr key={a.id}>
                      <td className="title">{a.name}</td>
                      <td className="right num">{show(ag.perTransactionLimitCents)}</td>
                      <td className="right num">{show(ag.dailySpendLimitCents)}</td>
                      <td className="right num">{show(ag.approvalThresholdCents, "never")}</td>
                      <td className="muted">
                        {ag.approvalRequiredActions.map((k) => a.actions.find((x) => x.key === k)?.label ?? k).join(", ") || "—"}
                      </td>
                      <td className="right">
                        <button className="btn btn-sm" onClick={() => go("agents", a.id)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="help">“—” means no agent-level limit; the global limits above still apply.</p>
      </Card>
    </>
  );
}
