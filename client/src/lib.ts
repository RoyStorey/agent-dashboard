import { llmVaultKey } from "../../shared/services.ts";
import type { AgentView, InputField, StateResponse } from "../../shared/types.ts";

/** Vault keys a field can use, with "llm" resolved for the agent's provider. */
export function fieldVaultKeys(agent: AgentView, field: InputField): string[] {
  return (field.vault ?? []).flatMap((k) => {
    if (k !== "llm") return [k];
    const r = llmVaultKey(agent.connection.provider);
    return r ? [r] : [];
  });
}

/** Agents with at least one field that can draw on this vault key. */
export function agentsUsing(state: StateResponse, key: string): AgentView[] {
  return state.agents.filter((a) => a.inputFields.some((f) => fieldVaultKeys(a, f).includes(key)));
}

/** Vault keys referenced by the current team, in catalog order of first use. */
export function teamVaultKeys(state: StateResponse): string[] {
  const keys = new Set<string>();
  for (const a of state.agents) for (const f of a.inputFields) for (const k of fieldVaultKeys(a, f)) keys.add(k);
  return [...keys];
}

/** Vault keys that would unblock at least one agent right now. */
export function missingVaultKeys(state: StateResponse): string[] {
  return [...new Set(state.readiness.flatMap((r) => r.missingVaultKeys))];
}

/** Required fields with no value that no credential can fill: the owner types these on the agent. */
export function manualMissingFields(agent: AgentView): InputField[] {
  return agent.inputFields.filter(
    (f) => f.required && agent.inputSources[f.key]?.type === "none" && fieldVaultKeys(agent, f).length === 0,
  );
}

export function isVaultSet(state: StateResponse, key: string): boolean {
  return state.vault.some((v) => v.key === key && v.set);
}
