import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { formatCents } from "../shared/money.ts";
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
import { computeFinance } from "./finance.ts";
import { evaluate, hardLimitViolations } from "./guardrails.ts";
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
}

const INPUT_KINDS: readonly InputKind[] = ["text", "secret", "number", "url", "textarea"];
const TASK_CATEGORIES: readonly TaskCategory[] = ["legal", "finance", "sales", "product", "operations", "custom"];
const FUNDING_TYPES: readonly FundingType[] = ["deposit", "withdrawal", "revenue"];
const LEVELS: readonly ActivityLevel[] = ["info", "warning", "error", "success"];
const MAX_ACTIVITY_RETURNED = 300;

function actionLabel(agent: Agent | undefined, key: string): string {
  return agent?.actions.find((a) => a.key === key)?.label ?? key;
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
      inputs: agent.inputs,
      inputFields: agent.inputFields.map((f) => ({ key: f.key, label: f.label, kind: f.kind, required: f.required })),
      missingInputs: missingInputs(agent),
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
      return log(s, agent.name, level, message, t);
    });
    res.status(201).json({ entry });
  });

  agentApi.post("/actions", (req, res) => {
    const body = asBody(req.body);
    const action = str(body, "action", { max: 64, required: true }) as string;
    const description = str(body, "description", { max: 2000 }) ?? "";
    const amountCents = cents(body, "amountCents") ?? 0;
    const request = store.mutate((s) => {
      const agent = currentAgent(s, res);
      const t = now();
      touch(agent, t);
      const ev = evaluate(s, agent, { action, amountCents }, t);
      const r: ActionRequest = {
        id: newId(),
        agentId: agent.id,
        action,
        description,
        amountCents,
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
      const money = amountCents > 0 ? ` for ${formatCents(amountCents)}` : "";
      const label = actionLabel(agent, action);
      if (ev.decision === "approved") log(s, agent.name, "info", `Approved: ${label}${money}.`, t);
      else if (ev.decision === "pending_approval")
        log(s, agent.name, "warning", `Needs your approval: ${label}${money}. ${ev.reasons.join(" ")}`, t);
      else log(s, agent.name, "error", `Denied: ${label}${money}. ${ev.reasons.join(" ")}`, t);
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
      log(s, agent.name, "success", `Completed: ${actionLabel(agent, request.action)}${money}. ${note}`.trim(), t);
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
      log(s, agent.name, "info", `Cancelled: ${actionLabel(agent, request.action)}. ${note}`.trim(), t);
      return request;
    });
    res.json({ request });
  });

  agentApi.post("/revenue", (req, res) => {
    const body = asBody(req.body);
    const amountCents = cents(body, "amountCents", { required: true, positive: true }) as number;
    const note = str(body, "note", { max: 500 }) ?? "";
    const entry = store.mutate((s) => {
      const agent = currentAgent(s, res);
      const t = now();
      touch(agent, t);
      const problems = hardLimitViolations(s, agent, { action: "report_revenue", amountCents: 0 }, t);
      if (problems.length > 0) throw new HttpError(403, problems.join(" "));
      const e = { id: newId(), type: "revenue" as const, amountCents, note, agentId: agent.id, createdAt: t.toISOString() };
      s.funding.push(e);
      log(s, agent.name, "success", `Reported revenue of ${formatCents(amountCents)}. ${note}`.trim(), t);
      return e;
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
    next();
  });

  function buildState(): StateResponse {
    const s = store.get();
    const t = now();
    const finance = computeFinance(s, t);
    return {
      business: s.business,
      tasks: s.tasks,
      agents: s.agents.map(toView),
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
      const b = s.business;
      b.name = str(body, "name", { max: 200 }) ?? b.name;
      b.product = str(body, "product", { max: 500 }) ?? b.product;
      b.description = str(body, "description", { max: 5000 }) ?? b.description;
      b.targetMarket = str(body, "targetMarket", { max: 1000 }) ?? b.targetMarket;
      b.salesChannels = str(body, "salesChannels", { max: 1000 }) ?? b.salesChannels;
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
      s.tasks.push({ id: newId(), title: title.trim(), description, category, status: "todo", notes: "", custom: true, completedAt: null });
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
          const missing = missingInputs(agent);
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
      if (per !== undefined) g.perTransactionLimitCents = per;
      if (daily !== undefined) g.dailySpendLimitCents = daily;
      if (monthly !== undefined) g.monthlySpendLimitCents = monthly;
      if (threshold !== undefined) g.approvalThresholdCents = threshold;
      if (kill !== undefined && kill !== g.killSwitch) {
        g.killSwitch = kill;
        log(s, "Owner", kill ? "error" : "success", kill ? "KILL SWITCH ON: all agent activity stopped." : "Kill switch off: agents may resume.", t);
      }
      if ([per, daily, monthly, threshold].some((v) => v !== undefined)) log(s, "Owner", "info", "Updated global guardrails.", t);
    });
    sendState(res);
  });

  /* ---------- Funding ---------- */

  owner.post("/funding", (req, res) => {
    const body = asBody(req.body);
    const type = oneOf(body, "type", FUNDING_TYPES, true) as FundingType;
    const amountCents = cents(body, "amountCents", { required: true, positive: true }) as number;
    const note = str(body, "note", { max: 500 }) ?? "";
    store.mutate((s) => {
      const t = now();
      if (type === "withdrawal") {
        const available = Math.max(0, computeFinance(s, t).unallocatedCents);
        if (amountCents > available) {
          throw bad(`You can only withdraw unallocated funds (${formatCents(available)}). Lower agent budgets first.`);
        }
      }
      s.funding.push({ id: newId(), type, amountCents, note, agentId: null, createdAt: t.toISOString() });
      const verb = type === "deposit" ? "Deposited" : type === "withdrawal" ? "Withdrew" : "Recorded revenue of";
      log(s, "Owner", "info", `${verb} ${formatCents(amountCents)}.${note ? ` ${note}` : ""}`, t);
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
      const problems = hardLimitViolations(s, agent, { action: r.action, amountCents: r.amountCents }, t);
      if (problems.length > 0) throw new HttpError(409, `Cannot approve: ${problems.join(" ")}`);
      r.status = "approved";
      r.decidedAt = t.toISOString();
      r.decidedBy = "owner";
      r.reasons = [...r.reasons, "Approved by owner."];
      log(s, "Owner", "success", `Approved ${agent.name}: ${actionLabel(agent, r.action)}${r.amountCents > 0 ? ` for ${formatCents(r.amountCents)}` : ""}.`, t);
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
      log(s, "Owner", "warning", `Rejected ${agent?.name ?? "agent"}: ${actionLabel(agent, r.action)}.${note ? ` ${note}` : ""}`, t);
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
