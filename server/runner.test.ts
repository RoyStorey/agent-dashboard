import assert from "node:assert/strict";
import { describe, it } from "node:test";
import request from "supertest";
import type { Agent, StateResponse } from "../shared/types.ts";
import { createAgent } from "./agents.ts";
import { createApp } from "./app.ts";
import type { ModelCall, ModelRequest } from "./runner/claude.ts";
import { briefing, systemPrompt } from "./runner/prompts.ts";
import { AgentRunner } from "./runner/runner.ts";
import { checkWork } from "./runner/signals.ts";
import { cleanHtml, type ShopifyTools } from "./runner/tools.ts";
import { defaultState, migrate, Store } from "./store.ts";

const json = { "Content-Type": "application/json" };
const MIN = 60_000;

/** A scripted stand-in for Claude: each agent's script may call its tools, then returns its summary. */
type Script = (req: ModelRequest, call: (name: string, input: Record<string, unknown>) => Promise<string>) => Promise<string>;

function fakeModel(scripts: Record<string, Script>, calls: Array<{ agent: string; req: ModelRequest }>): ModelCall {
  return async function* (req) {
    const agent = /^You are (.+?), the /.exec(req.system)?.[1] ?? "?";
    calls.push({ agent, req });
    const call = async (name: string, input: Record<string, unknown>) => {
      const tool = req.tools.find((t) => t.name === name);
      if (!tool) throw new Error(`no tool ${name}`);
      try {
        return await req.runTool(tool, input);
      } catch (err) {
        return `ERROR: ${(err as Error).message}`;
      }
    };
    const text = await (scripts[agent] ?? (async () => "Nothing to do."))(req, call);
    yield {
      model: req.model,
      usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 },
      text,
      searches: [],
      stopReason: "end_turn",
    };
  };
}

function setup(scripts: Record<string, Script>, roles: string[], opts: { shopify?: ShopifyTools } = {}) {
  let clock = new Date(2026, 10, 23, 9, 0, 0);
  // Each reading moves the clock on 1 ms, like real time, so events never share a timestamp.
  const now = () => (clock = new Date(clock.getTime() + 1));
  const store = new Store(null);
  const calls: Array<{ agent: string; req: ModelRequest }> = [];
  const runner = new AgentRunner(store, { now, model: fakeModel(scripts, calls), shopify: opts.shopify ?? null });
  const published: string[] = [];
  const shopify = {
    publishProduct: async (id: string) => void published.push(id),
    publishPage: async (id: string) => void published.push(id),
  };
  const app = createApp({ store, now, runner, shopify: shopify as never });
  store.mutate((s) => {
    s.vault.anthropic = { value: "sk-ant-test", updatedAt: clock.toISOString() };
    s.business.product = "Braided USB-C cables";
    for (const role of roles) {
      const a = createAgent(role, undefined, clock);
      a.status = "active";
      for (const f of a.inputFields) if (f.required && f.kind !== "secret" && !a.inputs[f.key]) a.inputs[f.key] = f.kind === "number" ? "10" : "x";
      s.agents.push(a);
    }
  });
  const agent = (role: string): Agent => store.get().agents.find((a) => a.role === role)!;
  return {
    store,
    app,
    runner,
    calls,
    published,
    agent,
    advance: (minutes: number) => {
      clock = new Date(clock.getTime() + minutes * MIN);
    },
    tick: async () => {
      runner.tick();
      await runner.settle();
    },
  };
}

describe("agent runner", () => {
  it("runs only agents with something new, records what they did, then goes idle", async () => {
    const t = setup(
      {
        Orchestrator: async (req, call) => {
          if (!req.user.includes("First run")) return "Checked in; all on track.";
          assert.equal(await call("set_brief", { brief: "Confirm demand for braided USB-C cables." }), "Brief updated.");
          assert.equal(await call("write_note", { to: ["research"], text: "Check competitor prices on Amazon." }), "Note saved.");
          return "Set the brief and asked Research for prices.";
        },
        Research: async () => "Waiting for the brief.",
      },
      ["orchestrator", "research", "storefront"],
    );
    await t.tick();
    assert.deepEqual(t.calls.map((c) => c.agent).sort(), ["Orchestrator", "Research"], "storefront waits for its phase");
    const s = t.store.get();
    assert.equal(s.plan.brief, "Confirm demand for braided USB-C cables.");
    const run = s.runs.find((r) => r.agentId === t.agent("orchestrator").id)!;
    assert.equal(run.status, "done");
    assert.equal(run.summary, "Set the brief and asked Research for prices.");
    assert.deepEqual(run.steps.map((x) => x.text), ["Updating the team brief", "Writing a note to research"]);
    assert.equal(run.costCents, 1);
    assert.equal(t.agent("orchestrator").runtime.state, "idle");
    assert.ok(t.agent("orchestrator").runtime.lastRunAt);
    assert.match(t.agent("storefront").runtime.lastSkip ?? "", /Build the store/);
    assert.ok(s.activity.some((a) => a.message.startsWith("Started working: First run")));
    assert.ok(s.activity.some((a) => a.kind === "report" && a.title === "Orchestrator finished"));
    assert.equal(s.aiUsage.length, 2);

    // Nothing new: the next checks are free.
    t.advance(24 * 60);
    t.tick();
    await t.runner.settle();
    // Research has a new note (written after its run started), so it runs; the Orchestrator only does its daily check-in.
    const names = t.calls.slice(2).map((c) => c.agent).sort();
    assert.deepEqual(names, ["Orchestrator", "Research"]);
    const researchRun = t.store.get().runs.filter((r) => r.agentId === t.agent("research").id).at(-1)!;
    assert.match(researchRun.reason, /1 new note for you/);
    assert.match(t.calls.find((c, i) => i >= 2 && c.agent === "Research")!.req.user, /Check competitor prices on Amazon/);

    const before = t.calls.length;
    t.advance(24 * 60 * 2);
    await t.tick();
    assert.equal(t.calls.length - before, 1, "only the Orchestrator's daily check-in; Research has nothing new");
    assert.equal(t.agent("research").runtime.lastSkip, "Nothing new since its last run.");
  });

  it("wakes a teammate early for a note, but not within the cooldown", async () => {
    const t = setup({ Orchestrator: async () => "Planned." , Research: async () => "Done." }, ["orchestrator", "research"]);
    await t.tick();
    const n = t.calls.length;
    await request(t.app).post("/api/team/notes").set(json).send({ to: ["research"], text: "Look at 240 W cables too." }).expect(200);
    t.advance(5);
    await t.tick();
    assert.equal(t.calls.length, n, "still cooling down");
    t.advance(30);
    await t.tick();
    assert.equal(t.calls.length, n + 1);
    assert.equal(t.calls.at(-1)!.agent, "Research");
    assert.ok(Date.parse(t.agent("orchestrator").runtime.nextCheckAt!) > Date.parse(t.agent("research").runtime.lastRunAt!), "the Orchestrator waits for its schedule");
  });

  it("moves to the next phase only after the owner approves", async () => {
    const t = setup(
      { Orchestrator: async (_r, call) => (await call("propose_next_phase", { reason: "Demand confirmed." }), "Asked to move on.") },
      ["orchestrator", "sourcing"],
    );
    await t.tick();
    assert.deepEqual(t.calls.map((c) => c.agent), ["Orchestrator"], "sourcing waits");
    let s = t.store.get();
    assert.equal(s.plan.phase, "research");
    const r = s.requests.find((x) => x.action === "advance_phase")!;
    assert.equal(r.status, "pending_approval", r.reasons.join(" "));
    assert.equal(r.meta?.phase, "sourcing");
    await request(t.app).post(`/api/requests/${r.id}/approve`).set(json).send({}).expect(200);
    s = t.store.get();
    assert.equal(s.plan.phase, "sourcing");
    assert.equal(s.requests.find((x) => x.id === r.id)!.status, "completed");
    t.advance(35);
    await t.tick();
    assert.ok(t.calls.some((c) => c.agent === "Sourcing"), `sourcing starts in its phase: ${JSON.stringify(t.agent("sourcing").runtime)} ${JSON.stringify(t.calls.map((c) => c.agent))}`);
    assert.ok(t.calls.filter((c) => c.agent === "Orchestrator").length === 2, "the owner's decision wakes the Orchestrator");
  });

  it("drafts store listings in Shopify for the owner to publish or reject", async () => {
    const created: Array<{ title: string; priceCents?: number }> = [];
    const fake: ShopifyTools = {
      listProducts: async () => [],
      createProductDraft: async (i) => (created.push(i), `gid://shopify/Product/${created.length}`),
      createPageDraft: async (i) => (created.push(i), `gid://shopify/Page/${created.length}`),
      salesSummary: async () => ({ days: 30, orders: 0, units: 0, grossCents: 0, refundedCents: 0, currency: "USD" }),
    };
    const results: string[] = [];
    const t = setup(
      {
        "Storefront & Listings": async (_r, call) => {
          results.push(await call("create_product_draft", { title: "Cheap cable", description_html: "<p>x</p>", price_cents: 999 }));
          results.push(
            await call("create_product_draft", {
              title: "Braided USB-C cable 2 m",
              description_html: '<p onclick="steal()">Tough.</p><script>alert(1)</script>',
              price_cents: 2499,
              tags: ["usb-c"],
            }),
          );
          results.push(await call("create_product_draft", { title: "braided usb-c cable 2 m", description_html: "<p>dup</p>", price_cents: 2499 }));
          results.push(await call("create_page_draft", { title: "Shipping & returns", body_html: "<p>Ships in 2 days.</p>" }));
          return "Drafted the first listing and the shipping page.";
        },
      },
      ["storefront"],
      { shopify: fake },
    );
    t.store.mutate((s) => {
      s.vault.shopify_admin = { value: "s.myshopify.com\nid\nsecret", updatedAt: "" };
      s.agents[0]!.inputs.min_price = "20.00";
    });
    await request(t.app).put("/api/team/plan").set(json).send({ phase: "store" }).expect(200);
    await t.tick();
    assert.match(results[0]!, /below the price floor of \$20\.00/);
    assert.match(results[1]!, /Draft product created/);
    assert.match(results[2]!, /already exists/);
    assert.match(results[3]!, /Draft page created/);
    assert.equal(created.length, 2);
    const drafts = t.store.get().drafts;
    assert.deepEqual(drafts.map((d) => [d.kind, d.status]), [["product", "pending"], ["page", "pending"]]);
    assert.ok(!JSON.stringify(created).includes("<script") && !JSON.stringify(created).includes("onclick"), `unsafe HTML removed: ${JSON.stringify(created)}`);

    const st = (await request(t.app).post(`/api/drafts/${drafts[0]!.id}/publish`).set(json).send({}).expect(200)).body as StateResponse;
    assert.deepEqual(t.published, ["gid://shopify/Product/1"]);
    assert.equal(st.drafts.find((d) => d.id === drafts[0]!.id)!.status, "published");
    await request(t.app).post(`/api/drafts/${drafts[0]!.id}/publish`).set(json).send({}).expect(409);
    await request(t.app).post(`/api/drafts/${drafts[1]!.id}/reject`).set(json).send({ note: "Say 3-5 days." }).expect(200);
    const work = checkWork(t.store.get(), t.agent("storefront"), new Date(Date.now() + 1e12));
    assert.match(work.reason ?? "", /reviewed 2 drafts/);
    assert.equal(work.urgent, true);
  });

  it("never runs past the guardrails: kill switch, AI budget, missing key, daily limit", async () => {
    let calls = 0;
    const t = setup(
      {
        Research: async (_r, call) => {
          calls++;
          return (await call("write_note", { to: ["all"], text: "Finding." })) + " Done.";
        },
      },
      ["research"],
    );
    await request(t.app).put("/api/guardrails").set(json).send({ killSwitch: true }).expect(200);
    await t.tick();
    assert.equal(calls, 0);
    assert.equal(t.agent("research").runtime.lastSkip, "Kill switch is on.");
    await request(t.app).post(`/api/agents/${t.agent("research").id}/run`).set(json).send({}).expect(409);
    await request(t.app).put("/api/guardrails").set(json).send({ killSwitch: false, aiMonthlyLimitCents: 1 }).expect(200);

    // The first run uses the whole 1¢ AI budget, so it is stopped and nothing more runs this month.
    await request(t.app).post(`/api/agents/${t.agent("research").id}/run`).set(json).send({}).expect(200);
    await t.runner.settle();
    const run = t.store.get().runs.at(-1)!;
    assert.equal(run.trigger, "manual");
    assert.equal(run.status, "stopped");
    assert.match(run.error ?? "", /AI usage budget/);
    const r = await request(t.app).post(`/api/agents/${t.agent("research").id}/run`).set(json).send({}).expect(409);
    assert.match(r.body.error, /AI usage budget/);

    // An unknown model can't be priced, so it can't be kept to the budget.
    await request(t.app).put("/api/guardrails").set(json).send({ aiMonthlyLimitCents: null }).expect(200);
    t.store.mutate((s) => (s.agents[0]!.connection.model = "some-other-model"));
    const m = await request(t.app).post(`/api/agents/${t.agent("research").id}/run`).set(json).send({}).expect(409);
    assert.match(m.body.error, /model it knows the price of/);
    t.store.mutate((s) => (s.agents[0]!.connection.model = "claude-opus-5-5"));

    // The daily limit holds back scheduled runs (but not Run now).
    await request(t.app).put(`/api/agents/${t.agent("research").id}/schedule`).set(json).send({ maxRunsPerDay: 1, everyMinutes: 60 }).expect(200);
    t.store.mutate((s) => s.runs.push({ ...run, id: "x", trigger: "schedule", startedAt: new Date(Date.parse(run.startedAt) + 1).toISOString() }));
    await request(t.app).post("/api/team/notes").set(json).send({ to: ["research"], text: "More please." }).expect(200);
    t.advance(61);
    await t.tick();
    assert.match(t.agent("research").runtime.lastSkip ?? "", /today's limit of 1 run/);
    await request(t.app).put(`/api/agents/${t.agent("research").id}/schedule`).set(json).send({ everyMinutes: 7 }).expect(400);

    // No key: blocked with a clear reason.
    t.store.mutate((s) => delete s.vault.anthropic);
    const k = await request(t.app).post(`/api/agents/${t.agent("research").id}/run`).set(json).send({}).expect(409);
    assert.match(k.body.error, /No Anthropic API key/);
  });

  it("stops a run when the owner pauses the agent", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const replies: string[] = [];
    const t = setup(
      {
        Research: async (_r, call) => {
          await gate;
          replies.push(await call("write_note", { to: ["all"], text: "Late finding." }));
          return "Done.";
        },
      },
      ["research"],
    );
    t.runner.tick();
    assert.equal(t.agent("research").runtime.state, "working");
    assert.equal(t.agent("research").runtime.step, "Reading its briefing");
    const st = (await request(t.app).get("/api/state")).body as StateResponse;
    assert.equal(st.runs[0]!.status, "running");
    await request(t.app).patch(`/api/agents/${t.agent("research").id}`).set(json).send({ status: "paused" }).expect(200);
    release();
    await t.runner.settle();
    assert.match(replies[0]!, /Stopped/);
    const run = t.store.get().runs.at(-1)!;
    assert.equal(run.status, "stopped");
    assert.equal(t.store.get().notebook.length, 0, "nothing written after the pause");
    assert.equal(t.agent("research").runtime.state, "idle");
  });

  it("keeps the system prompt stable between runs so it can be cached, and the briefing compact", async () => {
    const t = setup({}, ["orchestrator", "research"]);
    const s = t.store.get();
    const a = t.agent("research");
    assert.equal(systemPrompt(s, a), systemPrompt(t.store.get(), a));
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(systemPrompt(s, a)), "no dates in the cached part");
    assert.ok(!systemPrompt(s, a).includes("sk-ant"), "never includes secrets");
    const b = briefing(s, a, "First run", new Date());
    assert.ok(b.length < 2500, `briefing is ${b.length} characters`);
  });
});

describe("runner details", () => {
  it("cleans agent-written HTML", () => {
    assert.equal(cleanHtml('<p onclick="x()">Hi</p><script>bad()</script><a href="javascript:alert(1)">l</a>'), '<p>Hi</p><a href="#">l</a>');
    assert.equal(cleanHtml("<iframe src=x></iframe><b>ok</b>"), "<b>ok</b>");
  });

  it("upgrades older saves with schedules, limits and the phase start", () => {
    const old = defaultState() as unknown as Record<string, unknown>;
    const agent = createAgent("research", undefined, new Date()) as unknown as Record<string, unknown>;
    agent.schedule = { enabled: false, everyMinutes: 60 };
    agent.runtime = { ...(agent.runtime as object), state: "working", runId: "r1" };
    const s = migrate({ ...old, agents: [agent], plan: { phase: "sourcing", brief: "b", updatedAt: null, updatedBy: null } } as never);
    assert.deepEqual(s.agents[0]!.schedule, { enabled: false, everyMinutes: 60, maxRunsPerDay: 6 });
    assert.equal(s.agents[0]!.runtime.state, "idle");
    assert.equal(s.plan.phase, "sourcing");
    assert.equal(s.plan.phaseSince, null);
  });
});
