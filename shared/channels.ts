/**
 * Places to sell. Fees are typical figures at the time of writing; every
 * channel links to its official fee page because fees change. The dashboard
 * only applies a channel's fees to your plan when you click to do so.
 */

export interface ChannelFees {
  /** Commission / referral / transaction fee on each sale, in basis points. */
  marketplaceFeeBps: number;
  /** Card processing percentage, in basis points (0 when included in the commission). */
  paymentFeeBps: number;
  /** Fixed fees per order (card fee, listing renewal, per-order fee), in cents. */
  perOrderFeeCents: number;
}

export interface ChannelDef {
  key: string;
  name: string;
  type: "Your own store" | "Marketplace";
  /** One line: who it suits. */
  bestFor: string;
  monthlyCost: string;
  feeSummary: string;
  /** Typical fees to apply to the plan, or null when we can't state them reliably. */
  typicalFees: ChannelFees | null;
  approval: "Easy" | "Moderate" | "Hard";
  approvalNote: string;
  pros: string[];
  cons: string[];
  /** Shown prominently when choosing this channel. */
  warning?: string;
  signupUrl: string;
  feesUrl: string;
  /** Credentials-vault keys this channel's agents use, most important first. */
  vaultKeys: string[];
  /** What the Marketing agent should run ads on. */
  adsPlatform: string;
  /** Default fulfillment for this channel. */
  fulfillment: string;
  /** Steps to open the account (shown as a checklist task). */
  steps: string[];
  time: string;
}

export const CHANNELS: ChannelDef[] = [
  {
    key: "shopify",
    name: "Shopify",
    type: "Your own store",
    bestFor: "Owning your brand and customer list; any legal product.",
    monthlyCost: "Plans from about $39/month (less if billed yearly), after a free trial.",
    feeSummary: "No commission on sales. Card processing about 2.9% + 30¢ per order with Shopify Payments on the basic plan (US).",
    typicalFees: { marketplaceFeeBps: 0, paymentFeeBps: 290, perOrderFeeCents: 30 },
    approval: "Easy",
    approvalNote: "Open instantly; payouts need your business and bank details.",
    pros: ["You keep the customer relationship and email list", "No per-sale commission", "Sell almost anything legal, including supplier-made products"],
    cons: ["No built-in shoppers: you must bring traffic (ads, social, search)", "Monthly fee even with no sales"],
    signupUrl: "https://www.shopify.com/free-trial",
    feesUrl: "https://www.shopify.com/pricing",
    vaultKeys: ["shopify_admin", "meta_ads", "shipbob"],
    adsPlatform: "Meta Ads (Facebook & Instagram)",
    fulfillment: "ShipBob (3PL)",
    steps: [
      "Start a free trial with your business email.",
      "Choose a plan before the trial ends.",
      "Settings → Payments: activate Shopify Payments with your LLC, EIN and business bank account (customer money is paid out here).",
      "Settings → Shipping and delivery: set your shipping rates.",
      "Optional: buy or connect a domain name.",
      "Then paste your Shopify Admin API access on Credentials.",
    ],
    time: "30 min",
  },
  {
    key: "etsy",
    name: "Etsy",
    type: "Marketplace",
    bestFor: "Handmade, your own designs, vintage, or craft supplies.",
    monthlyCost: "No required monthly fee.",
    feeSummary:
      "$0.20 per listing (renews every 4 months or when it sells), 6.5% transaction fee on the sale price including shipping, payment processing about 3% + 25¢ (US). Optional Offsite Ads fee of 12–15% on sales Etsy's ads bring in.",
    typicalFees: { marketplaceFeeBps: 650, paymentFeeBps: 300, perOrderFeeCents: 45 },
    approval: "Easy",
    approvalNote: "Open in minutes; identity and bank checks for payouts.",
    pros: ["Built-in shoppers looking for unique items", "Low cost to start", "Simple setup"],
    cons: ["Strict rules on what you may sell", "Many small sellers; prices are competitive"],
    warning:
      "Etsy only allows items you make or design yourself, vintage items (20+ years old), and craft supplies. Reselling factory-made products bought from a supplier is not allowed and can get your shop closed. Read Etsy's Creativity Standards first.",
    signupUrl: "https://www.etsy.com/sell",
    feesUrl: "https://www.etsy.com/legal/fees",
    vaultKeys: ["etsy_api", "meta_ads", "shipbob"],
    adsPlatform: "Etsy Ads (set up inside Etsy) and Meta Ads",
    fulfillment: "Ship it yourself, or ShipBob (3PL)",
    steps: [
      "Read Etsy's Creativity Standards and confirm your product qualifies (made or designed by you, vintage, or craft supplies).",
      "Open a shop and choose a shop name.",
      "Add your bank account for payouts and a card for fees; complete identity verification.",
      "Set shipping profiles and your return policy.",
      "Then paste your Etsy API keys on Credentials.",
    ],
    time: "30 min",
  },
  {
    key: "amazon",
    name: "Amazon",
    type: "Marketplace",
    bestFor: "Reaching the most shoppers with supplier-made products.",
    monthlyCost: "Professional plan $39.99/month.",
    feeSummary: "Referral fee usually 8–15% by category (15% for many), plus an FBA fee per unit if Amazon stores and ships it.",
    typicalFees: { marketplaceFeeBps: 1500, paymentFeeBps: 0, perOrderFeeCents: 0 },
    approval: "Hard",
    approvalNote: "Strict identity verification; some categories need extra approval.",
    pros: ["Huge built-in demand", "FBA handles storage, shipping and returns", "Prime badge helps conversion"],
    cons: ["Verification can be slow or rejected", "High fees and heavy competition", "Amazon owns the customer relationship"],
    signupUrl: "https://sell.amazon.com",
    feesUrl: "https://sell.amazon.com/pricing",
    vaultKeys: ["amazon_sp_api", "amazon_ads_api"],
    adsPlatform: "Amazon Ads (Sponsored Products)",
    fulfillment: "Amazon FBA",
    steps: [
      "Sign up for a Professional selling plan with your LLC, EIN, business bank account and government ID.",
      "Make every name and address match exactly across your ID, bank statement and LLC documents; mismatches are the most common reason verification fails.",
      "Complete the video or in-person identity verification when asked.",
      "If verification fails, reply from the registration page with exactly the document requested (for example a recent bank or utility statement showing the same address).",
      "Then paste your Selling Partner API details on Credentials.",
    ],
    time: "45 min + verification",
  },
  {
    key: "ebay",
    name: "eBay",
    type: "Marketplace",
    bestFor: "Easy start with a broad audience; good for testing demand.",
    monthlyCost: "No required monthly fee (optional Store subscriptions).",
    feeSummary: "Final value fee about 13.25% for most categories, plus about 30¢–40¢ per order (payment processing included). Free listings each month, then a small insertion fee.",
    typicalFees: { marketplaceFeeBps: 1325, paymentFeeBps: 0, perOrderFeeCents: 40 },
    approval: "Easy",
    approvalNote: "Open quickly; payout setup needs bank details.",
    pros: ["Simple to start", "Large audience", "Good for testing a product cheaply"],
    cons: ["You handle shipping unless you use a 3PL", "Buyers compare heavily on price"],
    signupUrl: "https://www.ebay.com/sl/sell",
    feesUrl: "https://www.ebay.com/help/selling/fees-credits-invoices/selling-fees?id=4364",
    vaultKeys: ["ebay_api", "shipbob"],
    adsPlatform: "eBay Promoted Listings (set up inside eBay)",
    fulfillment: "ShipBob (3PL), or ship it yourself",
    steps: [
      "Create an eBay business account with your LLC details.",
      "Complete payments onboarding with your business bank account (sale proceeds are paid out here).",
      "Set your shipping and return policies.",
      "Then paste your eBay API keys on Credentials.",
    ],
    time: "30 min",
  },
  {
    key: "walmart",
    name: "Walmart Marketplace",
    type: "Marketplace",
    bestFor: "Established sellers who want a second big marketplace.",
    monthlyCost: "No monthly fee.",
    feeSummary: "Referral fee about 6–15% by category (15% for many).",
    typicalFees: { marketplaceFeeBps: 1500, paymentFeeBps: 0, perOrderFeeCents: 0 },
    approval: "Hard",
    approvalNote: "Application with review; usually expects a US business with marketplace sales history.",
    pros: ["Large US audience with less competition than Amazon", "No monthly fee"],
    cons: ["Hard to get approved as a brand-new seller", "Smaller than Amazon"],
    signupUrl: "https://marketplace.walmart.com",
    feesUrl: "https://marketplace.walmart.com",
    vaultKeys: ["walmart_api", "shipbob"],
    adsPlatform: "Walmart Connect (set up inside Walmart)",
    fulfillment: "Walmart Fulfillment Services or ShipBob (3PL)",
    steps: [
      "Apply with your EIN, W-9, US business address and any existing marketplace sales history.",
      "Wait for Walmart's review.",
      "After approval, add your bank account for payouts and set shipping.",
      "Then paste your Walmart API keys on Credentials.",
    ],
    time: "30 min + review",
  },
  {
    key: "tiktok",
    name: "TikTok Shop",
    type: "Marketplace",
    bestFor: "Products that sell well in short videos and with creators.",
    monthlyCost: "No monthly fee.",
    feeSummary: "A commission on each sale; check the current rate on TikTok's seller site before relying on it.",
    typicalFees: null,
    approval: "Moderate",
    approvalNote: "Business verification; some categories restricted.",
    pros: ["Viral reach through videos and affiliate creators", "Fast-growing"],
    cons: ["Needs a steady stream of video content", "Policies change often"],
    signupUrl: "https://seller-us.tiktok.com",
    feesUrl: "https://seller-us.tiktok.com",
    vaultKeys: ["shipbob"],
    adsPlatform: "TikTok Ads and affiliate creators (set up inside TikTok Shop)",
    fulfillment: "ShipBob (3PL), or ship it yourself",
    steps: [
      "Sign up on TikTok Shop Seller Center as a business.",
      "Verify your business and identity.",
      "Add your bank account for payouts and set shipping.",
    ],
    time: "30 min + verification",
  },
];

export function findChannel(key: string): ChannelDef | undefined {
  return CHANNELS.find((c) => c.key === key);
}

/** Guesses channel keys from free text such as "Amazon US, own Shopify store". */
export function detectChannels(text: string): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  const add = (k: string) => !out.includes(k) && out.push(k);
  if (t.includes("amazon")) add("amazon");
  if (t.includes("shopify") || t.includes("own store") || t.includes("own site")) add("shopify");
  if (t.includes("etsy")) add("etsy");
  if (t.includes("ebay")) add("ebay");
  if (t.includes("walmart")) add("walmart");
  if (t.includes("tiktok")) add("tiktok");
  return out;
}

export function channelNames(keys: string[]): string {
  return keys
    .map((k) => findChannel(k)?.name)
    .filter(Boolean)
    .join(", ");
}

/**
 * Narrows a field's candidate vault keys to the selected sales channels:
 * keys of selected channels come first (in channel order), keys that belong
 * only to channels you are NOT selling on are dropped (so an Amazon key is
 * never used for a Shopify store), and keys no channel claims are kept.
 * With no channels selected, the list is unchanged.
 */
export function orderByChannels(keys: string[], channels: string[]): string[] {
  if (channels.length === 0) return keys;
  const selectedKeys = new Set(channels.flatMap((c) => findChannel(c)?.vaultKeys ?? []));
  const claimed = new Set(CHANNELS.flatMap((c) => c.vaultKeys));
  const preferred: string[] = [];
  for (const c of channels) for (const k of findChannel(c)?.vaultKeys ?? []) if (keys.includes(k) && !preferred.includes(k)) preferred.push(k);
  return [...preferred, ...keys.filter((k) => !preferred.includes(k) && (!claimed.has(k) || selectedKeys.has(k)))];
}
