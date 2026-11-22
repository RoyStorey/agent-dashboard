import { useState, type ReactNode } from "react";
import { economicsComplete } from "../../../shared/economics.ts";
import { formatCents } from "../../../shared/money.ts";
import { findService } from "../../../shared/services.ts";
import { AGENT_TEMPLATES } from "../../../shared/templates.ts";
import type { AgentView, StateResponse } from "../../../shared/types.ts";
import type { SectionProps } from "../App.tsx";
import { api } from "../api.ts";
import { Badge, Card, Field, MoneyInput, PageHeader, ProgressBar, StepState } from "../components/ui.tsx";
import { manualMissingFields, missingVaultKeys } from "../lib.ts";
import { VaultItem } from "./Credentials.tsx";

export interface SetupStep {
  key: string;
  title: string;
  done: boolean;
  optional?: boolean;
}

export function setupSteps(state: StateResponse): SetupStep[] {
  const b = state.business;
  const hasAgents = state.agents.length > 0;
  const g = state.guardrails;
  return [
    { key: "product", title: "Choose what to sell", done: b.product.trim() !== "" },
    { key: "you", title: "Your contact details", done: b.ownerEmail.trim() !== "" && b.shippingAddress.trim() !== "" },
    { key: "team", title: "Add your agent team", done: hasAgents },
    { key: "economics", title: "Price and cost per unit", done: economicsComplete(state.economics) },
    { key: "keys", title: "Paste your keys", done: hasAgents && missingVaultKeys(state).length === 0 },
    { key: "details", title: "Answer what only you know", done: hasAgents && state.agents.every((a) => manualMissingFields(a).length === 0) },
    { key: "fund", title: "Fund the business", done: state.finance.depositedCents > 0 },
    { key: "caps", title: "Spending caps", done: g.dailySpendLimitCents !== null || g.monthlySpendLimitCents !== null },
    { key: "discord", title: "Discord updates", done: state.discord.enabled, optional: true },
    {
      key: "live",
      title: "Go live",
      done: hasAgents && state.agents.some((a) => a.status === "active") && !state.readiness.some((r) => r.ready && state.agents.find((a) => a.id === r.agentId)?.status === "draft"),
    },
  ];
}

function Step(props: { n: number; step: SetupStep; children: ReactNode; open: boolean }) {
  return (
    <Card>
      <div className="step">
        <StepState done={props.step.done} />
        <div className="grow">
          <div>
            <div className="step-num">
              Step {props.n}
              {props.step.optional ? " · optional" : ""}
            </div>
            <h3>{props.step.title}</h3>
          </div>
          {props.open && props.children}
        </div>
      </div>
    </Card>
  );
}

function AgentQuickFields({ agent, dash }: { agent: AgentView; dash: SectionProps["dash"] }) {
  const fields = manualMissingFields(agent);
  const [values, setValues] = useState<Record<string, string>>({});
  if (fields.length === 0) return null;
  return (
    <form
      className="stack"
      style={{ gap: 8 }}
      onSubmit={async (e) => {
        e.preventDefault();
        const inputs = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ""));
        if (Object.keys(inputs).length === 0) return;
        if (await dash.run(() => api.updateAgent(agent.id, { inputs }), `${agent.name} updated.`)) setValues({});
      }}
    >
      <strong>{agent.name}</strong>
      <div className="form-grid">
        {fields.map((f) => (
          <Field key={f.key} label={f.label} htmlFor={`q-${agent.id}-${f.key}`} help={f.help}>
            {f.kind === "textarea" ? (
              <textarea id={`q-${agent.id}-${f.key}`} value={values[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} rows={2} />
            ) : (
              <input
                id={`q-${agent.id}-${f.key}`}
                type={f.kind === "secret" ? "password" : "text"}
                value={values[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            )}
          </Field>
        ))}
      </div>
      <div>
        <button className="btn btn-primary btn-sm" type="submit">
          Save {agent.name}
        </button>
      </div>
    </form>
  );
}

export function Setup({ state, dash, go }: SectionProps) {
  const steps = setupSteps(state);
  const required = steps.filter((s) => !s.optional);
  const doneCount = required.filter((s) => s.done).length;
  const firstOpen = steps.findIndex((s) => !s.done && !s.optional);
  const [email, setEmail] = useState(state.business.ownerEmail);
  const [address, setAddress] = useState(state.business.shippingAddress);
  const [deposit, setDeposit] = useState<number | null>(null);
  const missingKeys = missingVaultKeys(state);
  const readyDrafts = state.agents.filter((a) => a.status === "draft" && state.readiness.find((r) => r.agentId === a.id)?.ready);
  const tasksLeft = state.tasks.filter((t) => t.status === "todo").length;

  // Every step is visible; the next unfinished one and anything not done stays expanded.
  const isOpen = (i: number) => !steps[i]!.done || i === firstOpen;
  const s = (key: string) => steps.find((x) => x.key === key)!;
  let n = 0;

  return (
    <>
      <PageHeader
        title="Setup assistant"
        subtitle="Everything needed to get your AI team working, in order. Each step shows exactly what to do. Most are one click or one paste."
      />
      <Card>
        <div className="row between">
          <strong>
            {doneCount} of {required.length} steps done
          </strong>
          {doneCount === required.length && <Badge tone="good">Your team is running</Badge>}
        </div>
        <ProgressBar value={doneCount} max={required.length} label="Setup progress" kind="progress" />
      </Card>

      <Step n={++n} step={s("product")} open={isOpen(0)}>
        <p className="muted">Know your product? Type it in. Not sure? AI researches what sells right now and fills everything in for you.</p>
        <div className="row">
          <button className="btn btn-primary" onClick={() => go("business")}>
            Choose or research a product
          </button>
        </div>
      </Step>

      <Step n={++n} step={s("you")} open={isOpen(1)}>
        <p className="muted">Used by agents: Customer Service escalates to your email, Sourcing ships samples to your address.</p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void dash.run(() => api.updateBusiness({ ownerEmail: email, shippingAddress: address }), "Saved. Agents updated.");
          }}
        >
          <div className="form-grid">
            <Field label="Your email" htmlFor="s-email">
              <input id="s-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </Field>
            <Field label="Shipping address for samples" htmlFor="s-addr">
              <textarea id="s-addr" value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
            </Field>
          </div>
          <div>
            <button className="btn btn-primary btn-sm" type="submit" disabled={!email.trim() || !address.trim()}>
              Save
            </button>
          </div>
        </form>
      </Step>

      <Step n={++n} step={s("team")} open={isOpen(2)}>
        <p className="muted">One agent per job: {AGENT_TEMPLATES.map((t) => t.name).join(", ")}. Each gets sensible spending limits and fills in what it can from your profile.</p>
        <div className="row">
          <button className="btn btn-primary" onClick={() => void dash.run(() => api.addRecommendedTeam(), "Team added.")}>
            Add the recommended team ({AGENT_TEMPLATES.length} agents)
          </button>
          <button className="btn" onClick={() => go("agents")}>
            Pick agents myself
          </button>
        </div>
      </Step>

      <Step n={++n} step={s("economics")} open={isOpen(3)}>
        <p className="muted">Sale price and cost per unit. Filled in automatically if you picked a researched product. Sets the lowest price agents may sell at, and powers every profit number.</p>
        <div>
          <button className="btn btn-primary" onClick={() => go("financials")}>
            Enter price and costs
          </button>
        </div>
      </Step>

      <Step n={++n} step={s("keys")} open={isOpen(4)}>
        {state.agents.length === 0 ? (
          <p className="muted">Add your team first; then this lists exactly which keys it needs.</p>
        ) : missingKeys.length === 0 ? (
          <p className="muted">All keys your team needs are saved.</p>
        ) : (
          <>
            <p className="muted">
              Each key is pasted once and shared with every agent that needs it. {missingKeys.length} to go. Each has a direct link and exact steps.
            </p>
            {missingKeys.map((k) => {
              const svc = findService(k);
              return svc ? <VaultItem key={k} svc={svc} state={state} dash={dash} /> : null;
            })}
          </>
        )}
      </Step>

      <Step n={++n} step={s("details")} open={isOpen(5)}>
        {state.agents.length === 0 ? (
          <p className="muted">Add your team first.</p>
        ) : (
          <>
            <p className="muted">Most details are filled in from your profile and plan. These are the few only you can answer.</p>
            {state.agents.map((a) => (
              <AgentQuickFields key={a.id} agent={a} dash={dash} />
            ))}
            <div className="row">
              <button className="btn btn-sm" onClick={() => void dash.run(() => api.autofill(false), "Filled in what we could.")}>
                Auto-fill again
              </button>
            </div>
          </>
        )}
      </Step>

      <Step n={++n} step={s("fund")} open={isOpen(6)}>
        <p className="muted">
          Enter your starting budget. {state.allocation.auto ? "It is split across agents by job automatically." : "Then allocate it on the Funding page."} No money moves in your bank; this sets what agents may spend.
        </p>
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (deposit === null || deposit <= 0) return dash.notify("error", "Enter an amount above $0.00.");
            if (await dash.run(() => api.addFunding("deposit", deposit, "Starting budget"), `Deposited ${formatCents(deposit)}.`)) setDeposit(null);
          }}
        >
          <div style={{ width: 180 }}>
            <MoneyInput value={deposit} onChange={setDeposit} ariaLabel="Starting budget" />
          </div>
          <button className="btn btn-primary" type="submit">
            Deposit{state.allocation.auto ? " & split" : ""}
          </button>
          <button className="btn" type="button" onClick={() => go("funding")}>
            See the split
          </button>
        </form>
      </Step>

      <Step n={++n} step={s("caps")} open={isOpen(7)}>
        <p className="muted">A hard daily and monthly ceiling across all agents. Recommended: 75% of your cash per month and 35% per day, so the first inventory order still fits in one day.</p>
        <div className="row">
          <button className="btn btn-primary" disabled={state.finance.cashBalanceCents <= 0} onClick={() => void dash.run(() => api.recommendedGuardrails(), "Caps applied.")}>
            Apply recommended caps
          </button>
          <button className="btn" onClick={() => go("guardrails")}>
            Set them myself
          </button>
        </div>
      </Step>

      <Step n={++n} step={s("discord")} open={isOpen(8)}>
        <p className="muted">Each agent posts updates for its area to its own channel; approvals and a daily finance summary go to HQ.</p>
        <div>
          <button className="btn" onClick={() => go("integrations")}>
            Connect Discord
          </button>
        </div>
      </Step>

      <Step n={++n} step={s("live")} open={isOpen(9)}>
        {readyDrafts.length > 0 ? (
          <>
            <p className="muted">Ready: {readyDrafts.map((a) => a.name).join(", ")}. Then give each agent's token to the program that runs it (Agent team → agent → Connect).</p>
            <div>
              <button className="btn btn-good-solid" onClick={() => void dash.run(() => api.activateReady(), "Agents activated.")}>
                Activate {readyDrafts.length} ready agent{readyDrafts.length === 1 ? "" : "s"}
              </button>
            </div>
          </>
        ) : (
          <p className="muted">Agents activate here once their keys and details are in.</p>
        )}
      </Step>

      <Card>
        <div className="row between">
          <div>
            <h3>Legal & accounts</h3>
            <p className="muted">
              {tasksLeft === 0 ? "All done." : `${tasksLeft} step${tasksLeft === 1 ? "" : "s"} only a person can do (LLC, EIN, bank, insurance, seller accounts). Each has exact steps and links.`}
            </p>
          </div>
          <button className="btn" onClick={() => go("todo")}>
            Open checklist
          </button>
        </div>
      </Card>
    </>
  );
}
