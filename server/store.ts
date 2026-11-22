import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { makeDefaultTasks } from "../shared/templates.ts";
import type { ActivityEntry, ActivityLevel, DashboardState } from "../shared/types.ts";

export const MAX_ACTIVITY = 2000;

export const newId = (): string => randomUUID();
export const newToken = (): string => `agt_${randomBytes(24).toString("hex")}`;

export function defaultState(): DashboardState {
  return {
    version: 1,
    business: { name: "", product: "", description: "", targetMarket: "", salesChannels: "" },
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
  };
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
    const raw = JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<DashboardState>;
    const base = defaultState();
    return {
      ...base,
      ...raw,
      business: { ...base.business, ...raw.business },
      guardrails: { ...base.guardrails, ...raw.guardrails },
      version: 1,
    };
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

  /** Applies a mutation to a copy of the state and persists it. If fn throws, nothing changes. */
  mutate<T>(fn: (draft: DashboardState) => T): T {
    const draft = structuredClone(this.state);
    const result = fn(draft);
    if (draft.activity.length > MAX_ACTIVITY) draft.activity = draft.activity.slice(-MAX_ACTIVITY);
    this.writeFile(draft);
    this.state = draft;
    return result;
  }
}

export function log(
  draft: DashboardState,
  actor: string,
  level: ActivityLevel,
  message: string,
  now: Date = new Date(),
): ActivityEntry {
  const entry: ActivityEntry = { id: newId(), at: now.toISOString(), actor, level, message };
  draft.activity.push(entry);
  return entry;
}
