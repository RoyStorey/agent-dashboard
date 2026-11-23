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
  /** Selected places to sell (keys from shared/channels.ts), primary first. */
  channels: string[];
  /** Reused to auto-fill agent inputs (escalation contact, ship-to address). */
  ownerName: string;
  ownerEmail: string;
  shippingAddress: string;
  /** How the owner chose the product: typed it in, or picked an AI research idea. */
  productSource: "manual" | "research" | null;
  /**
   * Who ships orders: the owner from home ("self"), a fulfillment company such
   * as ShipBob ("provider"), or the marketplace itself, e.g. Amazon FBA
   * ("marketplace"). null = not decided.
   */
  fulfillmentMode: FulfillmentMode | null;
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
  /** Fixed fees per order (card fee, listing renewal), assuming one unit per order. */
  perOrderFeeCents: Cents;
  adSpendBps: number;
  returnRateBps: number;
  fixedMonthlyCents: Cents;
  monthlyUnits: number;
}

export type SpendCategory = "inventory" | "samples" | "shipping" | "advertising" | "refunds" | "software" | "fees" | "other";

export type InputKind = "text" | "secret" | "number" | "url" | "textarea";

export type FulfillmentMode = "self" | "provider" | "marketplace";

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
  /** Name of a suggestion the dashboard can auto-fill (see server/inputs.ts). */
  suggest?: string;
  /** Not needed when the owner ships orders themselves (e.g. a fulfillment company's key). */
  notNeededWhenSelfShipping?: boolean;
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
  /** True if this action sets a selling price; the dashboard enforces the price floor. */
  setsPrice?: boolean;
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
  /** Template action keys this agent has been offered, so upgrades add new ones once and never re-add ones you removed. */
  seenTemplateActions?: string[];
  /** When the built-in runner checks this agent for new work. */
  schedule: AgentSchedule;
  /** Live status for the team board. */
  runtime: AgentRuntime;
}

export interface AgentSchedule {
  enabled: boolean;
  /** How often to check for new work. A check that finds nothing new costs nothing. */
  everyMinutes: number;
  /** Most model runs per day (a cost cap). "Run now" is not limited. */
  maxRunsPerDay: number;
}

export interface AgentRuntime {
  state: "working" | "idle";
  /** What it is doing right now, e.g. "Creating product draft: …". */
  step: string | null;
  runId: string | null;
  since: string | null;
  lastRunAt: string | null;
  lastCheckedAt: string | null;
  /** Why the last check didn't start a run, e.g. "Nothing new since the last run". */
  lastSkip: string | null;
  nextCheckAt: string | null;
}

/* ---------- The team: phases, notebook, runs, store drafts ---------- */

export type Phase = "research" | "sourcing" | "store" | "launch" | "operate";

export interface TeamPlan {
  phase: Phase;
  /** The Orchestrator's current brief for the whole team. */
  brief: string;
  /** When the team last moved to a new phase. */
  phaseSince: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** One entry in the shared team notebook. */
export interface NoteEntry {
  id: string;
  at: string;
  author: string;
  authorId: string | null;
  /** Agent roles it is for, "all", or "owner". */
  to: string[];
  text: string;
}

export interface RunStep {
  at: string;
  text: string;
}

export interface AgentRun {
  id: string;
  agentId: string;
  trigger: "schedule" | "manual";
  /** Why it ran, e.g. "2 new notes for you". */
  reason: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "done" | "stopped" | "error";
  steps: RunStep[];
  summary: string;
  costCents: Cents;
  inputTokens: number;
  outputTokens: number;
  error: string | null;
}

/** Something the Storefront agent created in Shopify as a hidden draft, waiting for the owner. */
export interface StoreDraft {
  id: string;
  agentId: string;
  kind: "product" | "page";
  title: string;
  shopifyId: string;
  priceCents: Cents | null;
  preview: string;
  status: "pending" | "published" | "rejected";
  createdAt: string;
  decidedAt: string | null;
  note: string;
}

export interface GlobalGuardrails {
  /** When on, every agent request is denied. */
  killSwitch: boolean;
  perTransactionLimitCents: Cents | null;
  dailySpendLimitCents: Cents | null;
  monthlySpendLimitCents: Cents | null;
  /** Any spend at or above this amount needs owner approval. null = never by amount. */
  approvalThresholdCents: Cents | null;
  /** Estimated AI model usage allowed per calendar month. null = no cap. */
  aiMonthlyLimitCents: Cents | null;
}

/** One report of AI model usage (tokens) and its estimated cost. */
export interface AiUsageEntry {
  id: string;
  at: string;
  agentId: string | null;
  label: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
  costCents: Cents;
}

export interface SecuritySettings {
  /** scrypt hash of the dashboard password (hex), or null when no password is set. */
  passwordHash: string | null;
  passwordSalt: string | null;
  passwordUpdatedAt: string | null;
}

export type TaskStatus = "todo" | "done";
export type TaskCategory = "legal" | "finance" | "money" | "sales" | "product" | "operations" | "custom";

/**
 * How a step relates to real money:
 * - "moves": real money changes hands (bank transfers, cards, billing).
 * - "reads": connects to a real account read-only; it can see money but cannot move it.
 * - "records": accounting only; numbers are written down in the dashboard, nothing moves.
 */
export type MoneyKind = "moves" | "reads" | "records";

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
  /** How this step relates to real money (null = paperwork, no money involved). */
  money: MoneyKind | null;
  /** Set when the step can't be done until a dashboard feature exists. */
  waitsFor: string | null;
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
  /** For price-setting actions: the price the agent wants to set. */
  priceCents?: Cents | null;
  /** Extra details the dashboard acts on after approval (e.g. the phase to move to). */
  meta?: Record<string, string>;
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

/* ---------- Shipping it yourself ---------- */

export type ShipmentStatus = "to_pack" | "packed" | "shipped" | "cancelled";

export interface ShipmentItem {
  name: string;
  qty: number;
  /** Stock-at-home item this uses up when shipped (optional). */
  supplyId?: string | null;
}

/** One order the owner packs and ships by hand. */
export interface Shipment {
  id: string;
  orderRef: string;
  channel: string;
  recipientName: string;
  /** Full mailing address, one line per row. Stored only on this computer. */
  address: string;
  items: ShipmentItem[];
  /** e.g. "Poly mailer 10×13 in". */
  packaging: string;
  /** Packaging item in stock at home that this uses up (optional). */
  packagingSupplyId: string | null;
  /** e.g. "USPS Ground Advantage". */
  service: string;
  notes: string;
  status: ShipmentStatus;
  trackingNumber: string;
  createdAt: string;
  createdBy: string;
  packedAt: string | null;
  shippedAt: string | null;
}

/** Something the owner keeps at home: product units or packing supplies. */
export interface SupplyItem {
  id: string;
  name: string;
  kind: "product" | "packaging";
  unit: string;
  onHand: number;
  /** Order more when on hand falls to this. */
  reorderAt: number;
  /** How many to buy when reordering. */
  reorderQty: number;
  /** Used up automatically for every shipment (e.g. 1 label per package). */
  usedPerShipment: number;
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
  /** A photo of the product the research actually saw, or "" (older results may not have it). */
  imageUrl?: string;
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
  aiUsage: AiUsageEntry[];
  security: SecuritySettings;
  shipments: Shipment[];
  supplies: SupplyItem[];
  shopify: ShopifySettings;
  plan: TeamPlan;
  notebook: NoteEntry[];
  runs: AgentRun[];
  drafts: StoreDraft[];
}

/** Connection to the owner's Shopify store (credentials live in the vault as "shopify_admin"). */
export interface ShopifySettings {
  /** Import paid, unshipped orders into Pack & ship every few minutes. */
  autoSync: boolean;
  /** Set after a successful connection test. */
  shopName: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastSyncAdded: number;
  lastError: string | null;
  lastErrorAt: string | null;
}

/* ---------- Computed views sent to the client ---------- */

export interface AgentFinance {
  agentId: string;
  budgetCents: Cents;
  spentCents: Cents;
  remainingCents: Cents;
  spentTodayCents: Cents;
  aiThisMonthCents: Cents;
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
  aiThisMonthCents: Cents;
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
  | "settings"
  | "money"
  | "shipping";

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
  /** Most recent usage reports (newest first). */
  aiUsage: AiUsageEntry[];
  /** AI cost per local day, covering all reports (for period totals). */
  aiUsageDaily: Array<{ at: string; costCents: Cents }>;
  security: { passwordSet: boolean };
  /** Open shipments plus the 50 most recent finished ones, newest first. */
  shipments: Shipment[];
  supplies: SupplyItem[];
  shopify: ShopifySettings;
  plan: TeamPlan;
  /** Newest first. */
  notebook: NoteEntry[];
  /** Newest first, the last 100 runs. */
  runs: AgentRun[];
  drafts: StoreDraft[];
  guardrails: GlobalGuardrails;
  funding: FundingEntry[];
  requests: ActionRequest[];
  activity: ActivityEntry[];
  finance: FinanceSummary;
  ownerActions: OwnerAction[];
  readiness: AgentReadiness[];
  serverTime: string;
}
