/**
 * Catalog of credentials the owner can store once in the vault. Agent input
 * fields reference these keys, so one saved key fills every agent that needs it.
 *
 * Every entry says exactly where to get it, what to paste, and in what format.
 */

export type ServiceCategory = "ai" | "sales" | "ads" | "operations" | "finance" | "research";

export interface ServiceDef {
  key: string;
  /** What this credential can do with real money: spend/refund it, only see it, or neither. */
  money: "spends" | "reads" | "none";
  label: string;
  provider: string;
  category: ServiceCategory;
  secret: boolean;
  multiline: boolean;
  /** Where to get it. */
  url: string;
  /** Exact steps, in order. */
  steps: string[];
  /** Exactly what to paste, e.g. "The key, starting with sk-ant-". */
  paste: string;
  placeholder: string;
  /** Prefix check used for a friendly warning (never blocks saving). */
  expectPrefix?: string;
  /** Roughly how long it takes. */
  time: string;
}

export const SERVICES: ServiceDef[] = [
  {
    key: "anthropic",
    money: "none",
    label: "Anthropic (Claude) API key",
    provider: "Anthropic",
    category: "ai",
    secret: true,
    multiline: false,
    url: "https://platform.claude.com/settings/keys",
    steps: [
      "Open the link and sign in (or create a free account).",
      "Add credits under Billing if you have not already. Agents stop working when credits run out.",
      "Click “Create Key”, name it “agent-dashboard”, and click Create.",
      "Copy the key straight away (it is shown only once).",
    ],
    paste: "The API key. It starts with sk-ant-",
    placeholder: "sk-ant-…",
    expectPrefix: "sk-ant-",
    time: "3 min",
  },
  {
    key: "openai",
    money: "none",
    label: "OpenAI API key",
    provider: "OpenAI",
    category: "ai",
    secret: true,
    multiline: false,
    url: "https://platform.openai.com/api-keys",
    steps: [
      "Open the link and sign in.",
      "Click “Create new secret key”, name it “agent-dashboard”.",
      "Copy the key (shown only once).",
    ],
    paste: "The secret key. It starts with sk-",
    placeholder: "sk-…",
    expectPrefix: "sk-",
    time: "3 min",
  },
  {
    key: "google_gemini",
    money: "none",
    label: "Google Gemini API key",
    provider: "Google",
    category: "ai",
    secret: true,
    multiline: false,
    url: "https://aistudio.google.com/app/apikey",
    steps: ["Open the link and sign in with Google.", "Click “Create API key”.", "Copy the key."],
    paste: "The API key (starts with AIza)",
    placeholder: "AIza…",
    expectPrefix: "AIza",
    time: "2 min",
  },
  {
    key: "amazon_sp_api",
    money: "reads",
    label: "Amazon Selling Partner API (Seller Central)",
    provider: "Amazon",
    category: "sales",
    secret: true,
    multiline: true,
    url: "https://developer-docs.amazon.com/sp-api/docs/registering-your-application",
    steps: [
      "You need an active Amazon seller account first (see the “Create seller accounts” task).",
      "In Seller Central go to Apps and Services → Develop Apps and register as a private developer.",
      "Create an app client, then click “Authorize” to generate a refresh token for your own store.",
      "Copy the LWA client ID, LWA client secret and the refresh token.",
    ],
    paste: "Three lines: LWA client ID, then LWA client secret, then refresh token",
    placeholder: "amzn1.application-oa2-client.…\namzn1.oa2-cs.v1.…\nAtzr|…",
    time: "20 min",
  },
  {
    key: "shopify_admin",
    money: "spends",
    label: "Shopify Admin API access",
    provider: "Shopify",
    category: "sales",
    secret: true,
    multiline: true,
    url: "https://help.shopify.com/en/manual/apps/app-types/custom-apps",
    steps: [
      "In your Shopify admin open Settings → Apps and sales channels → Develop apps.",
      "Create an app named “agent-dashboard” and grant it Admin API access to products, orders, inventory and customers.",
      "Install the app and reveal the Admin API access token (shown once).",
    ],
    paste: "Two lines: your store domain (name.myshopify.com), then the token (starts with shpat_)",
    placeholder: "your-store.myshopify.com\nshpat_…",
    time: "10 min",
  },
  {
    key: "amazon_ads_api",
    money: "spends",
    label: "Amazon Ads API",
    provider: "Amazon",
    category: "ads",
    secret: true,
    multiline: true,
    url: "https://advertising.amazon.com/API/docs/en-us/guides/onboarding/overview",
    steps: [
      "Follow the onboarding guide to request Amazon Ads API access (approval can take a few days).",
      "Once approved, create a Login with Amazon security profile and authorize it for your ads account.",
      "Copy the client ID, client secret, refresh token and your advertising profile ID.",
    ],
    paste: "Four lines: client ID, client secret, refresh token, profile ID",
    placeholder: "amzn1.application-oa2-client.…\n…\nAtzr|…\n1234567890",
    time: "15 min + approval wait",
  },
  {
    key: "keepa",
    money: "none",
    label: "Keepa API key (Amazon price & sales history)",
    provider: "Keepa",
    category: "research",
    secret: true,
    multiline: false,
    url: "https://keepa.com/#!api",
    steps: ["Open the link and subscribe to an API plan.", "Copy your private API access key from the same page."],
    paste: "The API access key",
    placeholder: "…",
    time: "5 min",
  },
  {
    key: "alibaba_account",
    money: "none",
    label: "Alibaba.com buyer account",
    provider: "Alibaba",
    category: "operations",
    secret: false,
    multiline: false,
    url: "https://www.alibaba.com",
    steps: ["Create a free buyer account (Join Free).", "Verify your email."],
    paste: "The email address of the buyer account",
    placeholder: "you@example.com",
    time: "5 min",
  },
  {
    key: "shipbob",
    money: "none",
    label: "ShipBob API token (3PL fulfillment)",
    provider: "ShipBob",
    category: "operations",
    secret: true,
    multiline: false,
    url: "https://developer.shipbob.com/",
    steps: ["In the ShipBob dashboard open Integrations → API Tokens.", "Generate a Personal Access Token named “agent-dashboard”.", "Copy it."],
    paste: "The personal access token",
    placeholder: "…",
    time: "3 min",
  },
  {
    key: "quickbooks",
    money: "reads",
    label: "QuickBooks Online API",
    provider: "Intuit",
    category: "finance",
    secret: true,
    multiline: true,
    url: "https://developer.intuit.com/app/developer/qbo/docs/get-started",
    steps: [
      "Create an Intuit developer account and an app with the Accounting scope.",
      "Connect it to your company and copy the client ID, client secret, refresh token and company (realm) ID.",
    ],
    paste: "Four lines: client ID, client secret, refresh token, realm ID",
    placeholder: "AB…\n…\nAB11…\n9130…",
    time: "15 min",
  },
  {
    key: "stripe",
    money: "spends",
    label: "Stripe restricted key (agent cards)",
    provider: "Stripe",
    category: "finance",
    secret: true,
    multiline: false,
    url: "https://dashboard.stripe.com/apikeys",
    steps: [
      "Stripe Issuing must be approved first (see Money setup).",
      "Developers → API keys → Create restricted key, named “agent-dashboard”.",
      "Set Issuing (cards, cardholders, authorizations) to Write and Balance to Read; leave the rest at None.",
      "Create it and copy the key.",
    ],
    paste: "The restricted key. It starts with rk_live_ (or rk_test_ for test mode)",
    placeholder: "rk_live_…",
    expectPrefix: "rk_",
    time: "5 min",
  },
  {
    key: "plaid",
    money: "reads",
    label: "Plaid keys (read-only bank connection)",
    provider: "Plaid",
    category: "finance",
    secret: true,
    multiline: true,
    url: "https://dashboard.plaid.com/developers/keys",
    steps: ["Sign up at Plaid and request Production access.", "Open Developers → Keys.", "Copy the client_id and the Production secret."],
    paste: "Two lines: client_id, then the Production secret",
    placeholder: "5f1a…\n9c3e…",
    time: "15 min + Plaid review",
  },
];

export function findService(key: string): ServiceDef | undefined {
  return SERVICES.find((s) => s.key === key);
}

/** Maps an agent's model provider to the vault key holding its API key. */
export const LLM_PROVIDER_KEYS: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google_gemini",
};

export function llmVaultKey(provider: string): string | undefined {
  return LLM_PROVIDER_KEYS[provider.trim().toLowerCase()];
}

/** Suggested model per provider for new agents. */
export const DEFAULT_MODELS: Record<string, string> = {
  Anthropic: "claude-opus-5-5",
  OpenAI: "",
  Google: "",
};
