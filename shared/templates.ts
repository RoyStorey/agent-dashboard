import { findChannel, type ChannelDef } from "./channels.ts";
import type { ActionDef, DashboardState, InputField, MoneyKind, OwnerTask, TaskCategory, TaskLink } from "./types.ts";

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
  /** Default share of auto-allocated funding (relative weight). */
  budgetWeight: number;
  /** Why it gets that share, shown next to the allocation. */
  budgetReason: string;
}

/** Store/marketplace credentials; the selected sales channels decide which one is used. */
const STORE_KEYS = ["amazon_sp_api", "shopify_admin", "etsy_api", "ebay_api", "walmart_api"] as const;

const llmKey: InputField = {
  key: "llm_api_key",
  label: "AI model API key",
  kind: "secret",
  required: true,
  vault: ["llm"],
  help: "Filled automatically from Credentials for this agent's model provider.",
};

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    role: "orchestrator",
    name: "Orchestrator",
    description: "Coordinates the other agents, assigns work and posts the team report to Discord.",
    responsibilities: [
      "Break business goals into tasks for each agent",
      "Watch for stalled or failing agents",
      "Post a weekly summary to the HQ Discord channel",
    ],
    inputFields: [llmKey, { key: "business_goals", label: "Business goals", kind: "textarea", required: true, suggest: "business_goals" }],
    actions: [
      { key: "assign_task", label: "Assign a task to an agent", spends: false },
      { key: "send_owner_report", label: "Send owner report", spends: false },
      { key: "advance_phase", label: "Move the team to the next phase", spends: false, approvalByDefault: true },
    ],
    defaults: { perTransactionLimitCents: 0, dailySpendLimitCents: 0, approvalThresholdCents: null },
    budgetWeight: 0,
    budgetReason: "Coordinates only; spends nothing.",
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
      { key: "research_tool_key", label: "Market data tool API key", kind: "secret", required: false, vault: ["keepa"], help: "Optional: Keepa or similar." },
      { key: "target_keywords", label: "Categories / keywords to research", kind: "textarea", required: true, suggest: "keywords" },
      { key: "target_margin_pct", label: "Minimum net margin (%)", kind: "number", required: true, suggest: "target_margin" },
    ],
    actions: [
      { key: "web_search", label: "Search the web", spends: false },
      { key: "buy_data_report", label: "Buy a paid data report", spends: true, category: "software" },
      { key: "publish_research", label: "Publish a research report", spends: false },
    ],
    defaults: { perTransactionLimitCents: 5000, dailySpendLimitCents: 10000, approvalThresholdCents: 2500 },
    budgetWeight: 3,
    budgetReason: "Occasional paid data reports.",
  },
  {
    role: "sourcing",
    name: "Sourcing",
    description: "Finds and vets suppliers, gets quotes, orders samples and the first inventory.",
    responsibilities: [
      "Find suppliers that meet required certifications",
      "Negotiate quotes and minimum order quantities",
      "Order samples and draft purchase orders",
    ],
    inputFields: [
      llmKey,
      { key: "supplier_platform_account", label: "Supplier platform account", kind: "text", required: true, vault: ["alibaba_account"] },
      { key: "required_certifications", label: "Required certifications", kind: "text", required: true, suggest: "certifications" },
      { key: "target_unit_cost", label: "Target cost per unit ($)", kind: "number", required: true, suggest: "unit_cost" },
      { key: "ship_to_address", label: "Sample / inventory ship-to address", kind: "textarea", required: true, suggest: "ship_to" },
    ],
    actions: [
      { key: "request_quote", label: "Request a supplier quote", spends: false },
      { key: "message_supplier", label: "Message a supplier", spends: false },
      { key: "order_samples", label: "Order samples", spends: true, category: "samples" },
      { key: "place_purchase_order", label: "Place a purchase order", spends: true, approvalByDefault: true, category: "inventory" },
    ],
    defaults: { perTransactionLimitCents: 250000, dailySpendLimitCents: 300000, approvalThresholdCents: 20000 },
    budgetWeight: 45,
    budgetReason: "Samples and the first inventory order are the biggest launch cost.",
  },
  {
    role: "storefront",
    name: "Storefront & Listings",
    description: "Writes and publishes product listings, photos and prices.",
    responsibilities: [
      "Write titles, bullets and descriptions",
      "Commission product photography",
      "Keep prices above the break-even price",
    ],
    inputFields: [
      llmKey,
      { key: "marketplace", label: "Sales channel(s)", kind: "text", required: true, suggest: "channels" },
      { key: "marketplace_api_key", label: "Store / marketplace API credentials", kind: "secret", required: true, vault: [...STORE_KEYS] },
      { key: "min_price", label: "Lowest allowed sale price ($)", kind: "number", required: true, suggest: "min_price" },
      { key: "brand_voice", label: "Brand voice & claims to avoid", kind: "textarea", required: false, suggest: "brand_voice" },
    ],
    actions: [
      { key: "draft_listing", label: "Draft a listing", spends: false },
      { key: "publish_listing", label: "Publish a listing", spends: false, approvalByDefault: true, setsPrice: true },
      { key: "update_price", label: "Update a price", spends: false, approvalByDefault: true, setsPrice: true },
      { key: "buy_photography", label: "Buy product photography", spends: true, category: "advertising" },
    ],
    defaults: { perTransactionLimitCents: 50000, dailySpendLimitCents: 50000, approvalThresholdCents: 10000 },
    budgetWeight: 5,
    budgetReason: "Product photos and listing assets.",
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
      { key: "ads_platform", label: "Ads platform(s)", kind: "text", required: true, suggest: "ads_platform" },
      { key: "ads_api_key", label: "Ads API credentials", kind: "secret", required: true, vault: ["amazon_ads_api", "meta_ads"] },
      { key: "target_acos_pct", label: "Target ad cost of sale (%)", kind: "number", required: true, suggest: "acos" },
    ],
    actions: [
      { key: "create_campaign", label: "Create a campaign", spends: false, approvalByDefault: true },
      { key: "adjust_bids", label: "Adjust bids", spends: false },
      { key: "pause_campaign", label: "Pause a campaign", spends: false },
      { key: "ad_spend", label: "Spend on ads", spends: true, category: "advertising" },
    ],
    defaults: { perTransactionLimitCents: 10000, dailySpendLimitCents: 5000, approvalThresholdCents: 5000 },
    budgetWeight: 20,
    budgetReason: "Launch ads to get the first sales and reviews.",
  },
  {
    role: "support",
    name: "Customer Service",
    description: "Answers buyers, handles returns and protects your seller rating.",
    responsibilities: ["Reply to buyer messages quickly", "Process returns and small refunds", "Escalate anything unusual to the owner"],
    inputFields: [
      llmKey,
      { key: "support_channel_key", label: "Buyer messaging credentials", kind: "secret", required: true, vault: [...STORE_KEYS] },
      { key: "return_policy", label: "Return & refund policy", kind: "textarea", required: true, suggest: "return_policy" },
      { key: "escalation_contact", label: "Escalation contact", kind: "text", required: true, suggest: "owner_contact" },
    ],
    actions: [
      { key: "reply_to_customer", label: "Reply to a customer", spends: false },
      { key: "issue_refund", label: "Issue a refund", spends: true, category: "refunds" },
      { key: "escalate_to_owner", label: "Escalate to owner", spends: false },
    ],
    defaults: { perTransactionLimitCents: 5000, dailySpendLimitCents: 20000, approvalThresholdCents: 3000 },
    budgetWeight: 5,
    budgetReason: "Small refunds and goodwill credits.",
  },
  {
    role: "inventory",
    name: "Inventory & Fulfillment",
    description: "Forecasts demand, keeps stock and packing supplies topped up, and tells you what to pack and ship.",
    responsibilities: [
      "Forecast demand from sales velocity",
      "Queue every new order with exact packing instructions when you ship yourself",
      "Order packing supplies and reorder stock before they run out",
      "Create inbound shipments when a fulfillment company is used",
    ],
    inputFields: [
      llmKey,
      { key: "fulfillment_provider", label: "Fulfillment provider", kind: "text", required: true, suggest: "fulfillment" },
      {
        key: "fulfillment_api_key",
        label: "Fulfillment API credentials",
        kind: "secret",
        required: true,
        vault: ["amazon_sp_api", "shipbob"],
        notNeededWhenSelfShipping: true,
        help: "Not needed while you ship orders yourself.",
      },
      { key: "reorder_point_units", label: "Reorder point (units)", kind: "number", required: true, suggest: "reorder_point" },
      { key: "lead_time_days", label: "Supplier lead time (days)", kind: "number", required: true, suggest: "lead_time" },
    ],
    actions: [
      { key: "check_stock", label: "Check stock levels", spends: false },
      { key: "create_shipment", label: "Create an inbound shipment", spends: true, category: "shipping" },
      { key: "reorder_stock", label: "Reorder stock", spends: true, approvalByDefault: true, category: "inventory" },
      { key: "order_supplies", label: "Order packing supplies", spends: true, approvalByDefault: true, category: "shipping" },
    ],
    defaults: { perTransactionLimitCents: 300000, dailySpendLimitCents: 300000, approvalThresholdCents: 25000 },
    budgetWeight: 15,
    budgetReason: "Freight to the warehouse and the first reorder.",
  },
  {
    role: "finance",
    name: "Finance",
    description: "Keeps the books, reports revenue and flags unprofitable products.",
    responsibilities: ["Categorize every transaction", "Report sales and payouts back to this dashboard", "Produce profit & loss and flag losing products"],
    inputFields: [
      llmKey,
      { key: "bookkeeping_api_key", label: "Bookkeeping API credentials", kind: "secret", required: true, vault: ["quickbooks"] },
      { key: "sales_data_key", label: "Sales data credentials", kind: "secret", required: false, vault: [...STORE_KEYS], help: "Lets it read payouts to report revenue." },
    ],
    actions: [
      { key: "categorize_transactions", label: "Categorize transactions", spends: false },
      { key: "report_revenue", label: "Report revenue", spends: false },
      { key: "generate_pnl", label: "Generate profit & loss", spends: false },
      { key: "pay_invoice", label: "Pay an invoice", spends: true, approvalByDefault: true, category: "other" },
    ],
    defaults: { perTransactionLimitCents: 100000, dailySpendLimitCents: 100000, approvalThresholdCents: 1 },
    budgetWeight: 7,
    budgetReason: "Bills such as software subscriptions and services.",
  },
];

export function findTemplate(role: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find((t) => t.role === role);
}

export const CUSTOM_ROLE = "custom";
export const CUSTOM_BUDGET_WEIGHT = 5;

/** The team added by "Add recommended team". */
export const RECOMMENDED_ROLES = AGENT_TEMPLATES.map((t) => t.role);

/** Default category for spending actions on agents saved before categories existed. */
export function actionCategory(def: ActionDef | undefined, key: string): import("./types.ts").SpendCategory {
  if (def?.category) return def.category;
  for (const t of AGENT_TEMPLATES) {
    const a = t.actions.find((x) => x.key === key);
    if (a?.category) return a.category;
  }
  return "other";
}

/* ---------------- Owner tasks ---------------- */

export interface TaskTemplate {
  key: string;
  title: string;
  description: string;
  category: TaskCategory;
  steps: string[];
  links: TaskLink[];
  time: string;
  money?: MoneyKind;
  waitsFor?: string;
}

/** Dashboard features that real-money steps depend on, and whether they exist yet. */
export interface MoneyIntegration {
  key: string;
  name: string;
  money: MoneyKind;
  built: boolean;
  what: string;
}

export const MONEY_INTEGRATIONS: MoneyIntegration[] = [
  {
    key: "sales_reporting",
    name: "Sales & payout reporting",
    money: "reads",
    built: true,
    what: "The Finance agent sends real marketplace payouts (gross, refunds, fees, units) to the dashboard, which fills in Financials.",
  },
  {
    key: "stripe_cards",
    name: "Stripe virtual cards for agents",
    money: "moves",
    built: false,
    what: "The dashboard creates a card per agent (or per approved purchase) with a hard limit, and approves or declines each charge in real time against budgets, caps and the kill switch.",
  },
  {
    key: "plaid_sync",
    name: "Bank balance sync (Plaid)",
    money: "reads",
    built: false,
    what: "Reads your business bank balance and transactions read-only, so deposits appear automatically and Cash matches the bank.",
  },
];

const WAITS_STRIPE = "Stripe virtual cards in the dashboard (not built yet)";
const WAITS_PLAID = "Bank balance sync (Plaid) in the dashboard (not built yet)";

export const DEFAULT_TASKS: TaskTemplate[] = [
  {
    key: "entity",
    category: "legal",
    title: "Form a legal entity (LLC)",
    description: "Marketplaces, banks and payment processors require a legally responsible business and owner. Usually costs $50–$500 in state fees.",
    steps: [
      "Pick your state (normally where you live).",
      "File “Articles of Organization” for an LLC on your state's Secretary of State website.",
      "Save the approval PDF. Banks and marketplaces ask for it.",
    ],
    links: [{ label: "SBA: register your business", url: "https://www.sba.gov/business-guide/launch-your-business/register-your-business" }],
    time: "30 min + state processing",
  },
  {
    key: "ein",
    category: "legal",
    title: "Get a free EIN (tax ID) from the IRS",
    description: "Needed for the bank account, seller accounts and taxes. It is free; never pay a third party for it.",
    steps: ["Apply online on IRS.gov (available weekday business hours).", "Choose LLC, answer the questions, and download the EIN confirmation letter (CP 575)."],
    links: [{ label: "IRS: apply for an EIN", url: "https://www.irs.gov/businesses/small-businesses-self-employed/get-an-employer-identification-number" }],
    time: "15 min",
  },
  {
    key: "bank",
    category: "finance",
    money: "moves",
    title: "Open a business bank account",
    description: "Keeps business money separate. Funding goes in here and marketplace payouts land here.",
    steps: ["Bring your LLC approval and EIN letter.", "Open a business checking account at any bank or online business bank.", "Order a debit card with a spending limit for agent purchases."],
    links: [{ label: "SBA: open a business bank account", url: "https://www.sba.gov/business-guide/launch-your-business/open-business-bank-account" }],
    time: "20 min",
  },
  {
    key: "insurance",
    category: "legal",
    title: "Get product liability insurance",
    description: "Protects you if a product causes harm. Amazon requires it once sales pass a threshold.",
    steps: ["Get quotes for general + product liability insurance from 2–3 insurers.", "Name your marketplace as additional insured if it requires it."],
    links: [{ label: "SBA: get business insurance", url: "https://www.sba.gov/business-guide/launch-your-business/get-business-insurance" }],
    time: "30 min",
  },
  {
    key: "compliance",
    category: "product",
    title: "Confirm product safety & compliance",
    description: "Check which certifications your product legally needs and require proof from suppliers before paying.",
    steps: [
      "Look up your product type on the CPSC site (US).",
      "Electrical items: require UL or ETL listing certificates. Children's items: a Children's Product Certificate.",
      "Ask each supplier for the test reports and verify the certificate number with the testing lab.",
    ],
    links: [{ label: "CPSC: testing & certification", url: "https://www.cpsc.gov/Business--Manufacturing/Testing-Certification" }],
    time: "1 hr",
  },
  {
    key: "sales_tax",
    category: "legal",
    title: "Register for sales tax",
    description: "Marketplaces collect sales tax in most US states, but you may still need a permit in your home state.",
    steps: ["Register for a seller's permit in your home state.", "Ask an accountant whether you need to register anywhere else."],
    links: [{ label: "SBA: pay taxes", url: "https://www.sba.gov/business-guide/manage-your-business/pay-taxes" }],
    time: "30 min",
  },
  {
    key: "money_transfer",
    category: "money",
    money: "moves",
    title: "Move your starting budget into the business bank account",
    description: "Real money: this is the cash your agents will actually spend. Only move what you can afford to lose while testing.",
    steps: ["Decide the starting amount (the AI research shows a startup cost for each idea).", "Transfer it from your personal account to the business checking account.", "Keep the confirmation; your accountant will want it as owner's capital."],
    links: [],
    time: "5 min",
  },
  {
    key: "money_record",
    category: "money",
    money: "records",
    title: "Record that deposit in the dashboard",
    description: "Accounting only: tells the dashboard how much is available so it can split budgets and enforce caps. It ticks itself when you record a deposit.",
    steps: ["Open Funding → Deposit and enter the same amount you transferred.", "It is split across agents automatically."],
    links: [],
    time: "1 min",
  },
  {
    key: "stripe_apply",
    category: "money",
    money: "moves",
    title: "Apply for Stripe Issuing (cards for agents)",
    description:
      "Lets the dashboard create virtual cards with hard limits, so an agent physically cannot spend more than you allowed. Needs a registered US business; Stripe reviews each application and may decline.",
    steps: [
      "Create a Stripe account with your LLC, EIN and business bank account.",
      "Open the Issuing page in the Stripe dashboard and request access (or contact Stripe sales from the Issuing page).",
      "Wait for approval. You can continue with the other steps meanwhile.",
    ],
    links: [
      { label: "Stripe Issuing", url: "https://stripe.com/issuing" },
      { label: "Create a Stripe account", url: "https://dashboard.stripe.com/register" },
    ],
    time: "20 min + Stripe review",
  },
  {
    key: "stripe_key",
    category: "money",
    money: "moves",
    title: "Paste a Stripe restricted key on Credentials",
    description: "Gives the dashboard permission to create and control agent cards. A restricted key can only do what you allow. It ticks itself when you save it.",
    steps: [
      "In Stripe: Developers → API keys → Create restricted key, named “agent-dashboard”.",
      "Give it Write access to Issuing (cards, cardholders, authorizations) and Read access to Balance. Leave everything else at None.",
      "Copy the key (starts with rk_live_) and paste it under Credentials → Stripe.",
    ],
    links: [{ label: "Stripe API keys", url: "https://dashboard.stripe.com/apikeys" }],
    time: "5 min",
  },
  {
    key: "stripe_fund",
    category: "money",
    money: "moves",
    title: "Add money to your Stripe Issuing balance",
    description: "Agent cards spend from this balance, not from your bank account. Keep it at or below the total of your agents' budgets.",
    steps: ["After approval, open Issuing → Balance in Stripe and add funds from your business bank account.", "Add about the total of your agents' budgets (see Funding)."],
    links: [{ label: "Stripe Issuing docs", url: "https://docs.stripe.com/issuing" }],
    time: "5 min + bank transfer time",
  },
  {
    key: "ads_card",
    category: "money",
    money: "moves",
    title: "Put the Marketing agent's card on your ad account",
    description: "Ad platforms charge the card on file. Using the agent's limited card means ad spend can never exceed its budget.",
    steps: [
      "Open the Marketing agent → Connect and copy its card details.",
      "In Amazon Ads (or your ad platform) → Billing, replace the payment method with that card.",
      "Also set a monthly budget cap inside the ad platform equal to the Marketing budget.",
    ],
    links: [],
    time: "10 min",
    waitsFor: WAITS_STRIPE,
  },
  {
    key: "plaid_keys",
    category: "money",
    money: "reads",
    title: "Get Plaid keys for a read-only bank connection",
    description: "Read-only: Plaid lets the dashboard see your business bank balance and transactions. It cannot move money. It ticks itself when you save the keys.",
    steps: [
      "Sign up for a Plaid account and request Production access (Plaid reviews it).",
      "Open Developers → Keys and copy your client_id and Production secret.",
      "Paste both under Credentials → Plaid.",
    ],
    links: [
      { label: "Plaid sign-up", url: "https://dashboard.plaid.com/signup" },
      { label: "Plaid keys", url: "https://dashboard.plaid.com/developers/keys" },
    ],
    time: "15 min + Plaid review",
  },
  {
    key: "plaid_link",
    category: "money",
    money: "reads",
    title: "Link your business bank account (read-only)",
    description: "You log in to your bank through Plaid's secure window; the dashboard never sees your bank password.",
    steps: ["Open Money setup and click “Link bank account”.", "Choose your bank, log in, and select the business checking account."],
    links: [],
    time: "3 min",
    waitsFor: WAITS_PLAID,
  },
  {
    key: "sales_sync",
    category: "money",
    money: "reads",
    title: "Let the Finance agent report real sales",
    description: "Read-only: the Finance agent reads your marketplace payouts and reports gross sales, refunds, fees and units, which fill in Financials.",
    steps: [
      "Save your Amazon Selling Partner API or Shopify credentials under Credentials.",
      "Activate the Finance agent and run its program at least daily (see Agent team → Finance → Connect).",
      "Check Financials after the first payout appears.",
    ],
    links: [],
    time: "10 min",
  },
  {
    key: "samples",
    category: "product",
    title: "Approve product samples yourself",
    description: "Physically check quality and safety before the first bulk order. The Sourcing agent orders them.",
    steps: ["Open each sample on arrival.", "Check finish, labeling and certification marks.", "Approve the purchase order on the Approvals page only after this."],
    links: [],
    time: "30 min when samples arrive",
  },
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
    steps: [...t.steps],
    links: t.links.map((l) => ({ ...l })),
    time: t.time,
    templateKey: t.key,
    money: t.money ?? null,
    waitsFor: t.waitsFor ?? null,
  }));
}

/** The "open your account" checklist step for a selected sales channel. */
export function makeChannelTask(def: ChannelDef, newId: () => string): OwnerTask {
  return { id: newId(), status: "todo", notes: "", custom: false, completedAt: null, ...channelTaskText(def) };
}

export function channelTaskText(def: ChannelDef): Omit<OwnerTask, "id" | "status" | "notes" | "custom" | "completedAt"> {
  const links: TaskLink[] = [
    { label: `Sign up for ${def.name}`, url: def.signupUrl },
    { label: `${def.name} fees`, url: def.feesUrl },
  ];
  if (def.key === "etsy") links.unshift({ label: "Etsy Creativity Standards", url: "https://www.etsy.com/legal/creativity" });
  return {
    title: `Open your ${def.name} ${def.type === "Your own store" ? "store" : "seller account"}`,
    description: `${def.warning ? `${def.warning} ` : ""}${def.approvalNote} Connecting payouts is where customer money reaches your bank.`,
    category: "sales",
    steps: [...def.steps],
    links,
    time: def.time,
    templateKey: `channel:${def.key}`,
    money: "moves",
    waitsFor: null,
  };
}

/**
 * Adds a step for each selected channel and removes the steps of channels
 * you no longer sell on, so the checklist always matches your choice. A step
 * you wrote notes on is kept, so your notes are never lost.
 */
export function syncChannelTasks(s: DashboardState, newId: () => string): void {
  const selected = new Set(s.business.channels);
  s.tasks = s.tasks.filter((t) => {
    if (!t.templateKey?.startsWith("channel:")) return true;
    const key = t.templateKey.slice("channel:".length);
    return selected.has(key) || t.notes.trim() !== "";
  });
  for (const key of s.business.channels) {
    const def = findChannel(key);
    if (def && !s.tasks.some((t) => t.templateKey === `channel:${key}`)) s.tasks.push(makeChannelTask(def, newId));
  }
}

/** Tasks the dashboard can tick by itself, and the condition that marks them done. */
export const AUTO_DONE: Record<string, (s: DashboardState) => boolean> = {
  money_record: (s) => s.funding.some((f) => f.type === "deposit"),
  stripe_key: (s) => (s.vault.stripe?.value ?? "").trim() !== "",
  plaid_keys: (s) => (s.vault.plaid?.value ?? "").trim() !== "",
};
