import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { formatCents } from "../shared/money.ts";
import { findService } from "../shared/services.ts";
import { AGENT_TEMPLATES, findTemplate } from "../shared/templates.ts";
import type {
  ActionDef,
  ActionRequest,
  ActivityLevel,
  Agent,
  DashboardState,
  FundingType,
  InputField,
  InputKind,
  StateResponse,
  TaskCategory,
} from "../shared/types.ts";
import { createAgent, toView } from "./agents.ts";
import { maskWebhook, type DiscordNotifier } from "./discord.ts";
import { autofillAgent, refreshSuggestedInputs, resolveInputs } from "./inputs.ts";
import { registerSetupRoutes } from "./setupRoutes.ts";
import { logQueued, parseShipment } from "./shippingInput.ts";
import { ShopifyService } from "./shopify.ts";
import { lowSupplies } from "../shared/shipping.ts";
import { LoginLimiter, Sessions, clearedCookie, hashPassword, readCookie, sessionCookie, SESSION_COOKIE, verifyPassword } from "./auth.ts";
import { aiThisMonth } from "./finance.ts";
import { estimateCostCents } from "../shared/aiPricing.ts";
import { anthropicResearch, type ResearchRunner } from "./research.ts";
import { autoAllocate } from "./allocate.ts";
import { computeFinance } from "./finance.ts";
import { evaluate, hardLimitViolations, priceFloorCents } from "./guardrails.ts";
import { computeOwnerActions, computeReadiness, missingInputs } from "./readiness.ts";
import { log, newId, newToken, type Store } from "./store.ts";
import {
  KEY_PATTERN,
  asBody,
  bad,
  bool,
  cents,
  centsOrNull,
  HttpError,
  obj,
  oneOf,
  str,
  strArray,
  type Body,
} from "./validate.ts";

export interface AppOptions {
  store: Store;
  /** Hostnames (without port) allowed to use the owner API. */
  allowedHosts?: string[];
  now?: () => Date;
  /** Runs AI product research. Defaults to Claude with web search. */
  research?: ResearchRunner;
  /** Posts activity to Discord. Optional (tests usually omit it). */
  notifier?: DiscordNotifier;
  /** Signed-in browsers (only used when a dashboard password is set). */
  sessions?: Sessions;
  /** Shopify connection (order import). */
  shopify?: ShopifyService;
}

/** Parses a revenue report: either a net payout, or gross sales with optional refunds, fees and units. */
export function parseRevenue(body: Body): {
  amountCents: number;
  grossSalesCents?: number;
  refundsCents?: number;
  feesCents?: number;
  unitsSold?: number;
} {
  const gross = cents(body, "grossSalesCents");
  const refunds = cents(body, "refundsCents");
  const fees = cents(body, "feesCents");
  const units = body.unitsSold;
  if (units !== undefined && (typeof units !== "number" || !Number.isSafeInteger(units) || units < 0)) {
    throw bad('"unitsSold" must be a whole number of units.');
  }
  const amount = cents(body, "amountCents");
  if (gross === undefined) {
    if (amount === undefined || amount === 0) throw bad('Send "amountCents" (net payout) or "grossSalesCents".');
    if (refunds !== undefined || fees !== undefined) throw bad('"refundsCents" and "feesCents" need "grossSalesCents".');
    return { amountCents: amount, ...(units !== undefined ? { unitsSold: units as number } : {}) };
  }
  if (gross === 0) throw bad('"grossSalesCents" must be greater than zero.');
  const net = gross - (refunds ?? 0) - (fees ?? 0);
  if (net < 0) throw bad("Refunds plus fees cannot exceed gross sales.");
  if (amount !== undefined && amount !== net) {
    throw bad(`"amountCents" (${formatCents(amount)}) must equal gross − refunds − fees (${formatCents(net)}), or be left out.`);
  }
  return {
    amountCents: net,
    grossSalesCents: gross,
    refundsCents: refunds ?? 0,
    feesCents: fees ?? 0,
    ...(units !== undefined ? { unitsSold: units as number } : {}),
  };
}

const INPUT_KINDS: readonly InputKind[] = ["text", "secret", "number", "url", "textarea"];
const TASK_CATEGORIES: readonly TaskCategory[] = ["legal", "finance", "sales", "product", "operations", "custom"];
const FUNDING_TYPES: readonly FundingType[] = ["deposit", "withdrawal", "revenue"];
const LEVELS: readonly ActivityLevel[] = ["info", "warning", "error", "success"];
const MAX_ACTIVITY_RETURNED = 300;

function actionLabel(agent: Agent | undefined, key: string): string {
  return agent?.actions.find((a) => a.key === key)?.label ?? key;
}

function revenueFields(rev: ReturnType<typeof parseRevenue>): Array<{ name: string; value: string }> {
  const out = [{ name: "Net payout", value: formatCents(rev.amountCents) }];
  if (rev.grossSalesCents !== undefined) out.unshift({ name: "Gross sales", value: formatCents(rev.grossSalesCents) });
  if (rev.refundsCents) out.push({ name: "Refunds", value: formatCents(rev.refundsCents) });
  if (rev.feesCents) out.push({ name: "Fees", value: formatCents(rev.feesCents) });
  if (rev.unitsSold !== undefined) out.push({ name: "Units", value: String(rev.unitsSold) });
  return out;
}

function maskVault(key: string, value: string): string {
  const svc = findService(key);
  if (svc && !svc.secret) return value;
  const v = value.trim();
  if (!v) return "";
  return v.length <= 8 ? "••••" : `••••${v.slice(-4)}`;
}

/** AI cost per local calendar day, so period totals stay exact without sending every report. */
function dailyAiTotals(s: DashboardState): Array<{ at: string; costCents: number }> {
  const byDay = new Map<string, number>();
  for (const u of s.aiUsage) {
    const d = new Date(u.at);
    const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    byDay.set(key, (byDay.get(key) ?? 0) + u.costCents);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([at, costCents]) => ({ at, costCents }));
}

function hostnameOf(hostHeader: string): string {
  // Handles "localhost:4317", "127.0.0.1:4317" and "[::1]:4317".
  if (hostHeader.startsWith("[")) return hostHeader.slice(0, hostHeader.indexOf("]") + 1);
  return hostHeader.split(":")[0] ?? "";
}

export function createApp(opts: AppOptions): express.Express {
  const { store } = opts;
  const now = opts.now ?? (() => new Date());
  const allowedHosts = new Set(opts.allowedHosts ?? ["localhost", "127.0.0.1", "[::1]"]);
  const sessions = opts.sessions ?? new Sessions();
  const limiter = new LoginLimiter();

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  /* ------------------------------------------------------------------ */
  /* Agent API: /api/agent/v1/*  (authenticated with a per-agent token)  */
  /* ------------------------------------------------------------------ */

  const agentApi = express.Router();

  function findAgentByToken(state: DashboardState, token: string): Agent | undefined {
    const given = Buffer.from(token);
    let found: Agent | undefined;
    for (const a of state.agents) {
      const expected = Buffer.from(a.apiToken);
      if (expected.length === given.length && timingSafeEqual(expected, given)) found = a;
    }
    return found;
  }

  agentApi.use((req, res, next) => {
    const header = req.get("authorization") ?? "";
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    const agent = match?.[1] ? findAgentByToken(store.get(), match[1]) : undefined;
    if (!agent) {
      res.status(401).json({ error: "Missing or invalid agent token." });
      return;
    }
    res.locals.agentId = agent.id;
    next();
  });

  function currentAgent(state: DashboardState, res: Response): Agent {
    const agent = state.agents.find((a) => a.id === res.locals.agentId);
    if (!agent) throw new HttpError(401, "Agent no longer exists.");
    return agent;
  }

  function touch(agent: Agent, at: Date): void {
    agent.lastSeenAt = at.toISOString();
  }

  agentApi.get("/config", (_req, res) => {
    const state = store.get();
    const agent = currentAgent(state, res);
    const t = now();
    const finance = computeFinance(state, t);
    const af = finance.agents.find((a) => a.agentId === agent.id);
    res.json({
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
          monthCostCents: aiThisMonth(state, t),
          overLimit: state.guardrails.aiMonthlyLimitCents !== null && aiThisMonth(state, t) >= state.guardrails.aiMonthlyLimitCents,
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
    });
  });

  agentApi.post("/heartbeat", (req, res) => {
    const body = asBody(req.body);
    const message = str(body, "message", { max: 500 });
    store.mutate((s) => {
      const agent = currentAgent(s, res);
      touch(agent, now());
      if (message !== undefined) agent.lastStatusMessage = message;
    });
    const state = store.get();
    res.json({ ok: true, killSwitch: state.guardrails.killSwitch, status: currentAgent(state, res).status });
  });

  agentApi.post("/log", (req, res) => {
    const body = asBody(req.body);
    const message = str(body, "message", { max: 2000, required: true }) as string;
    const level = oneOf(body, "level", LEVELS) ?? "info";
    const entry = store.mutate((s) => {
      const agent = currentAgent(s, res);
      const t = now();
      touch(agent, t);
      return log(s, agent.name, level, message, t, { kind: "log", agentId: agent.id });
    });
    res.status(201).json({ entry });
  });

  agentApi.post("/actions", (req, res) => {
    const body = asBody(req.body);
    const action = str(body, "action", { max: 64, required: true }) as string;
    const description = str(body, "description", { max: 2000 }) ?? "";
    const amountCents = cents(body, "amountCents") ?? 0;
    const priceCents = cents(body, "priceCents");
    const request = store.mutate((s) => {
      const agent = currentAgent(s, res);
      const t = now();
      touch(agent, t);
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
    });
    res.status(201).json({ request });
  });

  function agentRequest(s: DashboardState, res: Response, id: string): { agent: Agent; request: ActionRequest } {
    const agent = currentAgent(s, res);
    const request = s.requests.find((r) => r.id === id && r.agentId === agent.id);
    if (!request) throw new HttpError(404, "Request not found.");
    return { agent, request };
  }

  agentApi.get("/actions/:id", (req, res) => {
    const { request } = agentRequest(store.get(), res, req.params.id);
    res.json({ request });
  });

  agentApi.post("/actions/:id/complete", (req, res) => {
    const body = asBody(req.body);
    const actual = cents(body, "actualAmountCents");
    const note = str(body, "note", { max: 2000 }) ?? "";
    const request = store.mutate((s) => {
      const { agent, request } = agentRequest(s, res, req.params.id);
      if (request.status !== "approved") throw new HttpError(409, `Only approved requests can be completed (this one is ${request.status}).`);
      const finalAmount = actual ?? request.amountCents;
      if (finalAmount > request.amountCents) {
        throw new HttpError(409, `Actual amount ${formatCents(finalAmount)} exceeds the approved ${formatCents(request.amountCents)}. Submit a new request for the difference.`);
      }
      const t = now();
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
    });
    res.json({ request });
  });

  agentApi.post("/actions/:id/cancel", (req, res) => {
    const body = asBody(req.body);
    const note = str(body, "note", { max: 2000 }) ?? "";
    const request = store.mutate((s) => {
      const { agent, request } = agentRequest(s, res, req.params.id);
      if (request.status !== "approved" && request.status !== "pending_approval") {
        throw new HttpError(409, `Only approved or pending requests can be cancelled (this one is ${request.status}).`);
      }
      const t = now();
      touch(agent, t);
      request.status = "cancelled";
      request.closedAt = t.toISOString();
      request.resultNote = note;
      log(s, agent.name, "info", `Cancelled: ${actionLabel(agent, request.action)}. ${note}`.trim(), t, { kind: "log", agentId: agent.id });
      return request;
    });
    res.json({ request });
  });

  agentApi.post("/revenue", (req, res) => {
    const body = asBody(req.body);
    const rev = parseRevenue(body);
    const note = str(body, "note", { max: 500 }) ?? "";
    const entry = store.mutate((s) => {
      const agent = currentAgent(s, res);
      const t = now();
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
    });
    res.status(201).json({ entry });
  });

  agentApi.post("/usage", (req, res) => {
    const body = asBody(req.body);
    const model = str(body, "model", { max: 100, required: true }) as string;
    const label = str(body, "label", { max: 200 }) ?? "";
    const counts = {
      inputTokens: cents(body, "inputTokens") ?? 0,
      outputTokens: cents(body, "outputTokens") ?? 0,
      cacheReadTokens: cents(body, "cacheReadTokens") ?? 0,
      cacheWriteTokens: cents(body, "cacheWriteTokens") ?? 0,
      webSearches: cents(body, "webSearches") ?? 0,
    };
    const reported = cents(body, "costCents");
    const costCents = reported ?? estimateCostCents(model, counts);
    if (costCents === null) throw bad(`No price list for model "${model}". Include "costCents" with the cost you were charged.`);
    const result = store.mutate((s) => {
      const agent = currentAgent(s, res);
      const t = now();
      touch(agent, t);
      const before = aiThisMonth(s, t);
      s.aiUsage.push({ id: newId(), at: t.toISOString(), agentId: agent.id, label: label || agent.name, model, ...counts, costCents });
      const after = before + costCents;
      const limit = s.guardrails.aiMonthlyLimitCents;
      if (limit !== null && before < limit && after >= limit) {
        log(s, "System", "error", `AI usage budget reached: ${formatCents(after)} of ${formatCents(limit)} this month. Agent requests are now denied until next month or until you raise the cap on Guardrails.`, t, {
          kind: "system",
          title: "AI usage budget reached",
        });
      }
      return { monthCostCents: after, limitCents: limit, overLimit: limit !== null && after >= limit, costCents };
    });
    res.status(201).json(result);
  });

  agentApi.get("/shipments", (req, res) => {
    const state = store.get();
    currentAgent(state, res);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json({ shipments: state.shipments.filter((sh) => !status || sh.status === status) });
  });

  agentApi.post("/shipments", (req, res) => {
    const body = asBody(req.body);
    const shipment = store.mutate((s) => {
      const agent = currentAgent(s, res);
      const t = now();
      touch(agent, t);
      if (s.guardrails.killSwitch) throw new HttpError(403, "Kill switch is on: all agent activity is stopped.");
      const sh = parseShipment(s, body, agent.name, t);
      if (sh.orderRef && s.shipments.some((x) => x.orderRef === sh.orderRef && x.status !== "cancelled")) {
        throw new HttpError(409, `Order ${sh.orderRef} is already in the packing queue.`);
      }
      s.shipments.push(sh);
      logQueued(s, sh, agent.name, t);
      return sh;
    });
    res.status(201).json({ shipment });
  });

  agentApi.post("/supplies/:id/adjust", (req, res) => {
    const body = asBody(req.body);
    const delta = body.delta;
    if (typeof delta !== "number" || !Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 1_000_000) throw bad('"delta" must be a non-zero whole number.');
    const note = str(body, "note", { max: 500 }) ?? "";
    const supply = store.mutate((s) => {
      const agent = currentAgent(s, res);
      const item = s.supplies.find((x) => x.id === req.params.id);
      if (!item) throw new HttpError(404, "Stock item not found.");
      const t = now();
      touch(agent, t);
      item.onHand += delta;
      log(s, agent.name, "info", `${delta > 0 ? "Added" : "Removed"} ${Math.abs(delta)} ${item.unit} of ${item.name} (now ${item.onHand}). ${note}`.trim(), t, { kind: "log", agentId: agent.id });
      return item;
    });
    res.json({ supply });
  });

  agentApi.post("/report", (req, res) => {
    const body = asBody(req.body);
    const title = str(body, "title", { max: 200, required: true }) as string;
    const text = str(body, "body", { max: 4000, required: true }) as string;
    const rawFields = body.fields;
    let fields: Array<{ name: string; value: string }> | undefined;
    if (rawFields !== undefined) {
      if (!Array.isArray(rawFields) || rawFields.length > 20) throw bad('"fields" must be a list of up to 20 {name, value} items.');
      fields = rawFields.map((f) => {
        const o = asBody(f);
        return { name: str(o, "name", { max: 200, required: true }) as string, value: str(o, "value", { max: 1000, required: true }) as string };
      });
    }
    const entry = store.mutate((s) => {
      const agent = currentAgent(s, res);
      const t = now();
      touch(agent, t);
      return log(s, agent.name, "info", text, t, { kind: "report", agentId: agent.id, title, fields });
    });
    res.status(201).json({ entry });
  });

  app.use("/api/agent/v1", agentApi);

  /* ------------------------------------------------------------------ */
  /* Owner API: /api/*  (local only)                                     */
  /* ------------------------------------------------------------------ */

  const owner = express.Router();

  // Protects the owner API from DNS rebinding and cross-site requests.
  owner.use((req, res, next) => {
    const host = hostnameOf(req.get("host") ?? "");
    if (!allowedHosts.has(host)) {
      res.status(403).json({ error: `Host "${host}" is not allowed to use the owner API.` });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      const origin = req.get("origin");
      if (origin) {
        let originHost = "";
        try {
          originHost = hostnameOf(new URL(origin).host);
        } catch {
          originHost = "";
        }
        if (!allowedHosts.has(originHost)) {
          res.status(403).json({ error: "Cross-origin requests are not allowed." });
          return;
        }
      }
      if (!req.is("application/json")) {
        res.status(415).json({ error: "Owner API requests must use Content-Type: application/json." });
        return;
      }
    }
    // With a dashboard password set, everything except signing in needs a signed-in browser.
    if (store.get().security.passwordHash && req.path !== "/session" && req.path !== "/login") {
      if (!sessions.valid(readCookie(req, SESSION_COOKIE), now())) {
        res.status(401).json({ error: "Sign in to the dashboard.", loginRequired: true });
        return;
      }
    }
    next();
  });

  /* ---------- Sign-in ---------- */

  owner.get("/session", (req, res) => {
    const passwordSet = Boolean(store.get().security.passwordHash);
    res.json({ passwordSet, signedIn: !passwordSet || sessions.valid(readCookie(req, SESSION_COOKIE), now()) });
  });

  owner.post("/login", (req, res) => {
    const body = asBody(req.body);
    const password = str(body, "password", { max: 200, required: true }) as string;
    const sec = store.get().security;
    if (!sec.passwordHash || !sec.passwordSalt) {
      res.json({ ok: true });
      return;
    }
    const who = req.ip ?? "local";
    if (limiter.blocked(who, now())) throw new HttpError(429, "Too many wrong passwords. Wait 15 minutes and try again.");
    if (!verifyPassword(password, sec.passwordSalt, sec.passwordHash)) {
      limiter.fail(who, now());
      throw new HttpError(401, "Wrong password.");
    }
    limiter.succeed(who);
    res.set("Set-Cookie", sessionCookie(sessions.create(now()), req.secure)).json({ ok: true });
  });

  owner.post("/logout", (req, res) => {
    sessions.revoke(readCookie(req, SESSION_COOKIE));
    res.set("Set-Cookie", clearedCookie()).json({ ok: true });
  });

  owner.put("/security/password", (req, res) => {
    const body = asBody(req.body);
    const current = str(body, "currentPassword", { max: 200 }) ?? "";
    const next = str(body, "newPassword", { max: 200 });
    if (next === undefined) throw bad('"newPassword" is required (empty to remove the password).');
    if (next !== "" && next.length < 10) throw bad("Use at least 10 characters.");
    const sec = store.get().security;
    const who = req.ip ?? "local";
    if (sec.passwordHash && sec.passwordSalt) {
      if (limiter.blocked(who, now())) throw new HttpError(429, "Too many wrong passwords. Wait 15 minutes and try again.");
      if (!verifyPassword(current, sec.passwordSalt, sec.passwordHash)) {
        limiter.fail(who, now());
        throw new HttpError(401, "Your current password is wrong.");
      }
      limiter.succeed(who);
    } else if (next === "") {
      throw bad("No password is set.");
    }
    store.mutate((s) => {
      const t = now();
      if (next === "") {
        s.security = { passwordHash: null, passwordSalt: null, passwordUpdatedAt: t.toISOString() };
        log(s, "Owner", "warning", "Removed the dashboard password. Anyone using this computer can open the dashboard.", t);
      } else {
        const { hash, salt } = hashPassword(next);
        s.security = { passwordHash: hash, passwordSalt: salt, passwordUpdatedAt: t.toISOString() };
        log(s, "Owner", "success", `${sec.passwordHash ? "Changed" : "Set"} the dashboard password.`, t);
      }
    });
    // Any other signed-in browser is signed out; this one stays signed in.
    sessions.revokeAll();
    if (next === "") res.set("Set-Cookie", clearedCookie());
    else res.set("Set-Cookie", sessionCookie(sessions.create(now()), req.secure));
    sendState(res);
  });

  function buildState(): StateResponse {
    const s = store.get();
    const t = now();
    const finance = computeFinance(s, t);
    return {
      business: s.business,
      economics: s.economics,
      tasks: s.tasks,
      agents: s.agents.map((a) => toView(a, s)),
      vault: Object.entries(s.vault).map(([key, v]) => ({
        key,
        set: v.value.trim() !== "",
        preview: maskVault(key, v.value),
        updatedAt: v.updatedAt,
        ...(v.label ? { label: v.label } : {}),
      })),
      discord: {
        enabled: s.discord.enabled,
        events: s.discord.events,
        dailySummaryHour: s.discord.dailySummaryHour,
        lastDailySummaryDate: s.discord.lastDailySummaryDate,
        approvalMention: s.discord.approvalMention,
        defaultWebhookSet: s.discord.defaultWebhookUrl !== "",
        defaultWebhookPreview: maskWebhook(s.discord.defaultWebhookUrl),
        agentWebhooksSet: Object.fromEntries(Object.entries(s.discord.agentWebhooks).filter(([, u]) => u).map(([id, u]) => [id, maskWebhook(u)])),
        lastError: opts.notifier?.lastError ?? null,
        lastErrorAt: opts.notifier?.lastErrorAt ?? null,
        sentCount: opts.notifier?.sentCount ?? 0,
      },
      allocation: s.allocation,
      research: s.research,
      aiUsage: s.aiUsage.slice(-300).reverse(),
      aiUsageDaily: dailyAiTotals(s),
      shipments: [
        ...s.shipments.filter((sh) => sh.status === "to_pack" || sh.status === "packed"),
        ...s.shipments.filter((sh) => sh.status === "shipped" || sh.status === "cancelled").slice(-50),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      supplies: s.supplies,
      shopify: s.shopify,
      security: { passwordSet: Boolean(s.security.passwordHash) },
      guardrails: s.guardrails,
      funding: [...s.funding].reverse(),
      requests: [...s.requests].reverse(),
      activity: s.activity.slice(-MAX_ACTIVITY_RETURNED).reverse(),
      finance,
      ownerActions: computeOwnerActions(s, finance),
      readiness: computeReadiness(s, finance),
      serverTime: t.toISOString(),
    };
  }

  const sendState = (res: Response): void => {
    res.json(buildState());
  };

  owner.get("/state", (_req, res) => sendState(res));
  owner.get("/templates", (_req, res) => {
    res.json({ templates: AGENT_TEMPLATES });
  });

  owner.put("/business", (req, res) => {
    const body = asBody(req.body);
    store.mutate((s) => {
      const before = structuredClone(s);
      const b = s.business;
      b.name = str(body, "name", { max: 200 }) ?? b.name;
      b.product = str(body, "product", { max: 500 }) ?? b.product;
      b.description = str(body, "description", { max: 5000 }) ?? b.description;
      b.targetMarket = str(body, "targetMarket", { max: 1000 }) ?? b.targetMarket;
      b.salesChannels = str(body, "salesChannels", { max: 1000 }) ?? b.salesChannels;
      b.ownerName = str(body, "ownerName", { max: 200 }) ?? b.ownerName;
      b.ownerEmail = str(body, "ownerEmail", { max: 200 }) ?? b.ownerEmail;
      b.shippingAddress = str(body, "shippingAddress", { max: 1000 }) ?? b.shippingAddress;
      if (body.product !== undefined && b.productSource === null) b.productSource = "manual";
      refreshSuggestedInputs(before, s);
      log(s, "Owner", "info", "Updated the business profile.", now());
    });
    sendState(res);
  });

  /* ---------- Tasks ---------- */

  function findTask(s: DashboardState, id: string) {
    const t = s.tasks.find((x) => x.id === id);
    if (!t) throw new HttpError(404, "Task not found.");
    return t;
  }

  owner.post("/tasks", (req, res) => {
    const body = asBody(req.body);
    const title = str(body, "title", { max: 200, required: true }) as string;
    const description = str(body, "description", { max: 2000 }) ?? "";
    const category = oneOf(body, "category", TASK_CATEGORIES) ?? "custom";
    store.mutate((s) => {
      s.tasks.push({
        id: newId(),
        title: title.trim(),
        description,
        category,
        status: "todo",
        notes: "",
        custom: true,
        completedAt: null,
        steps: [],
        links: [],
        time: "",
        templateKey: null,
        money: null,
        waitsFor: null,
      });
      log(s, "Owner", "info", `Added task "${title.trim()}".`, now());
    });
    sendState(res);
  });

  owner.patch("/tasks/:id", (req, res) => {
    const body = asBody(req.body);
    const status = oneOf(body, "status", ["todo", "done"] as const);
    const notes = str(body, "notes", { max: 5000 });
    const title = str(body, "title", { max: 200 });
    const description = str(body, "description", { max: 2000 });
    store.mutate((s) => {
      const task = findTask(s, req.params.id);
      if (title !== undefined) {
        if (!title.trim()) throw bad("Title must not be empty.");
        task.title = title.trim();
      }
      if (description !== undefined) task.description = description;
      if (notes !== undefined) task.notes = notes;
      if (status !== undefined && status !== task.status) {
        task.status = status;
        task.completedAt = status === "done" ? now().toISOString() : null;
        log(s, "Owner", status === "done" ? "success" : "info", `${status === "done" ? "Completed" : "Reopened"} task "${task.title}".`, now());
      }
    });
    sendState(res);
  });

  owner.delete("/tasks/:id", (req, res) => {
    store.mutate((s) => {
      const task = findTask(s, req.params.id);
      s.tasks = s.tasks.filter((t) => t.id !== task.id);
      log(s, "Owner", "info", `Removed task "${task.title}".`, now());
    });
    sendState(res);
  });

  /* ---------- Agents ---------- */

  function findAgent(s: DashboardState, id: string): Agent {
    const a = s.agents.find((x) => x.id === id);
    if (!a) throw new HttpError(404, "Agent not found.");
    return a;
  }

  owner.post("/agents", (req, res) => {
    const body = asBody(req.body);
    const role = str(body, "role", { max: 64, required: true }) as string;
    const name = str(body, "name", { max: 100 });
    if (role !== "custom" && !findTemplate(role)) throw bad(`Unknown agent role "${role}".`);
    let id = "";
    store.mutate((s) => {
      const agent = createAgent(role, name, now());
      autofillAgent(s, agent);
      s.agents.push(agent);
      id = agent.id;
      log(s, "Owner", "info", `Added agent "${agent.name}".`, now());
    });
    res.status(201).json({ ...buildState(), createdAgentId: id });
  });

  function parseInputFields(value: unknown): InputField[] {
    if (!Array.isArray(value)) throw bad('"inputFields" must be a list.');
    if (value.length > 50) throw bad("An agent may have at most 50 inputs.");
    const seen = new Set<string>();
    return value.map((raw) => {
      const f = asBody(raw);
      const key = str(f, "key", { max: 64, required: true }) as string;
      if (!KEY_PATTERN.test(key)) throw bad(`Input key "${key}" must be lowercase letters, digits and underscores, starting with a letter.`);
      if (seen.has(key)) throw bad(`Duplicate input key "${key}".`);
      seen.add(key);
      const field: InputField = {
        key,
        label: (str(f, "label", { max: 100, required: true }) as string).trim(),
        kind: oneOf(f, "kind", INPUT_KINDS, true) as InputKind,
        required: bool(f, "required") ?? false,
      };
      const help = str(f, "help", { max: 500 });
      const placeholder = str(f, "placeholder", { max: 200 });
      if (help) field.help = help;
      if (placeholder) field.placeholder = placeholder;
      return field;
    });
  }

  function parseActions(value: unknown): ActionDef[] {
    if (!Array.isArray(value)) throw bad('"actions" must be a list.');
    if (value.length > 50) throw bad("An agent may have at most 50 actions.");
    const seen = new Set<string>();
    return value.map((raw) => {
      const a = asBody(raw);
      const key = str(a, "key", { max: 64, required: true }) as string;
      if (!KEY_PATTERN.test(key)) throw bad(`Action key "${key}" must be lowercase letters, digits and underscores, starting with a letter.`);
      if (seen.has(key)) throw bad(`Duplicate action key "${key}".`);
      seen.add(key);
      return {
        key,
        label: (str(a, "label", { max: 100, required: true }) as string).trim(),
        spends: bool(a, "spends") ?? false,
      };
    });
  }

  function applyAgentGuardrails(agent: Agent, g: Body): void {
    const keys = new Set(agent.actions.map((a) => a.key));
    const per = centsOrNull(g, "perTransactionLimitCents");
    const daily = centsOrNull(g, "dailySpendLimitCents");
    const threshold = centsOrNull(g, "approvalThresholdCents");
    const allowed = strArray(g, "allowedActions");
    const approval = strArray(g, "approvalRequiredActions");
    for (const k of [...(allowed ?? []), ...(approval ?? [])]) {
      if (!keys.has(k)) throw bad(`Unknown action "${k}".`);
    }
    if (per !== undefined) agent.guardrails.perTransactionLimitCents = per;
    if (daily !== undefined) agent.guardrails.dailySpendLimitCents = daily;
    if (threshold !== undefined) agent.guardrails.approvalThresholdCents = threshold;
    if (allowed !== undefined) agent.guardrails.allowedActions = [...new Set(allowed)];
    if (approval !== undefined) agent.guardrails.approvalRequiredActions = [...new Set(approval)];
  }

  owner.patch("/agents/:id", (req, res) => {
    const body = asBody(req.body);
    store.mutate((s) => {
      const agent = findAgent(s, req.params.id);
      const t = now();
      const name = str(body, "name", { max: 100 });
      if (name !== undefined) {
        if (!name.trim()) throw bad("Name must not be empty.");
        agent.name = name.trim();
      }
      const description = str(body, "description", { max: 2000 });
      if (description !== undefined) agent.description = description;
      const responsibilities = strArray(body, "responsibilities", { maxItems: 30 });
      if (responsibilities !== undefined) agent.responsibilities = responsibilities.map((r) => r.trim()).filter(Boolean);

      const conn = obj(body, "connection");
      if (conn) {
        agent.connection.provider = str(conn, "provider", { max: 100 }) ?? agent.connection.provider;
        agent.connection.model = str(conn, "model", { max: 100 }) ?? agent.connection.model;
        agent.connection.runtime = str(conn, "runtime", { max: 500 }) ?? agent.connection.runtime;
      }

      if (body.inputFields !== undefined) {
        agent.inputFields = parseInputFields(body.inputFields);
        const keys = new Set(agent.inputFields.map((f) => f.key));
        for (const k of Object.keys(agent.inputs)) if (!keys.has(k)) delete agent.inputs[k];
      }

      if (body.actions !== undefined) {
        const before = new Set(agent.actions.map((a) => a.key));
        agent.actions = parseActions(body.actions);
        const keys = new Set(agent.actions.map((a) => a.key));
        const g = agent.guardrails;
        g.allowedActions = g.allowedActions.filter((k) => keys.has(k));
        g.approvalRequiredActions = g.approvalRequiredActions.filter((k) => keys.has(k));
        // Actions the owner just added are allowed by default.
        for (const k of keys) if (!before.has(k)) g.allowedActions.push(k);
      }

      const inputs = obj(body, "inputs");
      if (inputs) {
        const changed: string[] = [];
        for (const [k, v] of Object.entries(inputs)) {
          const field = agent.inputFields.find((f) => f.key === k);
          if (!field) throw bad(`Unknown input "${k}".`);
          if (typeof v !== "string" || v.length > 10_000) throw bad(`Input "${field.label}" must be text up to 10,000 characters.`);
          if (field.kind === "number" && v.trim() !== "" && !Number.isFinite(Number(v))) throw bad(`Input "${field.label}" must be a number.`);
          if (field.kind === "url" && v.trim() !== "") {
            try {
              new URL(v);
            } catch {
              throw bad(`Input "${field.label}" must be a full URL (https://...).`);
            }
          }
          // For secrets an empty string means "leave unchanged"; use clearSecrets to remove one.
          if (field.kind === "secret" && v === "") continue;
          agent.inputs[k] = v;
          changed.push(field.label);
        }
        if (changed.length > 0) log(s, "Owner", "info", `Updated ${agent.name} inputs: ${changed.join(", ")}.`, t);
      }
      const clear = strArray(body, "clearSecrets");
      if (clear) {
        for (const k of clear) {
          const field = agent.inputFields.find((f) => f.key === k);
          if (!field || field.kind !== "secret") throw bad(`"${k}" is not a secret input.`);
          delete agent.inputs[k];
        }
      }

      const g = obj(body, "guardrails");
      if (g) {
        applyAgentGuardrails(agent, g);
        log(s, "Owner", "info", `Updated ${agent.name} guardrails.`, t);
      }

      const status = oneOf(body, "status", ["draft", "active", "paused"] as const);
      if (status !== undefined && status !== agent.status) {
        if (status === "active") {
          const missing = missingInputs(s, agent);
          if (missing.length > 0) throw bad(`Cannot activate ${agent.name}: missing ${missing.join(", ")}.`);
        }
        agent.status = status;
        log(s, "Owner", status === "active" ? "success" : "warning", `${agent.name} is now ${status}.`, t);
      }
    });
    sendState(res);
  });

  owner.delete("/agents/:id", (req, res) => {
    store.mutate((s) => {
      const agent = findAgent(s, req.params.id);
      const open = s.requests.filter((r) => r.agentId === agent.id && (r.status === "approved" || r.status === "pending_approval"));
      if (open.length > 0) {
        throw new HttpError(409, `${agent.name} has ${open.length} open request(s). Approve/reject or close them first.`);
      }
      s.agents = s.agents.filter((a) => a.id !== agent.id);
      log(s, "Owner", "warning", `Removed agent "${agent.name}". Its unspent budget returned to unallocated funds.`, now());
    });
    sendState(res);
  });

  owner.post("/agents/:id/token", (req, res) => {
    // POST (not GET) so the token never lands in browser history or caches.
    const agent = findAgent(store.get(), req.params.id);
    res.set("Cache-Control", "no-store").json({ token: agent.apiToken });
  });

  owner.post("/agents/:id/token/rotate", (req, res) => {
    const token = store.mutate((s) => {
      const agent = findAgent(s, req.params.id);
      agent.apiToken = newToken();
      log(s, "Owner", "warning", `Rotated the API token for ${agent.name}. The old token no longer works.`, now());
      return agent.apiToken;
    });
    res.set("Cache-Control", "no-store").json({ token });
  });

  owner.put("/agents/:id/budget", (req, res) => {
    const body = asBody(req.body);
    const budgetCents = cents(body, "budgetCents", { required: true }) as number;
    store.mutate((s) => {
      const agent = findAgent(s, req.params.id);
      const t = now();
      const finance = computeFinance(s, t);
      const af = finance.agents.find((a) => a.agentId === agent.id);
      const spent = af?.spentCents ?? 0;
      if (budgetCents < spent) {
        throw bad(`${agent.name} has already spent ${formatCents(spent)}; the budget cannot be lower than that.`);
      }
      const increase = budgetCents - spent - (af?.remainingCents ?? 0);
      if (increase > 0 && increase > finance.unallocatedCents) {
        throw bad(`Not enough unallocated funds: need ${formatCents(increase)}, have ${formatCents(Math.max(0, finance.unallocatedCents))}. Deposit more first.`);
      }
      const old = agent.budgetCents;
      agent.budgetCents = budgetCents;
      log(s, "Owner", "info", `Set ${agent.name} budget from ${formatCents(old)} to ${formatCents(budgetCents)}.`, t);
    });
    sendState(res);
  });

  /* ---------- Guardrails ---------- */

  owner.put("/guardrails", (req, res) => {
    const body = asBody(req.body);
    store.mutate((s) => {
      const g = s.guardrails;
      const t = now();
      const kill = bool(body, "killSwitch");
      const per = centsOrNull(body, "perTransactionLimitCents");
      const daily = centsOrNull(body, "dailySpendLimitCents");
      const monthly = centsOrNull(body, "monthlySpendLimitCents");
      const threshold = centsOrNull(body, "approvalThresholdCents");
      const aiCap = centsOrNull(body, "aiMonthlyLimitCents");
      if (aiCap !== undefined) g.aiMonthlyLimitCents = aiCap;
      if (per !== undefined) g.perTransactionLimitCents = per;
      if (daily !== undefined) g.dailySpendLimitCents = daily;
      if (monthly !== undefined) g.monthlySpendLimitCents = monthly;
      if (threshold !== undefined) g.approvalThresholdCents = threshold;
      if (kill !== undefined && kill !== g.killSwitch) {
        g.killSwitch = kill;
        log(s, "Owner", kill ? "error" : "success", kill ? "KILL SWITCH ON: all agent activity stopped." : "Kill switch off: agents may resume.", t, {
          kind: "system",
        });
      }
      if ([per, daily, monthly, threshold, aiCap].some((v) => v !== undefined)) log(s, "Owner", "info", "Updated global guardrails.", t);
    });
    sendState(res);
  });

  /* ---------- Funding ---------- */

  owner.post("/funding", (req, res) => {
    const body = asBody(req.body);
    const type = oneOf(body, "type", FUNDING_TYPES, true) as FundingType;
    const note = str(body, "note", { max: 500 }) ?? "";
    const rev = type === "revenue" ? parseRevenue(body) : null;
    const amountCents = rev ? rev.amountCents : (cents(body, "amountCents", { required: true, positive: true }) as number);
    store.mutate((s) => {
      const t = now();
      if (type === "withdrawal") {
        const available = Math.max(0, computeFinance(s, t).unallocatedCents);
        if (amountCents > available) {
          throw bad(`You can only withdraw unallocated funds (${formatCents(available)}). Lower agent budgets first.`);
        }
      }
      s.funding.push({ id: newId(), type, ...(rev ?? { amountCents }), note, agentId: null, createdAt: t.toISOString() });
      if (rev) {
        log(s, "Owner", "success", `Recorded sales: ${formatCents(rev.amountCents)} net payout.${note ? ` ${note}` : ""}`, t, {
          kind: "revenue",
          amountCents: rev.amountCents,
          title: "Sales recorded",
          fields: revenueFields(rev),
        });
      } else {
        log(s, "Owner", "info", `${type === "deposit" ? "Deposited" : "Withdrew"} ${formatCents(amountCents)}.${note ? ` ${note}` : ""}`, t);
      }
      if (type !== "withdrawal" && s.allocation.auto) autoAllocate(s, t, type);
    });
    sendState(res);
  });

  /* ---------- Requests ---------- */

  function findRequest(s: DashboardState, id: string): ActionRequest {
    const r = s.requests.find((x) => x.id === id);
    if (!r) throw new HttpError(404, "Request not found.");
    return r;
  }

  owner.post("/requests/:id/approve", (req, res) => {
    store.mutate((s) => {
      const r = findRequest(s, req.params.id);
      if (r.status !== "pending_approval") throw new HttpError(409, `This request is already ${r.status}.`);
      const agent = findAgent(s, r.agentId);
      const t = now();
      const problems = hardLimitViolations(s, agent, { action: r.action, amountCents: r.amountCents, priceCents: r.priceCents }, t);
      if (problems.length > 0) throw new HttpError(409, `Cannot approve: ${problems.join(" ")}`);
      r.status = "approved";
      r.decidedAt = t.toISOString();
      r.decidedBy = "owner";
      r.reasons = [...r.reasons, "Approved by owner."];
      log(s, "Owner", "success", `Approved ${agent.name}: ${actionLabel(agent, r.action)}${r.amountCents > 0 ? ` for ${formatCents(r.amountCents)}` : ""}.`, t, {
        kind: "request_approved",
        agentId: agent.id,
        amountCents: r.amountCents,
        title: `Owner approved: ${actionLabel(agent, r.action)}${r.amountCents > 0 ? ` (${formatCents(r.amountCents)})` : ""}`,
      });
    });
    sendState(res);
  });

  owner.post("/requests/:id/reject", (req, res) => {
    const body = asBody(req.body);
    const note = str(body, "note", { max: 2000 }) ?? "";
    store.mutate((s) => {
      const r = findRequest(s, req.params.id);
      if (r.status !== "pending_approval") throw new HttpError(409, `This request is already ${r.status}.`);
      const t = now();
      r.status = "rejected";
      r.decidedAt = t.toISOString();
      r.decidedBy = "owner";
      r.resultNote = note;
      r.reasons = [...r.reasons, `Rejected by owner.${note ? ` ${note}` : ""}`];
      const agent = s.agents.find((a) => a.id === r.agentId);
      log(s, "Owner", "warning", `Rejected ${agent?.name ?? "agent"}: ${actionLabel(agent, r.action)}.${note ? ` ${note}` : ""}`, t, {
        kind: "request_denied",
        agentId: agent?.id ?? null,
        title: `Owner rejected: ${actionLabel(agent, r.action)}`,
      });
    });
    sendState(res);
  });

  owner.post("/requests/:id/close", (req, res) => {
    const body = asBody(req.body);
    const outcome = oneOf(body, "outcome", ["completed", "cancelled"] as const, true);
    const actual = cents(body, "actualAmountCents");
    const note = str(body, "note", { max: 2000 }) ?? "";
    store.mutate((s) => {
      const r = findRequest(s, req.params.id);
      if (r.status !== "approved") throw new HttpError(409, `Only approved requests can be closed (this one is ${r.status}).`);
      const t = now();
      if (outcome === "completed") {
        const finalAmount = actual ?? r.amountCents;
        if (finalAmount > r.amountCents) throw bad(`Actual amount cannot exceed the approved ${formatCents(r.amountCents)}.`);
        r.actualAmountCents = finalAmount;
      }
      r.status = outcome as "completed" | "cancelled";
      r.closedAt = t.toISOString();
      r.resultNote = note;
      const agent = s.agents.find((a) => a.id === r.agentId);
      log(s, "Owner", "info", `Marked ${agent?.name ?? "agent"}: ${actionLabel(agent, r.action)} as ${outcome}.`, t);
    });
    sendState(res);
  });

  registerSetupRoutes(owner, {
    store,
    now,
    sendState,
    research: opts.research ?? anthropicResearch,
    notifier: opts.notifier,
    shopify: opts.shopify ?? new ShopifyService(store, undefined, now),
  });

  app.use("/api", owner);

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found." });
  });

  // Express recognises error handlers by their four parameters.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const e = err as { type?: string; status?: number };
    if (e?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Request body is not valid JSON." });
      return;
    }
    if (e?.type === "entity.too.large") {
      res.status(413).json({ error: "Request body is too large." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error." });
  });

  return app;
}
