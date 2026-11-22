import type { ActionDef, InputField, OwnerTask, TaskCategory } from "./types.ts";

export interface AgentTemplate {
  role: string;
  name: string;
  description: string;
  responsibilities: string[];
  inputFields: InputField[];
  actions: ActionDef[];
  /** Suggested starting guardrails, in cents. */
  defaults: {
    perTransactionLimitCents: number | null;
    dailySpendLimitCents: number | null;
    approvalThresholdCents: number | null;
  };
}

const llmKey: InputField = {
  key: "llm_api_key",
  label: "LLM API key",
  kind: "secret",
  required: true,
  help: "Key for the model provider this agent runs on (e.g. an Anthropic API key).",
};

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    role: "orchestrator",
    name: "Orchestrator",
    description: "Coordinates the other agents, assigns work and sends you a regular report.",
    responsibilities: [
      "Break business goals into tasks for each agent",
      "Watch for stalled or failing agents",
      "Send the owner a weekly summary",
    ],
    inputFields: [
      llmKey,
      { key: "report_destination", label: "Where to send reports", kind: "text", required: true, placeholder: "Email, Slack channel, etc." },
      { key: "business_goals", label: "Business goals", kind: "textarea", required: true, placeholder: "e.g. Reach $5k/month revenue at 20% net margin within 6 months" },
    ],
    actions: [
      { key: "assign_task", label: "Assign a task to an agent", spends: false },
      { key: "send_owner_report", label: "Send owner report", spends: false },
    ],
    defaults: { perTransactionLimitCents: 0, dailySpendLimitCents: 0, approvalThresholdCents: null },
  },
  {
    role: "research",
    name: "Research",
    description: "Finds profitable niches, tracks competitors, prices and reviews.",
    responsibilities: [
      "Identify niches with demand and weak competition",
      "Track competitor pricing and review complaints",
      "Estimate unit economics before anything is bought",
    ],
    inputFields: [
      llmKey,
      { key: "research_tool_key", label: "Market data tool API key", kind: "secret", required: false, help: "Optional: Keepa, Jungle Scout, Helium 10, etc." },
      { key: "target_keywords", label: "Categories / keywords to research", kind: "textarea", required: true },
      { key: "target_margin_pct", label: "Minimum net margin (%)", kind: "number", required: true, placeholder: "20" },
    ],
    actions: [
      { key: "web_search", label: "Search the web", spends: false },
      { key: "buy_data_report", label: "Buy a paid data report", spends: true },
      { key: "publish_research", label: "Publish a research report", spends: false },
    ],
    defaults: { perTransactionLimitCents: 5000, dailySpendLimitCents: 10000, approvalThresholdCents: 2500 },
  },
  {
    role: "sourcing",
    name: "Sourcing",
    description: "Finds and vets suppliers, gets quotes and orders samples.",
    responsibilities: [
      "Find suppliers that meet required certifications",
      "Negotiate quotes and minimum order quantities",
      "Order samples and draft purchase orders",
    ],
    inputFields: [
      llmKey,
      { key: "supplier_platform_account", label: "Supplier platform account", kind: "text", required: true, placeholder: "e.g. Alibaba buyer account email" },
      { key: "supplier_platform_key", label: "Supplier platform API key", kind: "secret", required: false },
      { key: "required_certifications", label: "Required certifications", kind: "text", required: true, placeholder: "e.g. UL, ETL, FCC, CE" },
      { key: "target_unit_cost", label: "Target landed cost per unit ($)", kind: "number", required: true },
      { key: "ship_to_address", label: "Sample / inventory ship-to address", kind: "textarea", required: true },
    ],
    actions: [
      { key: "request_quote", label: "Request a supplier quote", spends: false },
      { key: "message_supplier", label: "Message a supplier", spends: false },
      { key: "order_samples", label: "Order samples", spends: true },
      { key: "place_purchase_order", label: "Place a purchase order", spends: true, approvalByDefault: true },
    ],
    defaults: { perTransactionLimitCents: 250000, dailySpendLimitCents: 300000, approvalThresholdCents: 20000 },
  },
  {
    role: "storefront",
    name: "Storefront & Listings",
    description: "Writes and publishes product listings, photos and prices.",
    responsibilities: [
      "Write titles, bullets and descriptions",
      "Commission product photography",
      "Keep prices competitive within margin targets",
    ],
    inputFields: [
      llmKey,
      { key: "marketplace", label: "Sales channel(s)", kind: "text", required: true, placeholder: "e.g. Amazon, Shopify, eBay" },
      { key: "seller_id", label: "Seller / store ID", kind: "text", required: true },
      { key: "marketplace_api_key", label: "Marketplace API credentials", kind: "secret", required: true },
      { key: "min_price", label: "Lowest allowed sale price ($)", kind: "number", required: true },
      { key: "brand_voice", label: "Brand voice & claims to avoid", kind: "textarea", required: false },
    ],
    actions: [
      { key: "draft_listing", label: "Draft a listing", spends: false },
      { key: "publish_listing", label: "Publish a listing", spends: false, approvalByDefault: true },
      { key: "update_price", label: "Update a price", spends: false },
      { key: "buy_photography", label: "Buy product photography", spends: true },
    ],
    defaults: { perTransactionLimitCents: 50000, dailySpendLimitCents: 50000, approvalThresholdCents: 10000 },
  },
  {
    role: "marketing",
    name: "Marketing & Ads",
    description: "Runs paid ads and promotions within a strict budget.",
    responsibilities: [
      "Create and manage ad campaigns",
      "Adjust bids toward the target ad cost of sale",
      "Pause campaigns that lose money",
    ],
    inputFields: [
      llmKey,
      { key: "ads_platform", label: "Ads platform(s)", kind: "text", required: true, placeholder: "e.g. Amazon Ads, Meta, Google" },
      { key: "ads_api_key", label: "Ads API credentials", kind: "secret", required: true },
      { key: "target_acos_pct", label: "Target ad cost of sale (%)", kind: "number", required: true, placeholder: "25" },
    ],
    actions: [
      { key: "create_campaign", label: "Create a campaign", spends: false, approvalByDefault: true },
      { key: "adjust_bids", label: "Adjust bids", spends: false },
      { key: "pause_campaign", label: "Pause a campaign", spends: false },
      { key: "ad_spend", label: "Spend on ads", spends: true },
    ],
    defaults: { perTransactionLimitCents: 10000, dailySpendLimitCents: 5000, approvalThresholdCents: 5000 },
  },
  {
    role: "support",
    name: "Customer Service",
    description: "Answers buyers, handles returns and protects your seller rating.",
    responsibilities: [
      "Reply to buyer messages quickly",
      "Process returns and small refunds",
      "Escalate anything unusual to the owner",
    ],
    inputFields: [
      llmKey,
      { key: "support_channel_key", label: "Support inbox / messaging credentials", kind: "secret", required: true },
      { key: "return_policy", label: "Return & refund policy", kind: "textarea", required: true },
      { key: "escalation_contact", label: "Escalation contact", kind: "text", required: true, placeholder: "Your email or phone" },
    ],
    actions: [
      { key: "reply_to_customer", label: "Reply to a customer", spends: false },
      { key: "issue_refund", label: "Issue a refund", spends: true },
      { key: "escalate_to_owner", label: "Escalate to owner", spends: false },
    ],
    defaults: { perTransactionLimitCents: 5000, dailySpendLimitCents: 20000, approvalThresholdCents: 3000 },
  },
  {
    role: "inventory",
    name: "Inventory & Fulfillment",
    description: "Forecasts demand, ships stock to fulfillment and reorders.",
    responsibilities: [
      "Forecast demand from sales velocity",
      "Create inbound shipments to the warehouse",
      "Draft reorders before stock runs out",
    ],
    inputFields: [
      llmKey,
      { key: "fulfillment_provider", label: "Fulfillment provider", kind: "text", required: true, placeholder: "e.g. Amazon FBA, ShipBob" },
      { key: "fulfillment_api_key", label: "Fulfillment API credentials", kind: "secret", required: true },
      { key: "reorder_point_units", label: "Reorder point (units)", kind: "number", required: true },
      { key: "lead_time_days", label: "Supplier lead time (days)", kind: "number", required: true },
    ],
    actions: [
      { key: "check_stock", label: "Check stock levels", spends: false },
      { key: "create_shipment", label: "Create an inbound shipment", spends: true },
      { key: "reorder_stock", label: "Reorder stock", spends: true, approvalByDefault: true },
    ],
    defaults: { perTransactionLimitCents: 300000, dailySpendLimitCents: 300000, approvalThresholdCents: 25000 },
  },
  {
    role: "finance",
    name: "Finance",
    description: "Keeps the books, reports revenue and flags unprofitable products.",
    responsibilities: [
      "Categorize every transaction",
      "Report revenue back to this dashboard",
      "Produce profit & loss and flag losing products",
    ],
    inputFields: [
      llmKey,
      { key: "bookkeeping_api_key", label: "Bookkeeping API key", kind: "secret", required: true, help: "e.g. QuickBooks or Xero" },
      { key: "bank_feed_token", label: "Read-only bank feed token", kind: "secret", required: false },
      { key: "tax_notes", label: "Tax notes from your accountant", kind: "textarea", required: false },
    ],
    actions: [
      { key: "categorize_transactions", label: "Categorize transactions", spends: false },
      { key: "report_revenue", label: "Report revenue", spends: false },
      { key: "generate_pnl", label: "Generate profit & loss", spends: false },
      { key: "pay_invoice", label: "Pay an invoice", spends: true, approvalByDefault: true },
    ],
    defaults: { perTransactionLimitCents: 100000, dailySpendLimitCents: 100000, approvalThresholdCents: 1 },
  },
];

export function findTemplate(role: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find((t) => t.role === role);
}

export const CUSTOM_ROLE = "custom";

export const DEFAULT_TASKS: Array<{ title: string; description: string; category: TaskCategory }> = [
  { category: "product", title: "Define your business and product", description: "Fill in the business profile so every agent knows what you sell and to whom." },
  { category: "legal", title: "Form a legal entity (e.g. LLC)", description: "Marketplaces, banks and payment processors require a legally responsible business and owner." },
  { category: "legal", title: "Get a tax ID (EIN or local equivalent)", description: "Needed for the bank account, seller accounts and tax filing." },
  { category: "finance", title: "Open a business bank account", description: "Keep business money separate. This is where funding and revenue live." },
  { category: "legal", title: "Get product liability insurance", description: "Protects you if a product causes harm. Some marketplaces require it." },
  { category: "product", title: "Confirm product safety & compliance", description: "Check which certifications your product needs (e.g. UL/ETL for electrical, CPSC, FCC) and require them from suppliers." },
  { category: "legal", title: "Register for sales tax", description: "Register where you have nexus; marketplaces collect in many places but not all." },
  { category: "sales", title: "Create seller / store accounts", description: "Identity verification must be done by you. Then give the Storefront agent its API credentials." },
  { category: "finance", title: "Set up a payment method for agent spending", description: "A card or account with a hard limit that agents' tools charge to. Never give agents unlimited cards." },
  { category: "operations", title: "Choose a fulfillment method", description: "e.g. Amazon FBA or a 3PL so you never handle inventory." },
  { category: "product", title: "Approve product samples yourself", description: "Physically check quality and safety before the first bulk order." },
  { category: "operations", title: "Set guardrails before activating agents", description: "Spending caps, approval thresholds and the kill switch on the Guardrails page." },
  { category: "finance", title: "Fund the project", description: "Deposit a starting budget and allocate it to agents on the Funding page. Start small." },
  { category: "operations", title: "Review the weekly report", description: "Read the orchestrator's report and the profit numbers every week. Scale only what is profitable." },
];

export function makeDefaultTasks(newId: () => string): OwnerTask[] {
  return DEFAULT_TASKS.map((t) => ({
    id: newId(),
    title: t.title,
    description: t.description,
    category: t.category,
    status: "todo",
    notes: "",
    custom: false,
    completedAt: null,
  }));
}
