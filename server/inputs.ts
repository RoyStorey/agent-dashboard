import { unitBreakdown, bpsToInput, economicsComplete } from "../shared/economics.ts";
import { centsToInput } from "../shared/money.ts";
import { llmVaultKey } from "../shared/services.ts";
import type { Agent, DashboardState, InputField, InputSource, ProductIdea } from "../shared/types.ts";

/** Vault keys a field can draw from, with "llm" resolved for the agent's provider. */
export function fieldVaultKeys(agent: Pick<Agent, "connection">, field: InputField): string[] {
  const out: string[] = [];
  for (const k of field.vault ?? []) {
    if (k === "llm") {
      const resolved = llmVaultKey(agent.connection.provider);
      if (resolved) out.push(resolved);
    } else {
      out.push(k);
    }
  }
  return out;
}

export interface ResolvedInputs {
  values: Record<string, string>;
  sources: Record<string, InputSource>;
}

/** Effective input values: a manual value wins; otherwise the first saved vault entry. */
export function resolveInputs(state: Pick<DashboardState, "vault">, agent: Agent): ResolvedInputs {
  const values: Record<string, string> = {};
  const sources: Record<string, InputSource> = {};
  for (const f of agent.inputFields) {
    const manual = agent.inputs[f.key] ?? "";
    if (manual.trim() !== "") {
      values[f.key] = manual;
      sources[f.key] = { type: "manual" };
      continue;
    }
    const key = fieldVaultKeys(agent, f).find((k) => (state.vault[k]?.value ?? "").trim() !== "");
    if (key) {
      values[f.key] = state.vault[key]!.value;
      sources[f.key] = { type: "vault", key };
    } else {
      values[f.key] = "";
      sources[f.key] = { type: "none" };
    }
  }
  return { values, sources };
}

export function missingInputs(state: Pick<DashboardState, "vault">, agent: Agent): string[] {
  const { values } = resolveInputs(state, agent);
  return agent.inputFields.filter((f) => f.required && (values[f.key] ?? "").trim() === "").map((f) => f.label);
}

/** Vault keys that would fill this agent's missing required inputs (first choice per field). */
export function missingVaultKeys(state: Pick<DashboardState, "vault">, agent: Agent): string[] {
  const { values } = resolveInputs(state, agent);
  const keys = new Set<string>();
  for (const f of agent.inputFields) {
    if (!f.required || (values[f.key] ?? "").trim() !== "") continue;
    const first = fieldVaultKeys(agent, f)[0];
    if (first) keys.add(first);
  }
  return [...keys];
}

export function chosenIdea(state: DashboardState): ProductIdea | null {
  for (let i = state.research.length - 1; i >= 0; i--) {
    const job = state.research[i]!;
    if (job.chosenIndex !== null) return job.ideas[job.chosenIndex] ?? null;
  }
  return null;
}

export const DEFAULT_RETURN_POLICY =
  "30-day returns for unused items in original packaging. Refund to the original payment method within 3 business days of receiving the return. Defective or damaged items: full refund or free replacement, no return shipping charge. Escalate anything else to the owner.";

const has = (text: string, word: string) => text.toLowerCase().includes(word);

/** A suggested value for a field's `suggest` name, or "" when there is no good default. */
export function suggestValue(state: DashboardState, name: string): string {
  const b = state.business;
  const e = state.economics;
  const idea = chosenIdea(state);
  const channels = b.salesChannels || idea?.salesChannels || "";
  switch (name) {
    case "business_goals": {
      if (economicsComplete(e) && e.monthlyUnits > 0) {
        const u = unitBreakdown(e);
        return `Sell ${e.monthlyUnits} units/month of ${b.product || "the product"} at about $${centsToInput(e.salePriceCents)} each, keeping contribution margin at or above ${Math.max(0, Math.round((u.contributionMarginBps ?? 0) / 100))}% (about $${centsToInput(u.contribution)} per unit). Reach monthly break-even within 3 months and never exceed the budgets and caps set by the owner.`;
      }
      return b.product ? `Launch ${b.product} profitably: validate demand, source a certified supplier, list it, and reach monthly break-even within 3 months without exceeding the owner's budgets.` : "";
    }
    case "keywords":
      if (idea && idea.keywords.length > 0) return idea.keywords.join(", ");
      return [b.product, idea?.niche].filter(Boolean).join(", ");
    case "target_margin":
      return "20";
    case "certifications":
      return idea && idea.compliance.length > 0 ? idea.compliance.join(", ") : "";
    case "unit_cost":
      return e.unitCostCents > 0 ? centsToInput(e.unitCostCents) : "";
    case "ship_to":
      return b.shippingAddress;
    case "channels":
      return channels;
    case "min_price": {
      if (!economicsComplete(e)) return "";
      const p = unitBreakdown(e).breakEvenPrice;
      return p === null ? "" : centsToInput(p);
    }
    case "brand_voice":
      return "Plain, factual and friendly. Never claim certifications, awards or results the product does not have. No exaggerated health or safety claims.";
    case "ads_platform":
      if (has(channels, "amazon")) return "Amazon Ads (Sponsored Products)";
      if (has(channels, "shopify") || has(channels, "own store")) return "Meta Ads and Google Ads";
      return "";
    case "acos":
      return e.adSpendBps > 0 ? bpsToInput(e.adSpendBps) : "25";
    case "return_policy":
      return DEFAULT_RETURN_POLICY;
    case "owner_contact":
      return b.ownerEmail;
    case "fulfillment":
      if (has(channels, "amazon")) return "Amazon FBA";
      if (has(channels, "shopify")) return "ShipBob (3PL)";
      return "";
    case "reorder_point":
      // Daily sales × (30-day lead time + 14 days safety stock).
      return e.monthlyUnits > 0 ? String(Math.ceil((e.monthlyUnits * 44) / 30)) : "";
    case "lead_time":
      return "30";
    default:
      return "";
  }
}

/**
 * Fills empty, non-secret inputs that have a suggestion. Never overwrites a
 * value the owner typed. Returns the labels it filled.
 */
export function autofillAgent(state: DashboardState, agent: Agent): string[] {
  const filled: string[] = [];
  for (const f of agent.inputFields) {
    if (!f.suggest || f.kind === "secret") continue;
    if ((agent.inputs[f.key] ?? "").trim() !== "") continue;
    const v = suggestValue(state, f.suggest);
    if (v.trim() === "") continue;
    agent.inputs[f.key] = v;
    filled.push(f.label);
  }
  return filled;
}

export function autofillAll(state: DashboardState): number {
  let n = 0;
  for (const a of state.agents) n += autofillAgent(state, a).length;
  return n;
}
