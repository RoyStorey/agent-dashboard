/**
 * Minimal typed client for the dashboard's agent API. Any agent, in any
 * language, can do the same with plain HTTP; see docs/AGENT_API.md.
 */

export type RequestStatus = "approved" | "pending_approval" | "denied" | "rejected" | "completed" | "cancelled";

export interface ActionRequest {
  id: string;
  action: string;
  description: string;
  amountCents: number;
  actualAmountCents: number | null;
  status: RequestStatus;
  reasons: string[];
  resultNote: string;
}

export interface AgentConfig {
  agent: { id: string; name: string; role: string; description: string; status: "draft" | "active" | "paused"; responsibilities: string[] };
  business: { name: string; product: string; description: string; targetMarket: string; salesChannels: string };
  inputs: Record<string, string>;
  inputFields: Array<{ key: string; label: string; kind: "text" | "secret" | "number" | "url" | "textarea"; required: boolean }>;
  missingInputs: string[];
  actions: Array<{ key: string; label: string; spends: boolean; allowed: boolean; alwaysRequiresApproval: boolean }>;
  guardrails: {
    killSwitch: boolean;
    agent: { perTransactionLimitCents: number | null; dailySpendLimitCents: number | null; approvalThresholdCents: number | null };
    global: {
      perTransactionLimitCents: number | null;
      dailySpendLimitCents: number | null;
      monthlySpendLimitCents: number | null;
      approvalThresholdCents: number | null;
    };
  };
  budget: { budgetCents: number; spentCents: number; remainingCents: number; spentTodayCents: number } | undefined;
  serverTime: string;
}

export class DashboardError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class DashboardClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/agent/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new DashboardError(res.status, data.error ?? `HTTP ${res.status}`);
    return data as T;
  }

  config(): Promise<AgentConfig> {
    return this.call("GET", "/config");
  }

  heartbeat(message?: string): Promise<{ ok: boolean; killSwitch: boolean; status: string }> {
    return this.call("POST", "/heartbeat", { message });
  }

  log(message: string, level: "info" | "warning" | "error" | "success" = "info"): Promise<unknown> {
    return this.call("POST", "/log", { message: message.slice(0, 2000), level });
  }

  async requestAction(action: string, amountCents: number, description: string): Promise<ActionRequest> {
    return (await this.call<{ request: ActionRequest }>("POST", "/actions", { action, amountCents, description })).request;
  }

  async getRequest(id: string): Promise<ActionRequest> {
    return (await this.call<{ request: ActionRequest }>("GET", `/actions/${encodeURIComponent(id)}`)).request;
  }

  async complete(id: string, actualAmountCents: number, note: string): Promise<ActionRequest> {
    return (await this.call<{ request: ActionRequest }>("POST", `/actions/${encodeURIComponent(id)}/complete`, { actualAmountCents, note })).request;
  }

  async cancel(id: string, note: string): Promise<ActionRequest> {
    return (await this.call<{ request: ActionRequest }>("POST", `/actions/${encodeURIComponent(id)}/cancel`, { note })).request;
  }

  /** Report sales. Send the breakdown when you have it so the P&L shows gross sales, refunds and fees. */
  reportRevenue(r: { grossSalesCents: number; refundsCents?: number; feesCents?: number; unitsSold?: number; note?: string } | { amountCents: number; note?: string }): Promise<unknown> {
    return this.call("POST", "/revenue", r);
  }

  /** Post a report; the dashboard routes it to this agent's Discord channel. */
  report(title: string, body: string, fields?: Array<{ name: string; value: string }>): Promise<unknown> {
    return this.call("POST", "/report", { title: title.slice(0, 200), body: body.slice(0, 4000), fields });
  }
}
