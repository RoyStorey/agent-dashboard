import { CUSTOM_ROLE, findTemplate } from "../shared/templates.ts";
import type { Agent, AgentView } from "../shared/types.ts";
import { newId, newToken } from "./store.ts";

export function createAgent(role: string, name: string | undefined, now: Date): Agent {
  const t = findTemplate(role);
  const base: Agent = {
    id: newId(),
    name: name?.trim() || t?.name || "Custom agent",
    role: t ? t.role : CUSTOM_ROLE,
    description: t?.description ?? "",
    status: "draft",
    connection: { provider: "Anthropic", model: "claude-opus-5-5", runtime: "" },
    inputFields: t ? structuredClone(t.inputFields) : [],
    inputs: {},
    responsibilities: t ? [...t.responsibilities] : [],
    actions: t ? structuredClone(t.actions) : [],
    guardrails: {
      perTransactionLimitCents: t?.defaults.perTransactionLimitCents ?? 0,
      dailySpendLimitCents: t?.defaults.dailySpendLimitCents ?? 0,
      approvalThresholdCents: t?.defaults.approvalThresholdCents ?? null,
      allowedActions: t ? t.actions.map((a) => a.key) : [],
      approvalRequiredActions: t ? t.actions.filter((a) => a.approvalByDefault).map((a) => a.key) : [],
    },
    budgetCents: 0,
    apiToken: newToken(),
    createdAt: now.toISOString(),
    lastSeenAt: null,
    lastStatusMessage: null,
  };
  return base;
}

export function maskToken(token: string): string {
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}

/** The owner UI never receives secret values or the full API token. */
export function toView(agent: Agent): AgentView {
  const inputs: Record<string, string> = {};
  const secretsSet: Record<string, boolean> = {};
  for (const f of agent.inputFields) {
    const v = agent.inputs[f.key] ?? "";
    if (f.kind === "secret") {
      secretsSet[f.key] = v.trim() !== "";
      inputs[f.key] = "";
    } else {
      inputs[f.key] = v;
    }
  }
  const { apiToken, inputs: _omit, ...rest } = agent;
  void _omit;
  return { ...rest, inputs, secretsSet, apiTokenPreview: maskToken(apiToken) };
}
