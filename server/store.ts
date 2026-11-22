import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EMPTY_ECONOMICS } from "../shared/economics.ts";
import { DEFAULT_TASKS, findTemplate, makeDefaultTasks } from "../shared/templates.ts";
import type { ActivityEntry, ActivityLevel, DashboardState, DiscordSettings } from "../shared/types.ts";

export const MAX_ACTIVITY = 2000;

export const newId = (): string => randomUUID();
export const newToken = (): string => `agt_${randomBytes(24).toString("hex")}`;

export function defaultDiscord(): DiscordSettings {
  return {
    enabled: false,
    defaultWebhookUrl: "",
    agentWebhooks: {},
    events: { approvals: true, denials: true, spending: true, revenue: true, reports: true, agentLogs: "important", dailySummary: true },
    dailySummaryHour: 18,
    lastDailySummaryDate: null,
    approvalMention: "",
  };
}

export function defaultState(): DashboardState {
  return {
    version: 2,
    business: {
      name: "",
      product: "",
      description: "",
      targetMarket: "",
      salesChannels: "",
      ownerName: "",
      ownerEmail: "",
      shippingAddress: "",
      productSource: null,
    },
    economics: { ...EMPTY_ECONOMICS },
    tasks: makeDefaultTasks(newId),
    agents: [],
    guardrails: {
      killSwitch: false,
      perTransactionLimitCents: null,
      dailySpendLimitCents: null,
      monthlySpendLimitCents: null,
      approvalThresholdCents: 10000,
    },
    funding: [],
    requests: [],
    activity: [],
    vault: {},
    discord: defaultDiscord(),
    allocation: { auto: true, reserveBps: 1500, weights: {} },
    research: [],
  };
}

/** Built-in task titles from version 1, mapped to today's task keys. */
const LEGACY_TASK_TITLES: Record<string, string> = {
  "Form a legal entity (e.g. LLC)": "entity",
  "Get a tax ID (EIN or local equivalent)": "ein",
  "Open a business bank account": "bank",
  "Get product liability insurance": "insurance",
  "Confirm product safety & compliance": "compliance",
  "Register for sales tax": "sales_tax",
  "Create seller / store accounts": "seller_accounts",
  "Set up a payment method for agent spending": "spend_card",
  "Approve product samples yourself": "samples",
};

/** Brings a saved state from any earlier version up to the current shape. */
export function migrate(raw: Partial<DashboardState> & Record<string, unknown>): DashboardState {
  const base = defaultState();
  const s: DashboardState = {
    ...base,
    ...raw,
    business: { ...base.business, ...raw.business },
    economics: { ...base.economics, ...raw.economics },
    guardrails: { ...base.guardrails, ...raw.guardrails },
    discord: {
      ...base.discord,
      ...raw.discord,
      events: { ...base.discord.events, ...raw.discord?.events },
      agentWebhooks: { ...raw.discord?.agentWebhooks },
    },
    allocation: { ...base.allocation, ...raw.allocation, weights: { ...raw.allocation?.weights } },
    vault: { ...raw.vault },
    // A research job cannot survive a restart: mark any that were running as failed.
    research: (raw.research ?? []).map((j) =>
      j.status === "running" ? { ...j, status: "error" as const, error: "Interrupted because the dashboard restarted. Run it again.", finishedAt: j.startedAt } : j,
    ),
    version: 2,
  };
  // Refresh built-in task text (steps, links) while keeping the owner's progress and notes.
  if (raw.tasks) {
    const matchTemplate = (t: (typeof raw.tasks)[number]) => {
      const byKey = DEFAULT_TASKS.find((d) => d.key === t.templateKey);
      if (byKey || t.custom) return byKey;
      const key = LEGACY_TASK_TITLES[t.title];
      return DEFAULT_TASKS.find((d) => d.title === t.title || d.key === key);
    };
    s.tasks = raw.tasks
      // Built-in tasks from older versions that the setup assistant now covers are dropped unless they hold notes.
      .filter((t) => t.custom || matchTemplate(t) || (t.notes ?? "").trim() !== "")
      .map((t) => {
        const tpl = matchTemplate(t);
        return {
          ...t,
          steps: tpl ? [...tpl.steps] : (t.steps ?? []),
          links: tpl ? tpl.links.map((l) => ({ ...l })) : (t.links ?? []),
          time: tpl ? tpl.time : (t.time ?? ""),
          templateKey: tpl ? tpl.key : (t.templateKey ?? null),
          description: tpl ? tpl.description : t.description,
          title: tpl ? tpl.title : t.title,
        };
      });
    for (const d of makeDefaultTasks(newId)) {
      if (!s.tasks.some((t) => t.templateKey === d.templateKey)) s.tasks.push(d);
    }
  }
  // Give saved agents the template's vault links, suggestions and P&L categories.
  s.agents = s.agents.map((a) => {
    const tpl = findTemplate(a.role);
    if (!tpl) return a;
    return {
      ...a,
      inputFields: a.inputFields.map((f) => {
        const tf = tpl.inputFields.find((x) => x.key === f.key);
        return tf ? { ...f, vault: tf.vault, suggest: tf.suggest, help: tf.help ?? f.help } : f;
      }),
      actions: a.actions.map((x) => {
        const ta = tpl.actions.find((y) => y.key === x.key);
        return ta?.category && !x.category ? { ...x, category: ta.category } : x;
      }),
    };
  });
  return s;
}

/**
 * A tiny JSON-file database. Every mutation is applied in memory and then
 * written atomically (temp file + rename), so a crash never leaves a
 * half-written file. Node runs request handlers one at a time, and all
 * mutations here are synchronous, so there are no write races.
 */
export class Store {
  private state: DashboardState;
  private readonly file: string | null;

  constructor(dataDir: string | null) {
    this.file = dataDir ? path.join(dataDir, "db.json") : null;
    this.state = this.load(dataDir);
  }

  private load(dataDir: string | null): DashboardState {
    if (!this.file || !dataDir) return defaultState();
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(this.file)) {
      const s = defaultState();
      this.writeFile(s);
      return s;
    }
    const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<DashboardState> & Record<string, unknown>;
    return migrate(raw);
  }

  private writeFile(s: DashboardState): void {
    if (!this.file) return;
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  get(): DashboardState {
    return this.state;
  }

  /** Called after each successful mutation with the activity entries it added. */
  private listeners: Array<(entries: ActivityEntry[], state: DashboardState) => void> = [];

  onActivity(fn: (entries: ActivityEntry[], state: DashboardState) => void): void {
    this.listeners.push(fn);
  }

  /** Applies a mutation to a copy of the state and persists it. If fn throws, nothing changes. */
  mutate<T>(fn: (draft: DashboardState) => T): T {
    const draft = structuredClone(this.state);
    const before = new Set(this.state.activity.map((a) => a.id));
    const result = fn(draft);
    if (draft.activity.length > MAX_ACTIVITY) draft.activity = draft.activity.slice(-MAX_ACTIVITY);
    this.writeFile(draft);
    this.state = draft;
    const added = draft.activity.filter((a) => !before.has(a.id));
    if (added.length > 0) {
      for (const l of this.listeners) {
        try {
          l(added, draft);
        } catch (err) {
          console.error("activity listener failed", err);
        }
      }
    }
    return result;
  }
}

export function log(
  draft: DashboardState,
  actor: string,
  level: ActivityLevel,
  message: string,
  now: Date = new Date(),
  extra: Partial<Pick<ActivityEntry, "kind" | "agentId" | "title" | "fields" | "amountCents">> = {},
): ActivityEntry {
  const entry: ActivityEntry = {
    id: newId(),
    at: now.toISOString(),
    actor,
    level,
    message,
    kind: extra.kind ?? (actor === "Owner" ? "owner" : "system"),
    agentId: extra.agentId ?? null,
    ...(extra.title ? { title: extra.title } : {}),
    ...(extra.fields ? { fields: extra.fields } : {}),
    ...(extra.amountCents !== undefined ? { amountCents: extra.amountCents } : {}),
  };
  draft.activity.push(entry);
  return entry;
}
