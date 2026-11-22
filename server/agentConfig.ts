import { lowSupplies } from "../shared/shipping.ts";
import type { Agent, DashboardState } from "../shared/types.ts";
import { aiThisMonth, computeFinance } from "./finance.ts";
import { priceFloorCents } from "./guardrails.ts";
import { missingInputs, resolveInputs } from "./inputs.ts";

/** Everything an agent needs to know about itself and the business (served at GET /api/agent/v1/config). */
export function agentConfig(state: DashboardState, agent: Agent, t: Date) {
  const finance = computeFinance(state, t);
  const af = finance.agents.find((a) => a.agentId === agent.id);
  const aiMonth = aiThisMonth(state, t);
  return {
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      description: agent.description,
      status: agent.status,
      responsibilities: agent.responsibilities,
      connection: agent.connection,
    },
    business: state.business,
    economics: state.economics,
    inputs: resolveInputs(state, agent).values,
    inputFields: agent.inputFields.map((f) => ({ key: f.key, label: f.label, kind: f.kind, required: f.required })),
    missingInputs: missingInputs(state, agent),
    fulfillment: {
      mode: state.business.fulfillmentMode,
      supplies: state.supplies,
      lowSupplies: lowSupplies(state.supplies),
      toPackCount: state.shipments.filter((sh) => sh.status === "to_pack").length,
    },
    reporting: { discord: state.discord.enabled && Boolean(state.discord.agentWebhooks[agent.id] || state.discord.defaultWebhookUrl) },
    actions: agent.actions.map((a) => ({
      ...a,
      allowed: agent.guardrails.allowedActions.includes(a.key),
      alwaysRequiresApproval: agent.guardrails.approvalRequiredActions.includes(a.key),
    })),
    guardrails: {
      killSwitch: state.guardrails.killSwitch,
      agent: {
        perTransactionLimitCents: agent.guardrails.perTransactionLimitCents,
        dailySpendLimitCents: agent.guardrails.dailySpendLimitCents,
        approvalThresholdCents: agent.guardrails.approvalThresholdCents,
      },
      ai: {
        monthlyLimitCents: state.guardrails.aiMonthlyLimitCents,
        monthCostCents: aiMonth,
        overLimit: state.guardrails.aiMonthlyLimitCents !== null && aiMonth >= state.guardrails.aiMonthlyLimitCents,
      },
      priceFloorCents: priceFloorCents(state, agent),
      global: {
        perTransactionLimitCents: state.guardrails.perTransactionLimitCents,
        dailySpendLimitCents: state.guardrails.dailySpendLimitCents,
        monthlySpendLimitCents: state.guardrails.monthlySpendLimitCents,
        approvalThresholdCents: state.guardrails.approvalThresholdCents,
      },
    },
    budget: af,
    serverTime: t.toISOString(),
  };
}
