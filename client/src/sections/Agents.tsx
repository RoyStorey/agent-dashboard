import { useState } from "react";
import { AGENT_TEMPLATES } from "../../../shared/templates.ts";
import type { StateResponse } from "../../../shared/types.ts";
import type { SectionProps } from "../App.tsx";
import { api } from "../api.ts";
import { Badge, Card, EmptyState, Money, PageHeader, ProgressBar, timeAgo } from "../components/ui.tsx";
import { AgentDetail } from "./AgentDetail.tsx";

export function AgentStatusBadge({ state, agentId }: { state: StateResponse; agentId: string }) {
  const agent = state.agents.find((a) => a.id === agentId);
  const readiness = state.readiness.find((r) => r.agentId === agentId);
  if (!agent) return null;
  if (agent.status === "active") {
    return state.guardrails.killSwitch ? <Badge tone="bad">Stopped</Badge> : <Badge tone="good">Active</Badge>;
  }
  if (agent.status === "paused") return <Badge tone="warn">Paused</Badge>;
  if (readiness && !readiness.ready) return <Badge tone="bad">Needs input</Badge>;
  return <Badge tone="info">Ready to activate</Badge>;
}

export function Agents(props: SectionProps & { agentId?: string }) {
  const { state, dash, go, agentId } = props;
  const [showAdd, setShowAdd] = useState(state.agents.length === 0);

  if (agentId) {
    const agent = state.agents.find((a) => a.id === agentId);
    if (!agent) {
      return (
        <EmptyState title="Agent not found">
          <button className="btn btn-sm" onClick={() => go("agents")}>
            Back to the team
          </button>
        </EmptyState>
      );
    }
    return <AgentDetail {...props} agent={agent} />;
  }

  const addAgent = async (role: string) => {
    try {
      const res = await api.addAgent(role);
      await dash.run(async () => res, "Agent added. Fill in its inputs next.");
      go("agents", res.createdAgentId);
    } catch (e) {
      dash.notify("error", e instanceof Error ? e.message : String(e));
    }
  };

  const roleCounts = new Map<string, number>();
  for (const a of state.agents) roleCounts.set(a.role, (roleCounts.get(a.role) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="Agent team"
        subtitle="Each agent has one job. Connect any AI agent (Claude, another model, or your own script) by giving it its API token. The dashboard enforces your guardrails on every request it makes."
        actions={
          <button className="btn btn-primary" onClick={() => setShowAdd((s) => !s)}>
            {showAdd ? "Hide templates" : "Add agent"}
          </button>
        }
      />

      {showAdd && (
        <Card title="Add an agent from a template">
          <div className="grid grid-3">
            {AGENT_TEMPLATES.map((t) => {
              const n = roleCounts.get(t.role) ?? 0;
              return (
                <button key={t.role} className="card agent-card template-card" onClick={() => void addAgent(t.role)}>
                  <div className="row between">
                    <span className="title">{t.name}</span>
                    {n > 0 ? <Badge tone="good">On team{n > 1 ? ` ×${n}` : ""}</Badge> : <Badge>Add</Badge>}
                  </div>
                  <span className="muted">{t.description}</span>
                  <span className="help">
                    Needs from you: {t.inputFields.filter((f) => f.required).map((f) => f.label).join(", ")}
                  </span>
                </button>
              );
            })}
            <button className="card agent-card template-card" onClick={() => void addAgent("custom")}>
              <div className="row between">
                <span className="title">Custom agent</span>
                <Badge>Add</Badge>
              </div>
              <span className="muted">Start blank and define your own inputs and actions. Use this for any job the templates don't cover.</span>
            </button>
          </div>
        </Card>
      )}

      {state.agents.length === 0 ? (
        <EmptyState title="Your team is empty">Pick templates above. A typical starting team: Orchestrator, Research, Sourcing, Storefront and Finance.</EmptyState>
      ) : (
        <div className="grid grid-3">
          {state.agents.map((a) => {
            const af = state.finance.agents.find((x) => x.agentId === a.id);
            const r = state.readiness.find((x) => x.agentId === a.id);
            const pending = state.requests.filter((x) => x.agentId === a.id && x.status === "pending_approval").length;
            return (
              <div
                key={a.id}
                className="card agent-card"
                role="button"
                tabIndex={0}
                onClick={() => go("agents", a.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    go("agents", a.id);
                  }
                }}
              >
                <div className="row between" style={{ flexWrap: "nowrap" }}>
                  <div className="row" style={{ flexWrap: "nowrap", minWidth: 0 }}>
                    <div className="agent-avatar" aria-hidden>
                      {a.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className="title">{a.name}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {a.connection.model || "No model set"} · seen {timeAgo(a.lastSeenAt, state.serverTime)}
                      </div>
                    </div>
                  </div>
                  <AgentStatusBadge state={state} agentId={a.id} />
                </div>
                <div className="muted">{a.description || "No description."}</div>
                {r && r.missingInputs.length > 0 && (
                  <div className="help" style={{ color: "var(--bad-strong)" }}>
                    Missing: {r.missingInputs.join(", ")}
                  </div>
                )}
                {pending > 0 && <Badge tone="warn">{pending} awaiting approval</Badge>}
                <div className="stack" style={{ gap: 4 }}>
                  <div className="row between muted" style={{ fontSize: 12 }}>
                    <span>
                      Spent <Money cents={af?.spentCents ?? 0} /> of <Money cents={a.budgetCents} />
                    </span>
                    <span>
                      <Money cents={af?.remainingCents ?? 0} /> left
                    </span>
                  </div>
                  <ProgressBar value={af?.spentCents ?? 0} max={a.budgetCents} label={`${a.name} budget used`} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
