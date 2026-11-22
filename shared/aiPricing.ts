/**
 * Estimated AI model costs. Prices are US cents per million tokens, from
 * Anthropic's published list prices when this was written; check current
 * pricing at platform.claude.com before relying on them. For any model not
 * listed here, the agent must report its own cost.
 *
 * Cache writes are billed at 1.25× the input price (5-minute cache).
 * Web searches are billed at $10 per 1,000.
 */

interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 400, output: 2000, cacheRead: 20 },
  "claude-fable-5-2": { input: 800, output: 4000, cacheRead: 20 },
  "claude-sonnet-5-5": { input: 200, output: 1000, cacheRead: 10 },
  "claude-haiku-5-5": { input: 10, output: 50, cacheRead: 1 },
};

export const WEB_SEARCH_CENTS_PER_THOUSAND = 1000;

export interface UsageCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
}

/** Estimated cost in whole cents (rounded up), or null for an unknown model. */
export function estimateCostCents(model: string, u: UsageCounts): number | null {
  const p = MODEL_PRICES[model];
  if (!p) return null;
  // Work in hundred-millionths of a cent to keep integer math, then round up to the cent.
  const tokenCost =
    u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * (p.input * 1.25);
  const searchCost = (u.webSearches * WEB_SEARCH_CENTS_PER_THOUSAND) / 1000;
  return Math.ceil(tokenCost / 1_000_000 + searchCost - 1e-9);
}

/** Turns an Anthropic API `usage` object into counts. Missing fields count as zero. */
export function countsFromAnthropicUsage(usage: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}): UsageCounts {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    webSearches: usage.server_tool_use?.web_search_requests ?? 0,
  };
}

export function addCounts(a: UsageCounts, b: UsageCounts): UsageCounts {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    webSearches: a.webSearches + b.webSearches,
  };
}

export const ZERO_COUNTS: UsageCounts = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0 };
