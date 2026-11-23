import { useEffect, useState } from "react";
import { formatCents } from "../../../shared/money.ts";
import { findService } from "../../../shared/services.ts";
import type { ActionDef, AgentGuardrails, AgentView, InputField, InputKind, InputSource } from "../../../shared/types.ts";
import type { SectionProps } from "../App.tsx";
import { api } from "../api.ts";
import { Badge, Card, EmptyState, Field, Money, MoneyInput, ProgressBar, formatDateTime, timeAgo } from "../components/ui.tsx";
import { AgentStatusBadge } from "./Agents.tsx";
import { RequestStatusBadge } from "./Approvals.tsx";

type Tab = "inputs" | "guardrails" | "connect" | "setup" | "requests";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "inputs", label: "Inputs" },
  { key: "guardrails", label: "Guardrails" },
  { key: "connect", label: "Connect" },
  { key: "setup", label: "Job & actions" },
  { key: "requests", label: "Requests" },
];

type Props = SectionProps & { agent: AgentView };

export function AgentDetail(props: Props) {
  const { state, dash, go, agent } = props;
  const [tab, setTab] = useState<Tab>("inputs");
  const af = state.finance.agents.find((a) => a.agentId === agent.id);
  const readiness = state.readiness.find((r) => r.agentId === agent.id);

  const setStatus = (status: "active" | "paused") =>
    void dash.run(() => api.updateAgent(agent.id, { status }), status === "active" ? `${agent.name} activated.` : `${agent.name} paused.`);

  return (
    <>
      <div className="row">
        <button className="btn btn-sm" onClick={() => go("agents")}>
          ← Team
        </button>
      </div>
      <div className="page-head">
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <div className="agent-avatar" aria-hidden style={{ width: 44, height: 44, fontSize: 18 }}>
            {agent.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div className="row">
              <h2>{agent.name}</h2>
              <AgentStatusBadge state={state} agentId={agent.id} />
            </div>
            <p className="muted">
              {agent.description || "No description."} Last seen {timeAgo(agent.lastSeenAt, state.serverTime)}
              {agent.lastStatusMessage ? ` — “${agent.lastStatusMessage}”` : ""}.
            </p>
          </div>
        </div>
        <div className="page-actions">
          {agent.status === "active" ? (
            <button className="btn" onClick={() => setStatus("paused")}>
              Pause
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={!readiness?.ready}
              title={readiness?.ready ? "" : "Fill in every required input first"}
              onClick={() => setStatus("active")}
            >
              Activate
            </button>
          )}
          <button
            className="btn btn-danger"
            onClick={async () => {
              if (!window.confirm(`Remove ${agent.name}? Its token stops working and its unspent budget returns to unallocated funds.`)) return;
              if (await dash.run(() => api.deleteAgent(agent.id), `${agent.name} removed.`)) go("agents");
            }}
          >
            Remove
          </button>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Budget used</div>
          <div className="stat-value">
            <Money cents={af?.spentCents ?? 0} />
            <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>
              {" "}
              / {formatCents(agent.budgetCents)}
            </span>
          </div>
          <ProgressBar value={af?.spentCents ?? 0} max={agent.budgetCents} label="Budget used" />
        </div>
        <div className="stat">
          <div className="stat-label">Remaining budget</div>
          <div className="stat-value">
            <Money cents={af?.remainingCents ?? 0} />
          </div>
          <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => go("funding")}>
            Change budget
          </button>
        </div>
        <div className="stat">
          <div className="stat-label">Spent today</div>
          <div className="stat-value">
            <Money cents={af?.spentTodayCents ?? 0} />
          </div>
          <div className="stat-hint">
            Daily limit:{" "}
            {agent.guardrails.dailySpendLimitCents === null ? "none" : formatCents(agent.guardrails.dailySpendLimitCents)}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">AI usage this month</div>
          <div className="stat-value">
            <Money cents={af?.aiThisMonthCents ?? 0} />
          </div>
          <div className="stat-hint">Estimated from what this agent reports</div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === "inputs" && readiness && readiness.missingInputs.length > 0 && (
              <>
                {" "}
                <Badge tone="bad">{readiness.missingInputs.length}</Badge>
              </>
            )}
          </button>
        ))}
      </div>

      {tab === "inputs" && <InputsTab {...props} />}
      {tab === "guardrails" && <GuardrailsTab {...props} />}
      {tab === "connect" && <ConnectTab {...props} />}
      {tab === "setup" && <SetupTab {...props} />}
      {tab === "requests" && <RequestsTab {...props} />}
    </>
  );
}

/* ---------------- Inputs ---------------- */

function InputsTab({ agent, dash, go }: Props) {
  const [values, setValues] = useState<Record<string, string>>(agent.inputs);
  // Polling returns new objects every few seconds; only reset the form when the saved values really change.
  const savedKey = JSON.stringify(agent.inputs);
  useEffect(() => setValues(agent.inputs), [agent.id, savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (agent.inputFields.length === 0) {
    return (
      <Card>
        <EmptyState title="This agent has no inputs defined">Add the inputs it needs under “Job &amp; actions”.</EmptyState>
      </Card>
    );
  }

  const save = () => {
    const payload: Record<string, string> = {};
    for (const f of agent.inputFields) {
      const v = values[f.key] ?? "";
      if (f.kind === "secret") {
        if (v !== "") payload[f.key] = v;
      } else if (v !== (agent.inputs[f.key] ?? "")) {
        payload[f.key] = v;
      }
    }
    if (Object.keys(payload).length === 0) {
      dash.notify("success", "Nothing to save.");
      return;
    }
    void dash.run(() => api.updateAgent(agent.id, { inputs: payload }), "Inputs saved.").then((ok) => {
      // Never keep a saved secret sitting in the form.
      if (ok) setValues((cur) => ({ ...cur, ...Object.fromEntries(agent.inputFields.filter((f) => f.kind === "secret").map((f) => [f.key, ""])) }));
    });
  };

  return (
    <Card title="What this agent needs from you">
      <p className="muted">
        These values are given to the agent when it fetches its configuration. Secrets are stored on this computer only and are never shown again
        after saving.
      </p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="form-grid">
          {agent.inputFields.map((f) => (
            <InputControl
              key={f.key}
              field={f}
              value={values[f.key] ?? ""}
              secretSet={agent.secretsSet[f.key] ?? false}
              source={agent.inputSources[f.key] ?? { type: "none" }}
              onGoCredentials={() => go("credentials")}
              onChange={(v) => setValues({ ...values, [f.key]: v })}
              onClear={() => void dash.run(() => api.updateAgent(agent.id, { clearSecrets: [f.key] }), `${f.label} cleared.`)}
            />
          ))}
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" type="submit">
            Save inputs
          </button>
        </div>
      </form>
    </Card>
  );
}

function InputControl(props: {
  field: InputField;
  value: string;
  secretSet: boolean;
  source: InputSource;
  onGoCredentials: () => void;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  const { field: f, source } = props;
  const id = `in-${f.key}`;
  const fromVault = source.type === "vault";
  const missing = f.required && source.type === "none" && props.value.trim() === "";
  const vaultLabel = fromVault ? (findService(source.key)?.label ?? source.key) : "";
  const help = (
    <>
      {fromVault && <span className="source-tag">✓ From Credentials: {vaultLabel}. </span>}
      {!fromVault && (f.vault?.length ?? 0) > 0 && source.type === "none" && (
        <>
          <button type="button" className="btn btn-sm" style={{ padding: "0 6px" }} onClick={props.onGoCredentials}>
            Add it on Credentials
          </button>{" "}
        </>
      )}
      {f.help && !fromVault ? f.help : null}
      {missing && <span style={{ color: "var(--bad-strong)" }}> Required.</span>}
    </>
  );
  return (
    <Field label={f.label} htmlFor={id} required={f.required} help={help}>
      {f.kind === "textarea" ? (
        <textarea id={id} value={props.value} placeholder={f.placeholder} onChange={(e) => props.onChange(e.target.value)} />
      ) : f.kind === "secret" ? (
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input
            id={id}
            type="password"
            autoComplete="off"
            value={props.value}
            placeholder={props.secretSet ? "•••••••• saved for this agent. Type to replace." : fromVault ? "Using the saved credential. Type to override for this agent." : (f.placeholder ?? "Paste secret")}
            onChange={(e) => props.onChange(e.target.value)}
          />
          {props.secretSet && (
            <button type="button" className="btn btn-sm btn-danger" onClick={props.onClear}>
              Clear
            </button>
          )}
        </div>
      ) : (
        <input
          id={id}
          inputMode={f.kind === "number" ? "decimal" : undefined}
          type={f.kind === "url" ? "url" : "text"}
          value={props.value}
          placeholder={f.placeholder}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

/* ---------------- Guardrails ---------------- */

function GuardrailsTab({ agent, dash, state }: Props) {
  const [g, setG] = useState<AgentGuardrails>(agent.guardrails);
  const savedKey = JSON.stringify(agent.guardrails);
  useEffect(() => setG(agent.guardrails), [agent.id, savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(g) !== JSON.stringify(agent.guardrails);
  const toggle = (list: "allowedActions" | "approvalRequiredActions", key: string) => {
    const cur = new Set(g[list]);
    if (cur.has(key)) cur.delete(key);
    else cur.add(key);
    setG({ ...g, [list]: agent.actions.map((a) => a.key).filter((k) => cur.has(k)) });
  };
  const gg = state.guardrails;

  return (
    <div className="stack">
      <Card title="Spending limits for this agent">
        <p className="muted">
          Leave a field empty for no agent-level limit (global guardrails still apply). Set a limit to $0 to block all spending. Requests that
          break a limit are denied automatically.
        </p>
        <div className="form-grid">
          <Field label="Max per transaction" help={`Global: ${gg.perTransactionLimitCents === null ? "no limit" : formatCents(gg.perTransactionLimitCents)}`}>
            <MoneyInput nullable value={g.perTransactionLimitCents} onChange={(v) => setG({ ...g, perTransactionLimitCents: v })} ariaLabel="Max per transaction" />
          </Field>
          <Field label="Max per day" help={`Global: ${gg.dailySpendLimitCents === null ? "no limit" : formatCents(gg.dailySpendLimitCents)}`}>
            <MoneyInput nullable value={g.dailySpendLimitCents} onChange={(v) => setG({ ...g, dailySpendLimitCents: v })} ariaLabel="Max per day" />
          </Field>
          <Field
            label="Ask me before spending at least"
            help={`Global: ${gg.approvalThresholdCents === null ? "never" : formatCents(gg.approvalThresholdCents)}. Empty = never ask by amount.`}
          >
            <MoneyInput nullable placeholder="Never" value={g.approvalThresholdCents} onChange={(v) => setG({ ...g, approvalThresholdCents: v })} ariaLabel="Approval threshold" />
          </Field>
        </div>
      </Card>

      <Card title="What this agent may do">
        {agent.actions.length === 0 ? (
          <EmptyState title="No actions defined">Add actions under “Job &amp; actions”.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Type</th>
                  <th>Allowed</th>
                  <th>Always ask me first</th>
                </tr>
              </thead>
              <tbody>
                {agent.actions.map((a) => (
                  <tr key={a.key}>
                    <td>
                      <div className="title">{a.label}</div>
                      <code className="muted">{a.key}</code>
                    </td>
                    <td>{a.spends ? <Badge tone="warn">Spends money</Badge> : <Badge>No cost</Badge>}</td>
                    <td>
                      <input
                        type="checkbox"
                        className="check"
                        style={{ width: 18, height: 18, accentColor: "var(--accent)" }}
                        aria-label={`Allow ${a.label}`}
                        checked={g.allowedActions.includes(a.key)}
                        onChange={() => toggle("allowedActions", a.key)}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        className="check"
                        style={{ width: 18, height: 18, accentColor: "var(--accent)" }}
                        aria-label={`Always require approval for ${a.label}`}
                        checked={g.approvalRequiredActions.includes(a.key)}
                        onChange={() => toggle("approvalRequiredActions", a.key)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="form-actions">
        <button className="btn" disabled={!dirty} onClick={() => setG(agent.guardrails)}>
          Discard changes
        </button>
        <button className="btn btn-primary" disabled={!dirty} onClick={() => void dash.run(() => api.updateAgent(agent.id, { guardrails: g }), "Guardrails saved.")}>
          Save guardrails
        </button>
      </div>
    </div>
  );
}

/* ---------------- Connect ---------------- */

function ConnectTab({ agent, dash }: Props) {
  const [conn, setConn] = useState(agent.connection);
  const [token, setToken] = useState<string | null>(null);
  const savedKey = JSON.stringify(agent.connection);
  useEffect(() => setConn(agent.connection), [agent.id, savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setToken(null), [agent.id]);
  const dirty = JSON.stringify(conn) !== JSON.stringify(agent.connection);
  const base = window.location.origin;
  const shown = token ?? "<AGENT_TOKEN>";

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      dash.notify("success", "Copied to clipboard.");
    } catch {
      dash.notify("error", "Could not copy. Select the text and copy it manually.");
    }
  };

  return (
    <div className="stack">
      <Card title="Model & runtime">
        <div className="form-grid">
          <Field label="Provider" htmlFor="c-provider" help="The agent's AI key comes from Credentials for this provider.">
            <select id="c-provider" value={["Anthropic", "OpenAI", "Google"].includes(conn.provider) ? conn.provider : "Other"} onChange={(e) => setConn({ ...conn, provider: e.target.value === "Other" ? "" : e.target.value, model: e.target.value === "Anthropic" ? "claude-opus-5-5" : conn.provider === e.target.value ? conn.model : "" })}>
              <option value="Anthropic">Anthropic (Claude)</option>
              <option value="OpenAI">OpenAI</option>
              <option value="Google">Google (Gemini)</option>
              <option value="Other">Other (enter the key on Inputs)</option>
            </select>
          </Field>
          <Field
            label="Model"
            htmlFor="c-model"
            help={conn.provider === "Anthropic" ? "The dashboard runs this agent itself with this model: claude-opus-5-5 (default), claude-sonnet-5-5, claude-haiku-5-5 (cheapest) or claude-fable-5-2 (most capable, priciest)." : "The built-in runner only uses Claude. With another provider, run your own program with the API token below."}
          >
            <input id="c-model" value={conn.model} onChange={(e) => setConn({ ...conn, model: e.target.value })} placeholder={conn.provider === "Anthropic" ? "claude-opus-5-5" : "Model ID from your provider"} />
          </Field>
          <Field label="Where it runs" htmlFor="c-runtime" help="For your reference. Leave empty when the dashboard runs it (Claude); otherwise note where your own program runs.">
            <input id="c-runtime" value={conn.runtime} onChange={(e) => setConn({ ...conn, runtime: e.target.value })} />
          </Field>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={!dirty} onClick={() => void dash.run(() => api.updateAgent(agent.id, { connection: conn }), "Saved.")}>
            Save
          </button>
        </div>
      </Card>

      <Card title="API token">
        <p className="muted">The agent sends this token with every request. Treat it like a password. Rotating it immediately disconnects anything using the old one.</p>
        <div className="token-box mono">
          <span style={{ flex: 1 }}>{token ?? agent.apiTokenPreview}</span>
          {token ? (
            <button className="btn btn-sm" onClick={() => void copy(token)}>
              Copy
            </button>
          ) : (
            <button
              className="btn btn-sm"
              onClick={async () => {
                try {
                  setToken((await api.revealToken(agent.id)).token);
                } catch (e) {
                  dash.notify("error", e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Reveal
            </button>
          )}
          <button
            className="btn btn-sm btn-danger"
            onClick={async () => {
              if (!window.confirm(`Rotate ${agent.name}'s token? The old token stops working immediately.`)) return;
              try {
                setToken((await api.rotateToken(agent.id)).token);
                await dash.run(api.state);
                dash.notify("success", "Token rotated. Update your agent with the new one.");
              } catch (e) {
                dash.notify("error", e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Rotate
          </button>
        </div>
      </Card>

      <Card title="How your agent talks to the dashboard">
        <ol className="stack" style={{ margin: 0, paddingLeft: 18, gap: 6 }}>
          <li>
            <strong>Fetch its config</strong> (inputs, guardrails, budget) when it starts and before each run.
          </li>
          <li>
            <strong>Ask before acting.</strong> Submit every action, with an amount if it costs money. Only proceed when the status is{" "}
            <code>approved</code>. If it is <code>pending_approval</code>, poll until you decide.
          </li>
          <li>
            <strong>Report back.</strong> Mark the action <code>complete</code> with the real amount (any unused amount returns to its budget) or{" "}
            <code>cancel</code> it.
          </li>
          <li>
            <strong>Log</strong> what it is doing and send a <strong>heartbeat</strong> so you can see it is alive.
          </li>
          <li>
            <strong>Report AI usage</strong> after every model call (<code>POST /api/agent/v1/usage</code>) and stop when the reply says{" "}
            <code>overLimit</code>.
          </li>
          <li>
            For price changes and listings, include <code>priceCents</code>; prices below the floor are refused.
          </li>
        </ol>
        <pre>{`# 1. Get configuration
curl -s ${base}/api/agent/v1/config \\
  -H "Authorization: Bearer ${shown}"

# 2. Ask permission (amount in cents: 2500 = $25.00)
curl -s -X POST ${base}/api/agent/v1/actions \\
  -H "Authorization: Bearer ${shown}" -H "Content-Type: application/json" \\
  -d '{"action":"${agent.actions.find((a) => a.spends)?.key ?? agent.actions[0]?.key ?? "my_action"}","amountCents":2500,"description":"Why I want to do this"}'

# 3. Check a pending request / report the result
curl -s ${base}/api/agent/v1/actions/<REQUEST_ID> -H "Authorization: Bearer ${shown}"
curl -s -X POST ${base}/api/agent/v1/actions/<REQUEST_ID>/complete \\
  -H "Authorization: Bearer ${shown}" -H "Content-Type: application/json" \\
  -d '{"actualAmountCents":2350,"note":"Ordered 3 samples"}'

# 4. Heartbeat and logs
curl -s -X POST ${base}/api/agent/v1/heartbeat \\
  -H "Authorization: Bearer ${shown}" -H "Content-Type: application/json" \\
  -d '{"message":"Researching suppliers"}'`}</pre>
        <p className="help">
          A complete example agent built on the Claude API is in <code>examples/claude-agent.ts</code>. Full API reference: <code>docs/AGENT_API.md</code>.
        </p>
      </Card>
    </div>
  );
}

/* ---------------- Job & actions ---------------- */

const KINDS: InputKind[] = ["text", "secret", "number", "url", "textarea"];

const toKey = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "x_$1")
    .slice(0, 64) || "field";

function SetupTab({ agent, dash }: Props) {
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [resp, setResp] = useState(agent.responsibilities.join("\n"));
  const [fields, setFields] = useState<InputField[]>(agent.inputFields);
  const [actions, setActions] = useState<ActionDef[]>(agent.actions);

  useEffect(() => {
    setName(agent.name);
    setDescription(agent.description);
    setResp(agent.responsibilities.join("\n"));
    setFields(agent.inputFields);
    setActions(agent.actions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, JSON.stringify([agent.name, agent.description, agent.responsibilities, agent.inputFields, agent.actions])]);

  const save = () => {
    const patch: Record<string, unknown> = {
      name,
      description,
      responsibilities: resp.split("\n").map((s) => s.trim()).filter(Boolean),
    };
    if (JSON.stringify(fields) !== JSON.stringify(agent.inputFields)) patch.inputFields = fields;
    if (JSON.stringify(actions) !== JSON.stringify(agent.actions)) patch.actions = actions;
    void dash.run(() => api.updateAgent(agent.id, patch), "Saved.");
  };

  const uniqueKey = (base: string, existing: string[]) => {
    let k = base;
    let i = 2;
    while (existing.includes(k)) k = `${base}_${i++}`;
    return k;
  };

  return (
    <div className="stack">
      <Card title="The job">
        <div className="form-grid">
          <Field label="Name" htmlFor="s-name" required>
            <input id="s-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="s-desc">
            <input id="s-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <Field label="Responsibilities" htmlFor="s-resp" help="One per line. Sent to the agent as part of its instructions.">
          <textarea id="s-resp" value={resp} onChange={(e) => setResp(e.target.value)} rows={4} />
        </Field>
      </Card>

      <Card
        title="Inputs the owner must provide"
        actions={
          <button
            className="btn btn-sm"
            onClick={() => setFields([...fields, { key: uniqueKey("new_input", fields.map((f) => f.key)), label: "New input", kind: "text", required: true }])}
          >
            Add input
          </button>
        }
      >
        {fields.length === 0 ? (
          <p className="muted">No inputs yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Key</th>
                  <th>Type</th>
                  <th>Required</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        aria-label="Input label"
                        value={f.label}
                        onChange={(e) => {
                          const next = [...fields];
                          next[i] = { ...f, label: e.target.value };
                          setFields(next);
                        }}
                        onBlur={() => {
                          if (f.key.startsWith("new_input")) {
                            const next = [...fields];
                            next[i] = { ...f, key: uniqueKey(toKey(f.label), fields.filter((_, j) => j !== i).map((x) => x.key)) };
                            setFields(next);
                          }
                        }}
                      />
                    </td>
                    <td>
                      <code>{f.key}</code>
                    </td>
                    <td>
                      <select
                        aria-label="Input type"
                        value={f.kind}
                        onChange={(e) => {
                          const next = [...fields];
                          next[i] = { ...f, kind: e.target.value as InputKind };
                          setFields(next);
                        }}
                      >
                        {KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label="Required"
                        style={{ width: 18, height: 18, accentColor: "var(--accent)" }}
                        checked={f.required}
                        onChange={() => {
                          const next = [...fields];
                          next[i] = { ...f, required: !f.required };
                          setFields(next);
                        }}
                      />
                    </td>
                    <td className="right">
                      <button className="btn btn-sm btn-danger" onClick={() => setFields(fields.filter((_, j) => j !== i))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Actions this agent can request"
        actions={
          <button
            className="btn btn-sm"
            onClick={() => setActions([...actions, { key: uniqueKey("new_action", actions.map((a) => a.key)), label: "New action", spends: false }])}
          >
            Add action
          </button>
        }
      >
        <p className="muted">New actions are allowed by default. Restrict them on the Guardrails tab.</p>
        {actions.length === 0 ? (
          <p className="muted">No actions yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Key</th>
                  <th>Can spend money</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {actions.map((a, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        aria-label="Action label"
                        value={a.label}
                        onChange={(e) => {
                          const next = [...actions];
                          next[i] = { ...a, label: e.target.value };
                          setActions(next);
                        }}
                        onBlur={() => {
                          if (a.key.startsWith("new_action")) {
                            const next = [...actions];
                            next[i] = { ...a, key: uniqueKey(toKey(a.label), actions.filter((_, j) => j !== i).map((x) => x.key)) };
                            setActions(next);
                          }
                        }}
                      />
                    </td>
                    <td>
                      <code>{a.key}</code>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label="Can spend money"
                        style={{ width: 18, height: 18, accentColor: "var(--accent)" }}
                        checked={a.spends}
                        onChange={() => {
                          const next = [...actions];
                          next[i] = { ...a, spends: !a.spends };
                          setActions(next);
                        }}
                      />
                    </td>
                    <td className="right">
                      <button className="btn btn-sm btn-danger" onClick={() => setActions(actions.filter((_, j) => j !== i))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="form-actions">
        <button className="btn btn-primary" onClick={save}>
          Save job &amp; actions
        </button>
      </div>
    </div>
  );
}

/* ---------------- Requests ---------------- */

function RequestsTab({ agent, state }: Props) {
  const rows = state.requests.filter((r) => r.agentId === agent.id);
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState title="No requests yet">Requests appear here once the agent starts asking to take actions.</EmptyState>
      </Card>
    );
  }
  return (
    <Card>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th className="right">Amount</th>
              <th>Status</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted">{formatDateTime(r.createdAt)}</td>
                <td>
                  <div className="title">{agent.actions.find((a) => a.key === r.action)?.label ?? r.action}</div>
                  {r.description && <div className="muted">{r.description}</div>}
                </td>
                <td className="right num">
                  {r.status === "completed" && r.actualAmountCents !== null && r.actualAmountCents !== r.amountCents ? (
                    <>
                      <Money cents={r.actualAmountCents} />
                      <div className="help">of {formatCents(r.amountCents)}</div>
                    </>
                  ) : (
                    <Money cents={r.amountCents} />
                  )}
                </td>
                <td>
                  <RequestStatusBadge status={r.status} />
                </td>
                <td className="muted">{r.reasons.join(" ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
