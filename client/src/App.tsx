import { useEffect, useState } from "react";
import { formatCents } from "../../shared/money.ts";
import type { SectionKey, StateResponse } from "../../shared/types.ts";
import { api, useDashboard, type Dashboard } from "./api.ts";
import { Toasts } from "./components/ui.tsx";
import { Activity } from "./sections/Activity.tsx";
import { Agents } from "./sections/Agents.tsx";
import { Approvals } from "./sections/Approvals.tsx";
import { Business } from "./sections/Business.tsx";
import { Funding } from "./sections/Funding.tsx";
import { Guardrails } from "./sections/Guardrails.tsx";
import { Credentials } from "./sections/Credentials.tsx";
import { Financials } from "./sections/Financials.tsx";
import { Integrations } from "./sections/Integrations.tsx";
import { Login } from "./sections/Login.tsx";
import { Money, realMoneyConnected } from "./sections/Money.tsx";
import { Overview } from "./sections/Overview.tsx";
import { Settings } from "./sections/Settings.tsx";
import { Shipping } from "./sections/Shipping.tsx";
import { Setup, setupSteps } from "./sections/Setup.tsx";
import { Team } from "./sections/Team.tsx";
import { Todo } from "./sections/Todo.tsx";
import { useTheme } from "./theme.ts";

export interface SectionProps {
  state: StateResponse;
  dash: Dashboard;
  go: (section: SectionKey, agentId?: string) => void;
}

interface NavItem {
  key: SectionKey;
  label: string;
  group: string;
}

const NAV: NavItem[] = [
  { key: "setup", label: "Setup assistant", group: "Business" },
  { key: "overview", label: "Overview", group: "Business" },
  { key: "todo", label: "Things you need to do", group: "Business" },
  { key: "business", label: "Business & product", group: "Business" },
  { key: "financials", label: "Financials", group: "Business" },
  { key: "shipping", label: "Pack & ship", group: "Business" },
  { key: "team", label: "Team at work", group: "Agents" },
  { key: "agents", label: "Agent team", group: "Agents" },
  { key: "approvals", label: "Approvals", group: "Agents" },
  { key: "activity", label: "Activity", group: "Agents" },
  { key: "money", label: "Money setup", group: "Control" },
  { key: "credentials", label: "Credentials", group: "Control" },
  { key: "integrations", label: "Discord", group: "Control" },
  { key: "guardrails", label: "Guardrails", group: "Control" },
  { key: "funding", label: "Funding", group: "Control" },
  { key: "settings", label: "Settings & start over", group: "Control" },
];

function readHash(): { section: SectionKey | null; agentId?: string } {
  const [section, agentId] = window.location.hash.replace(/^#\/?/, "").split("/");
  const valid = NAV.some((n) => n.key === section);
  return { section: valid ? (section as SectionKey) : null, agentId: agentId || undefined };
}

export function App() {
  const dash = useDashboard();
  const { theme, toggle: toggleTheme } = useTheme();
  const [route, setRoute] = useState(readHash);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (section: SectionKey, agentId?: string) => {
    window.location.hash = agentId ? `/${section}/${agentId}` : `/${section}`;
    setMenuOpen(false);
    window.scrollTo({ top: 0 });
  };

  const { state } = dash;

  if (dash.needsLogin) return <Login onSignedIn={dash.refresh} />;

  if (!state) {
    return (
      <div className="content">
        {dash.loadError ? (
          <div className="banner banner-bad">
            <span>
              Cannot reach the dashboard server: {dash.loadError}. Is <code>npm run dev</code> running?
            </span>
          </div>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </div>
    );
  }

  const steps = setupSteps(state);
  const setupLeft = steps.filter((x) => !x.done && !x.optional).length;
  // With no section in the URL, start on the setup assistant until setup is finished.
  const section: SectionKey = route.section ?? (setupLeft > 0 ? "setup" : "overview");

  const counts: Partial<Record<SectionKey, { n: number; alert: boolean }>> = {
    todo: {
      n: state.ownerActions.filter((a) => a.severity === "blocker").length + state.tasks.filter((t) => t.status === "todo").length,
      alert: state.ownerActions.some((a) => a.severity === "blocker"),
    },
    agents: { n: state.agents.length, alert: false },
    team: { n: state.agents.filter((a) => a.runtime.state === "working").length, alert: false },
    setup: { n: setupLeft, alert: false },
    shipping: { n: state.shipments.filter((s) => s.status === "to_pack").length, alert: state.shipments.some((s) => s.status === "to_pack") },
    money: { n: state.tasks.filter((t) => t.category === "money" && t.status === "todo" && !t.waitsFor).length, alert: false },
    credentials: { n: new Set(state.readiness.flatMap((r) => r.missingVaultKeys)).size, alert: false },
    approvals: {
      n: state.requests.filter((r) => r.status === "pending_approval").length + state.drafts.filter((d) => d.status === "pending").length,
      alert: state.requests.some((r) => r.status === "pending_approval") || state.drafts.some((d) => d.status === "pending"),
    },
  };

  const kill = state.guardrails.killSwitch;
  const toggleKill = () => {
    if (!kill && !window.confirm("Turn ON the kill switch? Every agent request will be denied until you turn it off.")) return;
    void dash.run(() => api.updateGuardrails({ killSwitch: !kill }), kill ? "Kill switch off. Agents may resume." : "Kill switch ON. All agents stopped.");
  };

  const props: SectionProps = { state, dash, go };
  const groups = [...new Set(NAV.map((n) => n.group))];

  return (
    <div className="app">
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
      <nav className={`sidebar ${menuOpen ? "open" : ""}`} aria-label="Sections">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            AI
          </div>
          <div>
            <div className="brand-name">Agent Dashboard</div>
            <div className="brand-sub">{state.business.name || "Your AI-run business"}</div>
          </div>
        </div>
        {groups.map((g) => (
          <div key={g}>
            <div className="nav-group">{g}</div>
            {NAV.filter((n) => n.group === g).map((n) => {
              const c = counts[n.key];
              return (
                <button
                  key={n.key}
                  className={`nav-btn ${section === n.key ? "active" : ""}`}
                  aria-current={section === n.key ? "page" : undefined}
                  onClick={() => go(n.key)}
                >
                  <span>{n.label}</span>
                  {c && c.n > 0 && <span className={`nav-count ${c.alert ? "alert" : ""}`}>{c.n}</span>}
                </button>
              );
            })}
          </div>
        ))}
        <div className="sidebar-foot">
          Runs locally. Data is stored in <code>data/db.json</code> on this computer.
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <button className="btn btn-sm menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            ☰
          </button>
          <div className="spacer" />
          {!realMoneyConnected() && (
            <button className="btn btn-sm optional-chip" onClick={() => go("money")} title="Amounts here are records; no real money is connected. Click for details.">
              ✎ Accounting only
            </button>
          )}
          <div className="topbar-stat">
            <span>Cash (recorded)</span>
            <strong className="num">{formatCents(state.finance.cashBalanceCents)}</strong>
          </div>
          <div className="topbar-stat optional">
            <span>Unallocated</span>
            <strong className="num">{formatCents(state.finance.unallocatedCents)}</strong>
          </div>
          <div className="topbar-stat optional">
            <span>Spent today</span>
            <strong className="num">{formatCents(state.finance.spentTodayCents)}</strong>
          </div>
          <button
            className="btn btn-sm theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </button>
          <button
            className={`btn ${kill ? "btn-danger-solid kill-on" : "btn-danger"}`}
            onClick={toggleKill}
            aria-pressed={kill}
            title="Instantly deny every agent request"
          >
            {kill ? "Resume agents" : "Kill switch"}
          </button>
        </header>

        <main className="content">
          {dash.loadError && (
            <div className="banner banner-bad">Lost connection to the server: {dash.loadError}. Retrying…</div>
          )}
          {kill && section !== "guardrails" && (
            <div className="banner banner-bad">
              <strong>Kill switch is ON.</strong>
              <span>All agent requests are being denied.</span>
            </div>
          )}
          {section === "setup" && <Setup {...props} />}
          {section === "overview" && <Overview {...props} />}
          {section === "todo" && <Todo {...props} />}
          {section === "business" && <Business {...props} />}
          {section === "financials" && <Financials {...props} />}
          {section === "team" && <Team {...props} />}
          {section === "agents" && <Agents {...props} agentId={route.agentId} />}
          {section === "approvals" && <Approvals {...props} />}
          {section === "activity" && <Activity {...props} />}
          {section === "credentials" && <Credentials {...props} />}
          {section === "integrations" && <Integrations {...props} />}
          {section === "guardrails" && <Guardrails {...props} />}
          {section === "funding" && <Funding {...props} />}
          {section === "settings" && <Settings {...props} />}
          {section === "money" && <Money {...props} />}
          {section === "shipping" && <Shipping {...props} />}
        </main>
      </div>
      <Toasts toasts={dash.toasts} onDismiss={dash.dismissToast} />
    </div>
  );
}
