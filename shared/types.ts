/**
 * Shared domain model for the dashboard. All money is stored as integer cents
 * to avoid floating point rounding errors.
 */

export type Cents = number;

export interface BusinessProfile {
  name: string;
  product: string;
  description: string;
  targetMarket: string;
  salesChannels: string;
  /** Reused to auto-fill agent inputs (escalation contact, ship-to address). */
  ownerName: string;
  ownerEmail: string;
  shippingAddress: string;
  /** How the owner chose the product: typed it in, or picked an AI research idea. */
  productSource: "manual" | "research" | null;
}

/**
 * Planned unit economics. Money is integer cents; percentages are integer
 * basis points (1500 = 15.00%) so all math stays exact.
 */
export interface UnitEconomics {
  salePriceCents: Cents;
  unitCostCents: Cents;
  inboundShippingCents: Cents;
  otherPerUnitCents: Cents;
  fulfillmentFeeCents: Cents;
  marketplaceFeeBps: number;
  paymentFeeBps: number;
  adSpendBps: number;
  returnRateBps: number;
  fixedMonthlyCents: Cents;
  monthlyUnits: number;
}

export type SpendCategory = "inventory" | "samples" | "shipping" | "advertising" | "refunds" | "software" | "fees" | "other";

export type InputKind = "text" | "secret" | "number" | "url" | "textarea";

export interface InputField {
  key: string;
  label: string;
  kind: InputKind;
  required: boolean;
  help?: string;
  placeholder?: string;
  /**
   * Credentials-vault keys that can supply this value, in priority order.
   * "llm" means "the key for this agent's model provider".
   */
  vault?: string[];
  /** Name of a suggestion the dashboard can auto-fill (see server/autofill.ts). */
  suggest?: string;
}

export interface ActionDef {
  key: string;
  label: string;
  /** True if this action can spend money (requests may carry an amount). */
  spends: boolean;
  /** True if new agents of this role require owner approval for this action by default. */
  approvalByDefault?: boolean;
  /** Where spending on this action lands in the profit & loss statement. */
  category?: SpendCategory;
}

export type AgentStatus = "draft" | "active" | "paused";

export interface AgentGuardrails {
  /** Max a single request may spend. null = no agent-level limit. */
  perTransactionLimitCents: Cents | null;
  /** Max this agent may spend per calendar day. null = no agent-level limit. */
  dailySpendLimitCents: Cents | null;
  /** Spending requests at or above this amount need owner approval. null = never by amount. */
  approvalThresholdCents: Cents | null;
  /** Action keys this agent may perform at all. */
  allowedActions: string[];
  /** Action keys that always need owner approval, regardless of amount. */
  approvalRequiredActions: string[];
}

export interface AgentConnection {
  provider: string;
  model: string;
  /** Where the agent runs (free text: "my laptop cron job", a URL, etc.). */
  runtime: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  description: string;
  status: AgentStatus;
  connection: AgentConnection;
  inputFields: InputField[];
  inputs: Record<string, string>;
  responsibilities: string[];
  actions: ActionDef[];
  guardrails: AgentGuardrails;
  /** Total funding allocated to this agent (lifetime). */
  budgetCents: Cents;
  apiToken: string;
  createdAt: string;
  lastSeenAt: string | null;
  lastStatusMessage: string | null;
}

export interface GlobalGuardrails {
  /** When on, every agent request is denied. */
  killSwitch: boolean;
  perTransactionLimitCents: Cents | null;
  dailySpendLimitCents: Cents | null;
  monthlySpendLimitCents: Cents | null;
  /** Any spend at or above this amount needs owner approval. null = never by amount. */
  approvalThresholdCents: Cents | null;
}

export type TaskStatus = "todo" | "done";
export type TaskCategory = "legal" | "finance" | "sales" | "product" | "operations" | "custom";

export interface TaskLink {
  label: string;
  url: string;
}

export interface OwnerTask {
  id: string;
  title: string;
  description: string;
  category: TaskCategory;
  status: TaskStatus;
  notes: string;
  custom: boolean;
  completedAt: string | null;
  /** Exact steps to follow. */
  steps: string[];
  /** Direct links for doing it. */
  links: TaskLink[];
  /** Rough time it takes, e.g. "15 min". */
  time: string;
  /** Matches the built-in task definition, so text can be refreshed on upgrade. */
  templateKey: string | null;
}

export type FundingType = "deposit" | "withdrawal" | "revenue";

export interface FundingEntry {
  id: string;
  type: FundingType;
  /** For revenue: the net payout that reached the business (gross - refunds - fees). */
  amountCents: Cents;
  note: string;
  agentId: string | null;
  createdAt: string;
  /** Optional revenue breakdown. When absent, gross = amountCents and fees/refunds = 0. */
  grossSalesCents?: Cents;
  refundsCents?: Cents;
  feesCents?: Cents;
  unitsSold?: number;
}

export type RequestStatus =
  | "approved"
  | "pending_approval"
  | "denied"
  | "rejected"
  | "completed"
  | "cancelled";

export interface ActionRequest {
  id: string;
  agentId: string;
  action: string;
  description: string;
  amountCents: Cents;
  /** Set when completed; may be lower than amountCents. */
  actualAmountCents: Cents | null;
  status: RequestStatus;
  reasons: string[];
  createdAt: string;
  decidedAt: string | null;
  decidedBy: "guardrails" | "owner" | null;
  closedAt: string | null;
  resultNote: string;
}

export type ActivityLevel = "info" | "warning" | "error" | "success";

export type ActivityKind =
  | "owner"
  | "log"
  | "report"
  | "request_approved"
  | "request_pending"
  | "request_denied"
  | "request_closed"
  | "revenue"
  | "system";

export interface ActivityEntry {
  id: string;
  at: string;
  actor: string;
  level: ActivityLevel;
  message: string;
  kind?: ActivityKind;
  agentId?: string | null;
  /** Extra detail for rich notifications (Discord embeds). */
  title?: string;
  fields?: Array<{ name: string; value: string }>;
  /** Money involved, if any. */
  amountCents?: number;
}

/* ---------- Credentials vault ---------- */

export interface VaultEntry {
  value: string;
  updatedAt: string;
  /** Only for custom entries; catalog entries take their label from the catalog. */
  label?: string;
}

/* ---------- Discord ---------- */

export interface DiscordSettings {
  enabled: boolean;
  /** HQ channel: approvals, finance summaries, owner and system events. */
  defaultWebhookUrl: string;
  /** Per-agent (per-team) channel webhooks. Falls back to the default. */
  agentWebhooks: Record<string, string>;
  events: {
    approvals: boolean;
    denials: boolean;
    spending: boolean;
    revenue: boolean;
    reports: boolean;
    agentLogs: "all" | "important" | "none";
    dailySummary: boolean;
  };
  /** Local hour (0-23) to post the daily finance summary. */
  dailySummaryHour: number;
  lastDailySummaryDate: string | null;
  /** Optional text added to approval requests, e.g. "@here" or "<@123456789>". */
  approvalMention: string;
}

/* ---------- Budget allocation ---------- */

export interface AllocationSettings {
  /** Automatically split new deposits and revenue across agents. */
  auto: boolean;
  /** Share of cash always kept unallocated, in basis points. */
  reserveBps: number;
  /** Per-agent weight overrides (relative numbers). Missing = role default. */
  weights: Record<string, number>;
}

/* ---------- AI product research ---------- */

export interface ResearchBrief {
  budgetCents: Cents;
  interests: string;
  avoid: string;
  channels: string;
  location: string;
}

export interface ProductIdea {
  title: string;
  product: string;
  niche: string;
  targetAudience: string;
  whyNow: string;
  salesChannels: string;
  competition: "low" | "medium" | "high";
  salePriceCents: Cents;
  unitCostCents: Cents;
  inboundShippingCents: Cents;
  fulfillmentFeeCents: Cents;
  marketplaceFeeBps: number;
  estimatedMonthlyUnits: number;
  startupCostCents: Cents;
  compliance: string[];
  risks: string[];
  keywords: string[];
  sources: Array<{ title: string; url: string }>;
}

export interface ResearchJob {
  id: string;
  status: "running" | "done" | "error";
  brief: ResearchBrief;
  startedAt: string;
  finishedAt: string | null;
  summary: string;
  ideas: ProductIdea[];
  error: string | null;
  /** Index of the idea the owner chose, if any. */
  chosenIndex: number | null;
}

export interface DashboardState {
  version: 2;
  business: BusinessProfile;
  economics: UnitEconomics;
  tasks: OwnerTask[];
  agents: Agent[];
  guardrails: GlobalGuardrails;
  funding: FundingEntry[];
  requests: ActionRequest[];
  activity: ActivityEntry[];
  vault: Record<string, VaultEntry>;
  discord: DiscordSettings;
  allocation: AllocationSettings;
  research: ResearchJob[];
}

/* ---------- Computed views sent to the client ---------- */

export interface AgentFinance {
  agentId: string;
  budgetCents: Cents;
  spentCents: Cents;
  remainingCents: Cents;
  spentTodayCents: Cents;
}

export interface FinanceSummary {
  depositedCents: Cents;
  withdrawnCents: Cents;
  revenueCents: Cents;
  spentCents: Cents;
  cashBalanceCents: Cents;
  allocatedRemainingCents: Cents;
  unallocatedCents: Cents;
  spentTodayCents: Cents;
  spentThisMonthCents: Cents;
  profitCents: Cents;
  agents: AgentFinance[];
}

export type OwnerActionSeverity = "blocker" | "warning" | "info";

export interface OwnerAction {
  id: string;
  severity: OwnerActionSeverity;
  title: string;
  detail: string;
  /** Section of the dashboard to open to resolve it. */
  section: SectionKey;
  agentId?: string;
}

export type SectionKey =
  | "overview"
  | "todo"
  | "agents"
  | "guardrails"
  | "funding"
  | "approvals"
  | "activity"
  | "business"
  | "setup"
  | "financials"
  | "credentials"
  | "integrations"
  | "settings";

export interface AgentReadiness {
  agentId: string;
  missingInputs: string[];
  /** Missing inputs that a credentials-vault entry could supply. */
  missingVaultKeys: string[];
  needsBudget: boolean;
  ready: boolean;
}

/** Where an agent's input value comes from. */
export type InputSource = { type: "manual" } | { type: "vault"; key: string } | { type: "none" };

/** Agent as the owner UI sees it: secrets and token are masked. */
export interface AgentView extends Omit<Agent, "apiToken" | "inputs"> {
  /** Manually entered values (secrets blanked). */
  inputs: Record<string, string>;
  /** True if a manual secret value is saved. */
  secretsSet: Record<string, boolean>;
  /** Where each field's effective value comes from. */
  inputSources: Record<string, InputSource>;
  apiTokenPreview: string;
}

export interface VaultView {
  key: string;
  set: boolean;
  preview: string;
  updatedAt: string;
  label?: string;
}

export interface DiscordView extends Omit<DiscordSettings, "defaultWebhookUrl" | "agentWebhooks"> {
  defaultWebhookSet: boolean;
  defaultWebhookPreview: string;
  /** agentId -> masked preview of that agent's webhook. */
  agentWebhooksSet: Record<string, string>;
  lastError: string | null;
  lastErrorAt: string | null;
  sentCount: number;
}

export interface StateResponse {
  business: BusinessProfile;
  economics: UnitEconomics;
  tasks: OwnerTask[];
  agents: AgentView[];
  vault: VaultView[];
  discord: DiscordView;
  allocation: AllocationSettings;
  research: ResearchJob[];
  guardrails: GlobalGuardrails;
  funding: FundingEntry[];
  requests: ActionRequest[];
  activity: ActivityEntry[];
  finance: FinanceSummary;
  ownerActions: OwnerAction[];
  readiness: AgentReadiness[];
  serverTime: string;
}
