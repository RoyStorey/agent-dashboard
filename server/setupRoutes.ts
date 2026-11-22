import type { Response, Router } from "express";
import { formatCents } from "../shared/money.ts";
import { findService } from "../shared/services.ts";
import { RECOMMENDED_ROLES, findTemplate } from "../shared/templates.ts";
import type { DashboardState, ResearchBrief, ResearchJob, UnitEconomics } from "../shared/types.ts";
import { createAgent } from "./agents.ts";
import { applyRebalance, autoAllocate } from "./allocate.ts";
import { isWebhookUrl, type DiscordNotifier } from "./discord.ts";
import { aiThisMonth, computeFinance } from "./finance.ts";
import { CHANNELS, channelNames, detectChannels, findChannel } from "../shared/channels.ts";
import { syncChannelTasks } from "../shared/templates.ts";
import { autofillAgent, missingInputs, refreshSuggestedInputs, suggestValue } from "./inputs.ts";
import { RESEARCH_MODEL, ResearchFailure, type ResearchRunner } from "./research.ts";
import { estimateCostCents, type UsageCounts } from "../shared/aiPricing.ts";
import { defaultState, log, newId, type Store } from "./store.ts";
import { HttpError, asBody, bad, bool, cents, obj, str, strArray, type Body } from "./validate.ts";

export interface SetupContext {
  store: Store;
  now: () => Date;
  sendState: (res: Response) => void;
  research: ResearchRunner;
  notifier?: DiscordNotifier;
}

const CUSTOM_VAULT_KEY = /^custom_[a-z0-9_]{1,40}$/;
const MAX_RESEARCH_JOBS = 10;

function bps(body: Body, key: string): number | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > 10_000) throw bad(`"${key}" must be a whole number of basis points from 0 to 10000.`);
  return v;
}

function wholeNumber(body: Body, key: string, max = 1_000_000_000): number | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > max) throw bad(`"${key}" must be a whole number from 0 to ${max}.`);
  return v;
}

export function registerSetupRoutes(owner: Router, ctx: SetupContext): void {
  const { store, now, sendState } = ctx;

  /* ---------- Unit economics ---------- */

  owner.put("/economics", (req, res) => {
    const body = asBody(req.body);
    const patch: Partial<UnitEconomics> = {};
    for (const k of ["salePriceCents", "unitCostCents", "inboundShippingCents", "otherPerUnitCents", "fulfillmentFeeCents", "perOrderFeeCents", "fixedMonthlyCents"] as const) {
      const v = cents(body, k);
      if (v !== undefined) patch[k] = v;
    }
    for (const k of ["marketplaceFeeBps", "paymentFeeBps", "adSpendBps", "returnRateBps"] as const) {
      const v = bps(body, k);
      if (v !== undefined) patch[k] = v;
    }
    const units = wholeNumber(body, "monthlyUnits", 10_000_000);
    if (units !== undefined) patch.monthlyUnits = units;
    store.mutate((s) => {
      const before = structuredClone(s);
      Object.assign(s.economics, patch);
      refreshSuggestedInputs(before, s);
      log(s, "Owner", "info", "Updated unit economics.", now());
    });
    sendState(res);
  });

  /* ---------- Sales channels ---------- */

  owner.put("/channels", (req, res) => {
    const body = asBody(req.body);
    const channels = strArray(body, "channels", { maxItems: CHANNELS.length, maxLen: 32 });
    if (!channels) throw bad('"channels" is required.');
    for (const c of channels) if (!findChannel(c)) throw bad(`Unknown sales channel "${c}".`);
    if (new Set(channels).size !== channels.length) throw bad("Each channel can only be listed once.");
    store.mutate((s) => {
      const before = structuredClone(s);
      s.business.channels = channels;
      s.business.salesChannels = channelNames(channels);
      syncChannelTasks(s, newId);
      refreshSuggestedInputs(before, s);
      log(s, "Owner", "info", channels.length ? `Selling on: ${channelNames(channels)} (primary: ${findChannel(channels[0]!)!.name}).` : "Cleared sales channels.", now());
    });
    sendState(res);
  });

  owner.post("/channels/:key/apply-fees", (req, res) => {
    const def = findChannel(req.params.key as string);
    if (!def) throw new HttpError(404, "Unknown sales channel.");
    if (!def.typicalFees) throw bad(`${def.name} fees vary; enter them yourself on Financials after checking ${def.name}'s fee page.`);
    const fees = def.typicalFees;
    store.mutate((s) => {
      const before = structuredClone(s);
      Object.assign(s.economics, fees);
      refreshSuggestedInputs(before, s);
      log(s, "Owner", "info", `Applied typical ${def.name} fees to the plan.`, now());
    });
    sendState(res);
  });

  /* ---------- Credentials vault ---------- */

  owner.put("/vault/:key", (req, res) => {
    const key = req.params.key as string;
    const svc = findService(key);
    if (!svc && !CUSTOM_VAULT_KEY.test(key)) throw bad(`Unknown credential "${key}".`);
    const body = asBody(req.body);
    const value = str(body, "value", { max: 10_000, required: true }) as string;
    const label = str(body, "label", { max: 100 });
    if (!svc && !label?.trim()) throw bad("Custom credentials need a label.");
    store.mutate((s) => {
      s.vault[key] = { value: value.trim(), updatedAt: now().toISOString(), ...(svc ? {} : { label: label!.trim() }) };
      const users = s.agents.filter((a) => a.inputFields.some((f) => (f.vault ?? []).includes(key) || (f.vault?.includes("llm") && svc?.category === "ai")));
      log(s, "Owner", "success", `Saved ${svc?.label ?? label}${users.length ? ` (available to ${users.length} agent${users.length === 1 ? "" : "s"})` : ""}.`, now());
    });
    sendState(res);
  });

  owner.delete("/vault/:key", (req, res) => {
    const key = req.params.key as string;
    store.mutate((s) => {
      if (!s.vault[key]) throw new HttpError(404, "Credential not found.");
      const label = findService(key)?.label ?? s.vault[key]!.label ?? key;
      delete s.vault[key];
      log(s, "Owner", "warning", `Removed ${label} from Credentials. Agents that used it now need it again.`, now());
    });
    sendState(res);
  });

  /* ---------- One-click team ---------- */

  owner.post("/agents/recommended", (req, res) => {
    const body = asBody(req.body);
    const roles = strArray(body, "roles", { maxItems: 20, maxLen: 64 }) ?? RECOMMENDED_ROLES;
    for (const r of roles) if (!findTemplate(r)) throw bad(`Unknown agent role "${r}".`);
    store.mutate((s) => {
      const t = now();
      const added: string[] = [];
      for (const role of roles) {
        if (s.agents.some((a) => a.role === role)) continue;
        const agent = createAgent(role, undefined, t);
        autofillAgent(s, agent);
        s.agents.push(agent);
        added.push(agent.name);
      }
      if (added.length > 0) log(s, "Owner", "success", `Added ${added.length} agents: ${added.join(", ")}.`, t);
      if (added.length > 0 && s.allocation.auto) autoAllocate(s, t, "manual");
    });
    sendState(res);
  });

  owner.post("/agents/activate-ready", (_req, res) => {
    store.mutate((s) => {
      const names: string[] = [];
      for (const a of s.agents) {
        if (a.status === "draft" && missingInputs(s, a).length === 0) {
          a.status = "active";
          names.push(a.name);
        }
      }
      if (names.length === 0) throw bad("No agents are ready yet. Fill in their missing inputs first.");
      log(s, "Owner", "success", `Activated ${names.join(", ")}.`, now());
    });
    sendState(res);
  });

  owner.post("/agents/autofill", (req, res) => {
    const body = asBody(req.body);
    const overwrite = bool(body, "overwrite") ?? false;
    store.mutate((s) => {
      let n = 0;
      for (const a of s.agents) {
        if (overwrite) {
          for (const f of a.inputFields) {
            if (!f.suggest || f.kind === "secret") continue;
            const v = suggestValue(s, f.suggest);
            if (v.trim() && v !== a.inputs[f.key]) {
              a.inputs[f.key] = v;
              n++;
            }
          }
        } else {
          n += autofillAgent(s, a).length;
        }
      }
      log(s, "Owner", "info", n > 0 ? `Auto-filled ${n} agent detail${n === 1 ? "" : "s"}.` : "Auto-fill found nothing new to fill.", now());
    });
    sendState(res);
  });

  /* ---------- Guardrails presets ---------- */

  owner.post("/guardrails/recommended", (_req, res) => {
    store.mutate((s) => {
      const t = now();
      const cash = computeFinance(s, t).cashBalanceCents;
      if (cash <= 0) throw bad("Deposit funds first; the caps are based on your cash.");
      // Monthly cap: 75% of cash; daily cap: 35% of cash, so the first inventory order (usually
      // the biggest single purchase) fits in one day. Both rounded down to $10.
      const monthly = Math.max(1000, Math.floor((cash * 75) / 100 / 1000) * 1000);
      const daily = Math.max(1000, Math.floor((cash * 35) / 100 / 1000) * 1000);
      s.guardrails.monthlySpendLimitCents = monthly;
      s.guardrails.dailySpendLimitCents = daily;
      if (s.guardrails.approvalThresholdCents === null) s.guardrails.approvalThresholdCents = 10_000;
      log(s, "Owner", "info", `Applied recommended caps: ${formatCents(daily)}/day, ${formatCents(monthly)}/month.`, t);
    });
    sendState(res);
  });

  /* ---------- Budget allocation ---------- */

  owner.put("/allocation", (req, res) => {
    const body = asBody(req.body);
    const auto = bool(body, "auto");
    const reserveBps = bps(body, "reserveBps");
    const weights = obj(body, "weights");
    store.mutate((s) => {
      if (auto !== undefined) s.allocation.auto = auto;
      if (reserveBps !== undefined) s.allocation.reserveBps = reserveBps;
      if (weights) {
        for (const [id, w] of Object.entries(weights)) {
          if (!s.agents.some((a) => a.id === id)) throw bad("Unknown agent in weights.");
          if (w === null) delete s.allocation.weights[id];
          else if (typeof w !== "number" || !Number.isFinite(w) || w < 0 || w > 1000) throw bad("Weights must be numbers from 0 to 1000.");
          else s.allocation.weights[id] = Math.round(w * 100) / 100;
        }
      }
      log(s, "Owner", "info", "Updated budget allocation settings.", now());
    });
    sendState(res);
  });

  owner.post("/allocation/distribute", (_req, res) => {
    store.mutate((s) => {
      const added = autoAllocate(s, now(), "manual");
      if (added === 0) throw bad("Nothing to distribute: no unallocated cash above the reserve, or no agent can spend.");
    });
    sendState(res);
  });

  owner.post("/allocation/rebalance", (_req, res) => {
    store.mutate((s) => {
      if (applyRebalance(s, now()) === 0) throw bad("Budgets already match the plan.");
    });
    sendState(res);
  });

  /* ---------- Discord ---------- */

  owner.put("/discord", (req, res) => {
    const body = asBody(req.body);
    const enabled = bool(body, "enabled");
    const def = str(body, "defaultWebhookUrl", { max: 500 });
    const agentHooks = obj(body, "agentWebhooks");
    const events = obj(body, "events");
    const hour = wholeNumber(body, "dailySummaryHour", 23);
    const mention = str(body, "approvalMention", { max: 100 });
    if (def !== undefined && def.trim() !== "" && !isWebhookUrl(def)) {
      throw bad("That is not a Discord webhook URL. It should look like https://discord.com/api/webhooks/123…/abc…");
    }
    if (mention !== undefined && mention.trim() !== "" && !/^(@here|@everyone|<@!?\d+>|<@&\d+>)$/.test(mention.trim())) {
      throw bad("Mention must be @here, @everyone, <@USER_ID> or <@&ROLE_ID>.");
    }
    store.mutate((s) => {
      const d = s.discord;
      if (def !== undefined) d.defaultWebhookUrl = def.trim();
      if (agentHooks) {
        for (const [id, url] of Object.entries(agentHooks)) {
          if (!s.agents.some((a) => a.id === id)) throw bad("Unknown agent.");
          if (typeof url !== "string") throw bad("Webhook URLs must be text.");
          if (url.trim() === "") delete d.agentWebhooks[id];
          else if (!isWebhookUrl(url)) throw bad(`Not a Discord webhook URL for ${s.agents.find((a) => a.id === id)!.name}.`);
          else d.agentWebhooks[id] = url.trim();
        }
      }
      if (events) {
        for (const k of ["approvals", "denials", "spending", "revenue", "reports", "dailySummary"] as const) {
          const v = bool(events, k);
          if (v !== undefined) d.events[k] = v;
        }
        const logs = events.agentLogs;
        if (logs !== undefined) {
          if (logs !== "all" && logs !== "important" && logs !== "none") throw bad('"agentLogs" must be all, important or none.');
          d.events.agentLogs = logs;
        }
      }
      if (hour !== undefined) d.dailySummaryHour = hour;
      if (mention !== undefined) d.approvalMention = mention.trim();
      if (enabled !== undefined) {
        if (enabled && !d.defaultWebhookUrl) throw bad("Add the HQ channel webhook first.");
        d.enabled = enabled;
      }
      if (d.enabled && !d.defaultWebhookUrl) d.enabled = false;
      log(s, "Owner", "info", "Updated Discord settings.", now());
    });
    sendState(res);
  });

  owner.post("/discord/test", async (req, res) => {
    const body = asBody(req.body);
    const target = str(body, "target", { max: 100, required: true }) as string;
    const s = store.get();
    const agent = target === "hq" ? null : s.agents.find((a) => a.id === target);
    if (target !== "hq" && !agent) throw new HttpError(404, "Agent not found.");
    const url = agent ? s.discord.agentWebhooks[agent.id] : s.discord.defaultWebhookUrl;
    if (!url) throw bad("No webhook saved for that channel yet.");
    if (!ctx.notifier) throw bad("Discord is not available in this mode.");
    const result = await ctx.notifier.enqueue(url, {
      username: agent?.name ?? "Agent Dashboard",
      embeds: [
        {
          title: agent ? `${agent.name} is connected` : "Agent Dashboard HQ is connected",
          description: agent ? `Updates and reports from ${agent.name} will appear in this channel.` : "Approvals, finance summaries and alerts will appear here.",
          color: 0x22c55e,
        },
      ],
      allowed_mentions: { parse: [] },
    });
    if (!result.ok) throw bad(result.error ?? "Discord did not accept the message.");
    res.json({ ok: true });
  });

  owner.post("/discord/summary", async (_req, res) => {
    if (!ctx.notifier) throw bad("Discord is not available in this mode.");
    const result = await ctx.notifier.sendSummary(now());
    if (!result.ok) throw bad(result.error ?? "Discord did not accept the message.");
    res.json({ ok: true });
  });

  /* ---------- Start over & backups ---------- */

  owner.get("/backups", (_req, res) => {
    res.json({ backups: store.listBackups() });
  });

  owner.post("/reset", (req, res) => {
    const body = asBody(req.body);
    if (body.confirm !== "START OVER") throw bad('Type START OVER to confirm.');
    const keepCredentials = bool(body, "keepCredentials") ?? false;
    const old = store.get();
    const t = now();
    const backup = store.createBackup("before-start-over", t);
    const fresh = defaultState();
    fresh.security = structuredClone(old.security); // starting over never removes the dashboard password
    if (keepCredentials) fresh.vault = structuredClone(old.vault);
    log(
      fresh,
      "Owner",
      "warning",
      `Started over. Everything was cleared${keepCredentials ? " except saved credentials" : ""}. The previous data is saved as backup ${backup}.`,
      t,
    );
    store.replace(fresh);
    sendState(res);
  });

  owner.post("/backups/:name/restore", (req, res) => {
    const name = req.params.name as string;
    let restored: DashboardState;
    try {
      restored = store.readBackup(name);
    } catch (err) {
      throw new HttpError(404, err instanceof Error ? err.message : "Backup not found.");
    }
    const t = now();
    restored.security = structuredClone(store.get().security); // keep today's password, not the backup's
    const safety = store.createBackup("before-restore", t);
    log(restored, "Owner", "warning", `Restored backup ${name}. The data from just before the restore is saved as ${safety}.`, t);
    store.replace(restored);
    sendState(res);
  });

  owner.delete("/backups/:name", (req, res) => {
    const name = req.params.name as string;
    if (!store.listBackups().some((b) => b.name === name)) throw new HttpError(404, "Backup not found.");
    store.deleteBackup(name);
    res.json({ backups: store.listBackups() });
  });

  /* ---------- AI product research ---------- */

  owner.post("/research", (req, res) => {
    const body = asBody(req.body);
    const brief: ResearchBrief = {
      budgetCents: cents(body, "budgetCents", { required: true, positive: true }) as number,
      interests: str(body, "interests", { max: 1000 }) ?? "",
      avoid: str(body, "avoid", { max: 1000 }) ?? "",
      channels: str(body, "channels", { max: 300 }) ?? "",
      location: str(body, "location", { max: 200 }) ?? "",
    };
    const state = store.get();
    const apiKey = state.vault.anthropic?.value.trim();
    if (!apiKey) throw bad("Paste your Anthropic API key on the Credentials page first. Research runs on Claude.");
    if (state.research.some((j) => j.status === "running")) throw new HttpError(409, "Research is already running.");
    const aiCap = state.guardrails.aiMonthlyLimitCents;
    if (aiCap !== null && aiThisMonth(state, now()) >= aiCap) {
      throw bad(`This month's AI usage budget of ${formatCents(aiCap)} is used up. Raise it on Guardrails to run research.`);
    }

    const job: ResearchJob = {
      id: newId(),
      status: "running",
      brief,
      startedAt: now().toISOString(),
      finishedAt: null,
      summary: "",
      ideas: [],
      error: null,
      chosenIndex: null,
    };
    store.mutate((s) => {
      s.research.push(job);
      if (s.research.length > MAX_RESEARCH_JOBS) s.research = s.research.slice(-MAX_RESEARCH_JOBS);
      log(s, "Owner", "info", `Started AI product research (budget ${formatCents(brief.budgetCents)}).`, now(), { kind: "system" });
    });

    const finish = (update: (j: ResearchJob, s: DashboardState) => void) => {
      store.mutate((s) => {
        const j = s.research.find((x) => x.id === job.id);
        if (!j) return;
        update(j, s);
        j.finishedAt = now().toISOString();
      });
    };
    const recordUsage = (s: DashboardState, usage: UsageCounts | undefined) => {
      if (!usage) return;
      const cost = estimateCostCents(RESEARCH_MODEL, usage) ?? 0;
      s.aiUsage.push({ id: newId(), at: now().toISOString(), agentId: null, label: "Product research", model: RESEARCH_MODEL, ...usage, costCents: cost });
    };
    ctx.research(brief, apiKey).then(
      (result) =>
        finish((j, s) => {
          recordUsage(s, result.usage);
          j.status = "done";
          j.summary = result.summary;
          j.ideas = result.ideas;
          log(s, "System", "success", `Product research finished with ${result.ideas.length} ideas. Top pick: ${result.ideas[0]?.title ?? "none"}.`, now(), {
            title: "Product research finished",
          });
        }),
      (err: unknown) =>
        finish((j, s) => {
          recordUsage(s, err instanceof ResearchFailure ? err.usage : undefined);
          j.status = "error";
          j.error = err instanceof Error ? err.message : String(err);
          log(s, "System", "error", `Product research failed: ${j.error}`, now());
        }),
    );
    sendState(res);
  });

  owner.post("/research/:id/choose", (req, res) => {
    const body = asBody(req.body);
    const index = wholeNumber(body, "index", 20);
    if (index === undefined) throw bad('"index" is required.');
    store.mutate((s) => {
      const job = s.research.find((j) => j.id === req.params.id);
      if (!job || job.status !== "done") throw new HttpError(404, "Research results not found.");
      const idea = job.ideas[index];
      if (!idea) throw bad("No idea at that position.");
      const before = structuredClone(s);
      job.chosenIndex = index;
      const b = s.business;
      b.product = idea.product;
      b.description = [idea.niche, idea.whyNow].filter(Boolean).join(". ").slice(0, 5000);
      b.targetMarket = idea.targetAudience;
      b.productSource = "research";
      // Channels the owner already picked win; otherwise take the idea's suggested channels.
      if (b.channels.length === 0) b.channels = detectChannels(idea.salesChannels);
      b.salesChannels = b.channels.length > 0 ? channelNames(b.channels) : idea.salesChannels;
      syncChannelTasks(s, newId);
      const e = s.economics;
      e.salePriceCents = idea.salePriceCents;
      e.unitCostCents = idea.unitCostCents;
      e.inboundShippingCents = idea.inboundShippingCents;
      e.fulfillmentFeeCents = idea.fulfillmentFeeCents;
      const fees = findChannel(b.channels[0] ?? "")?.typicalFees;
      if (fees) Object.assign(e, fees);
      else if (idea.marketplaceFeeBps > 0) e.marketplaceFeeBps = idea.marketplaceFeeBps;
      e.monthlyUnits = idea.estimatedMonthlyUnits;
      refreshSuggestedInputs(before, s);
      log(s, "Owner", "success", `Chose product: ${idea.title}. Business profile and unit economics filled in.`, now());
    });
    sendState(res);
  });
}
