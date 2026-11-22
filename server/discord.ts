import { formatBps } from "../shared/economics.ts";
import { formatCents } from "../shared/money.ts";
import { computePnL } from "../shared/pnl.ts";
import type { ActivityEntry, ActivityLevel, DashboardState } from "../shared/types.ts";
import { computeFinance } from "./finance.ts";
import type { Store } from "./store.ts";

/** Discord webhook URLs: https://discord.com/api/webhooks/<id>/<token> (also discordapp.com, canary., ptb.). */
export const WEBHOOK_RE = /^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,30}\/[\w-]{20,200}$/;

export function isWebhookUrl(url: string): boolean {
  return WEBHOOK_RE.test(url.trim());
}

export function maskWebhook(url: string): string {
  if (!url) return "";
  const m = /webhooks\/(\d+)\//.exec(url);
  return m ? `discord webhook …${m[1]!.slice(-4)}` : "discord webhook";
}

export interface DiscordPayload {
  username?: string;
  content?: string;
  embeds?: Array<{
    title?: string;
    description?: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    timestamp?: string;
    footer?: { text: string };
  }>;
  allowed_mentions?: { parse: Array<"users" | "roles" | "everyone"> };
}

export type Sender = (url: string, body: DiscordPayload) => Promise<{ status: number; retryAfterMs?: number; error?: string }>;

export const httpSender: Sender = async (url, body) => {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 429) {
      const data = (await res.json().catch(() => ({}))) as { retry_after?: number };
      return { status: 429, retryAfterMs: Math.ceil((data.retry_after ?? 1) * 1000) };
    }
    if (!res.ok) return { status: res.status, error: (await res.text().catch(() => "")).slice(0, 200) };
    return { status: res.status };
  } catch (err) {
    return { status: 0, error: err instanceof Error ? err.message : String(err) };
  }
};

const COLORS: Record<ActivityLevel, number> = { info: 0x3b82f6, warning: 0xf59e0b, error: 0xef4444, success: 0x22c55e };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface Route {
  url: string;
  payload: DiscordPayload;
}

/** Decides where (if anywhere) an activity entry goes. Pure: easy to test. */
export function routeEntry(e: ActivityEntry, state: DashboardState, dashboardUrl: string): Route | null {
  const d = state.discord;
  if (!d.enabled) return null;
  const hq = d.defaultWebhookUrl;
  const team = (e.agentId && d.agentWebhooks[e.agentId]) || hq;
  const ev = d.events;
  let url = "";
  let mention = "";
  switch (e.kind) {
    case "request_pending":
      if (!ev.approvals) return null;
      url = hq;
      mention = d.approvalMention.trim();
      break;
    case "request_denied":
      if (!ev.denials) return null;
      url = team;
      break;
    case "request_approved":
    case "request_closed":
      if (!(ev.spending && (e.amountCents ?? 0) > 0) && ev.agentLogs !== "all") return null;
      url = team;
      break;
    case "revenue":
      if (!ev.revenue) return null;
      url = team;
      break;
    case "report":
      if (!ev.reports) return null;
      url = team;
      break;
    case "log":
      if (ev.agentLogs === "none") return null;
      if (ev.agentLogs === "important" && e.level === "info") return null;
      url = team;
      break;
    case "system":
      url = hq;
      break;
    default:
      return null;
  }
  if (!url) return null;
  const embed: NonNullable<DiscordPayload["embeds"]>[number] = {
    title: clip(e.title ?? (e.kind === "request_pending" ? "Approval needed" : e.actor), 256),
    description: clip(e.message, 4000),
    color: COLORS[e.level],
    timestamp: e.at,
  };
  if (e.fields && e.fields.length > 0) embed.fields = e.fields.slice(0, 25).map((f) => ({ name: clip(f.name, 256), value: clip(f.value || "—", 1024), inline: f.value.length < 40 }));
  if (e.kind === "request_pending") embed.footer = { text: `Approve or reject: ${dashboardUrl}/#/approvals` };
  return {
    url,
    payload: {
      username: clip(e.actor === "Owner" ? "Agent Dashboard" : e.actor, 80),
      ...(mention ? { content: mention } : {}),
      embeds: [embed],
      // Only approval requests may ping anyone, and only who the owner configured.
      allowed_mentions: { parse: mention ? ["users", "roles", "everyone"] : [] },
    },
  };
}

export function summaryPayload(state: DashboardState, now: Date): DiscordPayload {
  const f = computeFinance(state, now);
  const m = computePnL({ funding: state.funding, requests: state.requests, agents: state.agents, economics: state.economics, aiUsage: state.aiUsage, period: "this_month", now });
  const pending = state.requests.filter((r) => r.status === "pending_approval").length;
  const active = state.agents.filter((a) => a.status === "active").length;
  return {
    username: "Agent Dashboard",
    embeds: [
      {
        title: `Daily summary: ${state.business.name || "your business"}`,
        color: m.netProfit >= 0 ? COLORS.success : COLORS.warning,
        timestamp: now.toISOString(),
        fields: [
          { name: "Cash balance", value: formatCents(f.cashBalanceCents), inline: true },
          { name: "Spent today", value: formatCents(f.spentTodayCents), inline: true },
          { name: "Unallocated", value: formatCents(f.unallocatedCents), inline: true },
          { name: "Gross sales (month)", value: formatCents(m.grossSales), inline: true },
          { name: "Net sales (month)", value: formatCents(m.netSales), inline: true },
          { name: "Units sold (month)", value: String(m.unitsSold), inline: true },
          { name: "Gross profit (month)", value: `${formatCents(m.grossProfit)} (${formatBps(m.grossMarginBps)})`, inline: true },
          { name: "Net profit (month)", value: `${formatCents(m.netProfit)} (${formatBps(m.netMarginBps)})`, inline: true },
          { name: "Ad spend (month)", value: `${formatCents(m.advertising)} · TACoS ${formatBps(m.tacosBps)}`, inline: true },
          { name: "Agents active", value: `${active} of ${state.agents.length}`, inline: true },
          { name: "Waiting for approval", value: String(pending), inline: true },
          ...(state.business.fulfillmentMode === "self"
            ? [
                { name: "Orders to pack", value: String(state.shipments.filter((s) => s.status === "to_pack").length), inline: true },
                { name: "Packed, not dropped off", value: String(state.shipments.filter((s) => s.status === "packed").length), inline: true },
              ]
            : []),
          { name: "Kill switch", value: state.guardrails.killSwitch ? "ON" : "off", inline: true },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Posts activity to Discord without ever blocking or failing a dashboard
 * request. Messages to one webhook are sent in order; a 429 is retried once
 * after Discord's retry_after.
 */
export class DiscordNotifier {
  lastError: string | null = null;
  lastErrorAt: string | null = null;
  sentCount = 0;
  private chains = new Map<string, Promise<void>>();

  constructor(
    private readonly store: Store,
    private readonly sender: Sender = httpSender,
    private readonly dashboardUrl = "http://localhost:4317",
  ) {}

  attach(): void {
    this.store.onActivity((entries, state) => {
      for (const e of entries) {
        const r = routeEntry(e, state, this.dashboardUrl);
        if (r) void this.enqueue(r.url, r.payload);
      }
    });
  }

  enqueue(url: string, payload: DiscordPayload): Promise<{ ok: boolean; error?: string }> {
    const prev = this.chains.get(url) ?? Promise.resolve();
    let result: { ok: boolean; error?: string } = { ok: false };
    const next = prev.then(async () => {
      result = await this.sendWithRetry(url, payload);
    });
    this.chains.set(url, next);
    void next.finally(() => {
      if (this.chains.get(url) === next) this.chains.delete(url);
    });
    return next.then(() => result);
  }

  private async sendWithRetry(url: string, payload: DiscordPayload): Promise<{ ok: boolean; error?: string }> {
    let res = await this.sender(url, payload);
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, Math.min(res.retryAfterMs ?? 1000, 10_000)));
      res = await this.sender(url, payload);
    }
    if (res.status >= 200 && res.status < 300) {
      this.sentCount++;
      return { ok: true };
    }
    const error =
      res.status === 0
        ? `Could not reach Discord: ${res.error ?? "network error"}`
        : res.status === 401 || res.status === 404
          ? "Discord rejected the webhook (deleted or wrong URL). Create a new webhook and paste it again."
          : `Discord returned HTTP ${res.status}${res.error ? `: ${res.error}` : ""}`;
    this.lastError = error;
    this.lastErrorAt = new Date().toISOString();
    return { ok: false, error };
  }

  async sendSummary(now: Date): Promise<{ ok: boolean; error?: string }> {
    const state = this.store.get();
    if (!state.discord.defaultWebhookUrl) return { ok: false, error: "Add an HQ webhook first." };
    return this.enqueue(state.discord.defaultWebhookUrl, summaryPayload(state, now));
  }

  /** Call every minute or so; posts the daily summary once per local day after the configured hour. */
  async tick(now: Date): Promise<void> {
    const d = this.store.get().discord;
    if (!d.enabled || !d.events.dailySummary || !d.defaultWebhookUrl) return;
    const today = localDate(now);
    if (d.lastDailySummaryDate === today || now.getHours() < d.dailySummaryHour) return;
    this.store.mutate((s) => {
      s.discord.lastDailySummaryDate = today;
    });
    await this.sendSummary(now);
  }
}
