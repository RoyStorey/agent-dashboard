import { formatCents } from "../../../shared/money.ts";
import type { SectionProps } from "../App.tsx";
import { Badge, Card, EmptyState, Money, PageHeader, Stat, formatDateTime, timeAgo } from "../components/ui.tsx";
import { ActionList } from "./Todo.tsx";
import { AgentStatusBadge } from "./Agents.tsx";

export function Overview({ state, go }: SectionProps) {
  const f = state.finance;
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

      <div className="stats">
        <Stat label="Cash balance" value={<Money cents={f.cashBalanceCents} />} hint={<>Unallocated <Money cents={f.unallocatedCents} /></>} />
        <Stat label="Spent this month" value={<Money cents={f.spentThisMonthCents} />} hint={<>Today <Money cents={f.spentTodayCents} /></>} />
        <Stat label="Revenue (all time)" value={<Money cents={f.revenueCents} />} hint="Reported by agents or entered by you" />
        <Stat
          label="Profit (revenue − spend)"
          value={<Money cents={f.profitCents} />}
          tone={f.profitCents > 0 ? "good" : f.profitCents < 0 ? "bad" : undefined}
          hint={`Total spent ${formatCents(f.spentCents)}`}
        />
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
            <button className="btn btn-sm" onClick={() => go("agents")}>
              Manage
            </button>
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
                      <div className="muted">
                        Seen {timeAgo(a.lastSeenAt, state.serverTime)}
                        {a.lastStatusMessage ? ` · ${a.lastStatusMessage}` : ""}
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
