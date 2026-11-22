import { useState } from "react";
import { SERVICES, type ServiceDef } from "../../../shared/services.ts";
import type { SectionProps } from "../App.tsx";
import { api, type Dashboard } from "../api.ts";
import { Badge, Card, ExtLink, Field, PageHeader } from "../components/ui.tsx";
import { agentsUsing, missingVaultKeys, teamVaultKeys } from "../lib.ts";
import type { StateResponse } from "../../../shared/types.ts";

/** One credential: where to get it, exactly what to paste, and a box to paste it in. */
export function VaultItem(props: { svc: ServiceDef; state: StateResponse; dash: Dashboard; compact?: boolean }) {
  const { svc, state, dash } = props;
  const saved = state.vault.find((v) => v.key === svc.key);
  const isSet = saved?.set ?? false;
  const [value, setValue] = useState("");
  const [showSteps, setShowSteps] = useState(!isSet && !props.compact);
  const users = agentsUsing(state, svc.key);
  const prefixWarning = svc.expectPrefix && value.trim() !== "" && !value.trim().startsWith(svc.expectPrefix);
  const id = `vault-${svc.key}`;

  const save = async () => {
    if (!value.trim()) return;
    if (await dash.run(() => api.saveVault(svc.key, value), `${svc.label} saved.`)) setValue("");
  };

  return (
    <Card className="vault-item">
      <div className="row between">
        <div>
          <div className="row">
            <span className="title">{svc.label}</span>
            {isSet ? <Badge tone="good">Saved {saved?.preview}</Badge> : <Badge tone={users.length > 0 ? "bad" : "neutral"}>{users.length > 0 ? "Needed" : "Optional"}</Badge>}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {users.length > 0 ? `Used by ${users.map((u) => u.name).join(", ")}` : "Not used by any agent yet"} · about {svc.time}
          </div>
        </div>
        <div className="row">
          <ExtLink href={svc.url} className="link-btn">
            Get it here
          </ExtLink>
          <button className="btn btn-sm" onClick={() => setShowSteps((s) => !s)}>
            {showSteps ? "Hide steps" : "Steps"}
          </button>
        </div>
      </div>

      {showSteps && (
        <ol className="steps">
          {svc.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}

      <form
        className="stack"
        style={{ gap: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label={`Paste: ${svc.paste}`} htmlFor={id}>
          <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
            {svc.multiline ? (
              <textarea id={id} value={value} rows={svc.placeholder.split("\n").length} placeholder={isSet ? "Saved. Paste to replace." : svc.placeholder} onChange={(e) => setValue(e.target.value)} autoComplete="off" spellCheck={false} />
            ) : (
              <input
                id={id}
                type={svc.secret ? "password" : "text"}
                value={value}
                placeholder={isSet ? "Saved. Paste to replace." : svc.placeholder}
                onChange={(e) => setValue(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            )}
            <button type="submit" className="btn btn-primary" disabled={!value.trim()}>
              Save
            </button>
            {isSet && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  if (window.confirm(`Remove ${svc.label}? Agents using it will stop until you add it again.`)) void dash.run(() => api.deleteVault(svc.key), "Removed.");
                }}
              >
                Remove
              </button>
            )}
          </div>
        </Field>
        {prefixWarning && <div className="help" style={{ color: "var(--warn)" }}>This usually starts with “{svc.expectPrefix}”. Double-check you copied the right thing.</div>}
      </form>
    </Card>
  );
}

export function Credentials({ state, dash }: SectionProps) {
  const team = teamVaultKeys(state);
  const missing = new Set(missingVaultKeys(state));
  const needed = SERVICES.filter((s) => team.includes(s.key)).sort((a, b) => Number(missing.has(b.key)) - Number(missing.has(a.key)));
  const others = SERVICES.filter((s) => !team.includes(s.key));
  const custom = state.vault.filter((v) => v.key.startsWith("custom_"));
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");

  return (
    <>
      <PageHeader
        title="Credentials"
        subtitle="Paste each key once. Every agent that needs it gets it automatically, so you never enter the same key twice. Keys stay on this computer and are never shown again after saving."
      />
      {state.agents.length === 0 && <div className="banner banner-info">Add your agent team first; this page then shows exactly which keys the team needs.</div>}

      {needed.length > 0 && (
        <div className="stack">
          <h3>
            Needed by your team {missing.size > 0 ? <Badge tone="bad">{missing.size} missing</Badge> : <Badge tone="good">all set</Badge>}
          </h3>
          {needed.map((s) => (
            <VaultItem key={s.key} svc={s} state={state} dash={dash} />
          ))}
        </div>
      )}

      <div className="stack">
        <h3>Other services</h3>
        <p className="muted">Switch an agent to OpenAI or Google on its Connect tab and it will use these keys instead.</p>
        {others.map((s) => (
          <VaultItem key={s.key} svc={s} state={state} dash={dash} compact />
        ))}
      </div>

      <Card title="Custom credentials">
        <p className="muted">For any other service. Link it to an agent by pasting it into that agent's input, or have the agent read it by name.</p>
        {custom.map((c) => (
          <div key={c.key} className="row between">
            <span>
              <strong>{c.label}</strong> <code className="muted">{c.key}</code> {c.preview}
            </span>
            <button className="btn btn-sm btn-danger" onClick={() => void dash.run(() => api.deleteVault(c.key), "Removed.")}>
              Remove
            </button>
          </div>
        ))}
        <form
          className="form-grid"
          onSubmit={async (e) => {
            e.preventDefault();
            const key = `custom_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40)}`;
            if (key === "custom_") return;
            if (await dash.run(() => api.saveVault(key, value, label), "Saved.")) {
              setLabel("");
              setValue("");
            }
          }}
        >
          <Field label="Name" htmlFor="c-label">
            <input id="c-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Etsy API key" />
          </Field>
          <Field label="Value" htmlFor="c-value">
            <input id="c-value" type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
          </Field>
          <div className="form-actions" style={{ alignItems: "flex-end" }}>
            <button className="btn btn-primary" type="submit" disabled={!label.trim() || !value.trim()}>
              Save
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}
