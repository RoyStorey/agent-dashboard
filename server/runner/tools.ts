/**
 * The tools the built-in runner gives each agent. Each role gets only the
 * tools it needs: fewer tool definitions mean fewer input tokens per call.
 *
 * Tool inputs are not validated by the SDK, so every run() checks its own.
 * Every change goes through agentOps, so guardrails and logging are the same
 * as for agents that connect over the HTTP API.
 */
import { formatCents } from "../../shared/money.ts";
import { PHASES, PHASE_LABEL } from "../../shared/team.ts";
import type { Agent, DashboardState, StoreDraft } from "../../shared/types.ts";
import { addNote, adjustSupply, agentById, cancelAction, completeAction, setPhase, submitAction } from "../agentOps.ts";
import { priceFloorCents } from "../guardrails.ts";
import { log, newId, type Store } from "../store.ts";
import { HttpError } from "../validate.ts";

/** The Shopify calls agents may make. ShopifyService implements it; tests pass a fake. */
export interface ShopifyTools {
  listProducts(): Promise<Array<{ id: string; title: string; status: string; price: string | null }>>;
  createProductDraft(input: { title: string; descriptionHtml: string; productType: string; tags: string[]; priceCents: number }): Promise<string>;
  createPageDraft(input: { title: string; bodyHtml: string }): Promise<string>;
  salesSummary(days: number): Promise<{ days: number; orders: number; units: number; grossCents: number; refundedCents: number; currency: string }>;
}

export interface ToolContext {
  store: Store;
  agentId: string;
  now: () => Date;
  /** null when Shopify isn't connected. */
  shopify: ShopifyTools | null;
  /** Per-run counters, to stop a run from flooding the notebook or the store. */
  counters: { notes: number; drafts: number };
}

type Input = Record<string, unknown>;

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
  /** A short, owner-readable description of this call for the live board. */
  label(input: Input): string;
  run(input: Input, ctx: ToolContext): Promise<string> | string;
}

/** A mistake in the model's input: the message goes back to the model so it can correct itself. */
export class ToolInputError extends Error {}

export const MAX_NOTES_PER_RUN = 4;
export const MAX_DRAFTS_PER_RUN = 3;
export const MAX_PENDING_DRAFTS = 10;

/* ---------- input helpers ---------- */

function text(input: Input, key: string, max: number, required = true): string {
  const v = input[key];
  if (v === undefined || v === null || v === "") {
    if (required) throw new ToolInputError(`"${key}" is required.`);
    return "";
  }
  if (typeof v !== "string") throw new ToolInputError(`"${key}" must be text.`);
  const t = v.trim();
  if (required && !t) throw new ToolInputError(`"${key}" is required.`);
  if (t.length > max) throw new ToolInputError(`"${key}" is too long (max ${max} characters).`);
  return t;
}

function int(input: Input, key: string, min: number, max: number, required = true): number | undefined {
  const v = input[key];
  if (v === undefined || v === null) {
    if (required) throw new ToolInputError(`"${key}" is required.`);
    return undefined;
  }
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) {
    throw new ToolInputError(`"${key}" must be a whole number from ${min} to ${max}.`);
  }
  return v;
}

function list(input: Input, key: string, maxItems: number, maxLen: number): string[] {
  const v = input[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new ToolInputError(`"${key}" must be a list of text.`);
  return (v as string[]).map((x) => x.trim()).filter(Boolean).slice(0, maxItems).map((x) => x.slice(0, maxLen));
}

/** Removes scripts, frames, inline event handlers and javascript: links from agent-written HTML. */
export function cleanHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|form)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|link|meta)\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi, "$1=\"#\"");
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Runs fn inside store.mutate and turns guardrail errors into messages the model can act on. */
function mutate<T>(ctx: ToolContext, fn: (s: DashboardState, agent: Agent, t: Date) => T): T {
  try {
    return ctx.store.mutate((s) => fn(s, agentById(s, ctx.agentId), ctx.now()));
  } catch (err) {
    if (err instanceof HttpError) throw new ToolInputError(err.message);
    throw err;
  }
}

function recipients(s: DashboardState): string[] {
  return ["all", "owner", ...new Set(s.agents.map((a) => a.role))];
}

/* ---------- tools every agent gets ---------- */

const writeNote: AgentTool = {
  name: "write_note",
  description:
    "Add a short note to the team notebook. Address it to the roles that must act on it (\"all\" for everyone, \"owner\" for the human owner). A note wakes the agents it is addressed to, so only write one when it changes what someone should do; never just to acknowledge.",
  inputSchema: {
    type: "object",
    properties: {
      to: { type: "array", items: { type: "string" }, description: 'Roles, e.g. ["sourcing"], ["all"] or ["owner"]' },
      text: { type: "string", description: "The note. Plain text, at most a few sentences." },
    },
    required: ["to", "text"],
    additionalProperties: false,
  },
  label: (i) => `Writing a note to ${list(i, "to", 8, 30).join(", ") || "the team"}`,
  run(input, ctx) {
    const body = text(input, "text", 2000);
    if (ctx.counters.notes >= MAX_NOTES_PER_RUN) throw new ToolInputError(`You've written ${MAX_NOTES_PER_RUN} notes this run; that's the limit. Combine what's left into your final summary.`);
    const to = [...new Set(list(input, "to", 8, 30).map((x) => x.toLowerCase()))];
    const valid = recipients(ctx.store.get());
    const unknown = to.filter((r) => !valid.includes(r));
    if (!to.length) throw new ToolInputError(`"to" needs at least one of: ${valid.join(", ")}.`);
    if (unknown.length) throw new ToolInputError(`Unknown recipient ${unknown.join(", ")}. Use: ${valid.join(", ")}.`);
    mutate(ctx, (s, agent, t) => addNote(s, { name: agent.name, id: agent.id }, to, body, t));
    ctx.counters.notes++;
    return "Note saved.";
  },
};

const readNotebook: AgentTool = {
  name: "read_notebook",
  description: "Read older notebook entries, newest first, when the notes in your briefing are not enough.",
  inputSchema: {
    type: "object",
    properties: {
      role: { type: "string", description: "Only notes written by or addressed to this role (optional)" },
      limit: { type: "integer", description: "How many, 1-15 (default 10)" },
    },
    required: [],
    additionalProperties: false,
  },
  label: () => "Reading the team notebook",
  run(input, ctx) {
    const role = text(input, "role", 30, false).toLowerCase();
    const limit = int(input, "limit", 1, 15, false) ?? 10;
    const s = ctx.store.get();
    const roleOf = new Map(s.agents.map((a) => [a.id, a.role]));
    const notes = s.notebook
      .filter((n) => !role || n.to.includes(role) || (n.authorId && roleOf.get(n.authorId) === role))
      .slice(-limit)
      .reverse();
    if (!notes.length) return "No matching notes.";
    return notes.map((n) => `[${n.at.slice(0, 16)}] ${n.author} → ${n.to.join(", ")}: ${clip(n.text, 400)}`).join("\n");
  },
};

const requestAction: AgentTool = {
  name: "request_action",
  description:
    "Ask permission for one of your actions, especially anything that spends money. Guardrails approve it, deny it, or hold it for the owner. Only act after it is approved, then call complete_request.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", description: "The action key from your list of allowed actions" },
      description: { type: "string", description: "What exactly, from whom, and why. The owner reads this." },
      amount_cents: { type: "integer", description: "Money it spends, in US cents (0 if none)" },
      price_cents: { type: "integer", description: "Only for setting a sale price: the price in cents" },
    },
    required: ["action", "description", "amount_cents"],
    additionalProperties: false,
  },
  label: (i) => `Asking to ${String(i.action ?? "act").replace(/_/g, " ")}${typeof i.amount_cents === "number" && i.amount_cents > 0 ? ` (${formatCents(i.amount_cents)})` : ""}`,
  run(input, ctx) {
    const action = text(input, "action", 60);
    if (action === "advance_phase") throw new ToolInputError("Use propose_next_phase to move the team on.");
    const description = text(input, "description", 1000);
    const amountCents = int(input, "amount_cents", 0, 100_000_000)!;
    const priceCents = int(input, "price_cents", 1, 100_000_000, false);
    const r = mutate(ctx, (s, _a, t) => submitAction(s, ctx.agentId, { action, description, amountCents, priceCents }, t));
    const word = r.status === "approved" ? "Approved. Go ahead, then call complete_request." : r.status === "pending_approval" ? "Waiting for the owner. Don't act on it yet." : "Denied.";
    return `Request ${r.id}: ${word}${r.reasons.length ? ` ${r.reasons.join(" ")}` : ""}`;
  },
};

const completeRequest: AgentTool = {
  name: "complete_request",
  description: "Mark one of your approved requests as done, with what actually happened and what it really cost.",
  inputSchema: {
    type: "object",
    properties: {
      request_id: { type: "string" },
      actual_amount_cents: { type: "integer", description: "What it really cost, in cents (defaults to the approved amount)" },
      note: { type: "string", description: "What was done, e.g. order or reference number" },
    },
    required: ["request_id", "note"],
    additionalProperties: false,
  },
  label: () => "Closing a finished request",
  run(input, ctx) {
    const id = text(input, "request_id", 80);
    const actual = int(input, "actual_amount_cents", 0, 100_000_000, false);
    const note = text(input, "note", 1000);
    mutate(ctx, (s, _a, t) => completeAction(s, ctx.agentId, id, actual, note, t));
    return "Marked as done.";
  },
};

const cancelRequest: AgentTool = {
  name: "cancel_request",
  description: "Withdraw one of your approved or pending requests that is no longer needed.",
  inputSchema: {
    type: "object",
    properties: { request_id: { type: "string" }, note: { type: "string", description: "Why" } },
    required: ["request_id", "note"],
    additionalProperties: false,
  },
  label: () => "Withdrawing a request",
  run(input, ctx) {
    const id = text(input, "request_id", 80);
    const note = text(input, "note", 500);
    mutate(ctx, (s, _a, t) => cancelAction(s, ctx.agentId, id, note, t));
    return "Cancelled.";
  },
};

/* ---------- Orchestrator ---------- */

const setBrief: AgentTool = {
  name: "set_brief",
  description:
    "Replace the team brief: the current goal, key decisions and who is doing what. Every agent reads it at the start of each run. It doesn't wake anyone; address a note to wake a teammate.",
  inputSchema: {
    type: "object",
    properties: { brief: { type: "string", description: "The whole brief, at most about 200 words" } },
    required: ["brief"],
    additionalProperties: false,
  },
  label: () => "Updating the team brief",
  run(input, ctx) {
    const brief = text(input, "brief", 1500);
    mutate(ctx, (s, agent, t) => {
      s.plan.brief = brief;
      s.plan.updatedAt = t.toISOString();
      s.plan.updatedBy = agent.name;
    });
    return "Brief updated.";
  },
};

const proposeNextPhase: AgentTool = {
  name: "propose_next_phase",
  description: "When the current phase's goal is met, ask to move the whole team to the next phase. The owner approves it unless they turned that off.",
  inputSchema: {
    type: "object",
    properties: { reason: { type: "string", description: "What was achieved, and what the next phase starts with" } },
    required: ["reason"],
    additionalProperties: false,
  },
  label: () => "Proposing the next phase",
  run(input, ctx) {
    const reason = text(input, "reason", 1000);
    return mutate(ctx, (s, agent, t) => {
      const i = PHASES.indexOf(s.plan.phase);
      const next = PHASES[i + 1];
      if (!next) throw new ToolInputError("The team is already in the last phase.");
      if (s.requests.some((r) => r.agentId === agent.id && r.action === "advance_phase" && r.status === "pending_approval")) {
        throw new ToolInputError("A phase change is already waiting for the owner.");
      }
      const r = submitAction(s, agent.id, { action: "advance_phase", description: `Move to “${PHASE_LABEL[next]}”: ${reason}`, amountCents: 0, meta: { phase: next } }, t);
      if (r.status === "approved") {
        setPhase(s, next, agent.name, t);
        r.status = "completed";
        r.closedAt = t.toISOString();
        r.resultNote = "Phase changed.";
        return `Approved: the team is now in “${PHASE_LABEL[next]}”.`;
      }
      if (r.status === "pending_approval") return "Sent to the owner for approval.";
      return `Denied. ${r.reasons.join(" ")}`;
    });
  },
};

/* ---------- Storefront ---------- */

function draftLimits(s: DashboardState, ctx: ToolContext, title: string, kind: StoreDraft["kind"]): void {
  if (ctx.counters.drafts >= MAX_DRAFTS_PER_RUN) throw new ToolInputError(`You've created ${MAX_DRAFTS_PER_RUN} drafts this run; that's the limit.`);
  if (s.drafts.filter((d) => d.status === "pending").length >= MAX_PENDING_DRAFTS) {
    throw new ToolInputError(`${MAX_PENDING_DRAFTS} drafts are already waiting for the owner. Wait for them to be reviewed.`);
  }
  const same = s.drafts.find((d) => d.kind === kind && d.status !== "rejected" && d.title.toLowerCase() === title.toLowerCase());
  if (same) throw new ToolInputError(`A ${kind} called “${same.title}” already exists (${same.status}). Use a different title, or leave it.`);
}

function recordDraft(ctx: ToolContext, d: Omit<StoreDraft, "id" | "agentId" | "status" | "createdAt" | "decidedAt" | "note">): void {
  mutate(ctx, (s, agent, t) => {
    s.drafts.push({ ...d, id: newId(), agentId: agent.id, status: "pending", createdAt: t.toISOString(), decidedAt: null, note: "" });
    const money = d.priceCents !== null ? ` at ${formatCents(d.priceCents)}` : "";
    log(s, agent.name, "warning", `Drafted a store ${d.kind}: “${d.title}”${money}. It's hidden until you publish it on Approvals.`, t, {
      kind: "request_pending",
      agentId: agent.id,
      title: `Store draft ready for review: ${d.title}`,
    });
  });
  ctx.counters.drafts++;
}

function needShopify(ctx: ToolContext): ShopifyTools {
  if (!ctx.shopify) throw new ToolInputError("Shopify isn't connected yet. Ask the owner (note to owner) to connect it.");
  return ctx.shopify;
}

const listStoreProducts: AgentTool = {
  name: "list_store_products",
  description: "List the newest products already in the Shopify store, with status and price.",
  inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  label: () => "Checking the products in Shopify",
  async run(_input, ctx) {
    const items = await needShopify(ctx).listProducts();
    if (!items.length) return "The store has no products yet.";
    return items.map((p) => `${p.title} — ${p.status.toLowerCase()}${p.price ? ` — $${p.price}` : ""}`).join("\n");
  },
};

const createProductDraft: AgentTool = {
  name: "create_product_draft",
  description:
    "Create a product listing in Shopify as a hidden draft. Customers can't see it until the owner publishes it. Write a clear title, an honest description in simple HTML (<p>, <ul>, <li>, <strong>), and the price.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      description_html: { type: "string" },
      product_type: { type: "string", description: "e.g. USB-C cable" },
      tags: { type: "array", items: { type: "string" } },
      price_cents: { type: "integer", description: "Sale price in US cents" },
    },
    required: ["title", "description_html", "price_cents"],
    additionalProperties: false,
  },
  label: (i) => `Creating a product draft: ${clip(String(i.title ?? ""), 60)}`,
  async run(input, ctx) {
    const title = text(input, "title", 255);
    const descriptionHtml = cleanHtml(text(input, "description_html", 20_000));
    const productType = text(input, "product_type", 255, false);
    const tags = list(input, "tags", 20, 40);
    const priceCents = int(input, "price_cents", 1, 10_000_000)!;
    const s = ctx.store.get();
    const floor = priceFloorCents(s, agentById(s, ctx.agentId));
    if (floor !== null && priceCents < floor) throw new ToolInputError(`${formatCents(priceCents)} is below the price floor of ${formatCents(floor)}. Use a higher price.`);
    draftLimits(s, ctx, title, "product");
    const shopifyId = await needShopify(ctx).createProductDraft({ title, descriptionHtml, productType, tags, priceCents });
    recordDraft(ctx, { kind: "product", title, shopifyId, priceCents, preview: clip(descriptionHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), 600) });
    return `Draft product created (hidden). The owner will review it.`;
  },
};

const createPageDraft: AgentTool = {
  name: "create_page_draft",
  description: "Create an unpublished store page (About, FAQ, Shipping & returns, Contact). Simple HTML only. The owner publishes it.",
  inputSchema: {
    type: "object",
    properties: { title: { type: "string" }, body_html: { type: "string" } },
    required: ["title", "body_html"],
    additionalProperties: false,
  },
  label: (i) => `Writing a store page: ${clip(String(i.title ?? ""), 60)}`,
  async run(input, ctx) {
    const title = text(input, "title", 255);
    const bodyHtml = cleanHtml(text(input, "body_html", 30_000));
    draftLimits(ctx.store.get(), ctx, title, "page");
    const shopifyId = await needShopify(ctx).createPageDraft({ title, bodyHtml });
    recordDraft(ctx, { kind: "page", title, shopifyId, priceCents: null, preview: clip(bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), 600) });
    return "Draft page created (hidden). The owner will review it.";
  },
};

/* ---------- Inventory & Finance ---------- */

const adjustStock: AgentTool = {
  name: "adjust_stock",
  description: "Change the count of an item kept at home, e.g. after a supply delivery the owner confirmed. Use the item id from your briefing.",
  inputSchema: {
    type: "object",
    properties: {
      item_id: { type: "string" },
      delta: { type: "integer", description: "Positive to add, negative to remove" },
      note: { type: "string" },
    },
    required: ["item_id", "delta", "note"],
    additionalProperties: false,
  },
  label: () => "Updating stock counts",
  run(input, ctx) {
    const id = text(input, "item_id", 80);
    const delta = int(input, "delta", -1_000_000, 1_000_000)!;
    const note = text(input, "note", 300);
    const item = mutate(ctx, (s, _a, t) => adjustSupply(s, ctx.agentId, id, delta, note, t));
    return `${item.name}: now ${item.onHand} ${item.unit}.`;
  },
};

const salesSummary: AgentTool = {
  name: "shopify_sales_summary",
  description: "Totals of Shopify orders over the last N days: order count, units, gross sales and refunds. No customer details.",
  inputSchema: {
    type: "object",
    properties: { days: { type: "integer", description: "1-90" } },
    required: ["days"],
    additionalProperties: false,
  },
  label: (i) => `Reading Shopify sales (last ${String(i.days ?? 30)} days)`,
  async run(input, ctx) {
    const days = int(input, "days", 1, 90)!;
    const r = await needShopify(ctx).salesSummary(days);
    return `Last ${r.days} days: ${r.orders} orders, ${r.units} units, gross ${formatCents(r.grossCents)}, refunded ${formatCents(r.refundedCents)} (${r.currency}).`;
  },
};

/* ---------- per-role tool sets ---------- */

const COMMON = [writeNote, readNotebook, requestAction, completeRequest, cancelRequest];

export function toolsFor(role: string, opts: { shopifyConnected: boolean; selfShipping: boolean }): AgentTool[] {
  const extra: AgentTool[] = [];
  if (role === "orchestrator") extra.push(setBrief, proposeNextPhase);
  if (role === "storefront" && opts.shopifyConnected) extra.push(listStoreProducts, createProductDraft, createPageDraft);
  if (role === "inventory" && opts.selfShipping) extra.push(adjustStock);
  if (role === "finance" && opts.shopifyConnected) extra.push(salesSummary);
  return [...COMMON, ...extra];
}
