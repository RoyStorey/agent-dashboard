/**
 * The one place the runner talks to Claude. Kept behind a small interface so
 * tests can swap in a fake model and never spend a cent.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { countsFromAnthropicUsage, type UsageCounts } from "../../shared/aiPricing.ts";
import type { AgentTool } from "./tools.ts";

export interface ModelRequest {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  tools: AgentTool[];
  effort: "low" | "medium" | "high";
  maxTokens: number;
  maxIterations: number;
  /** 0 = no web search tool at all. */
  webSearches: number;
  signal: AbortSignal;
  /** Runs one of the agent's tools. Returns the text for the model; throws for an error result. */
  runTool(tool: AgentTool, input: Record<string, unknown>): Promise<string>;
}

/** One model response within a run. */
export interface ModelTurn {
  model: string;
  usage: UsageCounts;
  /** The response's text (the last one is the run summary). */
  text: string;
  /** Web searches the model ran in this response. */
  searches: string[];
  stopReason: string | null;
}

export type ModelCall = (req: ModelRequest) => AsyncIterable<ModelTurn>;

export function describeModelError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Your Anthropic API key was rejected. Paste a valid key on Credentials.";
  if (err instanceof Anthropic.PermissionDeniedError) return "Your Anthropic key doesn't have access to this model or tool.";
  if (err instanceof Anthropic.RateLimitError) return "Anthropic rate limit or out of credits. Check Billing on platform.claude.com.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the Anthropic API. Check the internet connection.";
  if (err instanceof Anthropic.APIUserAbortError) return "Stopped.";
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ""}: ${err.message}`.trim();
  return err instanceof Error ? err.message : String(err);
}

export const anthropicModelCall: ModelCall = async function* (req) {
  const client = new Anthropic({ apiKey: req.apiKey });
  const tools = req.tools.map((t) =>
    betaTool({
      name: t.name,
      description: t.description,
      // Our schemas are plain JSON Schema objects; the cast only satisfies the helper's type-level schema parser.
      inputSchema: t.inputSchema as Parameters<typeof betaTool>[0]["inputSchema"],
      run: (input) => req.runTool(t, (input ?? {}) as Record<string, unknown>),
    }),
  );
  const runner = client.beta.messages.toolRunner(
    {
      model: req.model,
      max_tokens: req.maxTokens,
      max_iterations: req.maxIterations,
      // Effort is the main cost lever: routine roles think less.
      output_config: { effort: req.effort },
      // Caches the system prompt, tools and conversation so each later step of the run reads them at a tenth of the price.
      cache_control: { type: "ephemeral" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: req.system,
      tools: req.webSearches > 0 ? [{ type: "web_search_20260209", name: "web_search", max_uses: req.webSearches }, ...tools] : tools,
      messages: [{ role: "user", content: req.user }],
    },
    { signal: req.signal },
  );
  for await (const message of runner) {
    let text = "";
    const searches: string[] = [];
    for (const block of message.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "server_tool_use" && block.name === "web_search") {
        const q = (block.input as { query?: unknown } | null)?.query;
        searches.push(typeof q === "string" ? q : "");
      }
    }
    yield { model: message.model, usage: countsFromAnthropicUsage(message.usage), text: text.trim(), searches, stopReason: message.stop_reason };
  }
};
