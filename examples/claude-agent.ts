/**
 * Example: one Claude-powered agent governed by the dashboard.
 *
 * The model never touches money directly. It can only *ask* the dashboard for
 * permission; this script's code (not the prompt) refuses to perform any action
 * the dashboard has not approved, and reports the real amount back afterwards.
 *
 * Run:
 *   ANTHROPIC_API_KEY=... AGENT_TOKEN=agt_... npm run agent:example -- "Find 3 suppliers and order samples"
 *
 * Env:
 *   AGENT_TOKEN     (required) the agent's token from the dashboard's Connect tab
 *   DASHBOARD_URL   default http://127.0.0.1:4317
 *   DRY_RUN         default "true": approved actions are cancelled instead of performed,
 *                   so no spend is recorded. Set DRY_RUN=false once real integrations exist.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { DashboardClient, DashboardError, type ActionRequest, type AgentConfig } from "./dashboard-client.ts";

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? "http://127.0.0.1:4317";
const TOKEN = process.env.AGENT_TOKEN;
const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const MODEL = "claude-opus-5-5";
const MAX_APPROVAL_WAIT_SECONDS = 300;

if (!TOKEN) {
  console.error("Set AGENT_TOKEN to the token shown on the agent's Connect tab in the dashboard.");
  process.exit(1);
}

const dashboard = new DashboardClient(DASHBOARD_URL, TOKEN);
const client = new Anthropic();

/**
 * Plug real integrations in here: one function per action key. Each receives
 * the approved request plus the agent's inputs (including secrets, which
 * never go to the model) and returns what it actually spent, in cents.
 */
type Integration = (req: ActionRequest, inputs: Record<string, string>) => Promise<{ spentCents: number; note: string }>;
const integrations: Record<string, Integration> = {
  // order_samples: async (req, inputs) => {
  //   const order = await mySupplierApi.order({ apiKey: inputs.supplier_platform_key, ... });
  //   return { spentCents: order.totalCents, note: `Order ${order.id}` };
  // },
};

const dollars = (cents: number | null | undefined) => (cents == null ? "no limit" : `$${(cents / 100).toFixed(2)}`);

function systemPrompt(cfg: AgentConfig): string {
  const secretKeys = new Set(cfg.inputFields.filter((f) => f.kind === "secret").map((f) => f.key));
  const settings = cfg.inputFields
    .filter((f) => !secretKeys.has(f.key) && (cfg.inputs[f.key] ?? "").trim() !== "")
    .map((f) => `- ${f.label}: ${cfg.inputs[f.key]}`)
    .join("\n");
  const actions = cfg.actions
    .filter((a) => a.allowed)
    .map((a) => `- ${a.key}: ${a.label}${a.spends ? " (may spend money)" : ""}${a.alwaysRequiresApproval ? " (always needs owner approval)" : ""}`)
    .join("\n");
  const b = cfg.business;
  return `You are "${cfg.agent.name}", one agent on a small team of AI agents running a business for its owner.

Business: ${b.name || "(unnamed)"}
Product: ${b.product || "(not set)"}
${b.description ? `Description: ${b.description}\n` : ""}${b.targetMarket ? `Target customers: ${b.targetMarket}\n` : ""}${b.salesChannels ? `Sales channels: ${b.salesChannels}\n` : ""}
Your job: ${cfg.agent.description}
Responsibilities:
${cfg.agent.responsibilities.map((r) => `- ${r}`).join("\n")}

Owner-provided settings:
${settings || "- (none)"}

Actions you may request:
${actions || "- (none)"}

Money: your remaining budget is ${dollars(cfg.budget?.remainingCents)}; per transaction ${dollars(cfg.guardrails.agent.perTransactionLimitCents)}; per day ${dollars(cfg.guardrails.agent.dailySpendLimitCents)}.

How you work:
- Every real-world action goes through request_action first. Amounts are integer cents (2500 = $25.00); use 0 for actions that cost nothing.
- If a request is pending_approval, call wait_for_approval; if it stays pending, move on and say so in your summary.
- Only call perform_action on approved requests. If you decide not to go ahead, call cancel_request so the reserved money returns to your budget.
- A denied or rejected request is final. Read the reasons; do not retry the same thing to get around a limit.
- Use log_progress for notable steps so the owner can follow along.
- Finish with a short summary of what you did, what is waiting on the owner, and what you recommend next.`;
}

function describe(req: ActionRequest): string {
  return JSON.stringify({
    request_id: req.id,
    action: req.action,
    amount: dollars(req.amountCents),
    status: req.status,
    reasons: req.reasons,
    result_note: req.resultNote || undefined,
  });
}

function makeTools(cfg: AgentConfig) {
  const allowed = cfg.actions.filter((a) => a.allowed).map((a) => a.key);

  return [
    betaTool({
      name: "request_action",
      description:
        "Ask the dashboard for permission to take an action. Returns approved, pending_approval or denied with reasons. Required before any real-world action.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: allowed.length > 0 ? allowed : ["none"], description: "The action key." },
          amount_cents: { type: "integer", minimum: 0, description: "Cost in integer cents; 0 if it costs nothing." },
          description: { type: "string", description: "What exactly you will do and why. The owner reads this when approving." },
        },
        required: ["action", "amount_cents", "description"],
        additionalProperties: false,
      },
      run: async ({ action, amount_cents, description }) => describe(await dashboard.requestAction(action, amount_cents, description)),
    }),

    betaTool({
      name: "wait_for_approval",
      description: `Wait (up to ${MAX_APPROVAL_WAIT_SECONDS}s) for the owner to approve or reject a pending request.`,
      inputSchema: {
        type: "object",
        properties: {
          request_id: { type: "string" },
          max_seconds: { type: "integer", minimum: 1, maximum: MAX_APPROVAL_WAIT_SECONDS },
        },
        required: ["request_id"],
        additionalProperties: false,
      },
      run: async ({ request_id, max_seconds }) => {
        const deadline = Date.now() + Math.min(max_seconds ?? 120, MAX_APPROVAL_WAIT_SECONDS) * 1000;
        let req = await dashboard.getRequest(request_id);
        while (req.status === "pending_approval" && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 5000));
          req = await dashboard.getRequest(request_id);
        }
        return describe(req);
      },
    }),

    betaTool({
      name: "perform_action",
      description: "Carry out an APPROVED request and report the real amount spent back to the dashboard.",
      inputSchema: {
        type: "object",
        properties: { request_id: { type: "string" } },
        required: ["request_id"],
        additionalProperties: false,
      },
      run: async ({ request_id }) => {
        // Enforced in code, whatever the model says: only approved requests run.
        const req = await dashboard.getRequest(request_id);
        if (req.status !== "approved") return `Refused: request is ${req.status}, not approved.`;
        const integration = integrations[req.action];
        if (DRY_RUN || !integration) {
          const why = DRY_RUN ? "DRY_RUN is on" : `no integration is configured for "${req.action}"`;
          await dashboard.cancel(req.id, `Not performed: ${why}.`);
          return `Not performed (${why}). The request was cancelled and its money returned to the budget.`;
        }
        // Re-read inputs so a secret the owner rotated mid-run is picked up.
        const { inputs } = await dashboard.config();
        try {
          const result = await integration(req, inputs);
          const spent = Math.min(Math.max(0, Math.round(result.spentCents)), req.amountCents);
          return describe(await dashboard.complete(req.id, spent, result.note));
        } catch (err) {
          await dashboard.log(`Action ${req.action} failed: ${String(err)}`, "error");
          return `Failed: ${String(err)}. The request is still approved; cancel it if you will not retry.`;
        }
      },
    }),

    betaTool({
      name: "cancel_request",
      description: "Cancel an approved or pending request you will not go ahead with.",
      inputSchema: {
        type: "object",
        properties: { request_id: { type: "string" }, note: { type: "string" } },
        required: ["request_id", "note"],
        additionalProperties: false,
      },
      run: async ({ request_id, note }) => describe(await dashboard.cancel(request_id, note)),
    }),

    betaTool({
      name: "log_progress",
      description: "Write a short progress note to the owner's activity log.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string" },
          level: { type: "string", enum: ["info", "warning", "success"] },
        },
        required: ["message"],
        additionalProperties: false,
      },
      run: async ({ message, level }) => {
        await dashboard.log(message, level ?? "info");
        return "Logged.";
      },
    }),
  ];
}

async function main(): Promise<void> {
  const task = process.argv.slice(2).join(" ").trim() || "Do the next most valuable piece of work for your role.";
  const cfg = await dashboard.config();

  if (cfg.guardrails.killSwitch) {
    console.log("Kill switch is on. Exiting without doing anything.");
    return;
  }
  if (cfg.agent.status !== "active") {
    console.log(`Agent is ${cfg.agent.status}. Activate it in the dashboard first.`);
    return;
  }

  await dashboard.heartbeat(`Working on: ${task.slice(0, 200)}`);
  await dashboard.log(`Started task: ${task}`);

  const final = await client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    max_iterations: 30,
    output_config: { effort: "high" },
    // If a safety classifier declines, retry on a fallback model chosen by the API.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: systemPrompt(cfg),
    tools: makeTools(cfg),
    messages: [{ role: "user", content: task }],
  });

  if (final.stop_reason === "refusal") {
    await dashboard.log("The model declined this task.", "warning");
    console.log("The model declined this task.");
    return;
  }

  const summary = final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  console.log(summary);
  await dashboard.log(`Finished. ${summary}`, "success");
  await dashboard.heartbeat("Idle");
}

main().catch(async (err) => {
  const message = err instanceof DashboardError ? `Dashboard error (${err.status}): ${err.message}` : String(err);
  console.error(message);
  try {
    await dashboard.log(`Run crashed: ${message}`, "error");
  } catch {
    // The dashboard itself may be unreachable; the console message is enough.
  }
  process.exit(1);
});
