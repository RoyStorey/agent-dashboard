import { unitBreakdown, bpsToInput, economicsComplete } from "../shared/economics.ts";
import { centsToInput } from "../shared/money.ts";
import { channelNames, detectChannels, findChannel, orderByChannels } from "../shared/channels.ts";
import { llmVaultKey } from "../shared/services.ts";
import type { Agent, DashboardState, FulfillmentMode, InputField, InputSource, ProductIdea } from "../shared/types.ts";

/**
 * Vault keys a field can draw from, with "llm" resolved for the agent's provider
 * and the selected sales channels' keys tried first.
 */
export function fieldVaultKeys(agent: Pick<Agent, "connection">, field: InputField, channels: string[] = []): string[] {
  const out: string[] = [];
  for (const k of field.vault ?? []) {
    if (k === "llm") {
      const resolved = llmVaultKey(agent.connection.provider);
      if (resolved) out.push(resolved);
    } else {
      out.push(k);
    }
  }
  return orderByChannels(out, channels);
}

export interface ResolvedInputs {
  values: Record<string, string>;
  sources: Record<string, InputSource>;
}

/** Effective input values: a manual value wins; otherwise the first saved vault entry. */
type InputsState = Pick<DashboardState, "vault"> & { business?: { channels: string[]; fulfillmentMode?: FulfillmentMode | null } };

/** Whether a field must be filled right now (some fields aren't needed while you ship orders yourself). */
export function requiredNow(state: InputsState, f: InputField): boolean {
  return f.required && !(f.notNeededWhenSelfShipping && state.business?.fulfillmentMode === "self");
}

export function resolveInputs(state: InputsState, agent: Agent): ResolvedInputs {
  const channels = state.business?.channels ?? [];
  const values: Record<string, string> = {};
  const sources: Record<string, InputSource> = {};
  for (const f of agent.inputFields) {
    const manual = agent.inputs[f.key] ?? "";
    if (manual.trim() !== "") {
      values[f.key] = manual;
      sources[f.key] = { type: "manual" };
      continue;
    }
    const key = fieldVaultKeys(agent, f, channels).find((k) => (state.vault[k]?.value ?? "").trim() !== "");
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

export function missingInputs(state: InputsState, agent: Agent): string[] {
  const { values } = resolveInputs(state, agent);
  return agent.inputFields.filter((f) => requiredNow(state, f) && (values[f.key] ?? "").trim() === "").map((f) => f.label);
}

/** Vault keys that would fill this agent's missing required inputs (first choice per field). */
export function missingVaultKeys(state: InputsState, agent: Agent): string[] {
  const { values } = resolveInputs(state, agent);
  const keys = new Set<string>();
  for (const f of agent.inputFields) {
    if (!requiredNow(state, f) || (values[f.key] ?? "").trim() !== "") continue;
    const first = fieldVaultKeys(agent, f, state.business?.channels ?? [])[0];
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

/** A suggested value for a field's `suggest` name, or "" when there is no good default. */
export function suggestValue(state: DashboardState, name: string): string {
  const b = state.business;
  const e = state.economics;
  const idea = chosenIdea(state);
  const channels = channelNames(b.channels) || b.salesChannels || idea?.salesChannels || "";
  const primary = findChannel(b.channels[0] ?? "") ?? findChannel(detectChannels(channels)[0] ?? "");
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
      return primary?.adsPlatform ?? "";
    case "acos":
      return e.adSpendBps > 0 ? bpsToInput(e.adSpendBps) : "25";
    case "return_policy":
      return DEFAULT_RETURN_POLICY;
    case "owner_contact":
      return b.ownerEmail;
    case "fulfillment":
      if (b.fulfillmentMode === "self") return "Ship it myself: the dashboard's Pack & ship queue (the owner packs and drops off)";
      if (b.fulfillmentMode === "marketplace") return "Amazon FBA";
      return primary?.fulfillment ?? "";
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

/**
 * After the plan changes (channels, product, prices), updates auto-filled
 * details that still hold the old suggestion. Values the owner typed are kept.
 */
export function refreshSuggestedInputs(before: DashboardState, after: DashboardState): number {
  let n = 0;
  for (const a of after.agents) {
    for (const f of a.inputFields) {
      if (!f.suggest || f.kind === "secret") continue;
      const current = a.inputs[f.key] ?? "";
      const old = suggestValue(before, f.suggest);
      if (current.trim() !== "" && current !== old) continue;
      const next = suggestValue(after, f.suggest);
      if (next.trim() !== "" && next !== current) {
        a.inputs[f.key] = next;
        n++;
      }
    }
  }
  return n;
}
