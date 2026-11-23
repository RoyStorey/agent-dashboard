import { useState } from "react";
import { formatCents } from "../../../shared/money.ts";
import { PHASES, PHASE_GOAL, PHASE_LABEL, ROLE_FIRST_PHASE, SCHEDULE_CHOICES } from "../../../shared/team.ts";
import type { AgentRun, AgentView, QueueEntry, QueueTodo, StateResponse } from "../../../shared/types.ts";
import type { SectionProps } from "../App.tsx";
import { api } from "../api.ts";
import { LiveBadge, elapsed, liveStatus } from "../components/AgentLive.tsx";
import { Badge, Card, EmptyState, PageHeader, formatDateTime } from "../components/ui.tsx";

const RUN_TONE: Record<AgentRun["status"], "good" | "warn" | "bad" | "info"> = { running: "info", done: "good", stopped: "warn", error: "bad" };
const RUN_LABEL: Record<AgentRun["status"], string> = { running: "Working", done: "Done", stopped: "Stopped", error: "Failed" };

/** "next minute", "in 4 min", "at 6:12 PM", "Tue 6:12 PM". */
export function whenLabel(at: string | null, nowIso: string): string {
  if (!at) return "when it can";
  const diff = new Date(at).getTime() - new Date(nowIso).getTime();
  if (diff <= 90_000) return "next minute";
  if (diff < 60 * 60_000) return `in ${Math.round(diff / 60_000)} min`;
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date(nowIso).toDateString() ? `at ${time}` : `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

/** One plain sentence about what's next for an agent. */
function nextLine(q: QueueEntry | undefined, nowIso: string): string | null {
  if (!q) return null;
  switch (q.lane) {
    case "now":
      return null;
    case "next":
      return q.waitingFor && !q.at ? `Up next: ${q.reason}. ${q.waitingFor}` : `Starts ${whenLabel(q.at, nowIso)}: ${q.reason}.`;
    case "later":
      return q.reason ? `Starts ${whenLabel(q.at, nowIso)}: ${q.reason}.${q.waitingFor ? ` ${q.waitingFor}` : ""}` : `Next check ${whenLabel(q.at, nowIso)}. It only runs if something changed.`;
    default:
      return q.waitingFor;
  }
}

const TODO_ICON: Record<QueueTodo["kind"], string> = { continue: "↻", note: "✉", finish: "☐", owner: "⏳" };

function TodoList({ todo }: { todo: QueueTodo[] }) {
  if (!todo.length) return null;
  return (
    <ul className="todo-list">
      {todo.map((x, i) => (
        <li key={i} className={`todo-${x.kind}`}>
          <span aria-hidden>{TODO_ICON[x.kind]}</span> {x.text}
        </li>
      ))}
    </ul>
  );
}

function QueueBoard({ state, go }: Pick<SectionProps, "state" | "go">) {
  const now = state.serverTime;
  const byId = new Map(state.agents.map((a) => [a.id, a]));
  const entries = state.queue.filter((q) => byId.has(q.agentId));
  const working = entries.filter((q) => q.lane === "now");
  const next = entries
    .filter((q) => q.lane === "next")
    .sort((a, b) => (a.at && b.at ? a.at.localeCompare(b.at) : a.at ? -1 : b.at ? 1 : 0));
  const later = entries.filter((q) => q.lane === "later").sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  const blocked = entries.filter((q) => q.lane === "blocked" || q.lane === "off");
  const yours = [
    ...state.requests
      .filter((r) => r.status === "pending_approval")
      .map((r) => ({
        id: r.id,
        who: byId.get(r.agentId)?.name ?? "An agent",
        text: r.action === "advance_phase" ? "wants to move the team to the next phase" : `asks: ${byId.get(r.agentId)?.actions.find((a) => a.key === r.action)?.label ?? r.action}${r.amountCents ? ` (${formatCents(r.amountCents)})` : ""}`,
      })),
    ...state.drafts.filter((d) => d.status === "pending").map((d) => ({ id: d.id, who: byId.get(d.agentId)?.name ?? "Storefront", text: `drafted “${d.title}” for your review` })),
  ];
  const name = (q: QueueEntry) => byId.get(q.agentId)!.name;
  const step = (q: QueueEntry) => byId.get(q.agentId)!.runtime.step;

  return (
    <Card title="Queue">
      <div className="queue">
        <section className="lane lane-now" aria-label="Working now">
          <h3>
            Working now <span className="lane-count">{working.length}</span>
          </h3>
          {working.length === 0 && <p className="muted lane-empty">Nobody is working right now.</p>}
          {working.map((q) => (
            <div key={q.agentId} className="qcard qcard-now">
              <div className="row between">
                <strong>
                  <span className="live-dot" aria-hidden />
                  {name(q)}
                </strong>
                <span className="muted">{elapsed(q.at, now)}</span>
              </div>
              <div className="qstep">{step(q) ?? "Working"}</div>
              {q.reason && <div className="help">Task: {q.reason}</div>}
            </div>
          ))}
        </section>

        <section className="lane" aria-label="Up next">
          <h3>
            Up next <span className="lane-count">{next.length}</span>
          </h3>
          {next.length === 0 && <p className="muted lane-empty">Nothing queued. Agents start when something new comes in.</p>}
          <ol className="qlist">
            {next.map((q) => (
              <li key={q.agentId} className="qcard">
                <div className="row between">
                  <strong>{name(q)}</strong>
                  <Badge tone={q.at ? "info" : "neutral"}>{q.at ? whenLabel(q.at, now) : "waiting"}</Badge>
                </div>
                <div>{q.reason}</div>
                {q.waitingFor && <div className="help">{q.waitingFor}</div>}
                <TodoList todo={q.todo.filter((x) => x.kind !== "owner")} />
              </li>
            ))}
          </ol>
        </section>

        <section className="lane lane-you" aria-label="Waiting on you">
          <h3>
            Waiting on you <span className={`lane-count ${yours.length ? "alert" : ""}`}>{yours.length}</span>
          </h3>
          {yours.length === 0 && <p className="muted lane-empty">Nothing needs you right now.</p>}
          {yours.map((y) => (
            <div key={y.id} className="qcard qcard-you">
              <div>
                <strong>{y.who}</strong> {y.text}
              </div>
            </div>
          ))}
          {yours.length > 0 && (
            <button className="btn btn-sm btn-primary" onClick={() => go("approvals")}>
              Review on Approvals
            </button>
          )}
        </section>
      </div>

      {(later.length > 0 || blocked.length > 0) && (
        <details className="later">
          <summary>
            Later:{" "}
            {[later.length ? `${later.length} scheduled check${later.length === 1 ? "" : "s"}` : "", blocked.length ? `${blocked.length} not running yet` : ""].filter(Boolean).join(", ")}
          </summary>
          <div className="table-wrap">
            <table>
              <tbody>
                {later.map((q) => (
                  <tr key={q.agentId}>
                    <td style={{ whiteSpace: "nowrap" }}>{name(q)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{whenLabel(q.at, now)}</td>
                    <td className="muted">{q.reason ? `${q.reason}.${q.waitingFor ? ` ${q.waitingFor}` : ""}` : "Checks for new work; only runs if something changed."}</td>
                  </tr>
                ))}
                {blocked.map((q) => (
                  <tr key={q.agentId}>
                    <td style={{ whiteSpace: "nowrap" }}>{name(q)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{q.lane === "off" ? "Not scheduled" : "Not yet"}</td>
                    <td className="muted">{q.waitingFor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Card>
  );
}

export function Team({ state, dash, go }: SectionProps) {
  const working = state.agents.filter((a) => a.runtime.state === "working").length;
  return (
    <>
      <PageHeader
        title="Team at work"
        subtitle="What each agent is doing right now, and when it last worked. Agents check for new work on a schedule; a check that finds nothing new is free, so idle agents cost nothing."
      />
      <QueueBoard state={state} go={go} />
      <PhaseCard state={state} dash={dash} go={go} />
      <Card title={`The team${working ? ` · ${working} working now` : ""}`}>
        {state.agents.length === 0 ? (
          <EmptyState title="No agents yet">
            <button className="btn btn-sm" onClick={() => go("agents")}>
              Add your team
            </button>
          </EmptyState>
        ) : (
          <div className="list">
            {state.agents.map((a) => (
              <AgentRow key={a.id} agent={a} state={state} dash={dash} go={go} />
            ))}
          </div>
        )}
        <p className="help">
          An agent wakes early when a teammate or you write it a note, when you decide one of its requests, or when the team moves to its phase. Run now skips the “anything new?” check; your guardrails and AI budget still apply.
        </p>
      </Card>
      <div className="grid grid-2">
        <Notebook state={state} dash={dash} go={go} />
        <Runs state={state} />
      </div>
    </>
  );
}

function PhaseCard({ state, dash }: SectionProps) {
  const [editing, setEditing] = useState(false);
  const [brief, setBrief] = useState(state.plan.brief);
  const i = PHASES.indexOf(state.plan.phase);
  const next = PHASES[i + 1];
  const setPhase = (p: string) => {
    if (!window.confirm(`Move the whole team to “${PHASE_LABEL[p as keyof typeof PHASE_LABEL]}”? Agents for that phase start on their next check.`)) return;
    void dash.run(() => api.updatePlan({ phase: p }), "Phase changed.");
  };
  return (
    <Card
      title={`Phase: ${PHASE_LABEL[state.plan.phase]}`}
      actions={
        next && (
          <button className="btn btn-sm" onClick={() => setPhase(next)}>
            Move to {PHASE_LABEL[next]}
          </button>
        )
      }
    >
      <ol className="phase-steps" aria-label="Phases">
        {PHASES.map((p, n) => (
          <li key={p} className={n < i ? "done" : n === i ? "current" : ""} aria-current={n === i ? "step" : undefined}>
            <button className="linklike" onClick={() => n !== i && setPhase(p)} disabled={n === i} title={PHASE_GOAL[p]}>
              {PHASE_LABEL[p]}
            </button>
          </li>
        ))}
      </ol>
      <p className="muted">
        <strong>Goal:</strong> {PHASE_GOAL[state.plan.phase]} Working now:{" "}
        {state.agents
          .filter((a) => PHASES.indexOf(ROLE_FIRST_PHASE[a.role] ?? "research") <= i)
          .map((a) => a.name)
          .join(", ") || "nobody yet"}
        .
      </p>
      <div className="stack" style={{ gap: 6 }}>
        <div className="row between">
          <strong>Team brief</strong>
          {!editing && (
            <button
              className="btn btn-sm"
              onClick={() => {
                setBrief(state.plan.brief);
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
        </div>
        {editing ? (
          <>
            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={4} maxLength={1500} aria-label="Team brief" />
            <div className="row">
              <button
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  if (await dash.run(() => api.updatePlan({ brief }), "Brief saved.")) setEditing(false);
                }}
              >
                Save
              </button>
              <button className="btn btn-sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{state.plan.brief || <span className="muted">The Orchestrator writes this on its first run.</span>}</p>
        )}
        {state.plan.updatedBy && (
          <span className="help">
            Last updated by {state.plan.updatedBy}
            {state.plan.updatedAt ? `, ${formatDateTime(state.plan.updatedAt)}` : ""}.
          </span>
        )}
      </div>
    </Card>
  );
}

function AgentRow({ agent, state, dash, go }: SectionProps & { agent: AgentView }) {
  const live = liveStatus(state, agent);
  const lastRun = state.runs.find((r) => r.agentId === agent.id && r.status !== "running");
  const scheduleValue = agent.schedule.enabled ? String(agent.schedule.everyMinutes) : "off";
  const choices = SCHEDULE_CHOICES.some((c) => c.minutes === agent.schedule.everyMinutes)
    ? SCHEDULE_CHOICES
    : [...SCHEDULE_CHOICES, { minutes: agent.schedule.everyMinutes, label: `every ${agent.schedule.everyMinutes} min` }];
  return (
    <div className="list-item team-row">
      <div className="agent-avatar" aria-hidden>
        {agent.name.slice(0, 1).toUpperCase()}
      </div>
      <div className="grow stack" style={{ gap: 4 }}>
        <div className="row">
          <button className="linklike title" onClick={() => go("agents", agent.id)}>
            {agent.name}
          </button>
          <LiveBadge status={live} />
        </div>
        <div className={live.working ? "" : "muted"} style={{ fontSize: 13 }}>
          {live.detail}
        </div>
        {(() => {
          const q = state.queue.find((x) => x.agentId === agent.id);
          const line = nextLine(q, state.serverTime);
          return (
            <>
              {line && <div className="help next-line">{line}</div>}
              {q && <TodoList todo={q.todo} />}
            </>
          );
        })()}
        {lastRun && !live.working && (
          <div className="help">
            Last run {formatDateTime(lastRun.startedAt)} ({formatCents(lastRun.costCents)}): {lastRun.summary || lastRun.error || RUN_LABEL[lastRun.status]}
          </div>
        )}
      </div>
      <div className="row team-controls">
        <select
          value={scheduleValue}
          aria-label={`How often ${agent.name} checks for work`}
          onChange={(e) => {
            const v = e.target.value;
            void dash.run(
              () => api.setSchedule(agent.id, v === "off" ? { enabled: false } : { enabled: true, everyMinutes: Number(v) }),
              v === "off" ? `${agent.name} only runs when you click Run now.` : "Schedule saved.",
            );
          }}
        >
          {choices.map((c) => (
            <option key={c.minutes} value={String(c.minutes)}>
              Checks {c.label}
            </option>
          ))}
          <option value="off">Only when I click Run now</option>
        </select>
        {live.working ? (
          <button className="btn btn-sm" onClick={() => void dash.run(() => api.stopAgent(agent.id), `Stopping ${agent.name}.`)}>
            Stop
          </button>
        ) : (
          <button
            className="btn btn-sm btn-primary"
            disabled={agent.status !== "active" || state.guardrails.killSwitch}
            title={agent.status !== "active" ? "Activate this agent first" : undefined}
            onClick={() => void dash.run(() => api.runAgent(agent.id), `${agent.name} started.`)}
          >
            Run now
          </button>
        )}
      </div>
    </div>
  );
}

function Notebook({ state, dash }: SectionProps) {
  const roles = [...new Set(state.agents.map((a) => a.role))];
  const [to, setTo] = useState("all");
  const [text, setText] = useState("");
  const [filter, setFilter] = useState("all");
  const name = (role: string) => (role === "all" ? "Everyone" : role === "owner" ? "You" : (state.agents.find((a) => a.role === role)?.name ?? role));
  const notes = state.notebook.filter((n) => filter === "all" || n.to.includes(filter) || state.agents.find((a) => a.id === n.authorId)?.role === filter || (filter === "owner" && n.authorId === null));
  return (
    <Card
      title="Team notebook"
      actions={
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter notes" style={{ width: "auto" }}>
          <option value="all">All notes</option>
          <option value="owner">To or from you</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {name(r)}
            </option>
          ))}
        </select>
      }
    >
      <form
        className="stack"
        style={{ gap: 6 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (await dash.run(() => api.addNote([to], text), "Note added. It wakes the agents it's for.")) setText("");
        }}
      >
        <div className="row note-form">
          <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Note for" style={{ width: "auto" }}>
            <option value="all">To everyone</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                To {name(r)}
              </option>
            ))}
          </select>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell the team something…" aria-label="Note" maxLength={2000} />
          <button className="btn btn-primary" disabled={!text.trim()}>
            Add
          </button>
        </div>
      </form>
      {notes.length === 0 ? (
        <p className="muted">No notes yet. Agents write here to share findings and hand work to each other.</p>
      ) : (
        <div className="list notebook">
          {notes.map((n) => (
            <div key={n.id} className="list-item" style={{ display: "block" }}>
              <div className="row between muted" style={{ fontSize: 12 }}>
                <span>
                  <strong>{n.authorId ? n.author : "You"}</strong> → {n.to.map(name).join(", ")}
                </span>
                <span>{formatDateTime(n.at)}</span>
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{n.text}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Runs({ state }: { state: StateResponse }) {
  const [agent, setAgent] = useState("all");
  const runs = state.runs.filter((r) => agent === "all" || r.agentId === agent);
  const total = runs.reduce((s, r) => s + r.costCents, 0);
  return (
    <Card
      title="Work log"
      actions={
        <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Filter runs" style={{ width: "auto" }}>
          <option value="all">Everyone</option>
          {state.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      }
    >
      {runs.length === 0 ? (
        <p className="muted">No runs yet. Each time an agent works, you'll see when, why, every step it took, and what it cost.</p>
      ) : (
        <div className="list">
          {runs.map((r) => {
            const a = state.agents.find((x) => x.id === r.agentId);
            return (
              <details key={r.id} className="list-item run-item" open={r.status === "running"}>
                <summary>
                  <div className="row between">
                    <span>
                      <strong>{a?.name ?? "Removed agent"}</strong> <span className="muted">· {formatDateTime(r.startedAt)}</span>
                    </span>
                    <span className="row" style={{ gap: 6 }}>
                      <span className="muted num">{formatCents(r.costCents)}</span>
                      <Badge tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</Badge>
                    </span>
                  </div>
                  <div className="help">
                    Why: {r.reason}
                    {r.finishedAt ? ` · took ${elapsed(r.startedAt, r.finishedAt)}` : ""}
                  </div>
                </summary>
                {r.steps.length > 0 && (
                  <ol className="run-steps">
                    {r.steps.map((s, i) => (
                      <li key={i}>
                        <span className="muted">{new Date(s.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span> {s.text}
                      </li>
                    ))}
                  </ol>
                )}
                {(r.summary || r.error) && <p style={{ margin: "6px 0 0" }}>{r.summary || <span style={{ color: "var(--bad-strong)" }}>{r.error}</span>}</p>}
                {r.summary && r.error && <p className="help">{r.error}</p>}
                <p className="help">
                  {(r.inputTokens + r.outputTokens).toLocaleString()} tokens ({r.inputTokens.toLocaleString()} in, {r.outputTokens.toLocaleString()} out){r.trigger === "manual" ? " · started by you" : ""}
                </p>
              </details>
            );
          })}
        </div>
      )}
      <p className="help">
        Showing the latest {runs.length} runs, {formatCents(total)} in total.
      </p>
    </Card>
  );
}
