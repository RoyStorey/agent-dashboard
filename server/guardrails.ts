import { formatCents } from "../shared/money.ts";
import type { Agent, DashboardState } from "../shared/types.ts";
import { computeFinance, spentThisMonth, spentToday, agentSpentToday } from "./finance.ts";
import { missingInputs } from "./inputs.ts";

export type Decision = "approved" | "pending_approval" | "denied";

export interface Evaluation {
  decision: Decision;
  reasons: string[];
}

export interface SpendProposal {
  action: string;
  amountCents: number;
}

/**
 * Hard limits: anything that fails here is denied outright and can never be
 * approved by the owner without first changing the guardrails or funding.
 * Pending requests commit no money, so they are re-checked here when the
 * owner approves them.
 */
export function hardLimitViolations(
  state: DashboardState,
  agent: Agent,
  proposal: SpendProposal,
  now: Date,
): string[] {
  const reasons: string[] = [];
  const g = state.guardrails;
  const ag = agent.guardrails;

  if (g.killSwitch) reasons.push("Kill switch is on: all agent activity is stopped.");
  if (agent.status !== "active") reasons.push(`Agent is ${agent.status}, not active.`);

  const missing = missingInputs(state, agent);
  if (missing.length > 0) reasons.push(`Agent is missing required inputs: ${missing.join(", ")}.`);

  const def = agent.actions.find((a) => a.key === proposal.action);
  if (!def) {
    reasons.push(`Unknown action "${proposal.action}" for this agent.`);
  } else if (!ag.allowedActions.includes(proposal.action)) {
    reasons.push(`Action "${def.label}" is not allowed for this agent.`);
  }

  const amount = proposal.amountCents;
  if (amount > 0) {
    if (def && !def.spends) reasons.push(`Action "${def.label}" is not a spending action.`);

    if (ag.perTransactionLimitCents !== null && amount > ag.perTransactionLimitCents) {
      reasons.push(`Exceeds this agent's per-transaction limit of ${formatCents(ag.perTransactionLimitCents)}.`);
    }
    if (g.perTransactionLimitCents !== null && amount > g.perTransactionLimitCents) {
      reasons.push(`Exceeds the global per-transaction limit of ${formatCents(g.perTransactionLimitCents)}.`);
    }

    const finance = computeFinance(state, now);
    const af = finance.agents.find((a) => a.agentId === agent.id);
    const remaining = af?.remainingCents ?? 0;
    if (amount > remaining) {
      reasons.push(`Exceeds this agent's remaining budget of ${formatCents(remaining)}.`);
    }
    if (amount > finance.cashBalanceCents) {
      reasons.push(`Exceeds available cash of ${formatCents(Math.max(0, finance.cashBalanceCents))}.`);
    }

    if (ag.dailySpendLimitCents !== null) {
      const today = agentSpentToday(state, agent.id, now);
      if (today + amount > ag.dailySpendLimitCents) {
        reasons.push(
          `Would exceed this agent's daily limit of ${formatCents(ag.dailySpendLimitCents)} (already ${formatCents(today)} today).`,
        );
      }
    }
    if (g.dailySpendLimitCents !== null) {
      const today = spentToday(state, now);
      if (today + amount > g.dailySpendLimitCents) {
        reasons.push(
          `Would exceed the global daily limit of ${formatCents(g.dailySpendLimitCents)} (already ${formatCents(today)} today).`,
        );
      }
    }
    if (g.monthlySpendLimitCents !== null) {
      const month = spentThisMonth(state, now);
      if (month + amount > g.monthlySpendLimitCents) {
        reasons.push(
          `Would exceed the global monthly limit of ${formatCents(g.monthlySpendLimitCents)} (already ${formatCents(month)} this month).`,
        );
      }
    }
  }
  return reasons;
}

/** Soft rules: the request is allowed, but only once the owner approves it. */
export function approvalReasons(state: DashboardState, agent: Agent, proposal: SpendProposal): string[] {
  const reasons: string[] = [];
  const amount = proposal.amountCents;
  if (agent.guardrails.approvalRequiredActions.includes(proposal.action)) {
    reasons.push("This action always requires owner approval.");
  }
  const at = agent.guardrails.approvalThresholdCents;
  if (amount > 0 && at !== null && amount >= at) {
    reasons.push(`Amount is at or above this agent's approval threshold of ${formatCents(at)}.`);
  }
  const gt = state.guardrails.approvalThresholdCents;
  if (amount > 0 && gt !== null && amount >= gt) {
    reasons.push(`Amount is at or above the global approval threshold of ${formatCents(gt)}.`);
  }
  return reasons;
}

export function evaluate(state: DashboardState, agent: Agent, proposal: SpendProposal, now: Date): Evaluation {
  const hard = hardLimitViolations(state, agent, proposal, now);
  if (hard.length > 0) return { decision: "denied", reasons: hard };
  const soft = approvalReasons(state, agent, proposal);
  if (soft.length > 0) return { decision: "pending_approval", reasons: soft };
  return { decision: "approved", reasons: ["Within all guardrails."] };
}
