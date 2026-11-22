import { economicsComplete } from "../shared/economics.ts";
import { formatCents } from "../shared/money.ts";
import { findService } from "../shared/services.ts";
import type { Agent, AgentReadiness, DashboardState, FinanceSummary, OwnerAction } from "../shared/types.ts";
import { missingInputs, missingVaultKeys, resolveInputs, fieldVaultKeys } from "./inputs.ts";

export { missingInputs };

/** True if the agent is allowed to spend but has no budget left. */
export function needsBudget(agent: Agent, finance: FinanceSummary): boolean {
  const canSpend = agent.actions.some((a) => a.spends && agent.guardrails.allowedActions.includes(a.key));
  if (!canSpend) return false;
  const af = finance.agents.find((x) => x.agentId === agent.id);
  return (af?.remainingCents ?? 0) <= 0;
}

export function computeReadiness(state: DashboardState, finance: FinanceSummary): AgentReadiness[] {
  return state.agents.map((a) => {
    const missing = missingInputs(state, a);
    return {
      agentId: a.id,
      missingInputs: missing,
      missingVaultKeys: missingVaultKeys(state, a),
      needsBudget: needsBudget(a, finance),
      ready: missing.length === 0,
    };
  });
}

/** Required inputs that no vault entry can fill: the owner has to type them on the agent. */
function manualMissing(state: DashboardState, agent: Agent): string[] {
  const { values } = resolveInputs(state, agent);
  return agent.inputFields
    .filter((f) => f.required && (values[f.key] ?? "").trim() === "" && fieldVaultKeys(agent, f).length === 0)
    .map((f) => f.label);
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

  const running = state.research.find((r) => r.status === "running");
  const unchosen = [...state.research].reverse().find((r) => r.status === "done" && r.chosenIndex === null && r.ideas.length > 0);
  if (!b.product.trim()) {
    if (running) {
      out.push({ id: "research-running", severity: "info", title: "AI is researching product ideas", detail: "Results appear on the Business & product page in a few minutes.", section: "business" });
    } else if (unchosen) {
      out.push({ id: "research-choose", severity: "blocker", title: `Pick one of ${unchosen.ideas.length} researched product ideas`, detail: "One click fills in your business profile and unit economics.", section: "business" });
    } else {
      out.push({
        id: "business-profile",
        severity: "blocker",
        title: "Choose what to sell",
        detail: "Type it in if you know it, or let AI research the best opportunity for your budget.",
        section: "business",
      });
    }
  }

  if (b.product.trim() && !economicsComplete(state.economics)) {
    out.push({
      id: "economics",
      severity: "warning",
      title: "Enter sale price and unit cost",
      detail: "Needed for margins, break-even price and profit numbers.",
      section: "financials",
    });
  }

  if (state.agents.length === 0) {
    out.push({
      id: "no-agents",
      severity: "blocker",
      title: "Add your agent team",
      detail: "One click adds the recommended team of 8 agents.",
      section: "agents",
    });
  }

  // Credentials: one item per vault key, listing which agents it unblocks.
  const byKey = new Map<string, string[]>();
  for (const a of state.agents) {
    for (const k of missingVaultKeys(state, a)) byKey.set(k, [...(byKey.get(k) ?? []), a.name]);
  }
  for (const [key, names] of byKey) {
    const svc = findService(key);
    out.push({
      id: `vault-${key}`,
      severity: "blocker",
      title: `Paste your ${svc?.label ?? key}`,
      detail: `Unblocks ${names.length === 1 ? names[0] : `${names.length} agents (${names.join(", ")})`}. ${svc ? `Takes about ${svc.time}.` : ""}`.trim(),
      section: "credentials",
    });
  }

  for (const a of state.agents) {
    const missing = manualMissing(state, a);
    if (missing.length > 0) {
      out.push({
        id: `inputs-${a.id}`,
        severity: "blocker",
        title: `${a.name}: fill in ${missing.length} detail${missing.length === 1 ? "" : "s"}`,
        detail: missing.join(", "),
        section: "agents",
        agentId: a.id,
      });
    }
  }

  if (finance.depositedCents === 0) {
    out.push({
      id: "no-funding",
      severity: "blocker",
      title: "Fund the project",
      detail: "Enter your starting budget. It is split across agents automatically.",
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
    if (needsBudget(a, finance) && finance.depositedCents > 0) {
      out.push({
        id: `budget-${a.id}`,
        severity: "warning",
        title: `${a.name}: no budget left`,
        detail: "Use “Auto-allocate” on the Funding page or set it by hand.",
        section: "funding",
        agentId: a.id,
      });
    }
  }

  const readyDrafts = state.agents.filter((a) => a.status === "draft" && missingInputs(state, a).length === 0);
  if (readyDrafts.length > 0) {
    out.push({
      id: "activate-ready",
      severity: "info",
      title: `${readyDrafts.length} agent${readyDrafts.length === 1 ? " is" : "s are"} ready to activate`,
      detail: readyDrafts.map((a) => a.name).join(", "),
      section: "setup",
    });
  }

  const g = state.guardrails;
  if (g.dailySpendLimitCents === null && g.monthlySpendLimitCents === null) {
    out.push({
      id: "no-global-cap",
      severity: "warning",
      title: "Set a daily or monthly spending cap",
      detail: "One click applies safe caps based on your funding.",
      section: "guardrails",
    });
  }

  if (state.agents.length > 0 && !(state.discord.enabled && state.discord.defaultWebhookUrl)) {
    out.push({
      id: "discord",
      severity: "info",
      title: "Connect Discord for team updates",
      detail: "Each agent posts its updates to its own channel; approvals and finance go to HQ.",
      section: "integrations",
    });
  }

  if (finance.unallocatedCents < 0) {
    out.push({
      id: "over-allocated",
      severity: "warning",
      title: "Agent budgets exceed available cash",
      detail: `Budgets are over cash by ${formatCents(-finance.unallocatedCents)}. Deposit funds or click Rebalance on the Funding page.`,
      section: "funding",
    });
  }

  // Steps waiting on an unbuilt dashboard feature can't be done yet, so they don't count.
  const openTasks = state.tasks.filter((t) => t.status === "todo" && !t.waitsFor).length;
  if (openTasks > 0) {
    out.push({
      id: "open-tasks",
      severity: "info",
      title: `${openTasks} step${openTasks === 1 ? "" : "s"} only you can do (legal, accounts, real money)`,
      detail: "Each has exact steps, direct links, and a tag showing whether it moves real money or is accounting only.",
      section: "todo",
    });
  }

  const rank = { blocker: 0, warning: 1, info: 2 } as const;
  return out.sort((x, y) => rank[x.severity] - rank[y.severity]);
}
