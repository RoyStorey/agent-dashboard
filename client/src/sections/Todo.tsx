import { useState } from "react";
import type { OwnerAction, OwnerTask, SectionKey, TaskCategory } from "../../../shared/types.ts";
import type { SectionProps } from "../App.tsx";
import { api } from "../api.ts";
import { Badge, Card, EmptyState, ExtLink, Field, PageHeader, ProgressBar } from "../components/ui.tsx";

const CATEGORY_LABEL: Record<TaskCategory, string> = {
  legal: "Legal & admin",
  finance: "Money & banking",
  sales: "Sales channels",
  product: "Product",
  operations: "Operations",
  custom: "Your tasks",
};

const SEVERITY_LABEL = { blocker: "Blocking", warning: "Recommended", info: "FYI" } as const;
const SEVERITY_TONE = { blocker: "bad", warning: "warn", info: "info" } as const;

export function ActionList(props: { actions: OwnerAction[]; go: (s: SectionKey, agentId?: string) => void }) {
  return (
    <div className="list">
      {props.actions.map((a) => (
        <div key={a.id} className="list-item">
          <div className={`severity severity-${a.severity}`} aria-hidden />
          <div className="grow">
            <div className="row">
              <span className="title">{a.title}</span>
              <Badge tone={SEVERITY_TONE[a.severity]}>{SEVERITY_LABEL[a.severity]}</Badge>
            </div>
            <div className="muted">{a.detail}</div>
          </div>
          <button className="btn btn-sm" onClick={() => props.go(a.section, a.agentId)}>
            Fix
          </button>
        </div>
      ))}
    </div>
  );
}

function TaskRow({ task, dash }: { task: OwnerTask; dash: SectionProps["dash"] }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(task.notes);
  const done = task.status === "done";

  return (
    <div className={`list-item ${done ? "done" : ""}`}>
      <input
        type="checkbox"
        className="check"
        style={{ width: 18, height: 18, marginTop: 2, accentColor: "var(--accent)" }}
        checked={done}
        aria-label={`Mark "${task.title}" ${done ? "not done" : "done"}`}
        onChange={() => void dash.run(() => api.updateTask(task.id, { status: done ? "todo" : "done" }))}
      />
      <div className="grow stack" style={{ gap: 8 }}>
        <div>
          <div className="row">
            <span className="title">{task.title}</span>
            {task.time && !done && <Badge>{task.time}</Badge>}
          </div>
          {task.description && !done && <div className="muted">{task.description}</div>}
          {task.notes && !open && <div className="help">Notes: {task.notes}</div>}
        </div>
        {!done && task.steps.length > 0 && (
          <ol className="steps">
            {task.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        )}
        {!done && task.links.length > 0 && (
          <div className="row">
            {task.links.map((l) => (
              <ExtLink key={l.url} href={l.url} className="link-btn">
                {l.label}
              </ExtLink>
            ))}
          </div>
        )}
        {open && (
          <div className="stack" style={{ gap: 8 }}>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes: confirmation numbers, where you saved documents…" aria-label="Notes" />
            <div className="row">
              <button
                className="btn btn-sm btn-primary"
                onClick={async () => {
                  if (await dash.run(() => api.updateTask(task.id, { notes }), "Notes saved.")) setOpen(false);
                }}
              >
                Save notes
              </button>
              {task.custom && (
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => {
                    if (window.confirm(`Delete "${task.title}"?`)) void dash.run(() => api.deleteTask(task.id));
                  }}
                >
                  Delete task
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      <button className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
        {open ? "Close" : "Notes"}
      </button>
    </div>
  );
}

export function Todo({ state, dash, go }: SectionProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const done = state.tasks.filter((t) => t.status === "done").length;
  const categories = (Object.keys(CATEGORY_LABEL) as TaskCategory[]).filter((c) => state.tasks.some((t) => t.category === c));
  const actions = state.ownerActions.filter((a) => a.id !== "open-tasks");

  return (
    <>
      <PageHeader
        title="Things you need to do"
        subtitle="Everything the business needs from you, in order. Agents run the rest. Each legal or account step has exact instructions and a direct link."
      />

      <Card title="Right now">
        {actions.length === 0 ? (
          <EmptyState title="All clear">Every agent has the inputs, funding and approvals it needs.</EmptyState>
        ) : (
          <ActionList actions={actions} go={go} />
        )}
      </Card>

      <Card
        title={`Legal & accounts: only you can do these (${done}/${state.tasks.length})`}
        actions={<span className="muted">{state.tasks.length ? Math.round((done / state.tasks.length) * 100) : 0}% complete</span>}
      >
        <ProgressBar value={done} max={state.tasks.length} label="Checklist progress" />
        {categories.map((c) => (
          <div key={c} className="stack" style={{ gap: 0 }}>
            <h4 className="nav-group" style={{ margin: "8px 0 0" }}>
              {CATEGORY_LABEL[c]}
            </h4>
            <div className="list">
              {state.tasks
                .filter((t) => t.category === c)
                .map((t) => (
                  <TaskRow key={t.id} task={t} dash={dash} />
                ))}
            </div>
          </div>
        ))}
      </Card>

      <Card title="Add your own task">
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim()) return;
            if (await dash.run(() => api.addTask({ title, description, category: "custom" }), "Task added.")) {
              setTitle("");
              setDescription("");
            }
          }}
        >
          <div className="form-grid">
            <Field label="Task" htmlFor="new-task-title" required>
              <input id="new-task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Trademark the brand name" />
            </Field>
            <Field label="Details" htmlFor="new-task-desc">
              <input id="new-task-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={!title.trim()}>
              Add task
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}
