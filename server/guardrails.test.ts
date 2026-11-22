import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActionRequest, Agent, DashboardState } from "../shared/types.ts";
import { createAgent } from "./agents.ts";
import { computeFinance } from "./finance.ts";
import { evaluate } from "./guardrails.ts";
import { computeOwnerActions } from "./readiness.ts";
import { defaultState, newId } from "./store.ts";

const NOW = new Date(2026, 10, 22, 12, 0, 0);

function setup(): { state: DashboardState; agent: Agent } {
  const state = defaultState();
  state.guardrails.approvalThresholdCents = null;
  const agent = createAgent("sourcing", undefined, NOW);
  for (const f of agent.inputFields) agent.inputs[f.key] = "x";
  agent.status = "active";
  agent.budgetCents = 100_000;
  agent.guardrails = {
    perTransactionLimitCents: 50_000,
    dailySpendLimitCents: 60_000,
    approvalThresholdCents: null,
    allowedActions: agent.actions.map((a) => a.key),
    approvalRequiredActions: [],
  };
  state.agents.push(agent);
  state.funding.push({ id: newId(), type: "deposit", amountCents: 200_000, note: "", agentId: null, createdAt: NOW.toISOString() });
  return { state, agent };
}

function spend(state: DashboardState, agentId: string, amountCents: number, at: Date, status: ActionRequest["status"] = "completed"): void {
  state.requests.push({
    id: newId(),
    agentId,
    action: "order_samples",
    description: "",
    amountCents,
    actualAmountCents: status === "completed" ? amountCents : null,
    status,
    reasons: [],
    createdAt: at.toISOString(),
    decidedAt: at.toISOString(),
    decidedBy: "guardrails",
    closedAt: null,
    resultNote: "",
  });
}

describe("guardrails", () => {
  it("approves a request within every limit", () => {
    const { state, agent } = setup();
    const e = evaluate(state, agent, { action: "order_samples", amountCents: 10_000 }, NOW);
    assert.equal(e.decision, "approved");
  });

  it("denies everything when the kill switch is on", () => {
    const { state, agent } = setup();
    state.guardrails.killSwitch = true;
    const e = evaluate(state, agent, { action: "request_quote", amountCents: 0 }, NOW);
    assert.equal(e.decision, "denied");
    assert.match(e.reasons.join(" "), /Kill switch/);
  });

  it("denies inactive agents and agents missing required inputs", () => {
    const { state, agent } = setup();
    agent.status = "paused";
    assert.equal(evaluate(state, agent, { action: "request_quote", amountCents: 0 }, NOW).decision, "denied");
    agent.status = "active";
    agent.inputs["llm_api_key"] = "";
    const e = evaluate(state, agent, { action: "request_quote", amountCents: 0 }, NOW);
    assert.equal(e.decision, "denied");
    assert.match(e.reasons.join(" "), /LLM API key/);
  });

  it("denies actions that are unknown or not allowed", () => {
    const { state, agent } = setup();
    assert.equal(evaluate(state, agent, { action: "launch_rocket", amountCents: 0 }, NOW).decision, "denied");
    agent.guardrails.allowedActions = ["request_quote"];
    assert.equal(evaluate(state, agent, { action: "order_samples", amountCents: 100 }, NOW).decision, "denied");
  });

  it("denies money on a non-spending action", () => {
    const { state, agent } = setup();
    assert.equal(evaluate(state, agent, { action: "request_quote", amountCents: 100 }, NOW).decision, "denied");
  });

  it("enforces per-transaction limits (agent and global)", () => {
    const { state, agent } = setup();
    assert.equal(evaluate(state, agent, { action: "order_samples", amountCents: 50_000 }, NOW).decision, "approved");
    assert.equal(evaluate(state, agent, { action: "order_samples", amountCents: 50_001 }, NOW).decision, "denied");
    state.guardrails.perTransactionLimitCents = 1_000;
    assert.equal(evaluate(state, agent, { action: "order_samples", amountCents: 1_001 }, NOW).decision, "denied");
  });

  it("enforces the agent's remaining budget", () => {
    const { state, agent } = setup();
    agent.guardrails.dailySpendLimitCents = null;
    spend(state, agent.id, 95_000, new Date(2026, 9, 1));
    assert.equal(evaluate(state, agent, { action: "order_samples", amountCents: 5_000 }, NOW).decision, "approved");
    assert.equal(evaluate(state, agent, { action: "order_samples", amountCents: 5_001 }, NOW).decision, "denied");
  });

  it("counts approved-but-not-completed requests and ignores cancelled ones", () => {
    const { state, agent } = setup();
    spend(state, agent.id, 50_000, NOW, "approved");
    spend(state, agent.id, 50_000, NOW, "cancelled");
    assert.equal(computeFinance(state, NOW).agents[0]?.spentCents, 50_000);
    // Daily limit is 60_000; 50_000 already committed today.
    assert.equal(evaluate(state, agent, { action: "order_samples", amountCents: 10_000 }, NOW).decision, "approved");
    assert.equal(evaluate(state, agent, { action: "order_samples", amountCents: 10_001 }, NOW).decision, "denied");
  });

  it("resets the daily limit on a new calendar day", () => {
    const { state, agent } = setup();
    spend(state, agent.id, 60_000, new Date(2026, 10, 21, 23, 59));
    assert.equal(evaluate(state, agent, { action: "order_samples", amountCents: 30_000 }, NOW).decision, "approved");
  });

  it("enforces global daily and monthly caps across all agents", () => {
    const { state, agent } = setup();
    const other = createAgent("marketing", undefined, NOW);
    state.agents.push(other);
    spend(state, other.id, 20_000, NOW);
    spend(state, other.id, 30_000, new Date(2026, 10, 2));
    state.guardrails.dailySpendLimitCents = 25_000;
    assert.equal(evaluate(state, agent, { action: "order_samples", amountCents: 5_000 }, NOW).decision, "approved");
    assert.equal(evaluate(state, agent, { action: "order_samples", amountCents: 5_001 }, NOW).decision, "denied");
    state.guardrails.dailySpendLimitCents = null;
    state.guardrails.monthlySpendLimitCents = 60_000;
    assert.equal(evaluate(state, agent, { action: "order_samples", amountCents: 10_000 }, NOW).decision, "approved");
    assert.equal(evaluate(state, agent, { action: "order_samples", amountCents: 10_001 }, NOW).decision, "denied");
  });

  it("never spends more cash than exists", () => {
    const { state, agent } = setup();
    state.funding = [{ id: newId(), type: "deposit", amountCents: 1_000, note: "", agentId: null, createdAt: NOW.toISOString() }];
    assert.equal(evaluate(state, agent, { action: "order_samples", amountCents: 1_001 }, NOW).decision, "denied");
  });

  it("routes to owner approval by action or threshold", () => {
    const { state, agent } = setup();
    agent.guardrails.approvalRequiredActions = ["place_purchase_order"];
    assert.equal(evaluate(state, agent, { action: "place_purchase_order", amountCents: 100 }, NOW).decision, "pending_approval");
    agent.guardrails.approvalThresholdCents = 2_000;
    assert.equal(evaluate(state, agent, { action: "order_samples", amountCents: 1_999 }, NOW).decision, "approved");
    assert.equal(evaluate(state, agent, { action: "order_samples", amountCents: 2_000 }, NOW).decision, "pending_approval");
    agent.guardrails.approvalThresholdCents = null;
    state.guardrails.approvalThresholdCents = 500;
    assert.equal(evaluate(state, agent, { action: "order_samples", amountCents: 500 }, NOW).decision, "pending_approval");
    // Zero-cost actions are never held for amount-based approval.
    assert.equal(evaluate(state, agent, { action: "request_quote", amountCents: 0 }, NOW).decision, "approved");
  });

  it("prefers deny over approval when both apply", () => {
    const { state, agent } = setup();
    agent.guardrails.approvalRequiredActions = ["order_samples"];
    assert.equal(evaluate(state, agent, { action: "order_samples", amountCents: 999_999 }, NOW).decision, "denied");
  });
});

describe("finance", () => {
  it("computes balances in integer cents", () => {
    const { state, agent } = setup();
    state.funding.push({ id: newId(), type: "revenue", amountCents: 1_999, note: "", agentId: null, createdAt: NOW.toISOString() });
    state.funding.push({ id: newId(), type: "withdrawal", amountCents: 1_000, note: "", agentId: null, createdAt: NOW.toISOString() });
    spend(state, agent.id, 333, NOW);
    const f = computeFinance(state, NOW);
    assert.equal(f.cashBalanceCents, 200_000 + 1_999 - 1_000 - 333);
    assert.equal(f.profitCents, 1_999 - 333);
    assert.equal(f.allocatedRemainingCents, 100_000 - 333);
    assert.equal(f.unallocatedCents, f.cashBalanceCents - f.allocatedRemainingCents);
  });
});

describe("owner actions", () => {
  it("lists blockers for a brand new business", () => {
    const state = defaultState();
    const ids = computeOwnerActions(state, computeFinance(state, NOW)).map((a) => a.id);
    assert.ok(ids.includes("business-profile"));
    assert.ok(ids.includes("no-agents"));
    assert.ok(ids.includes("no-funding"));
    assert.ok(ids.includes("open-tasks"));
  });

  it("lists missing agent inputs", () => {
    const state = defaultState();
    const agent = createAgent("research", undefined, NOW);
    state.agents.push(agent);
    const a = computeOwnerActions(state, computeFinance(state, NOW)).find((x) => x.id === `inputs-${agent.id}`);
    assert.ok(a);
    assert.match(a.detail, /LLM API key/);
  });
});
