/**
 * The built-in agent runner. Every minute it looks at each active agent and,
 * in plain code, decides whether it has anything new to do (signals.ts). Only
 * then does it call Claude. While a run is going, the agent's live status
 * shows what it's doing; when it ends, the run's summary, steps and cost are
 * saved and the agent goes back to idle.
 */
import { estimateCostCents, MODEL_PRICES } from "../../shared/aiPricing.ts";
import { formatCents } from "../../shared/money.ts";
import { MAX_CONCURRENT_RUNS, WAKE_COOLDOWN_MINUTES, roleBudget } from "../../shared/team.ts";
import type { Agent, AgentRun, DashboardState } from "../../shared/types.ts";
import { agentById, recordUsage, writeReport } from "../agentOps.ts";
import { startOfDay } from "../finance.ts";
import { resolveInputs } from "../inputs.ts";
import { log, newId, type Store } from "../store.ts";
import { HttpError } from "../validate.ts";
import { anthropicModelCall, describeModelError, type ModelCall } from "./claude.ts";
import { briefing, systemPrompt } from "./prompts.ts";
import { blockedReason, checkWork, phaseWait } from "./signals.ts";
import { ToolInputError, toolsFor, type AgentTool, type ShopifyTools, type ToolContext } from "./tools.ts";

const MINUTE = 60_000;
const MAX_STEPS = 60;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface RunnerOptions {
  now?: () => Date;
  model?: ModelCall;
  /** Shopify calls for agents, used only while Shopify is connected. */
  shopify?: ShopifyTools | null;
  maxConcurrent?: number;
}

export function runsToday(s: DashboardState, agentId: string, now: Date): number {
  const start = startOfDay(now).toISOString();
  return s.runs.filter((r) => r.agentId === agentId && r.trigger === "schedule" && r.startedAt >= start).length;
}

/** Why the runner can't use this agent's model, or null. The cost cap needs a known price. */
export function modelProblem(agent: Agent): string | null {
  const m = agent.connection.model.trim();
  if (MODEL_PRICES[m]) return null;
  return `The built-in runner needs a model it knows the price of (${Object.keys(MODEL_PRICES).join(", ")}), so it can keep to your AI budget. Change the model on this agent's Connect tab.`;
}

export class AgentRunner {
  private readonly now: () => Date;
  private readonly model: ModelCall;
  private readonly shopify: ShopifyTools | null;
  private readonly maxConcurrent: number;
  private readonly active = new Map<string, { controller: AbortController; stopReason: string | null; done: Promise<void> }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: Store,
    opts: RunnerOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.model = opts.model ?? anthropicModelCall;
    this.shopify = opts.shopify ?? null;
    this.maxConcurrent = opts.maxConcurrent ?? MAX_CONCURRENT_RUNS;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), MINUTE);
    this.timer.unref();
    setTimeout(() => this.tick(), 5_000).unref();
  }

  isRunning(agentId: string): boolean {
    return this.active.has(agentId);
  }

  /** Resolves when the agent's current run (if any) has finished. For tests and shutdown. */
  async settle(agentId?: string): Promise<void> {
    const runs = agentId ? [this.active.get(agentId)].filter(Boolean) : [...this.active.values()];
    await Promise.all(runs.map((r) => r!.done));
  }

  /** Reasons that stop this agent from running at all, or null. */
  private blocked(s: DashboardState, agent: Agent, t: Date): string | null {
    return blockedReason(s, agent, t) ?? modelProblem(agent);
  }

  /** The free check. Starts runs for agents with something new; records why the others stay idle. */
  tick(): void {
    const t = this.now();
    const s = this.store.get();
    const skips: Array<{ id: string; why: string }> = [];
    for (const agent of s.agents) {
      if (this.active.has(agent.id) || agent.status !== "active" || !agent.schedule.enabled) continue;
      const due = !agent.runtime.nextCheckAt || t.getTime() >= Date.parse(agent.runtime.nextCheckAt);
      const why = this.blocked(s, agent, t) ?? phaseWait(s, agent);
      if (why) {
        if (due) skips.push({ id: agent.id, why });
        continue;
      }
      const work = checkWork(s, agent, t);
      if (!work.reason) {
        if (due) skips.push({ id: agent.id, why: "Nothing new since its last run." });
        continue;
      }
      const cooled = !agent.runtime.lastRunAt || t.getTime() - Date.parse(agent.runtime.lastRunAt) >= WAKE_COOLDOWN_MINUTES * MINUTE;
      if (!due && !(work.urgent && cooled)) continue;
      if (runsToday(s, agent.id, t) >= agent.schedule.maxRunsPerDay) {
        if (due) skips.push({ id: agent.id, why: `Reached today's limit of ${agent.schedule.maxRunsPerDay} runs. Waiting: ${work.reason}.` });
        continue;
      }
      if (this.active.size >= this.maxConcurrent) continue; // try again next minute
      this.begin(agent.id, "schedule", work.reason);
    }
    if (skips.length) {
      this.store.mutate((d) => {
        for (const k of skips) {
          const a = d.agents.find((x) => x.id === k.id);
          if (!a) continue;
          a.runtime.lastCheckedAt = t.toISOString();
          a.runtime.lastSkip = k.why;
          a.runtime.nextCheckAt = new Date(t.getTime() + a.schedule.everyMinutes * MINUTE).toISOString();
        }
      });
    }
  }

  /** The owner's "Run now". Skips the "anything new?" check and the daily limit, never the guardrails. */
  runNow(agentId: string): void {
    const s = this.store.get();
    const agent = s.agents.find((a) => a.id === agentId);
    if (!agent) throw new HttpError(404, "Agent not found.");
    if (this.active.has(agentId)) throw new HttpError(409, `${agent.name} is already working.`);
    const why = this.blocked(s, agent, this.now());
    if (why) throw new HttpError(409, why);
    const work = checkWork(s, agent, this.now()).reason;
    this.begin(agentId, "manual", `the owner clicked Run now${work ? `; ${work.charAt(0).toLowerCase()}${work.slice(1)}` : ""}`);
  }

  /** Stops a run in progress (the owner's Stop button, the kill switch, or a pause). */
  stop(agentId: string, reason = "Stopped by the owner."): boolean {
    const run = this.active.get(agentId);
    if (!run) return false;
    run.stopReason = reason;
    run.controller.abort();
    return true;
  }

  /** Stops every run, e.g. when the kill switch is turned on. */
  stopAll(reason: string): void {
    for (const id of this.active.keys()) this.stop(id, reason);
  }

  private begin(agentId: string, trigger: AgentRun["trigger"], reason: string): void {
    const t = this.now();
    const runId = newId();
    const snapshot = this.store.mutate((s) => {
      const agent = agentById(s, agentId);
      // Build the prompts first: the briefing shows what's new since the *previous* run.
      const prompts = { system: systemPrompt(s, agent), user: briefing(s, agent, reason, t) };
      s.runs.push({
        id: runId,
        agentId,
        trigger,
        reason,
        startedAt: t.toISOString(),
        finishedAt: null,
        status: "running",
        steps: [],
        summary: "",
        costCents: 0,
        inputTokens: 0,
        outputTokens: 0,
        error: null,
      });
      agent.runtime = {
        ...agent.runtime,
        state: "working",
        step: "Reading its briefing",
        runId,
        since: t.toISOString(),
        lastRunAt: t.toISOString(),
        lastCheckedAt: t.toISOString(),
        lastSkip: null,
      };
      log(s, agent.name, "info", `Started working: ${reason}.`, t, { kind: "log", agentId });
      return { ...prompts, agent: structuredClone(agent), state: s };
    });
    const controller = new AbortController();
    const entry = { controller, stopReason: null as string | null, done: Promise.resolve() };
    this.active.set(agentId, entry);
    entry.done = this.execute(runId, snapshot.agent, snapshot.state, snapshot.system, snapshot.user, entry).finally(() => this.active.delete(agentId));
  }

  private step(runId: string, agentId: string, text: string, record: boolean): void {
    const t = this.now();
    this.store.mutate((s) => {
      const agent = s.agents.find((a) => a.id === agentId);
      if (agent && agent.runtime.runId === runId) agent.runtime.step = text;
      const run = s.runs.find((r) => r.id === runId);
      if (record && run && run.steps.length < MAX_STEPS) run.steps.push({ at: t.toISOString(), text: clip(text, 300) });
    });
  }

  private async execute(
    runId: string,
    agent: Agent,
    s: DashboardState,
    system: string,
    user: string,
    entry: { controller: AbortController; stopReason: string | null },
  ): Promise<void> {
    const budget = roleBudget(agent.role);
    const ctx: ToolContext = {
      store: this.store,
      agentId: agent.id,
      now: this.now,
      shopify: s.vault.shopify_admin?.value.trim() ? this.shopify : null,
      counters: { notes: 0, drafts: 0 },
    };
    const tools = toolsFor(agent.role, { shopifyConnected: ctx.shopify !== null, selfShipping: s.business.fulfillmentMode === "self" });
    const halt = (why: string) => {
      if (!entry.stopReason) entry.stopReason = why;
      entry.controller.abort();
    };

    const runTool = async (tool: AgentTool, input: Record<string, unknown>): Promise<string> => {
      const live = this.store.get();
      const a = live.agents.find((x) => x.id === agent.id);
      const why = !a ? "The agent was deleted." : blockedReason(live, a, this.now());
      if (why) {
        halt(why);
        throw new Error(`Stopped: ${why}`);
      }
      let label = tool.name;
      try {
        label = tool.label(input);
      } catch {
        /* a bad input shows the tool name; run() reports the problem */
      }
      this.step(runId, agent.id, label, true);
      try {
        return await tool.run(input, ctx);
      } catch (err) {
        const msg = err instanceof ToolInputError ? err.message : `That didn't work: ${err instanceof Error ? err.message : String(err)}`;
        this.step(runId, agent.id, `Problem: ${clip(msg, 200)}`, true);
        throw new Error(msg);
      } finally {
        this.step(runId, agent.id, "Thinking about the next step", false);
      }
    };

    let summary = "";
    let status: AgentRun["status"] = "done";
    let error: string | null = null;
    try {
      const apiKey = (resolveInputs(s, agent).values.llm_api_key ?? "").trim();
      const turns = this.model({
        apiKey,
        model: agent.connection.model.trim(),
        system,
        user,
        tools,
        effort: budget.effort,
        maxTokens: budget.maxTokens,
        maxIterations: budget.maxIterations,
        webSearches: budget.webSearches,
        signal: entry.controller.signal,
        runTool,
      });
      for await (const turn of turns) {
        const t = this.now();
        // A fallback model may not be on the price list: estimate at the agent's own model's price.
        const costCents = estimateCostCents(turn.model, turn.usage) ?? estimateCostCents(agent.connection.model.trim(), turn.usage) ?? 0;
        const usage = this.store.mutate((d) => {
          const u = recordUsage(d, agent.id, { model: turn.model, label: `${agent.name} run`, counts: turn.usage, costCents }, t);
          const run = d.runs.find((r) => r.id === runId);
          if (run) {
            run.costCents += u.costCents;
            run.inputTokens += turn.usage.inputTokens + turn.usage.cacheReadTokens + turn.usage.cacheWriteTokens;
            run.outputTokens += turn.usage.outputTokens;
            for (const q of turn.searches) if (run.steps.length < MAX_STEPS) run.steps.push({ at: t.toISOString(), text: clip(`Searched the web: ${q || "…"}`, 300) });
          }
          const a = d.agents.find((x) => x.id === agent.id);
          if (a && a.runtime.runId === runId) a.runtime.step = "Thinking about the next step";
          return u;
        });
        if (turn.text) summary = turn.text;
        if (turn.stopReason === "refusal") {
          status = "error";
          error = "The model declined this task.";
        }
        if (usage.overLimit) halt("This month's AI usage budget is used up.");
        const live = this.store.get();
        const liveAgent = live.agents.find((x) => x.id === agent.id);
        const why = !liveAgent ? "The agent was deleted." : blockedReason(live, liveAgent, t);
        if (why) halt(why);
        if (entry.controller.signal.aborted) break;
      }
      if (entry.stopReason) {
        status = "stopped";
        error = entry.stopReason;
      }
    } catch (err) {
      if (entry.controller.signal.aborted) {
        status = "stopped";
        error = entry.stopReason ?? "Stopped.";
      } else {
        status = "error";
        error = describeModelError(err);
      }
    }
    this.finish(runId, agent.id, status, summary, error);
  }

  private finish(runId: string, agentId: string, status: AgentRun["status"], summary: string, error: string | null): void {
    const t = this.now();
    this.store.mutate((s) => {
      const run = s.runs.find((r) => r.id === runId);
      const agent = s.agents.find((a) => a.id === agentId);
      if (run) {
        run.status = status;
        run.finishedAt = t.toISOString();
        run.summary = clip(summary || (status === "done" ? "Finished without a summary." : ""), 2000);
        run.error = error;
      }
      if (!agent) return;
      agent.runtime = {
        ...agent.runtime,
        state: "idle",
        step: null,
        runId: null,
        since: null,
        nextCheckAt: new Date(t.getTime() + agent.schedule.everyMinutes * MINUTE).toISOString(),
      };
      const cost = run ? ` (${formatCents(run.costCents)})` : "";
      if (status === "done") {
        writeReport(s, agentId, `${agent.name} finished`, `${run?.summary ?? summary}${cost}`.trim(), undefined, t);
      } else if (status === "stopped") {
        log(s, agent.name, "warning", `Stopped working: ${error ?? "stopped"}${cost}`, t, { kind: "log", agentId });
      } else {
        log(s, agent.name, "error", `Run failed: ${error ?? "unknown error"}${cost}`, t, { kind: "log", agentId, title: `${agent.name} hit a problem` });
      }
    });
  }
}
