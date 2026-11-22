/**
 * What an agent can do, in one place. The HTTP agent API and the built-in
 * runner both call these, so the same guardrails, logging and Discord routing
 * apply however an agent connects. Every function runs inside store.mutate().
 */
import { estimateCostCents, type UsageCounts } from "../shared/aiPricing.ts";
import { formatCents } from "../shared/money.ts";
import type { ActionRequest, Agent, DashboardState, Shipment } from "../shared/types.ts";
import { autoAllocate } from "./allocate.ts";
import { aiThisMonth } from "./finance.ts";
import { evaluate, hardLimitViolations } from "./guardrails.ts";
import { logQueued, parseShipment } from "./shippingInput.ts";
import { log, newId } from "./store.ts";
import { HttpError, bad, type Body } from "./validate.ts";

export function actionLabel(agent: Agent | undefined, key: string): string {
  return agent?.actions.find((a) => a.key === key)?.label ?? key;
}

export function agentById(s: DashboardState, agentId: string): Agent {
  const agent = s.agents.find((a) => a.id === agentId);
  if (!agent) throw new HttpError(401, "Agent no longer exists.");
  return agent;
}

export function touch(agent: Agent, at: Date): void {
  agent.lastSeenAt = at.toISOString();
}

export interface RevenueInput {
  amountCents: number;
  grossSalesCents?: number;
  refundsCents?: number;
  feesCents?: number;
  unitsSold?: number;
}

export function revenueFields(rev: RevenueInput): Array<{ name: string; value: string }> {
  const out = [{ name: "Net payout", value: formatCents(rev.amountCents) }];
  if (rev.grossSalesCents !== undefined) out.unshift({ name: "Gross sales", value: formatCents(rev.grossSalesCents) });
  if (rev.refundsCents) out.push({ name: "Refunds", value: formatCents(rev.refundsCents) });
  if (rev.feesCents) out.push({ name: "Fees", value: formatCents(rev.feesCents) });
  if (rev.unitsSold !== undefined) out.push({ name: "Units", value: String(rev.unitsSold) });
  return out;
}

export function submitAction(
  s: DashboardState,
  agentId: string,
  input: { action: string; description: string; amountCents: number; priceCents?: number; meta?: Record<string, string> },
  t: Date,
): ActionRequest {
  const agent = agentById(s, agentId);
  touch(agent, t);
  const { action, description, amountCents, priceCents } = input;
  const ev = evaluate(s, agent, { action, amountCents, priceCents }, t);
  const r: ActionRequest = {
    id: newId(),
    agentId: agent.id,
    action,
    description,
    amountCents,
    priceCents: priceCents ?? null,
    actualAmountCents: null,
    status: ev.decision,
    reasons: ev.reasons,
    createdAt: t.toISOString(),
    decidedAt: ev.decision === "pending_approval" ? null : t.toISOString(),
    decidedBy: ev.decision === "pending_approval" ? null : "guardrails",
    closedAt: null,
    resultNote: "",
    ...(input.meta ? { meta: input.meta } : {}),
  };
  s.requests.push(r);
  const money = (amountCents > 0 ? ` for ${formatCents(amountCents)}` : "") + (priceCents !== undefined ? ` at a price of ${formatCents(priceCents)}` : "");
  const label = actionLabel(agent, action);
  const extra = { agentId: agent.id, amountCents, fields: description ? [{ name: "Why", value: description }] : undefined };
  if (ev.decision === "approved") log(s, agent.name, "info", `Approved: ${label}${money}.`, t, { ...extra, kind: "request_approved" });
  else if (ev.decision === "pending_approval")
    log(s, agent.name, "warning", `Needs your approval: ${label}${money}. ${ev.reasons.join(" ")}`, t, {
      ...extra,
      kind: "request_pending",
      title: `Approval needed: ${agent.name} wants to ${label.toLowerCase()}${money}`,
    });
  else log(s, agent.name, "error", `Denied: ${label}${money}. ${ev.reasons.join(" ")}`, t, { ...extra, kind: "request_denied" });
  return r;
}

export function ownRequest(s: DashboardState, agentId: string, requestId: string): { agent: Agent; request: ActionRequest } {
  const agent = agentById(s, agentId);
  const request = s.requests.find((r) => r.id === requestId && r.agentId === agent.id);
  if (!request) throw new HttpError(404, "Request not found.");
  return { agent, request };
}

export function completeAction(s: DashboardState, agentId: string, requestId: string, actual: number | undefined, note: string, t: Date): ActionRequest {
  const { agent, request } = ownRequest(s, agentId, requestId);
  if (request.status !== "approved") throw new HttpError(409, `Only approved requests can be completed (this one is ${request.status}).`);
  const finalAmount = actual ?? request.amountCents;
  if (finalAmount > request.amountCents) {
    throw new HttpError(409, `Actual amount ${formatCents(finalAmount)} exceeds the approved ${formatCents(request.amountCents)}. Submit a new request for the difference.`);
  }
  touch(agent, t);
  request.status = "completed";
  request.actualAmountCents = finalAmount;
  request.closedAt = t.toISOString();
  request.resultNote = note;
  const money = finalAmount > 0 ? ` (${formatCents(finalAmount)})` : "";
  log(s, agent.name, "success", `Completed: ${actionLabel(agent, request.action)}${money}. ${note}`.trim(), t, {
    kind: "request_closed",
    agentId: agent.id,
    amountCents: finalAmount,
  });
  return request;
}

export function cancelAction(s: DashboardState, agentId: string, requestId: string, note: string, t: Date): ActionRequest {
  const { agent, request } = ownRequest(s, agentId, requestId);
  if (request.status !== "approved" && request.status !== "pending_approval") {
    throw new HttpError(409, `Only approved or pending requests can be cancelled (this one is ${request.status}).`);
  }
  touch(agent, t);
  request.status = "cancelled";
  request.closedAt = t.toISOString();
  request.resultNote = note;
  log(s, agent.name, "info", `Cancelled: ${actionLabel(agent, request.action)}. ${note}`.trim(), t, { kind: "log", agentId: agent.id });
  return request;
}

export function reportRevenue(s: DashboardState, agentId: string, rev: RevenueInput, note: string, t: Date) {
  const agent = agentById(s, agentId);
  touch(agent, t);
  const problems = hardLimitViolations(s, agent, { action: "report_revenue", amountCents: 0 }, t);
  if (problems.length > 0) throw new HttpError(403, problems.join(" "));
  const e = { id: newId(), type: "revenue" as const, ...rev, note, agentId: agent.id, createdAt: t.toISOString() };
  s.funding.push(e);
  log(s, agent.name, "success", `Reported revenue: ${formatCents(rev.amountCents)} net payout. ${note}`.trim(), t, {
    kind: "revenue",
    agentId: agent.id,
    amountCents: rev.amountCents,
    title: "Sales reported",
    fields: revenueFields(rev),
  });
  if (s.allocation.auto) autoAllocate(s, t, "revenue");
  return e;
}

/** Records AI usage. agentId null = the dashboard itself (e.g. product research). Warns once when the monthly cap is crossed. */
export function recordUsage(
  s: DashboardState,
  agentId: string | null,
  input: { model: string; label: string; counts: UsageCounts; costCents?: number },
  t: Date,
): { monthCostCents: number; limitCents: number | null; overLimit: boolean; costCents: number } {
  const costCents = input.costCents ?? estimateCostCents(input.model, input.counts);
  if (costCents === null) throw bad(`No price list for model "${input.model}". Include "costCents" with the cost you were charged.`);
  const agent = agentId ? agentById(s, agentId) : null;
  if (agent) touch(agent, t);
  const before = aiThisMonth(s, t);
  s.aiUsage.push({ id: newId(), at: t.toISOString(), agentId, label: input.label || agent?.name || "Dashboard", model: input.model, ...input.counts, costCents });
  const after = before + costCents;
  const limit = s.guardrails.aiMonthlyLimitCents;
  if (limit !== null && before < limit && after >= limit) {
    log(s, "System", "error", `AI usage budget reached: ${formatCents(after)} of ${formatCents(limit)} this month. Agent requests are now denied until next month or until you raise the cap on Guardrails.`, t, {
      kind: "system",
      title: "AI usage budget reached",
    });
  }
  return { monthCostCents: after, limitCents: limit, overLimit: limit !== null && after >= limit, costCents };
}

export function queueShipment(s: DashboardState, agentId: string, body: Body, t: Date): Shipment {
  const agent = agentById(s, agentId);
  touch(agent, t);
  if (s.guardrails.killSwitch) throw new HttpError(403, "Kill switch is on: all agent activity is stopped.");
  const sh = parseShipment(s, body, agent.name, t);
  if (sh.orderRef && s.shipments.some((x) => x.orderRef === sh.orderRef && x.status !== "cancelled")) {
    throw new HttpError(409, `Order ${sh.orderRef} is already in the packing queue.`);
  }
  s.shipments.push(sh);
  logQueued(s, sh, agent.name, t);
  return sh;
}

export function adjustSupply(s: DashboardState, agentId: string, supplyId: string, delta: number, note: string, t: Date) {
  if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 1_000_000) throw bad('"delta" must be a non-zero whole number.');
  const agent = agentById(s, agentId);
  const item = s.supplies.find((x) => x.id === supplyId);
  if (!item) throw new HttpError(404, "Stock item not found.");
  touch(agent, t);
  item.onHand += delta;
  log(s, agent.name, "info", `${delta > 0 ? "Added" : "Removed"} ${Math.abs(delta)} ${item.unit} of ${item.name} (now ${item.onHand}). ${note}`.trim(), t, { kind: "log", agentId: agent.id });
  return item;
}

export function writeReport(s: DashboardState, agentId: string, title: string, text: string, fields: Array<{ name: string; value: string }> | undefined, t: Date) {
  const agent = agentById(s, agentId);
  touch(agent, t);
  return log(s, agent.name, "info", text, t, { kind: "report", agentId: agent.id, title, fields });
}
