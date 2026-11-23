import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentTemplate } from "../../shared/templates.ts";
import type { StateResponse } from "../../shared/types.ts";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number = 0,
    /** True when the dashboard has a password and this browser isn't signed in. */
    public readonly loginRequired: boolean = false,
  ) {
    super(message);
  }
}

export interface BackupInfo {
  name: string;
  createdAt: string;
  reason: string;
  businessName: string;
  product: string;
  agents: number;
  sizeBytes: number;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const d = data as { error?: string; loginRequired?: boolean } | null;
    throw new ApiError(d?.error ?? `Request failed (${res.status}).`, res.status, d?.loginRequired === true);
  }
  return data as T;
}

export const api = {
  state: () => call<StateResponse>("GET", "/api/state"),
  templates: () => call<{ templates: AgentTemplate[] }>("GET", "/api/templates"),
  updateBusiness: (b: Record<string, string>) => call<StateResponse>("PUT", "/api/business", b),
  addTask: (t: { title: string; description: string; category: string }) => call<StateResponse>("POST", "/api/tasks", t),
  updateTask: (id: string, patch: Record<string, unknown>) => call<StateResponse>("PATCH", `/api/tasks/${id}`, patch),
  deleteTask: (id: string) => call<StateResponse>("DELETE", `/api/tasks/${id}`),
  addAgent: (role: string, name?: string) =>
    call<StateResponse & { createdAgentId: string }>("POST", "/api/agents", { role, name }),
  updateAgent: (id: string, patch: Record<string, unknown>) => call<StateResponse>("PATCH", `/api/agents/${id}`, patch),
  deleteAgent: (id: string) => call<StateResponse>("DELETE", `/api/agents/${id}`),
  revealToken: (id: string) => call<{ token: string }>("POST", `/api/agents/${id}/token`),
  rotateToken: (id: string) => call<{ token: string }>("POST", `/api/agents/${id}/token/rotate`),
  setBudget: (id: string, budgetCents: number) => call<StateResponse>("PUT", `/api/agents/${id}/budget`, { budgetCents }),
  updateGuardrails: (g: Record<string, unknown>) => call<StateResponse>("PUT", "/api/guardrails", g),
  addFunding: (type: string, amountCents: number, note: string) =>
    call<StateResponse>("POST", "/api/funding", { type, amountCents, note }),
  approve: (id: string) => call<StateResponse>("POST", `/api/requests/${id}/approve`),
  reject: (id: string, note: string) => call<StateResponse>("POST", `/api/requests/${id}/reject`, { note }),
  closeRequest: (id: string, outcome: "completed" | "cancelled", actualAmountCents?: number) =>
    call<StateResponse>("POST", `/api/requests/${id}/close`, { outcome, actualAmountCents }),
  recordSales: (r: { grossSalesCents: number; refundsCents: number; feesCents: number; unitsSold?: number; note: string }) =>
    call<StateResponse>("POST", "/api/funding", { type: "revenue", ...r }),
  updateEconomics: (e: Record<string, number>) => call<StateResponse>("PUT", "/api/economics", e),
  testShopify: () => call<StateResponse>("POST", "/api/shopify/test"),
  syncShopify: () => call<StateResponse>("POST", "/api/shopify/sync"),
  setShopifyAutoSync: (autoSync: boolean) => call<StateResponse>("PUT", "/api/shopify", { autoSync }),
  setFulfillment: (mode: "self" | "provider" | "marketplace" | null) => call<StateResponse>("PUT", "/api/fulfillment", { mode }),
  addShipment: (s: Record<string, unknown>) => call<StateResponse>("POST", "/api/shipments", s),
  updateShipment: (id: string, status: string, trackingNumber?: string) => call<StateResponse>("PATCH", `/api/shipments/${id}`, { status, trackingNumber }),
  saveSupplies: (supplies: unknown[]) => call<StateResponse>("PUT", "/api/supplies", { supplies }),
  updateChannels: (channels: string[]) => call<StateResponse>("PUT", "/api/channels", { channels }),
  applyChannelFees: (key: string) => call<StateResponse>("POST", `/api/channels/${encodeURIComponent(key)}/apply-fees`),
  saveVault: (key: string, value: string, label?: string) => call<StateResponse>("PUT", `/api/vault/${encodeURIComponent(key)}`, { value, label }),
  deleteVault: (key: string) => call<StateResponse>("DELETE", `/api/vault/${encodeURIComponent(key)}`),
  addRecommendedTeam: (roles?: string[]) => call<StateResponse>("POST", "/api/agents/recommended", roles ? { roles } : {}),
  activateReady: () => call<StateResponse>("POST", "/api/agents/activate-ready"),
  autofill: (overwrite: boolean) => call<StateResponse>("POST", "/api/agents/autofill", { overwrite }),
  recommendedGuardrails: () => call<StateResponse>("POST", "/api/guardrails/recommended"),
  updateAllocation: (a: Record<string, unknown>) => call<StateResponse>("PUT", "/api/allocation", a),
  resetAllocation: () => call<StateResponse>("POST", "/api/allocation/reset"),
  distribute: () => call<StateResponse>("POST", "/api/allocation/distribute"),
  rebalance: () => call<StateResponse>("POST", "/api/allocation/rebalance"),
  updateDiscord: (d: Record<string, unknown>) => call<StateResponse>("PUT", "/api/discord", d),
  testDiscord: (target: string) => call<{ ok: boolean }>("POST", "/api/discord/test", { target }),
  discordSummary: () => call<{ ok: boolean }>("POST", "/api/discord/summary"),
  startResearch: (brief: Record<string, unknown>) => call<StateResponse>("POST", "/api/research", brief),
  session: () => call<{ passwordSet: boolean; signedIn: boolean }>("GET", "/api/session"),
  login: (password: string) => call<{ ok: boolean }>("POST", "/api/login", { password }),
  logout: () => call<{ ok: boolean }>("POST", "/api/logout"),
  setPassword: (currentPassword: string, newPassword: string) => call<StateResponse>("PUT", "/api/security/password", { currentPassword, newPassword }),
  chooseIdea: (jobId: string, index: number) => call<StateResponse>("POST", `/api/research/${jobId}/choose`, { index }),
  backups: () => call<{ backups: BackupInfo[] }>("GET", "/api/backups"),
  startOver: (keepCredentials: boolean) => call<StateResponse>("POST", "/api/reset", { confirm: "START OVER", keepCredentials }),
  restoreBackup: (name: string) => call<StateResponse>("POST", `/api/backups/${encodeURIComponent(name)}/restore`),
  runAgent: (id: string) => call<StateResponse>("POST", `/api/agents/${id}/run`),
  stopAgent: (id: string) => call<StateResponse>("POST", `/api/agents/${id}/stop`),
  setSchedule: (id: string, schedule: { enabled?: boolean; everyMinutes?: number; maxRunsPerDay?: number }) =>
    call<StateResponse>("PUT", `/api/agents/${id}/schedule`, schedule),
  updatePlan: (plan: { phase?: string; brief?: string }) => call<StateResponse>("PUT", "/api/team/plan", plan),
  addNote: (to: string[], text: string) => call<StateResponse>("POST", "/api/team/notes", { to, text }),
  publishDraft: (id: string) => call<StateResponse>("POST", `/api/drafts/${id}/publish`),
  rejectDraft: (id: string, note: string) => call<StateResponse>("POST", `/api/drafts/${id}/reject`, { note }),
  deleteBackup: (name: string) => call<{ backups: BackupInfo[] }>("DELETE", `/api/backups/${encodeURIComponent(name)}`),
};

export interface Dashboard {
  state: StateResponse | null;
  loadError: string | null;
  /** The dashboard has a password and this browser must sign in. */
  needsLogin: boolean;
  refresh: () => Promise<void>;
  /** Runs a mutation, applies the returned state, and reports errors as toasts. Resolves true on success. */
  run: (fn: () => Promise<StateResponse | unknown>, success?: string) => Promise<boolean>;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  notify: (kind: Toast["kind"], text: string) => void;
}

export interface Toast {
  id: number;
  kind: "success" | "error";
  text: string;
}

const POLL_MS = 3000;

function isStateResponse(v: unknown): v is StateResponse {
  return typeof v === "object" && v !== null && "finance" in v && "agents" in v;
}

export function useDashboard(): Dashboard {
  const [state, setState] = useState<StateResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  // Ignore poll results that started before a mutation finished, so a slow
  // poll never overwrites fresher state.
  const generation = useRef(0);

  const notify = useCallback((kind: Toast["kind"], text: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, text }].slice(-3));
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 8000 : 3000);
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const refresh = useCallback(async () => {
    const gen = generation.current;
    try {
      const s = await api.state();
      if (gen === generation.current) setState(s);
      setLoadError(null);
      setNeedsLogin(false);
    } catch (e) {
      if (e instanceof ApiError && e.loginRequired) {
        setNeedsLogin(true);
        setLoadError(null);
        return;
      }
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const signedInRefresh = useCallback(async () => {
    setNeedsLogin(false);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [refresh]);

  const run = useCallback<Dashboard["run"]>(
    async (fn, success) => {
      try {
        const result = await fn();
        generation.current++;
        if (isStateResponse(result)) setState(result);
        else await refresh();
        if (success) notify("success", success);
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.loginRequired) setNeedsLogin(true);
        notify("error", e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [notify, refresh],
  );

  return { state, loadError, needsLogin, refresh: signedInRefresh, run, toasts, dismissToast, notify };
}
