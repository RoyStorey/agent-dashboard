/**
 * Decides, in plain code and at no token cost, whether an agent has anything
 * new to work on. Only when this finds something does the runner call the model.
 */
import { lowSupplies } from "../../shared/shipping.ts";
import { PHASE_LABEL, ROLE_FIRST_PHASE, roleActiveIn } from "../../shared/team.ts";
import type { Agent, DashboardState } from "../../shared/types.ts";
import { aiThisMonth } from "../finance.ts";
import { resolveInputs } from "../inputs.ts";

const DAY = 86_400_000;

/** Reasons that block any run, scheduled or manual. null = clear to run. */
export function blockedReason(s: DashboardState, agent: Agent, now: Date): string | null {
  if (agent.status !== "active") return `Not active (${agent.status}).`;
  if (s.guardrails.killSwitch) return "Kill switch is on.";
  if (agent.connection.provider.trim().toLowerCase() !== "anthropic") {
    return `The built-in runner uses Claude. Set this agent's provider to Anthropic, or run your own ${agent.connection.provider || "agent"} program with its token.`;
  }
  if (!(resolveInputs(s, agent).values.llm_api_key ?? "").trim()) return "No Anthropic API key. Save one on Credentials.";
  const cap = s.guardrails.aiMonthlyLimitCents;
  if (cap !== null && aiThisMonth(s, now) >= cap) return "This month's AI usage budget is used up.";
  return null;
}

/** Why a scheduled check should wait for a later phase, or null. */
export function phaseWait(s: DashboardState, agent: Agent): string | null {
  if (roleActiveIn(agent.role, s.plan.phase)) return null;
  const first = ROLE_FIRST_PHASE[agent.role] ?? "research";
  return `Waits for the “${PHASE_LABEL[first]}” phase.`;
}

export interface WorkCheck {
  /** Everything new for this agent, or null when nothing is. */
  reason: string | null;
  /** True when it's worth waking the agent before its next scheduled check (a note, a decision, a new phase). */
  urgent: boolean;
}

/**
 * What's new for this agent since its last run. "Since" is the start of its
 * last run, so anything that happened during a run is picked up next time.
 */
export function checkWork(s: DashboardState, agent: Agent, now: Date): WorkCheck {
  const since = agent.runtime.lastRunAt ? Date.parse(agent.runtime.lastRunAt) : 0;
  const after = (iso: string | null | undefined) => Boolean(iso) && Date.parse(iso as string) > since;
  const elapsed = now.getTime() - since;
  const urgent: string[] = [];
  const reasons: string[] = [];
  const role = agent.role;

  if (!agent.runtime.lastRunAt) urgent.push("getting started");
  if (agent.runtime.followUp) urgent.push(`continuing: ${agent.runtime.followUp}`);
  const notes = s.notebook.filter((n) => after(n.at) && n.authorId !== agent.id && (n.to.includes(role) || n.to.includes("all")));
  if (notes.length) urgent.push(`${notes.length} new note${notes.length === 1 ? "" : "s"} for you`);
  const decided = s.requests.filter((r) => r.agentId === agent.id && r.decidedBy === "owner" && after(r.decidedAt));
  if (decided.length) urgent.push(`the owner decided ${decided.length} of your request${decided.length === 1 ? "" : "s"}`);
  if (agent.runtime.lastRunAt && after(s.plan.phaseSince)) urgent.push(`the team moved to “${PHASE_LABEL[s.plan.phase]}”`);
  if (role === "storefront") {
    const d = s.drafts.filter((x) => x.agentId === agent.id && after(x.decidedAt)).length;
    if (d) urgent.push(`the owner reviewed ${d} draft${d === 1 ? "" : "s"}`);
  }

  switch (role) {
    case "orchestrator": {
      const finished = s.runs.filter((r) => r.agentId !== agent.id && r.status === "done" && after(r.finishedAt)).length;
      if (finished) reasons.push(`${finished} teammate run${finished === 1 ? "" : "s"} finished`);
      const tasks = s.tasks.filter((t) => after(t.completedAt)).length;
      if (tasks) reasons.push(`the owner completed ${tasks} checklist step${tasks === 1 ? "" : "s"}`);
      if (since && elapsed > DAY && reasons.length + urgent.length === 0) reasons.push("daily check-in");
      break;
    }
    case "inventory": {
      if (s.business.fulfillmentMode === "self") {
        const newOrders = s.shipments.filter((x) => after(x.createdAt)).length;
        if (newOrders) reasons.push(`${newOrders} new order${newOrders === 1 ? "" : "s"}`);
        const low = lowSupplies(s.supplies);
        const recentAsk = s.requests.some(
          (r) =>
            r.agentId === agent.id &&
            (r.action === "order_supplies" || r.action === "reorder_stock") &&
            r.status !== "denied" &&
            r.status !== "rejected" &&
            now.getTime() - Date.parse(r.createdAt) < 3 * DAY,
        );
        if (low.length && !recentAsk) reasons.push(`running low: ${low.map((x) => x.name).join(", ")}`);
      }
      break;
    }
    case "finance": {
      const sales = s.funding.filter((f) => f.type === "revenue" && after(f.createdAt)).length;
      const shipped = s.shipments.filter((x) => after(x.shippedAt)).length;
      if (sales) reasons.push("new sales recorded");
      if (shipped) reasons.push(`${shipped} order${shipped === 1 ? "" : "s"} shipped`);
      if (since && elapsed > 7 * DAY && reasons.length + urgent.length === 0) reasons.push("weekly review");
      break;
    }
    case "marketing": {
      if (since && elapsed > 7 * DAY && reasons.length + urgent.length === 0) reasons.push("weekly review");
      break;
    }
    case "research": {
      if (s.plan.phase === "operate" && since && elapsed > 14 * DAY && reasons.length + urgent.length === 0) reasons.push("fortnightly market check");
      break;
    }
  }
  const all = [...urgent, ...reasons];
  if (!all.length) return { reason: null, urgent: false };
  const text = all.join("; ");
  return { reason: text.charAt(0).toUpperCase() + text.slice(1), urgent: urgent.length > 0 };
}
