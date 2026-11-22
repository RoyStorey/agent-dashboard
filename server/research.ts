import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { ZERO_COUNTS, addCounts, countsFromAnthropicUsage, type UsageCounts } from "../shared/aiPricing.ts";
import { formatCents } from "../shared/money.ts";
import type { ProductIdea, ResearchBrief } from "../shared/types.ts";

export const RESEARCH_MODEL = "claude-opus-5-5";

export interface ResearchResult {
  summary: string;
  ideas: ProductIdea[];
  /** Tokens and searches used, for AI spend tracking. */
  usage?: UsageCounts;
}

/** A failed run still used (and is billed for) some tokens; this carries them. */
export class ResearchFailure extends Error {
  constructor(
    message: string,
    public readonly usage: UsageCounts,
  ) {
    super(message);
  }
}

/** Anything that can turn a brief into product ideas (the real one calls Claude; tests use a fake). */
export type ResearchRunner = (brief: ResearchBrief, apiKey: string) => Promise<ResearchResult>;

const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
const str = (v: unknown, max = 2000): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strList = (v: unknown, maxItems = 12): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, 300)).filter(Boolean).slice(0, maxItems) : [];

/** Validates and clamps one idea from model output. Returns null if unusable. */
export function sanitizeIdea(raw: unknown): ProductIdea | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const product = str(r.product, 300);
  const salePriceCents = int(r.sale_price_cents);
  if (!product || salePriceCents <= 0) return null;
  const competition = r.competition === "low" || r.competition === "medium" || r.competition === "high" ? r.competition : "medium";
  const sources = Array.isArray(r.sources)
    ? r.sources
        .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
        .map((s) => ({ title: str(s.title, 200), url: str(s.url, 500) }))
        .filter((s) => /^https?:\/\//.test(s.url))
        .slice(0, 8)
    : [];
  return {
    title: str(r.title, 120) || product,
    product,
    niche: str(r.niche, 300),
    targetAudience: str(r.target_audience, 600),
    whyNow: str(r.why_now, 1500),
    salesChannels: str(r.sales_channels, 300),
    competition,
    salePriceCents,
    unitCostCents: int(r.unit_cost_cents),
    inboundShippingCents: int(r.inbound_shipping_cents_per_unit),
    fulfillmentFeeCents: int(r.fulfillment_fee_cents_per_unit),
    marketplaceFeeBps: Math.min(10_000, int(r.marketplace_fee_bps)),
    estimatedMonthlyUnits: int(r.estimated_monthly_units),
    startupCostCents: int(r.startup_cost_cents),
    compliance: strList(r.compliance),
    risks: strList(r.risks),
    keywords: strList(r.keywords, 15),
    sources,
  };
}

const IDEA_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short name for the opportunity" },
    product: { type: "string", description: "The exact product to sell, specific enough to source" },
    niche: { type: "string" },
    target_audience: { type: "string", description: "Who buys it and why" },
    why_now: { type: "string", description: "Evidence of current demand and the gap in the market" },
    sales_channels: { type: "string", description: "e.g. Amazon US, Shopify store" },
    competition: { type: "string", enum: ["low", "medium", "high"] },
    sale_price_cents: { type: "integer", description: "Expected retail price in US cents" },
    unit_cost_cents: { type: "integer", description: "Supplier price per unit in US cents" },
    inbound_shipping_cents_per_unit: { type: "integer", description: "Freight + duties per unit in US cents" },
    fulfillment_fee_cents_per_unit: { type: "integer", description: "Pick/pack/ship fee per unit in US cents (e.g. FBA fee)" },
    marketplace_fee_bps: { type: "integer", description: "Marketplace referral fee in basis points (15% = 1500)" },
    estimated_monthly_units: { type: "integer", description: "Realistic units/month for a new seller after launch" },
    startup_cost_cents: { type: "integer", description: "Cash needed to launch: samples, first order, photos, launch ads, in US cents" },
    compliance: { type: "array", items: { type: "string" }, description: "Certifications/regulations required" },
    risks: { type: "array", items: { type: "string" } },
    keywords: { type: "array", items: { type: "string" }, description: "Search keywords buyers use" },
    sources: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, url: { type: "string" } },
        required: ["title", "url"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "title",
    "product",
    "niche",
    "target_audience",
    "why_now",
    "sales_channels",
    "competition",
    "sale_price_cents",
    "unit_cost_cents",
    "inbound_shipping_cents_per_unit",
    "fulfillment_fee_cents_per_unit",
    "marketplace_fee_bps",
    "estimated_monthly_units",
    "startup_cost_cents",
    "compliance",
    "risks",
    "keywords",
    "sources",
  ],
  additionalProperties: false,
} as const;

export function researchPrompt(brief: ResearchBrief): string {
  return `Find the best physical products for me to start selling online right now.

My situation:
- Total starting budget: ${formatCents(brief.budgetCents)} (must cover samples, the first inventory order, photos and launch ads)
- Interests or categories I'd consider: ${brief.interests || "open to anything"}
- Avoid: ${brief.avoid || "nothing specific"}
- Preferred sales channels: ${brief.channels || "whatever fits best (Amazon, Shopify, etc.)"}
- Where I sell from / to: ${brief.location || "United States"}

Use web search to check current demand, prices, competition and supplier costs. Prefer niches where a new seller can win (weak listings, unhappy reviews, rising demand), the product is small and light, and safety compliance is manageable. Every idea's startup cost must fit within my budget.

When you are done, call submit_product_ideas once with 3 to 5 ideas ranked best first. Use realistic numbers from your research; all money in US cents, fees in basis points. Include the source URLs you relied on.`;
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Your Anthropic API key was rejected. Paste a valid key on the Credentials page.";
  if (err instanceof Anthropic.PermissionDeniedError) return "Your Anthropic key does not have access to this model or to web search.";
  if (err instanceof Anthropic.RateLimitError) return "Anthropic rate limit or out of credits. Check Billing on platform.claude.com and try again.";
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the Anthropic API. Check your internet connection.";
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ""}: ${err.message}`.trim();
  return err instanceof Error ? err.message : String(err);
}

export const anthropicResearch: ResearchRunner = async (brief, apiKey) => {
  const client = new Anthropic({ apiKey });
  // A holder object, because TypeScript can't see assignments made inside the tool callback.
  const out: { result: ResearchResult | null } = { result: null };

  const submit = betaTool({
    name: "submit_product_ideas",
    description: "Submit the final ranked product ideas. Call exactly once, at the end of your research.",
    strict: true,
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Two or three sentences: what you found and why the top idea is first" },
        ideas: { type: "array", items: IDEA_SCHEMA },
      },
      required: ["summary", "ideas"],
      additionalProperties: false,
    },
    run: async (input) => {
      // betaTool does not validate at runtime, so check and clamp every field here.
      const ideas = (Array.isArray(input.ideas) ? input.ideas : []).map(sanitizeIdea).filter((x): x is ProductIdea => x !== null);
      if (ideas.length === 0) return "No valid ideas were included. Each idea needs a product and a sale price above zero. Call the tool again.";
      out.result = { summary: str(input.summary, 2000), ideas: ideas.slice(0, 5) };
      return `Saved ${out.result.ideas.length} ideas. You are done; reply with one short sentence.`;
    },
  });

  let usage: UsageCounts = ZERO_COUNTS;
  try {
    const runner = client.beta.messages.toolRunner({
      model: RESEARCH_MODEL,
      max_tokens: 16000,
      max_iterations: 12,
      output_config: { effort: "high" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 12 }, submit],
      messages: [{ role: "user", content: researchPrompt(brief) }],
    });
    // Iterate message by message so every call's usage is counted, not just the last one.
    let stopReason: string | null = null;
    for await (const message of runner) {
      usage = addCounts(usage, countsFromAnthropicUsage(message.usage));
      stopReason = message.stop_reason;
    }
    if (out.result) return { ...out.result, usage };
    if (stopReason === "refusal") throw new Error("The model declined this research request. Try different interests.");
    throw new Error("Research finished without returning ideas. Run it again.");
  } catch (err) {
    if (out.result) return { ...out.result, usage };
    throw new ResearchFailure(describeError(err), usage);
  }
};
