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
  /** Values to paste into the provider's form, shown with Copy buttons. */
  copy?: Array<{ label: string; value: string }>;
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
    // With the permissions below it can read orders and payouts and edit products, but cannot refund or move money.
    money: "reads",
    label: "Shopify Admin API access",
    provider: "Shopify",
    category: "sales",
    secret: true,
    multiline: true,
    url: "https://dev.shopify.com",
    steps: [
      "Open the Shopify Dev Dashboard → Apps → Create app.",
      "App name: agent-dashboard. Leave Version name as it is.",
      "App URL: leave https://example.com. Untick “Embed app in Shopify admin”. Leave the redirect box empty and “Use legacy install flow” unticked.",
      "Scopes: click Copy below and paste the list into the Scopes box.",
      "Leave Webhooks API version as it is and click Create app (top right).",
      "On the app's page, install it on your store.",
      "Open the app's settings and copy the Client ID and Client secret.",
    ],
    copy: [
      {
        label: "Scopes",
        value: "read_products,write_products,read_inventory,write_inventory,read_orders,read_customers,read_shopify_payments_payouts",
      },
    ],
    paste:
      "Three lines: your store address (name.myshopify.com), the Client ID, the Client secret. (If your screen shows an Admin API access token starting with shpat_ instead, paste that as the third line.)",
    placeholder: "your-store.myshopify.com\nClient ID\nClient secret",
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
    key: "etsy_api",
    money: "spends",
    label: "Etsy API keys",
    provider: "Etsy",
    category: "sales",
    secret: true,
    multiline: true,
    url: "https://www.etsy.com/developers/your-apps",
    steps: [
      "You need an open Etsy shop first (see the Etsy step on your checklist).",
      "Open the link, create an app named “agent-dashboard”, and wait for Etsy to approve API access.",
      "Copy the app's keystring and shared secret, then authorize the app for your shop to get a refresh token.",
    ],
    paste: "Three lines: keystring, shared secret, refresh token",
    placeholder: "keystring…\nshared secret…\nrefresh token…",
    time: "15 min + Etsy review",
  },
  {
    key: "ebay_api",
    money: "spends",
    label: "eBay API keys",
    provider: "eBay",
    category: "sales",
    secret: true,
    multiline: true,
    url: "https://developer.ebay.com/my/keys",
    steps: [
      "Join the eBay Developers Program with the same account as your seller account.",
      "Create a Production keyset; copy the App ID (Client ID) and Cert ID (Client Secret).",
      "Generate a user token for your seller account and copy its refresh token.",
    ],
    paste: "Three lines: App ID, Cert ID, refresh token",
    placeholder: "App ID…\nCert ID…\nrefresh token…",
    time: "15 min",
  },
  {
    key: "walmart_api",
    money: "spends",
    label: "Walmart Marketplace API keys",
    provider: "Walmart",
    category: "sales",
    secret: true,
    multiline: true,
    url: "https://developer.walmart.com",
    steps: ["Available after Walmart approves your seller account.", "In Seller Center open the API key management page and create keys.", "Copy the Client ID and Client Secret."],
    paste: "Two lines: Client ID, then Client Secret",
    placeholder: "client id…\nclient secret…",
    time: "10 min",
  },
  {
    key: "meta_ads",
    money: "spends",
    label: "Meta Ads (Facebook & Instagram) access",
    provider: "Meta",
    category: "ads",
    secret: true,
    multiline: true,
    url: "https://developers.facebook.com/docs/marketing-apis/get-started",
    steps: [
      "Create a Meta Business account and an ad account with a payment method.",
      "Create a Meta app with the Marketing API, and a system user with access to the ad account.",
      "Generate a system-user access token with ads_management permission; copy it and your ad account ID (act_…).",
    ],
    paste: "Two lines: access token, then ad account ID (act_…)",
    placeholder: "EAAB…\nact_1234567890",
    time: "20 min",
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
