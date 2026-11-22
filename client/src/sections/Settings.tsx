import { useCallback, useEffect, useState } from "react";
import type { SectionProps } from "../App.tsx";
import { api, type BackupInfo } from "../api.ts";
import { Badge, Card, EmptyState, Field, PageHeader, formatDateTime } from "../components/ui.tsx";

const CONFIRM = "START OVER";

function PasswordCard({ state, dash }: Pick<SectionProps, "state" | "dash">) {
  const set = state.security.passwordSet;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const mismatch = next !== "" && confirm !== "" && next !== confirm;
  const tooShort = next !== "" && next.length < 10;
  const clear = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  return (
    <Card title={<span className="row">Dashboard password {set ? <Badge tone="good">On</Badge> : <Badge tone="warn">Off</Badge>}</span>}>
      <p className="muted">
        {set
          ? "Anyone opening the dashboard must sign in. Agents are unaffected; they use their own tokens. Sign-ins last 12 hours, and restarting the dashboard signs everyone out."
          : "Right now anyone who can use this computer can open the dashboard and see or change everything. Set a password to require signing in. Agents are unaffected."}
      </p>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (tooShort || mismatch || !next) return;
          if (await dash.run(() => api.setPassword(current, next), set ? "Password changed. Other browsers were signed out." : "Password set. The dashboard now requires signing in.")) clear();
        }}
      >
        <div className="form-grid">
          {set && (
            <Field label="Current password" htmlFor="pw-current">
              <input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
          )}
          <Field label={set ? "New password" : "Password"} htmlFor="pw-new" help="At least 10 characters. A short phrase is easiest to remember.">
            <input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Type it again" htmlFor="pw-confirm">
            <input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        </div>
        {(tooShort || mismatch) && (
          <div className="help" style={{ color: "var(--bad-strong)" }}>
            {tooShort ? "Use at least 10 characters." : "The two passwords don't match."}
          </div>
        )}
        <div className="form-actions">
          {set && (
            <>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  try {
                    await api.logout();
                  } finally {
                    window.location.reload();
                  }
                }}
              >
                Sign out
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={!current}
                title={current ? "" : "Enter your current password first"}
                onClick={async () => {
                  if (!window.confirm("Remove the password? Anyone using this computer could open the dashboard.")) return;
                  if (await dash.run(() => api.setPassword(current, ""), "Password removed.")) clear();
                }}
              >
                Remove password
              </button>
            </>
          )}
          <button type="submit" className="btn btn-primary" disabled={!next || tooShort || mismatch || (set && !current)}>
            {set ? "Change password" : "Set password"}
          </button>
        </div>
        <p className="help">
          Forgot it? Stop the dashboard and run <code>npm run reset-password</code>. Your data is kept.
        </p>
      </form>
    </Card>
  );
}

export function Settings({ state, dash, go }: SectionProps) {
  const [typed, setTyped] = useState("");
  const [keepCredentials, setKeepCredentials] = useState(false);
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);

  const loadBackups = useCallback(async () => {
    try {
      setBackups((await api.backups()).backups);
    } catch (e) {
      dash.notify("error", e instanceof Error ? e.message : String(e));
    }
  }, [dash.notify]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const savedKeys = state.vault.filter((v) => v.set).length;
  const counts = [
    state.business.product ? `your business profile (${state.business.name || state.business.product})` : null,
    state.agents.length ? `${state.agents.length} agent${state.agents.length === 1 ? "" : "s"} and their tokens` : null,
    state.funding.length ? `${state.funding.length} deposit / sales record${state.funding.length === 1 ? "" : "s"}` : null,
    state.requests.length ? `${state.requests.length} agent request${state.requests.length === 1 ? "" : "s"}` : null,
    state.research.length ? `${state.research.length} AI research run${state.research.length === 1 ? "" : "s"}` : null,
    savedKeys ? `${savedKeys} saved credential${savedKeys === 1 ? "" : "s"}${keepCredentials ? " (kept)" : ""}` : null,
    "your checklist progress, guardrails, Discord settings and activity log",
  ].filter(Boolean);

  const startOver = async () => {
    if (typed.trim() !== CONFIRM) return;
    const ok = await dash.run(() => api.startOver(keepCredentials), "Started fresh. A backup of your old data was saved.");
    if (ok) {
      setTyped("");
      await loadBackups();
      go("setup");
    }
  };

  return (
    <>
      <PageHeader title="Settings & start over" subtitle="Clear out test data and begin again from a blank dashboard." />

      <PasswordCard state={state} dash={dash} />

      <Card title="Start over">
        <p>This removes everything you've entered and returns the dashboard to how it looked on first launch:</p>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {counts.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="muted">
          A backup of everything is saved first, so you can undo this below. Any agent programs you connected stop working (their tokens are deleted).
        </p>
        <label className="check">
          <input type="checkbox" checked={keepCredentials} onChange={() => setKeepCredentials((k) => !k)} />
          Keep my saved credentials (API keys) so I don't have to paste them again
        </label>
        <form
          className="row"
          style={{ alignItems: "flex-end" }}
          onSubmit={(e) => {
            e.preventDefault();
            void startOver();
          }}
        >
          <div style={{ flex: "1 1 240px" }}>
            <Field label={`Type ${CONFIRM} to confirm`} htmlFor="confirm-reset">
              <input id="confirm-reset" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder={CONFIRM} />
            </Field>
          </div>
          <button type="submit" className="btn btn-danger-solid" disabled={typed.trim() !== CONFIRM}>
            Erase everything and start fresh
          </button>
        </form>
      </Card>

      <Card title="Backups" actions={<button className="btn btn-sm" onClick={() => void loadBackups()}>Refresh</button>}>
        <p className="muted">A backup is saved automatically before every start-over and restore. The newest 20 are kept, in <code>data/backups/</code>.</p>
        {backups === null ? (
          <p className="muted">Loading…</p>
        ) : backups.length === 0 ? (
          <EmptyState title="No backups yet" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Saved</th>
                  <th>Why</th>
                  <th>Contents</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.name}>
                    <td style={{ whiteSpace: "nowrap" }}>{formatDateTime(b.createdAt)}</td>
                    <td>
                      <Badge>{b.reason}</Badge>
                    </td>
                    <td className="muted">
                      {b.businessName || b.product || "No business set"} · {b.agents} agent{b.agents === 1 ? "" : "s"}
                    </td>
                    <td className="right" style={{ whiteSpace: "nowrap" }}>
                      <button
                        className="btn btn-sm"
                        onClick={async () => {
                          if (!window.confirm("Restore this backup? Your current data is backed up first, then replaced.")) return;
                          if (await dash.run(() => api.restoreBackup(b.name), "Backup restored.")) {
                            await loadBackups();
                            go("overview");
                          }
                        }}
                      >
                        Restore
                      </button>{" "}
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={async () => {
                          if (!window.confirm("Delete this backup permanently?")) return;
                          try {
                            setBackups((await api.deleteBackup(b.name)).backups);
                          } catch (e) {
                            dash.notify("error", e instanceof Error ? e.message : String(e));
                          }
                        }}
                      >
                        Delete
                      </button>
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
