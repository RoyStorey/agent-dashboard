import { useState } from "react";
import { api } from "../api.ts";
import { Field } from "../components/ui.tsx";

export function Login({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="content" style={{ maxWidth: 420, margin: "12vh auto 0" }}>
      <section className="card">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark" aria-hidden>
            AI
          </div>
          <div>
            <div className="brand-name">Agent Dashboard</div>
            <div className="brand-sub">Sign in to continue</div>
          </div>
        </div>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!password) return;
            setBusy(true);
            setError(null);
            try {
              await api.login(password);
              setPassword("");
              await onSignedIn();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Dashboard password" htmlFor="login-pw">
            <input id="login-pw" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && (
            <div className="help" role="alert" style={{ color: "var(--bad-strong)" }}>
              {error}
            </div>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="help">
            Forgot it? Stop the dashboard and run <code>npm run reset-password</code> in its folder. Your data is kept.
          </p>
        </form>
      </section>
    </div>
  );
}
