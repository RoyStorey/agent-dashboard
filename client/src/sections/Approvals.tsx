import { useState } from "react";
import { formatCents } from "../../../shared/money.ts";
import type { ActionRequest, RequestStatus, StoreDraft } from "../../../shared/types.ts";
import type { SectionProps } from "../App.tsx";
import { api } from "../api.ts";
import { Badge, Card, EmptyState, Money, MoneyBadge, MoneyInput, PageHeader, formatDateTime } from "../components/ui.tsx";

const STATUS: Record<RequestStatus, { label: string; tone: "good" | "warn" | "bad" | "info" | "neutral" }> = {
  approved: { label: "Approved — in progress", tone: "info" },
  pending_approval: { label: "Waiting for you", tone: "warn" },
  denied: { label: "Denied by guardrails", tone: "bad" },
  rejected: { label: "Rejected by you", tone: "bad" },
  completed: { label: "Completed", tone: "good" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;
}

function agentName(state: SectionProps["state"], r: ActionRequest): string {
  return state.agents.find((a) => a.id === r.agentId)?.name ?? "Removed agent";
}

function actionLabel(state: SectionProps["state"], r: ActionRequest): string {
  return state.agents.find((a) => a.id === r.agentId)?.actions.find((a) => a.key === r.action)?.label ?? r.action;
}

function PendingCard({ r, state, dash }: { r: ActionRequest } & Pick<SectionProps, "state" | "dash">) {
  const [note, setNote] = useState("");
  const af = state.finance.agents.find((a) => a.agentId === r.agentId);
  return (
    <Card
      title={
        <span className="row">
          {agentName(state, r)}: {actionLabel(state, r)}
          {r.amountCents > 0 && <Badge tone="warn">{formatCents(r.amountCents)}</Badge>}
        </span>
      }
      actions={<span className="muted">{formatDateTime(r.createdAt)}</span>}
    >
      {r.description ? <p>{r.description}</p> : <p className="muted">No description given.</p>}
      {r.priceCents !== undefined && r.priceCents !== null && (
        <div>
          <strong>New price:</strong> {formatCents(r.priceCents)}
        </div>
      )}
      <div className="help">Held because: {r.reasons.join(" ")}</div>
      {r.amountCents > 0 && (
        <div className="row">
          <MoneyBadge kind="moves" />
          <span className="help">Approving lets the agent pay {formatCents(r.amountCents)} with the card or account it was given.</span>
        </div>
      )}
      {r.amountCents > 0 && (
        <div className="help">
          Agent budget remaining: <Money cents={af?.remainingCents ?? 0} /> · Cash: <Money cents={state.finance.cashBalanceCents} />
        </div>
      )}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note to the agent (sent with a rejection)" aria-label="Note" />
      <div className="form-actions">
        <button className="btn btn-danger" onClick={() => void dash.run(() => api.reject(r.id, note), "Rejected.")}>
          Reject
        </button>
        <button className="btn btn-good-solid" onClick={() => void dash.run(() => api.approve(r.id), "Approved.")}>
          Approve{r.amountCents > 0 ? ` ${formatCents(r.amountCents)}` : ""}
        </button>
      </div>
    </Card>
  );
}

function CloseControls({ r, dash }: { r: ActionRequest; dash: SectionProps["dash"] }) {
  const [open, setOpen] = useState(false);
  const [actual, setActual] = useState<number | null>(r.amountCents);
  if (!open) {
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)}>
        Close manually
      </button>
    );
  }
  return (
    <div className="stack" style={{ gap: 6, minWidth: 200 }}>
      {r.amountCents > 0 && <MoneyInput value={actual} onChange={setActual} ariaLabel="Actual amount spent" />}
      <div className="row">
        <button
          className="btn btn-sm btn-primary"
          disabled={actual === null}
          onClick={() => void dash.run(() => api.closeRequest(r.id, "completed", actual ?? undefined), "Marked completed.")}
        >
          Completed
        </button>
        <button className="btn btn-sm" onClick={() => void dash.run(() => api.closeRequest(r.id, "cancelled"), "Cancelled; amount returned to budget.")}>
          Cancelled
        </button>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>
          ×
        </button>
      </div>
    </div>
  );
}

function DraftCard({ d, state, dash }: { d: StoreDraft } & Pick<SectionProps, "state" | "dash">) {
  const [note, setNote] = useState("");
  const author = state.agents.find((a) => a.id === d.agentId)?.name ?? "Storefront";
  return (
    <Card
      title={
        <span className="row">
          {d.kind === "product" ? "Product listing" : "Store page"}: {d.title}
          {d.priceCents !== null && <Badge tone="info">{formatCents(d.priceCents)}</Badge>}
        </span>
      }
      actions={<span className="muted">{formatDateTime(d.createdAt)}</span>}
    >
      <p className="muted" style={{ margin: 0 }}>
        Drafted by {author}. It's hidden in your Shopify store; open Shopify admin → {d.kind === "product" ? "Products" : "Online Store → Pages"} to see it in full or edit it.
      </p>
      <p style={{ margin: 0 }}>{d.preview || <span className="muted">No text.</span>}</p>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What to change (sent with a rejection)" aria-label="Note to the Storefront agent" />
      <div className="form-actions">
        <button className="btn btn-danger" onClick={() => void dash.run(() => api.rejectDraft(d.id, note), "Rejected. The agent will see your note.")}>
          Reject
        </button>
        <button
          className="btn btn-good-solid"
          onClick={() => {
            if (window.confirm(`Publish “${d.title}”? Customers will be able to see it.`)) void dash.run(() => api.publishDraft(d.id), "Published to your store.");
          }}
        >
          Publish to store
        </button>
      </div>
    </Card>
  );
}

export function Approvals({ state, dash }: SectionProps) {
  const [filter, setFilter] = useState<"all" | RequestStatus>("all");
  const pending = state.requests.filter((r) => r.status === "pending_approval");
  const inProgress = state.requests.filter((r) => r.status === "approved");
  const drafts = state.drafts.filter((d) => d.status === "pending");
  const history = state.requests.filter((r) => filter === "all" || r.status === filter);

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle="Requests your guardrails held for a human decision. Approving re-checks every hard limit, so you can never approve past a budget or cap."
      />

      {drafts.length > 0 && (
        <>
          <h2>Store drafts to review ({drafts.length})</h2>
          <div className="grid grid-2">
            {drafts.map((d) => (
              <DraftCard key={d.id} d={d} state={state} dash={dash} />
            ))}
          </div>
        </>
      )}

      {pending.length === 0 ? (
        <EmptyState title={drafts.length ? "No other requests waiting" : "Nothing waiting for approval"} />
      ) : (
        <div className="grid grid-2">
          {pending.map((r) => (
            <PendingCard key={r.id} r={r} state={state} dash={dash} />
          ))}
        </div>
      )}

      {inProgress.length > 0 && (
        <Card title={`In progress (${inProgress.length})`}>
          <p className="muted">
            Approved money is reserved until the agent reports the action complete or cancelled. If an agent crashed, close it here yourself.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Action</th>
                  <th className="right">Reserved</th>
                  <th>Approved</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {inProgress.map((r) => (
                  <tr key={r.id}>
                    <td>{agentName(state, r)}</td>
                    <td>
                      {actionLabel(state, r)}
                      {r.description && <div className="muted">{r.description}</div>}
                    </td>
                    <td className="right">
                      <Money cents={r.amountCents} />
                    </td>
                    <td className="muted">{r.decidedAt ? formatDateTime(r.decidedAt) : ""}</td>
                    <td className="right">
                      <CloseControls r={r} dash={dash} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card
        title="All requests"
        actions={
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter by status" style={{ width: "auto" }}>
            <option value="all">All statuses</option>
            {(Object.keys(STATUS) as RequestStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS[s].label}
              </option>
            ))}
          </select>
        }
      >
        {history.length === 0 ? (
          <EmptyState title="No requests" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Agent</th>
                  <th>Action</th>
                  <th className="right">Amount</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id}>
                    <td className="muted">{formatDateTime(r.createdAt)}</td>
                    <td>{agentName(state, r)}</td>
                    <td>{actionLabel(state, r)}</td>
                    <td className="right">
                      <Money cents={r.status === "completed" && r.actualAmountCents !== null ? r.actualAmountCents : r.amountCents} />
                    </td>
                    <td>
                      <RequestStatusBadge status={r.status} />
                    </td>
                    <td className="muted">
                      {r.description}
                      {r.description && r.reasons.length > 0 ? " — " : ""}
                      {r.reasons.join(" ")}
                      {r.resultNote ? ` Result: ${r.resultNote}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
