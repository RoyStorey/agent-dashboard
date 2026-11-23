import { liveStatus } from "../components/AgentLive.tsx";
import { formatBps } from "../../../shared/economics.ts";
import { formatCents } from "../../../shared/money.ts";
import { computePnL } from "../../../shared/pnl.ts";
import { setupSteps } from "./Setup.tsx";
import type { SectionProps } from "../App.tsx";
import { Badge, Card, EmptyState, Money, PageHeader, Stat, formatDateTime } from "../components/ui.tsx";
import { ActionList } from "./Todo.tsx";
import { AgentStatusBadge } from "./Agents.tsx";

export function Overview({ state, go }: SectionProps) {
  const f = state.finance;
  const m = computePnL({ funding: state.funding, requests: state.requests, agents: state.agents, economics: state.economics, aiUsage: state.aiUsageDaily, period: "this_month", now: new Date(state.serverTime) });
  const setupLeft = setupSteps(state).filter((x) => !x.done && !x.optional).length;
  const blockers = state.ownerActions.filter((a) => a.severity === "blocker").length;
  const tasksDone = state.tasks.filter((t) => t.status === "done").length;
  const active = state.agents.filter((a) => a.status === "active").length;

  return (
    <>
      <PageHeader
        title={state.business.name ? `${state.business.name}` : "Welcome"}
        subtitle={
          state.business.product
            ? `Selling: ${state.business.product}`
            : "Set up a business run by a team of AI agents. You provide the funding, the accounts and the decisions only a human can make."
        }
      />

      {setupLeft > 0 && (
        <div className="banner banner-info">
          <span>
            <strong>Setup: {setupLeft} step{setupLeft === 1 ? "" : "s"} left.</strong> The assistant walks you through each one.
          </span>
          <button className="btn btn-primary btn-sm" onClick={() => go("setup")}>
            Continue setup
          </button>
        </div>
      )}

      <div className="stats">
        <Stat label="Cash balance" value={<Money cents={f.cashBalanceCents} />} hint={<>Unallocated <Money cents={f.unallocatedCents} /></>} />
        <Stat label="Gross sales (this month)" value={<Money cents={m.grossSales} />} hint={`${m.unitsSold} units · net sales ${formatCents(m.netSales)}`} />
        <Stat
          label="Net profit (this month)"
          value={<Money cents={m.netProfit} />}
          tone={m.netProfit > 0 ? "good" : m.netProfit < 0 ? "bad" : undefined}
          hint={`Net margin ${formatBps(m.netMarginBps)} · gross margin ${formatBps(m.grossMarginBps)}`}
        />
        <Stat label="Spent this month" value={<Money cents={f.spentThisMonthCents} />} hint={<>Today <Money cents={f.spentTodayCents} /></>} />
      </div>

      <div className="grid grid-2">
        <Card
          title={
            <span className="row">
              What you need to do next {blockers > 0 && <Badge tone="bad">{blockers} blocking</Badge>}
            </span>
          }
          actions={
            <button className="btn btn-sm" onClick={() => go("todo")}>
              See all
            </button>
          }
        >
          {state.ownerActions.length === 0 ? (
            <EmptyState title="Nothing needs you right now">Your agents have everything they need.</EmptyState>
          ) : (
            <ActionList actions={state.ownerActions.slice(0, 6)} go={go} />
          )}
          <div className="muted">
            Setup checklist: {tasksDone} of {state.tasks.length} done
          </div>
        </Card>

        <Card
          title={`Agent team (${active} of ${state.agents.length} active)`}
          actions={
            <div className="row">
              <button className="btn btn-sm" onClick={() => go("team")}>
                See them work
              </button>
              <button className="btn btn-sm" onClick={() => go("agents")}>
                Manage
              </button>
            </div>
          }
        >
          {state.agents.length === 0 ? (
            <EmptyState title="No agents yet">
              <button className="btn btn-primary btn-sm" onClick={() => go("agents")}>
                Add your first agent
              </button>
            </EmptyState>
          ) : (
            <div className="list">
              {state.agents.map((a) => {
                const af = f.agents.find((x) => x.agentId === a.id);
                return (
                  <button key={a.id} className="list-item nav-btn" onClick={() => go("agents", a.id)}>
                    <div className="agent-avatar" aria-hidden>
                      {a.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="grow">
                      <div className="title">{a.name}</div>
                      <div className={a.runtime.state === "working" ? "" : "muted"}>
                        {liveStatus(state, a).detail}
                        {a.runtime.state !== "working" && a.lastStatusMessage ? ` · ${a.lastStatusMessage}` : ""}
                      </div>
                    </div>
                    <div className="stack" style={{ alignItems: "flex-end", gap: 4 }}>
                      <AgentStatusBadge state={state} agentId={a.id} />
                      <span className="muted num">
                        <Money cents={af?.remainingCents ?? 0} /> left
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Recent activity"
        actions={
          <button className="btn btn-sm" onClick={() => go("activity")}>
            View log
          </button>
        }
      >
        {state.activity.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <div className="list">
            {state.activity.slice(0, 8).map((e) => (
              <div key={e.id} className="list-item">
                <div className={`severity severity-${e.level === "error" ? "blocker" : e.level === "warning" ? "warning" : "info"}`} />
                <div className="grow">
                  <strong>{e.actor}</strong> <span>{e.message}</span>
                </div>
                <span className="muted">{formatDateTime(e.at)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
