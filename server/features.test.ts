import assert from "node:assert/strict";
import { describe, it } from "node:test";
import request from "supertest";
import { planAllocation, planRebalance } from "../shared/allocation.ts";
import { bpsToInput, breakEvenUnits, parsePercent, project, unitBreakdown } from "../shared/economics.ts";
import { computePnL } from "../shared/pnl.ts";
import type { ActionRequest, ActivityEntry, DashboardState, StateResponse, UnitEconomics } from "../shared/types.ts";
import { createAgent } from "./agents.ts";
import { createApp, parseRevenue } from "./app.ts";
import { DiscordNotifier, routeEntry, type DiscordPayload } from "./discord.ts";
import { autofillAgent, resolveInputs } from "./inputs.ts";
import type { ResearchRunner } from "./research.ts";
import { defaultState, migrate, newId, Store } from "./store.ts";

const NOW = new Date(2026, 10, 22, 12, 0, 0);
const json = { "Content-Type": "application/json" };
const HOOK = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABCDEF-123";
const HOOK2 = "https://discord.com/api/webhooks/223456789012345678/bbcdefghijklmnopqrstuvwxyz_ABCDEF-123";

const ECON: UnitEconomics = {
  salePriceCents: 2500,
  unitCostCents: 500,
  inboundShippingCents: 100,
  otherPerUnitCents: 50,
  fulfillmentFeeCents: 400,
  marketplaceFeeBps: 1500,
  paymentFeeBps: 0,
  perOrderFeeCents: 0,
  adSpendBps: 1500,
  returnRateBps: 500,
  fixedMonthlyCents: 20000,
  monthlyUnits: 300,
};

describe("unit economics", () => {
  it("computes every per-unit line exactly", () => {
    const u = unitBreakdown(ECON);
    assert.equal(u.grossSales, 2500);
    assert.equal(u.refunds, 125);
    assert.equal(u.netSales, 2375);
    assert.equal(u.landedCost, 650);
    assert.equal(u.grossProfit, 1725);
    assert.equal(u.grossMarginBps, 7263);
    assert.equal(u.marketplaceFees, 375);
    assert.equal(u.advertising, 375);
    assert.equal(u.contribution, 575);
    assert.equal(u.contributionMarginBps, 2421);
    assert.equal(u.roiBps, 8846);
    assert.equal(u.breakEvenPrice, 1616);
    assert.equal(u.breakEvenAdBps, 3800);
  });

  it("break-even price really breaks even", () => {
    const at = unitBreakdown({ ...ECON, salePriceCents: 1616 });
    const below = unitBreakdown({ ...ECON, salePriceCents: 1614 });
    assert.ok(at.contribution >= 0);
    assert.ok(below.contribution < 0);
  });

  it("projects a month and the break-even volume", () => {
    const p = project(ECON, 300);
    assert.equal(p.netProfit, 300 * 575 - 20000);
    assert.equal(p.netMarginBps, 2140);
    assert.equal(p.inventoryCash, 300 * 650);
    assert.equal(breakEvenUnits(ECON), 35);
    assert.equal(breakEvenUnits({ ...ECON, salePriceCents: 1000 }), null);
  });

  it("parses and prints percentages as basis points", () => {
    assert.equal(parsePercent("2.9"), 290);
    assert.equal(parsePercent("15"), 1500);
    assert.equal(parsePercent("12.5%"), 1250);
    assert.equal(parsePercent("0.05"), 5);
    assert.equal(parsePercent("101"), null);
    assert.equal(parsePercent("abc"), null);
    assert.equal(bpsToInput(290), "2.9");
    assert.equal(bpsToInput(1250), "12.5");
    assert.equal(bpsToInput(1500), "15");
    assert.equal(bpsToInput(5), "0.05");
  });
});

function req(agentId: string, action: string, amount: number, at: Date): ActionRequest {
  return {
    id: newId(),
    agentId,
    action,
    description: "",
    amountCents: amount,
    actualAmountCents: amount,
    status: "completed",
    reasons: [],
    createdAt: at.toISOString(),
    decidedAt: at.toISOString(),
    decidedBy: "guardrails",
    closedAt: at.toISOString(),
    resultNote: "",
  };
}

describe("profit & loss", () => {
  const sourcing = createAgent("sourcing", undefined, NOW);
  const marketing = createAgent("marketing", undefined, NOW);
  const funding = [
    { id: newId(), type: "deposit" as const, amountCents: 500000, note: "", agentId: null, createdAt: new Date(2026, 10, 1).toISOString() },
    {
      id: newId(),
      type: "revenue" as const,
      amountCents: 80000,
      grossSalesCents: 100000,
      refundsCents: 5000,
      feesCents: 15000,
      unitsSold: 40,
      note: "",
      agentId: null,
      createdAt: new Date(2026, 10, 20).toISOString(),
    },
  ];
  const requests = [
    req(marketing.id, "ad_spend", 10000, new Date(2026, 10, 10)),
    req(sourcing.id, "place_purchase_order", 30000, new Date(2026, 10, 5)),
    req(sourcing.id, "order_samples", 2000, new Date(2026, 10, 3)),
    req(sourcing.id, "order_samples", 999, new Date(2026, 9, 3)), // last month: excluded
  ];

  it("builds the statement from reported sales and categorized spend", () => {
    const p = computePnL({ funding, requests, agents: [sourcing, marketing], economics: { ...ECON, fixedMonthlyCents: 0 }, period: "this_month", now: NOW });
    assert.equal(p.grossSales, 100000);
    assert.equal(p.refunds, 5000);
    assert.equal(p.netSales, 95000);
    assert.equal(p.unitsSold, 40);
    assert.equal(p.cogsMethod, "unit_cost");
    assert.equal(p.cogs, 40 * 650);
    assert.equal(p.grossProfit, 95000 - 26000);
    assert.equal(p.marketplaceFees, 15000);
    assert.equal(p.advertising, 10000);
    assert.equal(p.samples, 2000);
    assert.equal(p.totalOpex, 27000);
    assert.equal(p.netProfit, 69000 - 27000);
    assert.equal(p.netMarginBps, 4421);
    assert.equal(p.tacosBps, 1000);
    assert.equal(p.roasX100, 1000);
    assert.equal(p.inventoryPurchased, 30000);
    assert.equal(p.totalSpend, 42000);
    assert.equal(p.netCashFlow, 500000 + 80000 - 42000);
    assert.equal(p.averageSellingPrice, 2500);
  });

  it("falls back to inventory cash as COGS without a unit cost", () => {
    const p = computePnL({ funding, requests, agents: [sourcing, marketing], economics: { ...ECON, unitCostCents: 0, inboundShippingCents: 0, otherPerUnitCents: 0 }, period: "this_month", now: NOW });
    assert.equal(p.cogsMethod, "cash_purchases");
    assert.equal(p.cogs, 30000);
  });

  it("includes everything for all time", () => {
    const p = computePnL({ funding, requests, agents: [sourcing, marketing], economics: ECON, period: "all", now: NOW });
    assert.equal(p.samples, 2999);
  });
});

describe("budget allocation", () => {
  it("splits exactly by weight with a reserve, using every cent", () => {
    const s = createAgent("sourcing", undefined, NOW);
    const m = createAgent("marketing", undefined, NOW);
    const o = createAgent("orchestrator", undefined, NOW);
    const plan = planAllocation({ agents: [s, m, o], settings: { auto: true, reserveBps: 1500, weights: {} }, availableCents: 100001, cashBalanceCents: 100001 });
    assert.equal(plan.reserveCents, 15000);
    assert.equal(plan.distributableCents, 85001);
    const add = (id: string) => plan.lines.find((l) => l.agentId === id)?.addCents;
    assert.equal(add(s.id), 58847);
    assert.equal(add(m.id), 26154);
    assert.equal(add(o.id), undefined); // the orchestrator cannot spend
    assert.equal(plan.lines.reduce((x, l) => x + l.addCents, 0), 85001);
  });

  it("honors weight overrides", () => {
    const s = createAgent("sourcing", undefined, NOW);
    const m = createAgent("marketing", undefined, NOW);
    const plan = planAllocation({ agents: [s, m], settings: { auto: true, reserveBps: 0, weights: { [s.id]: 1, [m.id]: 1 } }, availableCents: 1001, cashBalanceCents: 1001 });
    assert.deepEqual(plan.lines.map((l) => l.addCents).sort(), [500, 501]);
  });

  it("rebalances unspent money but never below what was spent, and leaves paused agents alone", () => {
    const s = createAgent("sourcing", undefined, NOW);
    const m = createAgent("marketing", undefined, NOW);
    const p = createAgent("research", undefined, NOW);
    p.status = "paused";
    const plan = planRebalance({
      agents: [s, m, p],
      settings: { auto: true, reserveBps: 0, weights: {} },
      cashBalanceCents: 10000,
      finance: [
        { agentId: s.id, budgetCents: 9000, spentCents: 8000, remainingCents: 1000 },
        { agentId: m.id, budgetCents: 0, spentCents: 0, remainingCents: 0 },
        { agentId: p.id, budgetCents: 3000, spentCents: 0, remainingCents: 3000 },
      ],
    });
    const line = (id: string) => plan.lines.find((l) => l.agentId === id)!;
    assert.equal(plan.distributableCents, 7000);
    assert.equal(line(p.id).newBudgetCents, 3000);
    assert.equal(line(s.id).newBudgetCents, 8000 + Math.round((7000 * 45) / 65));
    assert.equal(line(s.id).newBudgetCents - 8000 + line(m.id).newBudgetCents, 7000);
  });
});

describe("credentials and auto-fill", () => {
  it("resolves the AI key from the vault for the agent's provider, with manual override", () => {
    const state = defaultState();
    const a = createAgent("research", undefined, NOW);
    state.vault.anthropic = { value: "sk-ant-1", updatedAt: "" };
    state.vault.openai = { value: "sk-oa-1", updatedAt: "" };
    assert.equal(resolveInputs(state, a).values.llm_api_key, "sk-ant-1");
    assert.deepEqual(resolveInputs(state, a).sources.llm_api_key, { type: "vault", key: "anthropic" });
    a.connection.provider = "OpenAI";
    assert.equal(resolveInputs(state, a).values.llm_api_key, "sk-oa-1");
    a.inputs.llm_api_key = "manual";
    assert.deepEqual(resolveInputs(state, a).sources.llm_api_key, { type: "manual" });
  });

  it("fills empty details from the business plan and never overwrites typed values", () => {
    const state = defaultState();
    state.economics = { ...ECON };
    state.business.ownerEmail = "owner@example.com";
    state.business.salesChannels = "Amazon US";
    const st = createAgent("storefront", undefined, NOW);
    const sup = createAgent("support", undefined, NOW);
    st.inputs.brand_voice = "mine";
    autofillAgent(state, st);
    autofillAgent(state, sup);
    assert.equal(st.inputs.min_price, "16.16");
    assert.equal(st.inputs.marketplace, "Amazon US");
    assert.equal(st.inputs.brand_voice, "mine");
    assert.equal(sup.inputs.escalation_contact, "owner@example.com");
    assert.ok((sup.inputs.return_policy ?? "").length > 20);
  });
});

describe("discord routing", () => {
  function entry(p: Partial<ActivityEntry>): ActivityEntry {
    return { id: newId(), at: NOW.toISOString(), actor: "Sourcing", level: "info", message: "hi", kind: "log", agentId: "a1", ...p };
  }
  function state(): DashboardState {
    const s = defaultState();
    s.discord.enabled = true;
    s.discord.defaultWebhookUrl = HOOK;
    s.discord.agentWebhooks = { a1: HOOK2 };
    s.discord.approvalMention = "@here";
    return s;
  }

  it("sends approvals to HQ with the mention, and team news to the team channel", () => {
    const s = state();
    const pending = routeEntry(entry({ kind: "request_pending", level: "warning" }), s, "http://x");
    assert.equal(pending?.url, HOOK);
    assert.equal(pending?.payload.content, "@here");
    assert.deepEqual(pending?.payload.allowed_mentions?.parse, ["users", "roles", "everyone"]);
    const report = routeEntry(entry({ kind: "report", title: "Weekly" }), s, "http://x");
    assert.equal(report?.url, HOOK2);
    assert.deepEqual(report?.payload.allowed_mentions?.parse, []);
    const other = routeEntry(entry({ kind: "report", agentId: "a2" }), s, "http://x");
    assert.equal(other?.url, HOOK, "falls back to HQ");
  });

  it("filters by the owner's settings", () => {
    const s = state();
    assert.equal(routeEntry(entry({ kind: "log", level: "info" }), s, "x"), null, "info logs are skipped in 'important' mode");
    assert.ok(routeEntry(entry({ kind: "log", level: "warning" }), s, "x"));
    assert.equal(routeEntry(entry({ kind: "request_approved", amountCents: 0 }), s, "x"), null);
    assert.ok(routeEntry(entry({ kind: "request_approved", amountCents: 100 }), s, "x"));
    assert.equal(routeEntry(entry({ kind: "owner" }), s, "x"), null);
    s.discord.enabled = false;
    assert.equal(routeEntry(entry({ kind: "report" }), s, "x"), null);
  });

  it("retries once on a rate limit and reports bad webhooks clearly", async () => {
    const store = new Store(null);
    const calls: number[] = [];
    const sender = async () => {
      calls.push(1);
      return calls.length === 1 ? { status: 429, retryAfterMs: 1 } : { status: 204 };
    };
    const n = new DiscordNotifier(store, sender);
    assert.deepEqual(await n.enqueue(HOOK, {}), { ok: true });
    assert.equal(calls.length, 2);
    const bad = new DiscordNotifier(store, async () => ({ status: 404 }));
    const r = await bad.enqueue(HOOK, {});
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /deleted or wrong URL/);
  });
});

describe("revenue parsing", () => {
  it("derives the net payout from a breakdown and checks consistency", () => {
    assert.deepEqual(parseRevenue({ grossSalesCents: 1000, refundsCents: 100, feesCents: 150, unitsSold: 4 }), {
      amountCents: 750,
      grossSalesCents: 1000,
      refundsCents: 100,
      feesCents: 150,
      unitsSold: 4,
    });
    assert.throws(() => parseRevenue({ grossSalesCents: 1000, feesCents: 100, amountCents: 1 }), /must equal/);
    assert.throws(() => parseRevenue({ grossSalesCents: 100, feesCents: 200 }), /cannot exceed/);
    assert.throws(() => parseRevenue({ feesCents: 1, amountCents: 5 }), /need "grossSalesCents"/);
    assert.deepEqual(parseRevenue({ amountCents: 500 }), { amountCents: 500 });
  });
});

describe("setup API", () => {
  function make(research?: ResearchRunner) {
    const store = new Store(null);
    const sent: Array<{ url: string; body: DiscordPayload }> = [];
    const notifier = new DiscordNotifier(store, async (url, body) => {
      sent.push({ url, body });
      return { status: 204 };
    });
    notifier.attach();
    const app = createApp({ store, notifier, research });
    return { app, store, sent };
  }

  it("stores credentials without ever returning secret values", async () => {
    const { app } = make();
    await request(app).put("/api/vault/not_a_service").set(json).send({ value: "x" }).expect(400);
    const st = (await request(app).put("/api/vault/anthropic").set(json).send({ value: "sk-ant-supersecretvalue1234" }).expect(200)).body as StateResponse;
    const text = JSON.stringify(st);
    assert.ok(!text.includes("supersecret"));
    assert.equal(st.vault.find((v) => v.key === "anthropic")?.preview, "••••1234");
    await request(app).put("/api/vault/alibaba_account").set(json).send({ value: "me@example.com" }).expect(200);
  });

  it("adds the recommended team, fills details, and activates agents once ready", async () => {
    const { app, store } = make();
    await request(app).put("/api/business").set(json).send({ product: "Braided cables", salesChannels: "Amazon US", ownerEmail: "o@example.com", shippingAddress: "1 Main St" }).expect(200);
    await request(app).put("/api/economics").set(json).send({ salePriceCents: 2500, unitCostCents: 500, monthlyUnits: 300 }).expect(200);
    let st = (await request(app).post("/api/agents/recommended").set(json).send({}).expect(200)).body as StateResponse;
    assert.equal(st.agents.length, 8);
    await request(app).post("/api/agents/recommended").set(json).send({}).expect(200);
    assert.equal(store.get().agents.length, 8, "adding twice does not duplicate");
    const support = store.get().agents.find((a) => a.role === "support")!;
    assert.equal(support.inputs.escalation_contact, "o@example.com");
    // Paste the shared keys once; every agent picks them up.
    for (const k of ["anthropic", "alibaba_account", "amazon_sp_api", "amazon_ads_api", "quickbooks"]) {
      await request(app).put(`/api/vault/${k}`).set(json).send({ value: `value-for-${k}` }).expect(200);
    }
    st = (await request(app).get("/api/state")).body as StateResponse;
    const notReady = st.readiness.filter((r) => !r.ready);
    // Only Sourcing still needs a human answer: which certifications the product requires.
    assert.deepEqual(
      notReady.map((r) => st.agents.find((a) => a.id === r.agentId)!.role),
      ["sourcing"],
    );
    assert.deepEqual(notReady[0]!.missingInputs, ["Required certifications"]);
    st = (await request(app).post("/api/agents/activate-ready").set(json).send({}).expect(200)).body as StateResponse;
    assert.equal(st.agents.filter((a) => a.status === "active").length, 7);
    const orch = store.get().agents.find((a) => a.role === "orchestrator")!;
    const token = (await request(app).post(`/api/agents/${orch.id}/token`).set(json).send({})).body.token;
    const cfg = await request(app).get("/api/agent/v1/config").set("Authorization", `Bearer ${token}`).expect(200);
    assert.equal(cfg.body.inputs.llm_api_key, "value-for-anthropic");
  });

  it("auto-allocates deposits, keeps the reserve, and rebalances", async () => {
    const { app, store } = make();
    await request(app).post("/api/agents/recommended").set(json).send({ roles: ["sourcing", "marketing", "orchestrator"] }).expect(200);
    let st = (await request(app).post("/api/funding").set(json).send({ type: "deposit", amountCents: 100000 }).expect(200)).body as StateResponse;
    assert.equal(st.finance.unallocatedCents, 15000);
    const sourcing = store.get().agents.find((a) => a.role === "sourcing")!;
    assert.equal(sourcing.budgetCents, Math.round((85000 * 45) / 65));
    // A manual tweak survives the next deposit.
    await request(app).put(`/api/agents/${sourcing.id}/budget`).set(json).send({ budgetCents: 1000 }).expect(200);
    st = (await request(app).post("/api/allocation/rebalance").set(json).send({}).expect(200)).body as StateResponse;
    assert.equal(st.finance.unallocatedCents, 15000);
    await request(app).post("/api/allocation/rebalance").set(json).send({}).expect(400);
  });

  it("runs AI research in the background and fills the business from the chosen idea", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const fake: ResearchRunner = async (brief, key) => {
      assert.equal(key, "sk-ant-test");
      assert.equal(brief.budgetCents, 300000);
      await gate;
      return {
        summary: "Two good options.",
        ideas: [
          {
            title: "Right-angle cords",
            product: "Right-angle flat extension cords",
            niche: "Furniture-friendly power",
            targetAudience: "Apartment renters",
            whyNow: "Rising searches",
            salesChannels: "Amazon US",
            competition: "medium",
            salePriceCents: 2299,
            unitCostCents: 420,
            inboundShippingCents: 90,
            fulfillmentFeeCents: 410,
            marketplaceFeeBps: 1500,
            estimatedMonthlyUnits: 250,
            startupCostCents: 250000,
            compliance: ["UL 817"],
            risks: [],
            keywords: ["flat plug extension cord"],
            sources: [],
          },
        ],
      };
    };
    const { app, store } = make(fake);
    await request(app).post("/api/research").set(json).send({ budgetCents: 300000 }).expect(400); // no key yet
    await request(app).put("/api/vault/anthropic").set(json).send({ value: "sk-ant-test" }).expect(200);
    await request(app).post("/api/agents/recommended").set(json).send({ roles: ["research", "sourcing"] }).expect(200);
    const st = (await request(app).post("/api/research").set(json).send({ budgetCents: 300000, interests: "home office" }).expect(200)).body as StateResponse;
    assert.equal(st.research[0]?.status, "running");
    await request(app).post("/api/research").set(json).send({ budgetCents: 300000 }).expect(409);
    release();
    await new Promise((r) => setTimeout(r, 20));
    const job = store.get().research[0]!;
    assert.equal(job.status, "done");
    await request(app).post(`/api/research/${job.id}/choose`).set(json).send({ index: 0 }).expect(200);
    const s = store.get();
    assert.equal(s.business.product, "Right-angle flat extension cords");
    assert.equal(s.business.productSource, "research");
    assert.equal(s.economics.salePriceCents, 2299);
    assert.equal(s.economics.monthlyUnits, 250);
    const sourcing = s.agents.find((a) => a.role === "sourcing")!;
    assert.equal(sourcing.inputs.required_certifications, "UL 817");
    assert.equal(sourcing.inputs.target_unit_cost, "4.20");
    const research = s.agents.find((a) => a.role === "research")!;
    assert.equal(research.inputs.target_keywords, "flat plug extension cord");
  });

  it("validates Discord settings and routes agent reports to the team channel", async () => {
    const { app, store, sent } = make();
    await request(app).post("/api/agents/recommended").set(json).send({ roles: ["finance"] }).expect(200);
    await request(app).put("/api/discord").set(json).send({ enabled: true }).expect(400); // no HQ webhook yet
    await request(app).put("/api/discord").set(json).send({ defaultWebhookUrl: "https://example.com/hook" }).expect(400);
    const fin = store.get().agents[0]!;
    const st = (await request(app).put("/api/discord").set(json).send({ defaultWebhookUrl: HOOK, enabled: true, agentWebhooks: { [fin.id]: HOOK2 } }).expect(200)).body as StateResponse;
    assert.ok(!JSON.stringify(st).includes("abcdefghijklmnopqrstuvwxyz"), "webhook tokens are never returned");
    const token = (await request(app).post(`/api/agents/${fin.id}/token`).set(json).send({})).body.token;
    await request(app)
      .post("/api/agent/v1/report")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Weekly P&L", body: "Profitable week.", fields: [{ name: "Net", value: "$420.00" }] })
      .expect(201);
    await new Promise((r) => setTimeout(r, 10));
    const report = sent.find((x) => x.body.embeds?.[0]?.title === "Weekly P&L");
    assert.equal(report?.url, HOOK2);
    await request(app).post("/api/discord/test").set(json).send({ target: "hq" }).expect(200);
  });
});

describe("migration", () => {
  it("upgrades a version-1 data file without losing progress", () => {
    const old = {
      version: 1,
      business: { name: "Old Co", product: "Cables", description: "", targetMarket: "", salesChannels: "" },
      tasks: [
        { id: "t1", title: "Get a tax ID (EIN or local equivalent)", description: "", category: "legal", status: "done", notes: "EIN 12-3", custom: false, completedAt: "x" },
        { id: "t2", title: "Fund the project", description: "", category: "finance", status: "todo", notes: "", custom: false, completedAt: null },
        { id: "t3", title: "My own task", description: "", category: "custom", status: "todo", notes: "", custom: true, completedAt: null },
      ],
      agents: [],
      guardrails: { killSwitch: false, perTransactionLimitCents: null, dailySpendLimitCents: null, monthlySpendLimitCents: null, approvalThresholdCents: 10000 },
      funding: [],
      requests: [],
      activity: [],
    } as unknown as Partial<DashboardState> & Record<string, unknown>;
    const s = migrate(old);
    assert.equal(s.version, 2);
    assert.equal(s.business.name, "Old Co");
    assert.equal(s.business.ownerEmail, "");
    assert.ok(!s.tasks.some((t) => t.id === "t2"), "obsolete built-in task removed");
    assert.ok(s.tasks.some((t) => t.id === "t3"), "custom task kept");
    const ein = s.tasks.find((t) => t.templateKey === "ein");
    assert.equal(ein?.id, "t1", "matched by old title");
    assert.equal(ein?.status, "done");
    assert.equal(ein?.notes, "EIN 12-3");
    assert.ok((ein?.links.length ?? 0) > 0);
    assert.ok(s.tasks.some((t) => t.templateKey === "entity"), "new built-in tasks added");
    assert.equal(s.allocation.auto, true);
  });
});

describe("recommended caps", () => {
  it("leave room for the first inventory order", async () => {
    const store = new Store(null);
    const app = createApp({ store });
    await request(app).post("/api/funding").set(json).send({ type: "deposit", amountCents: 300000 }).expect(200);
    const st = (await request(app).post("/api/guardrails/recommended").set(json).send({}).expect(200)).body as StateResponse;
    assert.equal(st.guardrails.monthlySpendLimitCents, 225000);
    assert.equal(st.guardrails.dailySpendLimitCents, 105000);
  });
});

describe("start over and backups", () => {
  it("clears everything, keeps a restorable backup, and can keep credentials", async () => {
    const dir = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "agent-dash-reset-"));
    try {
      const store = new Store(dir);
      const app = createApp({ store });
      await request(app).put("/api/business").set(json).send({ name: "Test Co", product: "Test cables" }).expect(200);
      await request(app).put("/api/vault/anthropic").set(json).send({ value: "sk-ant-keepme1234" }).expect(200);
      await request(app).post("/api/agents/recommended").set(json).send({}).expect(200);
      await request(app).post("/api/funding").set(json).send({ type: "deposit", amountCents: 50000 }).expect(200);
      const oldToken = store.get().agents[0]!.apiToken;

      await request(app).post("/api/reset").set(json).send({}).expect(400);
      await request(app).post("/api/reset").set(json).send({ confirm: "start over" }).expect(400);
      let st = (await request(app).post("/api/reset").set(json).send({ confirm: "START OVER", keepCredentials: true }).expect(200)).body as StateResponse;
      assert.equal(st.business.name, "");
      assert.equal(st.agents.length, 0);
      assert.equal(st.funding.length, 0);
      assert.equal(st.finance.cashBalanceCents, 0);
      assert.equal(st.activity.length, 1);
      assert.ok(st.vault.some((v) => v.key === "anthropic" && v.set), "credentials kept when asked");
      await request(app).get("/api/agent/v1/config").set("Authorization", `Bearer ${oldToken}`).expect(401);

      // Survives a restart (written to disk).
      assert.equal(new Store(dir).get().business.name, "");

      const backups = (await request(app).get("/api/backups").expect(200)).body.backups as Array<{ name: string; businessName: string; agents: number }>;
      assert.equal(backups.length, 1);
      assert.equal(backups[0]!.businessName, "Test Co");
      assert.equal(backups[0]!.agents, 8);

      st = (await request(app).post("/api/reset").set(json).send({ confirm: "START OVER" }).expect(200)).body as StateResponse;
      assert.equal(st.vault.length, 0, "credentials cleared by default");

      st = (await request(app).post(`/api/backups/${backups[0]!.name}/restore`).set(json).send({}).expect(200)).body as StateResponse;
      assert.equal(st.business.name, "Test Co");
      assert.equal(st.agents.length, 8);
      assert.equal(st.finance.depositedCents, 50000);
      await request(app).post("/api/backups/..%2Fdb.json/restore").set(json).send({}).expect(404);
      assert.equal((await request(app).get("/api/backups")).body.backups.length, 3, "a safety backup is taken before each reset and restore");
    } finally {
      (await import("node:fs")).rmSync(dir, { recursive: true, force: true });
    }
  });

  it("restoring does not re-post old history to Discord", async () => {
    const store = new Store(null);
    const sent: unknown[] = [];
    const notifier = new DiscordNotifier(store, async (_u, b) => {
      sent.push(b);
      return { status: 204 };
    });
    notifier.attach();
    const app = createApp({ store, notifier });
    await request(app).put("/api/discord").set(json).send({ defaultWebhookUrl: HOOK, enabled: true }).expect(200);
    await request(app).put("/api/guardrails").set(json).send({ killSwitch: true }).expect(200);
    await new Promise((r) => setTimeout(r, 10));
    const before = sent.length;
    assert.ok(before >= 1);
    await request(app).post("/api/reset").set(json).send({ confirm: "START OVER" }).expect(200);
    const name = store.listBackups()[0]!.name;
    await request(app).post(`/api/backups/${name}/restore`).set(json).send({}).expect(200);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(sent.length, before);
  });
});

describe("money setup checklist", () => {
  it("tags every money step and ticks the ones the dashboard can verify", async () => {
    const store = new Store(null);
    const app = createApp({ store });
    const money = store.get().tasks.filter((t) => t.category === "money");
    assert.ok(money.length >= 8);
    assert.ok(money.every((t) => t.money !== null), "every money step says what it touches");
    assert.equal(money.find((t) => t.templateKey === "money_record")?.money, "records");
    assert.equal(money.find((t) => t.templateKey === "plaid_keys")?.money, "reads");
    assert.equal(money.find((t) => t.templateKey === "stripe_apply")?.money, "moves");
    assert.ok(money.find((t) => t.templateKey === "ads_card")?.waitsFor, "steps blocked on unbuilt features say so");

    const status = (k: string) => store.get().tasks.find((t) => t.templateKey === k)?.status;
    assert.equal(status("money_record"), "todo");
    await request(app).post("/api/funding").set(json).send({ type: "deposit", amountCents: 1000 }).expect(200);
    assert.equal(status("money_record"), "done");
    await request(app).put("/api/vault/stripe").set(json).send({ value: "rk_test_abc123456789" }).expect(200);
    assert.equal(status("stripe_key"), "done");
    await request(app).put("/api/vault/plaid").set(json).send({ value: "client\nsecret" }).expect(200);
    assert.equal(status("plaid_keys"), "done");
    assert.equal(status("stripe_apply"), "todo", "steps the dashboard can't verify stay manual");
  });

  it("upgrades an older checklist: drops the old card task, adds money steps", () => {
    const s = migrate({
      tasks: [
        { id: "x", title: "Set up a capped card for agent spending", description: "", category: "finance", status: "todo", notes: "", custom: false, completedAt: null, steps: [], links: [], time: "", templateKey: "spend_card" },
        { id: "b", title: "Open a business bank account", description: "", category: "finance", status: "done", notes: "", custom: false, completedAt: "x", steps: [], links: [], time: "", templateKey: "bank" },
      ],
    } as unknown as Partial<DashboardState> & Record<string, unknown>);
    assert.ok(!s.tasks.some((t) => t.id === "x"));
    const bank = s.tasks.find((t) => t.id === "b")!;
    assert.equal(bank.status, "done");
    assert.equal(bank.money, "moves");
    assert.ok(s.tasks.some((t) => t.templateKey === "stripe_apply"));
    const withDeposit = migrate({
      funding: [{ id: "f", type: "deposit", amountCents: 100, note: "", agentId: null, createdAt: "2026-11-01T00:00:00.000Z" }],
      tasks: [],
    } as unknown as Partial<DashboardState> & Record<string, unknown>);
    assert.equal(withDeposit.tasks.find((t) => t.templateKey === "money_record")?.status, "done", "already-satisfied steps tick on upgrade");
  });
});

describe("sales channels", () => {
  it("includes per-order fees in profit and break-even price", () => {
    const u = unitBreakdown({ ...ECON, perOrderFeeCents: 30 });
    assert.equal(u.perOrderFees, 30);
    assert.equal(u.contribution, 575 - 30);
    assert.equal(u.breakEvenPrice, 1662);
    assert.ok(unitBreakdown({ ...ECON, perOrderFeeCents: 30, salePriceCents: 1662 }).contribution >= 0);
    assert.ok(unitBreakdown({ ...ECON, perOrderFeeCents: 30, salePriceCents: 1660 }).contribution < 0);
  });

  it("adds and removes the account steps as channels change", async () => {
    const store = new Store(null);
    const app = createApp({ store });
    await request(app).put("/api/channels").set(json).send({ channels: ["nope"] }).expect(400);
    await request(app).put("/api/channels").set(json).send({ channels: ["shopify", "shopify"] }).expect(400);
    let st = (await request(app).put("/api/channels").set(json).send({ channels: ["shopify", "etsy"] }).expect(200)).body as StateResponse;
    assert.equal(st.business.salesChannels, "Shopify, Etsy");
    const keys = () => store.get().tasks.map((t) => t.templateKey).filter((k) => k?.startsWith("channel:"));
    assert.deepEqual(keys(), ["channel:shopify", "channel:etsy"]);
    const etsy = store.get().tasks.find((t) => t.templateKey === "channel:etsy")!;
    assert.match(etsy.description, /make or design/);
    assert.equal(etsy.money, "moves");
    // Mark Shopify done, then drop both: the finished step is kept, the untouched one removed.
    const shop = store.get().tasks.find((t) => t.templateKey === "channel:shopify")!;
    await request(app).patch(`/api/tasks/${shop.id}`).set(json).send({ status: "done" }).expect(200);
    st = (await request(app).put("/api/channels").set(json).send({ channels: ["ebay"] }).expect(200)).body as StateResponse;
    assert.deepEqual(keys(), ["channel:shopify", "channel:ebay"]);
    assert.ok(!store.get().tasks.some((t) => t.templateKey === "seller_accounts"), "the old generic seller-account step is gone");
  });

  it("uses the selected channel's credentials and suggestions", async () => {
    const store = new Store(null);
    const app = createApp({ store });
    await request(app).post("/api/agents/recommended").set(json).send({ roles: ["storefront", "marketing", "inventory"] }).expect(200);
    await request(app).put("/api/channels").set(json).send({ channels: ["amazon"] }).expect(200);
    const agent = (role: string) => store.get().agents.find((a) => a.role === role)!;
    assert.equal(agent("marketing").inputs.ads_platform, "Amazon Ads (Sponsored Products)");
    assert.equal(agent("inventory").inputs.fulfillment_provider, "Amazon FBA");
    // The owner types their own fulfillment choice; switching channels must not overwrite it.
    await request(app).patch(`/api/agents/${agent("inventory").id}`).set(json).send({ inputs: { fulfillment_provider: "My garage" } }).expect(200);
    let st = (await request(app).put("/api/channels").set(json).send({ channels: ["shopify"] }).expect(200)).body as StateResponse;
    assert.equal(agent("marketing").inputs.ads_platform, "Meta Ads (Facebook & Instagram)");
    assert.equal(agent("storefront").inputs.marketplace, "Shopify");
    assert.equal(agent("inventory").inputs.fulfillment_provider, "My garage");
    const r = st.readiness.find((x) => x.agentId === agent("storefront").id)!;
    assert.ok(r.missingVaultKeys.includes("shopify_admin"));
    assert.ok(!r.missingVaultKeys.includes("amazon_sp_api"));
    // With both saved, the Shopify credential is the one used.
    await request(app).put("/api/vault/amazon_sp_api").set(json).send({ value: "amazon-creds" }).expect(200);
    await request(app).put("/api/vault/shopify_admin").set(json).send({ value: "shop.myshopify.com\nshpat_x" }).expect(200);
    st = (await request(app).get("/api/state")).body as StateResponse;
    const view = st.agents.find((a) => a.role === "storefront")!;
    assert.deepEqual(view.inputSources.marketplace_api_key, { type: "vault", key: "shopify_admin" });
  });

  it("never uses credentials for a channel you don't sell on", async () => {
    const store = new Store(null);
    const app = createApp({ store });
    await request(app).post("/api/agents/recommended").set(json).send({ roles: ["storefront", "marketing"] }).expect(200);
    await request(app).put("/api/vault/amazon_sp_api").set(json).send({ value: "amazon-creds" }).expect(200);
    await request(app).put("/api/vault/amazon_ads_api").set(json).send({ value: "amazon-ads" }).expect(200);
    let st = (await request(app).put("/api/channels").set(json).send({ channels: ["shopify"] }).expect(200)).body as StateResponse;
    const sf = () => st.agents.find((a) => a.role === "storefront")!;
    const mk = () => st.agents.find((a) => a.role === "marketing")!;
    assert.deepEqual(sf().inputSources.marketplace_api_key, { type: "none" }, "the Amazon key is not used for a Shopify store");
    assert.deepEqual(mk().inputSources.ads_api_key, { type: "none" }, "Amazon Ads is not used when not selling on Amazon");
    const missing = new Set(st.readiness.flatMap((r) => r.missingVaultKeys));
    assert.ok(missing.has("shopify_admin") && missing.has("meta_ads"));
    st = (await request(app).put("/api/channels").set(json).send({ channels: ["shopify", "amazon"] }).expect(200)).body as StateResponse;
    assert.deepEqual(sf().inputSources.marketplace_api_key, { type: "vault", key: "amazon_sp_api" }, "used again once Amazon is selected");
    // With nothing selected, any saved key may be used (older behaviour).
    st = (await request(app).put("/api/channels").set(json).send({ channels: [] }).expect(200)).body as StateResponse;
    assert.deepEqual(sf().inputSources.marketplace_api_key, { type: "vault", key: "amazon_sp_api" });
  });

  it("applies a channel's typical fees on request only", async () => {
    const store = new Store(null);
    const app = createApp({ store });
    const st = (await request(app).post("/api/channels/shopify/apply-fees").set(json).send({}).expect(200)).body as StateResponse;
    assert.equal(st.economics.marketplaceFeeBps, 0);
    assert.equal(st.economics.paymentFeeBps, 290);
    assert.equal(st.economics.perOrderFeeCents, 30);
    await request(app).post("/api/channels/tiktok/apply-fees").set(json).send({}).expect(400);
    await request(app).post("/api/channels/nope/apply-fees").set(json).send({}).expect(404);
  });

  it("recognises channels typed in older versions", () => {
    const s = migrate({ business: { salesChannels: "Amazon US, own Shopify store" }, tasks: [] } as unknown as Partial<DashboardState> & Record<string, unknown>);
    assert.deepEqual(s.business.channels, ["amazon", "shopify"]);
    assert.ok(s.tasks.some((t) => t.templateKey === "channel:amazon"));
    assert.ok(s.tasks.some((t) => t.templateKey === "channel:shopify"));
  });
});

describe("security safeguards", () => {
  async function activeStorefront() {
    const store = new Store(null);
    const app = createApp({ store });
    await request(app).put("/api/vault/anthropic").set(json).send({ value: "sk-ant-x" }).expect(200);
    await request(app).put("/api/vault/shopify_admin").set(json).send({ value: "s.myshopify.com\nshpat_x" }).expect(200);
    await request(app).put("/api/channels").set(json).send({ channels: ["shopify"] }).expect(200);
    await request(app).put("/api/economics").set(json).send({ salePriceCents: 2500, unitCostCents: 500, monthlyUnits: 100 }).expect(200);
    await request(app).post("/api/agents/recommended").set(json).send({ roles: ["storefront"] }).expect(200);
    const agent = store.get().agents[0]!;
    await request(app).patch(`/api/agents/${agent.id}`).set(json).send({ inputs: { min_price: "20.00" }, status: "active" }).expect(200);
    const token = (await request(app).post(`/api/agents/${agent.id}/token`).set(json).send({})).body.token as string;
    return { app, store, agent, auth: { Authorization: `Bearer ${token}` } };
  }

  it("enforces the price floor on price changes and listings", async () => {
    const { app, auth } = await activeStorefront();
    const ask = (body: object) => request(app).post("/api/agent/v1/actions").set(auth).send(body).expect(201);
    let r = (await ask({ action: "update_price" })).body.request;
    assert.equal(r.status, "denied");
    assert.match(r.reasons.join(" "), /priceCents/);
    r = (await ask({ action: "update_price", priceCents: 1999 })).body.request;
    assert.equal(r.status, "denied");
    assert.match(r.reasons.join(" "), /below the price floor of \$20\.00/);
    r = (await ask({ action: "update_price", priceCents: 2000 })).body.request;
    assert.equal(r.status, "pending_approval", "price changes need approval by default");
    assert.equal(r.priceCents, 2000);
    r = (await ask({ action: "publish_listing", priceCents: 1500 })).body.request;
    assert.equal(r.status, "denied");
  });

  it("estimates AI cost, records it, and stops agents at the monthly cap", async () => {
    const { app, store, auth } = await activeStorefront();
    await request(app).put("/api/guardrails").set(json).send({ aiMonthlyLimitCents: 500 }).expect(200);
    await request(app).post("/api/agent/v1/usage").set(auth).send({ model: "gpt-unknown", inputTokens: 5 }).expect(400);
    let u = (await request(app).post("/api/agent/v1/usage").set(auth).send({ model: "claude-opus-5-5", inputTokens: 500_000, outputTokens: 50_000 }).expect(201)).body;
    assert.equal(u.costCents, 300, "500k in × $4/M + 50k out × $20/M = $3.00");
    assert.equal(u.overLimit, false);
    u = (await request(app).post("/api/agent/v1/usage").set(auth).send({ model: "other-model", costCents: 250 }).expect(201)).body;
    assert.equal(u.monthCostCents, 550);
    assert.equal(u.overLimit, true);
    const r = (await request(app).post("/api/agent/v1/actions").set(auth).send({ action: "draft_listing" }).expect(201)).body.request;
    assert.equal(r.status, "denied");
    assert.match(r.reasons.join(" "), /AI usage budget/);
    assert.equal(store.get().activity.filter((a) => a.message.startsWith("AI usage budget reached")).length, 1, "warned once");
    const st = (await request(app).get("/api/state")).body as StateResponse;
    assert.equal(st.finance.aiThisMonthCents, 550);
    assert.equal(st.aiUsageDaily.reduce((s, d) => s + d.costCents, 0), 550);
    const cfg = (await request(app).get("/api/agent/v1/config").set(auth)).body;
    assert.equal(cfg.guardrails.ai.overLimit, true);
    assert.equal(cfg.guardrails.priceFloorCents, 2000);
  });

  it("puts AI usage in the P&L", () => {
    const p = computePnL({ funding: [], requests: [], agents: [], economics: ECON, period: "all", now: NOW, aiUsage: [{ at: NOW.toISOString(), costCents: 1234 }] });
    assert.equal(p.aiUsage, 1234);
    assert.equal(p.totalOpex, 1234 + p.fixedOverhead);
  });

  it("requires a password once one is set, without affecting agents", async () => {
    const { app, auth } = await activeStorefront();
    await request(app).put("/api/security/password").set(json).send({ newPassword: "short" }).expect(400);
    const browser = request.agent(app);
    await browser.put("/api/security/password").set(json).send({ newPassword: "correct horse battery" }).expect(200);
    // This browser stays signed in; a different one is locked out.
    await browser.get("/api/state").expect(200);
    const locked = await request(app).get("/api/state").expect(401);
    assert.equal(locked.body.loginRequired, true);
    assert.equal((await request(app).get("/api/session")).body.passwordSet, true);
    // Agents keep working with their own tokens.
    await request(app).get("/api/agent/v1/config").set(auth).expect(200);

    const other = request.agent(app);
    await other.post("/api/login").set(json).send({ password: "wrong" }).expect(401);
    await other.post("/api/login").set(json).send({ password: "correct horse battery" }).expect(200);
    await other.get("/api/state").expect(200);
    await other.post("/api/logout").set(json).send({}).expect(200);
    await other.get("/api/state").expect(401);

    // Changing it requires the current password and signs out other browsers.
    await browser.put("/api/security/password").set(json).send({ currentPassword: "nope", newPassword: "another long one" }).expect(401);
    await browser.put("/api/security/password").set(json).send({ currentPassword: "correct horse battery", newPassword: "another long one" }).expect(200);
    await browser.get("/api/state").expect(200);

    // Starting over keeps the password.
    const st = (await browser.post("/api/reset").set(json).send({ confirm: "START OVER" }).expect(200)).body as StateResponse;
    assert.equal(st.security.passwordSet, true);
    // Remove it.
    await browser.put("/api/security/password").set(json).send({ currentPassword: "another long one", newPassword: "" }).expect(200);
    await request(app).get("/api/state").expect(200);
  });

  it("locks out password guessing", async () => {
    const store = new Store(null);
    const app = createApp({ store });
    const b = request.agent(app);
    await b.put("/api/security/password").set(json).send({ newPassword: "a very good password" }).expect(200);
    const guesser = request.agent(app);
    for (let i = 0; i < 5; i++) await guesser.post("/api/login").set(json).send({ password: `guess${i}` }).expect(401);
    await guesser.post("/api/login").set(json).send({ password: "a very good password" }).expect(429);
  });

  it("never stores or returns the password itself", async () => {
    const store = new Store(null);
    const app = createApp({ store });
    const b = request.agent(app);
    const st = await b.put("/api/security/password").set(json).send({ newPassword: "super secret phrase" }).expect(200);
    assert.ok(!JSON.stringify(st.body).includes("super secret phrase"));
    assert.ok(!JSON.stringify(store.get()).includes("super secret phrase"));
    assert.ok(!JSON.stringify(st.body).includes(store.get().security.passwordHash!), "the hash isn't sent either");
  });
});
