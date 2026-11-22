import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EMPTY_ECONOMICS } from "../shared/economics.ts";
import { detectChannels, findChannel } from "../shared/channels.ts";
import { AUTO_DONE, DEFAULT_TASKS, channelTaskText, findTemplate, makeDefaultTasks, syncChannelTasks } from "../shared/templates.ts";
import type { ActivityEntry, ActivityLevel, DashboardState, DiscordSettings } from "../shared/types.ts";

export const MAX_ACTIVITY = 2000;
/** AI usage reports kept (older ones are dropped; monthly totals only need recent ones). */
export const MAX_AI_USAGE = 20000;

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
      channels: [],
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
      aiMonthlyLimitCents: null,
    },
    funding: [],
    requests: [],
    activity: [],
    vault: {},
    discord: defaultDiscord(),
    allocation: { auto: true, reserveBps: 1500, weights: {} },
    research: [],
    aiUsage: [],
    security: { passwordHash: null, passwordSalt: null, passwordUpdatedAt: null },
  };
}

/** Ticks checklist steps the dashboard can verify itself (e.g. a deposit was recorded). Never un-ticks. */
export function autoCompleteTasks(s: DashboardState, now: Date = new Date()): void {
  for (const t of s.tasks) {
    const check = t.templateKey ? AUTO_DONE[t.templateKey] : undefined;
    if (t.status === "todo" && check?.(s)) {
      t.status = "done";
      t.completedAt = now.toISOString();
    }
  }
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
    aiUsage: Array.isArray(raw.aiUsage) ? raw.aiUsage : [],
    security: { ...base.security, ...raw.security },
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
      .filter((t) => t.custom || matchTemplate(t) || t.templateKey?.startsWith("channel:") || (t.notes ?? "").trim() !== "")
      .map((t) => {
        const ch = t.templateKey?.startsWith("channel:") ? findChannel(t.templateKey.slice(8)) : undefined;
        if (ch) return { ...t, ...channelTaskText(ch) };
        const tpl = matchTemplate(t);
        return {
          ...t,
          steps: tpl ? [...tpl.steps] : (t.steps ?? []),
          links: tpl ? tpl.links.map((l) => ({ ...l })) : (t.links ?? []),
          time: tpl ? tpl.time : (t.time ?? ""),
          templateKey: tpl ? tpl.key : (t.templateKey ?? null),
          money: tpl ? (tpl.money ?? null) : (t.money ?? null),
          waitsFor: tpl ? (tpl.waitsFor ?? null) : (t.waitsFor ?? null),
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
        if (!ta) return x;
        return { ...x, ...(ta.category && !x.category ? { category: ta.category } : {}), ...(ta.setsPrice ? { setsPrice: true } : {}) };
      }),
    };
  });
  // Older saves only had free-text channels: recognise them, then make sure each has its setup step.
  if (!Array.isArray(s.business.channels) || s.business.channels.length === 0) s.business.channels = detectChannels(s.business.salesChannels);
  s.business.channels = s.business.channels.filter((k) => findChannel(k));
  syncChannelTasks(s, newId);
  // Tick steps that are already satisfied by existing data (e.g. a deposit recorded before this step existed).
  autoCompleteTasks(s);
  return s;
}

/**
 * A tiny JSON-file database. Every mutation is applied in memory and then
 * written atomically (temp file + rename), so a crash never leaves a
 * half-written file. Node runs request handlers one at a time, and all
 * mutations here are synchronous, so there are no write races.
 */
export interface BackupInfo {
  name: string;
  createdAt: string;
  reason: string;
  businessName: string;
  product: string;
  agents: number;
  sizeBytes: number;
}

const BACKUP_NAME = /^backup-\d{8}-\d{6}-\d{3}-[a-z-]{1,40}\.json$/;
export const MAX_BACKUPS = 20;

export class Store {
  private state: DashboardState;
  private readonly file: string | null;
  private readonly backupsDir: string | null;
  /** Backups for stores without a data directory (tests). */
  private readonly memoryBackups = new Map<string, string>();

  constructor(dataDir: string | null) {
    this.file = dataDir ? path.join(dataDir, "db.json") : null;
    this.backupsDir = dataDir ? path.join(dataDir, "backups") : null;
    this.state = this.load(dataDir);
  }

  /** Saves a copy of the current data. Returns the backup's name. Keeps the newest MAX_BACKUPS. */
  createBackup(reason: string, now: Date = new Date()): string {
    const p = (n: number, w = 2) => String(n).padStart(w, "0");
    const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-${p(now.getMilliseconds(), 3)}`;
    const safeReason = reason.toLowerCase().replace(/[^a-z-]+/g, "-").slice(0, 40) || "manual";
    let name = `backup-${stamp}-${safeReason}.json`;
    const exists = (n: string) => (this.backupsDir ? fs.existsSync(path.join(this.backupsDir, n)) : this.memoryBackups.has(n));
    for (let i = 1; exists(name); i++) name = `backup-${stamp}-${safeReason}-${"x".repeat(i)}.json`;
    const body = JSON.stringify(this.state, null, 2);
    if (this.backupsDir) {
      fs.mkdirSync(this.backupsDir, { recursive: true });
      fs.writeFileSync(path.join(this.backupsDir, name), body, { mode: 0o600 });
    } else {
      this.memoryBackups.set(name, body);
    }
    const all = this.listBackups();
    for (const old of all.slice(MAX_BACKUPS)) this.deleteBackup(old.name);
    return name;
  }

  private backupNames(): string[] {
    if (!this.backupsDir) return [...this.memoryBackups.keys()];
    if (!fs.existsSync(this.backupsDir)) return [];
    return fs.readdirSync(this.backupsDir).filter((n) => BACKUP_NAME.test(n));
  }

  private readRaw(name: string): string {
    if (!BACKUP_NAME.test(name)) throw new Error("Invalid backup name.");
    if (!this.backupsDir) {
      const v = this.memoryBackups.get(name);
      if (v === undefined) throw new Error("Backup not found.");
      return v;
    }
    const file = path.join(this.backupsDir, name);
    if (!fs.existsSync(file)) throw new Error("Backup not found.");
    return fs.readFileSync(file, "utf8");
  }

  listBackups(): BackupInfo[] {
    const out: BackupInfo[] = [];
    for (const name of this.backupNames()) {
      try {
        const raw = this.readRaw(name);
        const data = JSON.parse(raw) as Partial<DashboardState>;
        const m = /^backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})-([a-z-]+?)(?:-x+)?\.json$/.exec(name)!;
        out.push({
          name,
          createdAt: new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!, +m[7]!).toISOString(),
          reason: m[8]!.replace(/-/g, " "),
          businessName: data.business?.name ?? "",
          product: data.business?.product ?? "",
          agents: data.agents?.length ?? 0,
          sizeBytes: Buffer.byteLength(raw),
        });
      } catch {
        // Skip unreadable files rather than failing the whole list.
      }
    }
    return out.sort((a, b) => b.name.localeCompare(a.name));
  }

  readBackup(name: string): DashboardState {
    return migrate(JSON.parse(this.readRaw(name)) as Partial<DashboardState> & Record<string, unknown>);
  }

  deleteBackup(name: string): void {
    if (!BACKUP_NAME.test(name)) return;
    if (this.backupsDir) fs.rmSync(path.join(this.backupsDir, name), { force: true });
    else this.memoryBackups.delete(name);
  }

  /**
   * Replaces all data at once (start over / restore). Deliberately skips the
   * activity listeners, so restoring a backup never re-posts old history to Discord.
   */
  replace(next: DashboardState): void {
    const copy = structuredClone(next);
    this.writeFile(copy);
    this.state = copy;
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
    autoCompleteTasks(draft);
    if (draft.activity.length > MAX_ACTIVITY) draft.activity = draft.activity.slice(-MAX_ACTIVITY);
    if (draft.aiUsage.length > MAX_AI_USAGE) draft.aiUsage = draft.aiUsage.slice(-MAX_AI_USAGE);
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
