import { formatCents } from "../shared/money.ts";
import type { Agent, AgentReadiness, DashboardState, FinanceSummary, OwnerAction } from "../shared/types.ts";

export function missingInputs(agent: Agent): string[] {
  return agent.inputFields
    .filter((f) => f.required && (agent.inputs[f.key] ?? "").trim() === "")
    .map((f) => f.label);
}

/** True if the agent is allowed to spend but has no budget allocated. */
export function needsBudget(agent: Agent, finance: FinanceSummary): boolean {
  const canSpend = agent.actions.some((a) => a.spends && agent.guardrails.allowedActions.includes(a.key));
  if (!canSpend) return false;
  const af = finance.agents.find((x) => x.agentId === agent.id);
  return (af?.remainingCents ?? 0) <= 0;
}

export function computeReadiness(state: DashboardState, finance: FinanceSummary): AgentReadiness[] {
  return state.agents.map((a) => {
    const missing = missingInputs(a);
    const budget = needsBudget(a, finance);
    return { agentId: a.id, missingInputs: missing, needsBudget: budget, ready: missing.length === 0 };
  });
}

/**
 * Everything the owner must do for the business to run, derived from the
 * current state. Ordered blockers first.
 */
export function computeOwnerActions(state: DashboardState, finance: FinanceSummary): OwnerAction[] {
  const out: OwnerAction[] = [];
  const b = state.business;

  if (state.guardrails.killSwitch) {
    out.push({
      id: "kill-switch",
      severity: "blocker",
      title: "Kill switch is ON",
      detail: "Every agent request is being denied. Turn it off on the Guardrails page when you are ready.",
      section: "guardrails",
    });
  }

  if (!b.name.trim() || !b.product.trim()) {
    out.push({
      id: "business-profile",
      severity: "blocker",
      title: "Describe your business and product",
      detail: "Agents receive this profile so they know what they are selling.",
      section: "business",
    });
  }

  if (state.agents.length === 0) {
    out.push({
      id: "no-agents",
      severity: "blocker",
      title: "Add your agent team",
      detail: "Add agents from templates (Research, Sourcing, Storefront, ...) on the Agent Team page.",
      section: "agents",
    });
  }

  if (finance.depositedCents === 0) {
    out.push({
      id: "no-funding",
      severity: "blocker",
      title: "Fund the project",
      detail: "Deposit a starting budget. Agents cannot spend anything until money is allocated to them.",
      section: "funding",
    });
  }

  const pending = state.requests.filter((r) => r.status === "pending_approval");
  if (pending.length > 0) {
    out.push({
      id: "pending-approvals",
      severity: "blocker",
      title: `${pending.length} request${pending.length === 1 ? "" : "s"} waiting for your approval`,
      detail: "Agents are blocked until you approve or reject.",
      section: "approvals",
    });
  }

  for (const a of state.agents) {
    const missing = missingInputs(a);
    if (missing.length > 0) {
      out.push({
        id: `inputs-${a.id}`,
        severity: "blocker",
        title: `${a.name}: provide ${missing.length} required input${missing.length === 1 ? "" : "s"}`,
        detail: missing.join(", "),
        section: "agents",
        agentId: a.id,
      });
    }
  }

  for (const a of state.agents) {
    if (needsBudget(a, finance)) {
      out.push({
        id: `budget-${a.id}`,
        severity: "warning",
        title: `${a.name}: allocate a budget`,
        detail: "This agent has spending actions enabled but no remaining budget.",
        section: "funding",
        agentId: a.id,
      });
    }
  }

  for (const a of state.agents) {
    if (a.status === "draft" && missingInputs(a).length === 0) {
      out.push({
        id: `activate-${a.id}`,
        severity: "info",
        title: `${a.name} is configured but not active`,
        detail: "Activate it on the Agent Team page when you are ready.",
        section: "agents",
        agentId: a.id,
      });
    }
  }

  const g = state.guardrails;
  if (g.dailySpendLimitCents === null && g.monthlySpendLimitCents === null) {
    out.push({
      id: "no-global-cap",
      severity: "warning",
      title: "Set a global daily or monthly spending cap",
      detail: "A hard ceiling protects you if an agent misbehaves.",
      section: "guardrails",
    });
  }

  if (finance.unallocatedCents < 0) {
    out.push({
      id: "over-allocated",
      severity: "warning",
      title: "Agent budgets exceed available cash",
      detail: `Budgets are over cash by ${formatCents(-finance.unallocatedCents)}. Deposit funds or reduce budgets.`,
      section: "funding",
    });
  }

  const openTasks = state.tasks.filter((t) => t.status === "todo").length;
  if (openTasks > 0) {
    out.push({
      id: "open-tasks",
      severity: "info",
      title: `${openTasks} setup task${openTasks === 1 ? "" : "s"} left on your checklist`,
      detail: "These need a human: legal, banking, accounts and approvals.",
      section: "todo",
    });
  }

  const rank = { blocker: 0, warning: 1, info: 2 } as const;
  return out.sort((x, y) => rank[x.severity] - rank[y.severity]);
}
