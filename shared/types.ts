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
}

export type InputKind = "text" | "secret" | "number" | "url" | "textarea";

export interface InputField {
  key: string;
  label: string;
  kind: InputKind;
  required: boolean;
  help?: string;
  placeholder?: string;
}

export interface ActionDef {
  key: string;
  label: string;
  /** True if this action can spend money (requests may carry an amount). */
  spends: boolean;
  /** True if new agents of this role require owner approval for this action by default. */
  approvalByDefault?: boolean;
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

export interface OwnerTask {
  id: string;
  title: string;
  description: string;
  category: TaskCategory;
  status: TaskStatus;
  notes: string;
  custom: boolean;
  completedAt: string | null;
}

export type FundingType = "deposit" | "withdrawal" | "revenue";

export interface FundingEntry {
  id: string;
  type: FundingType;
  amountCents: Cents;
  note: string;
  agentId: string | null;
  createdAt: string;
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

export interface ActivityEntry {
  id: string;
  at: string;
  actor: string;
  level: ActivityLevel;
  message: string;
}

export interface DashboardState {
  version: 1;
  business: BusinessProfile;
  tasks: OwnerTask[];
  agents: Agent[];
  guardrails: GlobalGuardrails;
  funding: FundingEntry[];
  requests: ActionRequest[];
  activity: ActivityEntry[];
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
  | "business";

export interface AgentReadiness {
  agentId: string;
  missingInputs: string[];
  needsBudget: boolean;
  ready: boolean;
}

/** Agent as the owner UI sees it: secrets and token are masked. */
export interface AgentView extends Omit<Agent, "apiToken" | "inputs"> {
  inputs: Record<string, string>;
  secretsSet: Record<string, boolean>;
  apiTokenPreview: string;
}

export interface StateResponse {
  business: BusinessProfile;
  tasks: OwnerTask[];
  agents: AgentView[];
  guardrails: GlobalGuardrails;
  funding: FundingEntry[];
  requests: ActionRequest[];
  activity: ActivityEntry[];
  finance: FinanceSummary;
  ownerActions: OwnerAction[];
  readiness: AgentReadiness[];
  serverTime: string;
}
