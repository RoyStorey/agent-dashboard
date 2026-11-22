import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import request from "supertest";
import type { StateResponse } from "../shared/types.ts";
import { createApp } from "./app.ts";
import { Store } from "./store.ts";

function makeApp(dataDir: string | null = null) {
  const store = new Store(dataDir);
  const app = createApp({ store });
  return { app, store };
}

const json = { "Content-Type": "application/json" };

async function setupActiveSourcingAgent() {
  const { app, store } = makeApp();
  const created = await request(app).post("/api/agents").set(json).send({ role: "sourcing" }).expect(201);
  const id = created.body.createdAgentId as string;
  const agent = (created.body as StateResponse).agents.find((a) => a.id === id)!;
  const inputs: Record<string, string> = {};
  for (const f of agent.inputFields) inputs[f.key] = f.kind === "number" ? "3" : "value";
  await request(app).patch(`/api/agents/${id}`).set(json).send({ inputs, status: "active" }).expect(200);
  await request(app).post("/api/funding").set(json).send({ type: "deposit", amountCents: 100_000 }).expect(200);
  await request(app).put(`/api/agents/${id}/budget`).set(json).send({ budgetCents: 50_000 }).expect(200);
  await request(app).put("/api/guardrails").set(json).send({ approvalThresholdCents: null }).expect(200);
  const token = (await request(app).post(`/api/agents/${id}/token`).set(json).send({}).expect(200)).body.token as string;
  return { app, store, id, token };
}

describe("owner API security", () => {
  it("rejects foreign Host headers (DNS rebinding)", async () => {
    const { app } = makeApp();
    await request(app).get("/api/state").set("Host", "evil.example").expect(403);
    await request(app).get("/api/state").expect(200);
  });

  it("rejects cross-origin and non-JSON mutations", async () => {
    const { app } = makeApp();
    await request(app).put("/api/guardrails").set(json).set("Origin", "https://evil.example").send({ killSwitch: true }).expect(403);
    await request(app).put("/api/guardrails").set("Content-Type", "text/plain").send("{}").expect(415);
  });

  it("never returns secret values or the full token in state", async () => {
    const { app, id, token } = await setupActiveSourcingAgent();
    const state = (await request(app).get("/api/state").expect(200)).body as StateResponse;
    const text = JSON.stringify(state);
    assert.ok(!text.includes(token));
    const agent = state.agents.find((a) => a.id === id)!;
    assert.equal(agent.inputs["llm_api_key"], "");
    assert.equal(agent.secretsSet["llm_api_key"], true);
  });
});

describe("agent lifecycle", () => {
  it("refuses activation while required inputs are missing", async () => {
    const { app } = makeApp();
    const created = await request(app).post("/api/agents").set(json).send({ role: "research" }).expect(201);
    const res = await request(app).patch(`/api/agents/${created.body.createdAgentId}`).set(json).send({ status: "active" }).expect(400);
    assert.match(res.body.error, /missing/);
  });

  it("requires a valid agent token", async () => {
    const { app } = makeApp();
    await request(app).get("/api/agent/v1/config").expect(401);
    await request(app).get("/api/agent/v1/config").set("Authorization", "Bearer nope").expect(401);
  });

  it("serves full config (with secrets) to the agent itself", async () => {
    const { app, token } = await setupActiveSourcingAgent();
    const res = await request(app).get("/api/agent/v1/config").set("Authorization", `Bearer ${token}`).expect(200);
    assert.equal(res.body.inputs.llm_api_key, "value");
    assert.equal(res.body.budget.remainingCents, 50_000);
  });

  it("approves, completes with a lower actual amount, and refunds the difference", async () => {
    const { app, token } = await setupActiveSourcingAgent();
    const auth = { Authorization: `Bearer ${token}` };
    const r = await request(app).post("/api/agent/v1/actions").set(auth).send({ action: "order_samples", amountCents: 10_000 }).expect(201);
    assert.equal(r.body.request.status, "approved");
    await request(app).post(`/api/agent/v1/actions/${r.body.request.id}/complete`).set(auth).send({ actualAmountCents: 20_000 }).expect(409);
    await request(app).post(`/api/agent/v1/actions/${r.body.request.id}/complete`).set(auth).send({ actualAmountCents: 7_500 }).expect(200);
    const state = (await request(app).get("/api/state")).body as StateResponse;
    assert.equal(state.finance.spentCents, 7_500);
    assert.equal(state.finance.cashBalanceCents, 92_500);
    assert.equal(state.finance.agents[0]?.remainingCents, 42_500);
  });

  it("holds purchase orders for approval and re-checks limits on approve", async () => {
    const { app, id, token } = await setupActiveSourcingAgent();
    const auth = { Authorization: `Bearer ${token}` };
    const r = await request(app).post("/api/agent/v1/actions").set(auth).send({ action: "place_purchase_order", amountCents: 40_000 }).expect(201);
    assert.equal(r.body.request.status, "pending_approval");
    let state = (await request(app).get("/api/state")).body as StateResponse;
    assert.ok(state.ownerActions.some((a) => a.id === "pending-approvals"));

    // Owner lowers the budget below the request; approval must now fail.
    await request(app).put(`/api/agents/${id}/budget`).set(json).send({ budgetCents: 30_000 }).expect(200);
    await request(app).post(`/api/requests/${r.body.request.id}/approve`).set(json).send({}).expect(409);

    await request(app).put(`/api/agents/${id}/budget`).set(json).send({ budgetCents: 50_000 }).expect(200);
    await request(app).post(`/api/requests/${r.body.request.id}/approve`).set(json).send({}).expect(200);
    const polled = await request(app).get(`/api/agent/v1/actions/${r.body.request.id}`).set(auth).expect(200);
    assert.equal(polled.body.request.status, "approved");
    state = (await request(app).get("/api/state")).body as StateResponse;
    assert.equal(state.finance.agents[0]?.remainingCents, 10_000);
  });

  it("kill switch denies new requests", async () => {
    const { app, token } = await setupActiveSourcingAgent();
    await request(app).put("/api/guardrails").set(json).send({ killSwitch: true }).expect(200);
    const r = await request(app).post("/api/agent/v1/actions").set("Authorization", `Bearer ${token}`).send({ action: "request_quote" }).expect(201);
    assert.equal(r.body.request.status, "denied");
  });

  it("rotating a token invalidates the old one", async () => {
    const { app, id, token } = await setupActiveSourcingAgent();
    const rotated = await request(app).post(`/api/agents/${id}/token/rotate`).set(json).send({}).expect(200);
    await request(app).get("/api/agent/v1/config").set("Authorization", `Bearer ${token}`).expect(401);
    await request(app).get("/api/agent/v1/config").set("Authorization", `Bearer ${rotated.body.token}`).expect(200);
  });

  it("blocks deleting an agent with open requests", async () => {
    const { app, id, token } = await setupActiveSourcingAgent();
    await request(app).post("/api/agent/v1/actions").set("Authorization", `Bearer ${token}`).send({ action: "order_samples", amountCents: 100 }).expect(201);
    await request(app).delete(`/api/agents/${id}`).set(json).send({}).expect(409);
  });
});

describe("funding", () => {
  it("cannot allocate or withdraw more than is unallocated", async () => {
    const { app, id } = await setupActiveSourcingAgent();
    // 100,000 deposited, 50,000 allocated.
    await request(app).put(`/api/agents/${id}/budget`).set(json).send({ budgetCents: 150_001 }).expect(400);
    await request(app).post("/api/funding").set(json).send({ type: "withdrawal", amountCents: 50_001 }).expect(400);
    await request(app).post("/api/funding").set(json).send({ type: "withdrawal", amountCents: 50_000 }).expect(200);
    const state = (await request(app).get("/api/state")).body as StateResponse;
    assert.equal(state.finance.unallocatedCents, 0);
  });

  it("rejects fractional or negative amounts", async () => {
    const { app } = makeApp();
    await request(app).post("/api/funding").set(json).send({ type: "deposit", amountCents: 10.5 }).expect(400);
    await request(app).post("/api/funding").set(json).send({ type: "deposit", amountCents: -1 }).expect(400);
    await request(app).post("/api/funding").set(json).send({ type: "deposit", amountCents: 0 }).expect(400);
  });

  it("lets a finance agent report revenue", async () => {
    const { app } = makeApp();
    const created = await request(app).post("/api/agents").set(json).send({ role: "finance" }).expect(201);
    const id = created.body.createdAgentId as string;
    await request(app)
      .patch(`/api/agents/${id}`)
      .set(json)
      .send({ inputs: { llm_api_key: "k", bookkeeping_api_key: "k" }, status: "active" })
      .expect(200);
    const token = (await request(app).post(`/api/agents/${id}/token`).set(json).send({})).body.token;
    await request(app).post("/api/agent/v1/revenue").set("Authorization", `Bearer ${token}`).send({ amountCents: 4_999, note: "3 orders" }).expect(201);
    const state = (await request(app).get("/api/state")).body as StateResponse;
    assert.equal(state.finance.revenueCents, 4_999);
    assert.equal(state.finance.profitCents, 4_999);
  });
});

describe("persistence", () => {
  it("survives a restart", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-dashboard-"));
    try {
      const first = makeApp(dir);
      await request(first.app).post("/api/funding").set(json).send({ type: "deposit", amountCents: 12_345 }).expect(200);
      const second = makeApp(dir);
      const state = (await request(second.app).get("/api/state")).body as StateResponse;
      assert.equal(state.finance.depositedCents, 12_345);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
