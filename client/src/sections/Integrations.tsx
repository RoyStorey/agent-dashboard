import { useEffect, useState } from "react";
import type { DiscordSettings } from "../../../shared/types.ts";
import type { SectionProps } from "../App.tsx";
import { api } from "../api.ts";
import { Badge, Card, ExtLink, Field, PageHeader, formatDateTime } from "../components/ui.tsx";

const slug = (name: string) =>
  `#${name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;

function WebhookRow(props: {
  label: string;
  channel: string;
  savedPreview: string;
  target: string;
  onSave: (url: string) => Promise<boolean>;
  dash: SectionProps["dash"];
}) {
  const [url, setUrl] = useState("");
  const id = `hook-${props.target}`;
  return (
    <tr>
      <td>
        <div className="title">{props.label}</div>
        <code className="muted">{props.channel}</code>
      </td>
      <td style={{ minWidth: 260 }}>
        <input
          id={id}
          aria-label={`${props.label} webhook URL`}
          type="password"
          autoComplete="off"
          value={url}
          placeholder={props.savedPreview ? `Saved (${props.savedPreview}). Paste to replace.` : "https://discord.com/api/webhooks/…"}
          onChange={(e) => setUrl(e.target.value)}
        />
      </td>
      <td className="right" style={{ whiteSpace: "nowrap" }}>
        <button
          className="btn btn-sm btn-primary"
          disabled={!url.trim()}
          onClick={async () => {
            if (await props.onSave(url.trim())) setUrl("");
          }}
        >
          Save
        </button>{" "}
        <button
          className="btn btn-sm"
          disabled={!props.savedPreview}
          onClick={() => void props.dash.run(() => api.testDiscord(props.target), `Test message sent to ${props.channel}. Check Discord.`)}
        >
          Test
        </button>{" "}
        {props.savedPreview && props.target !== "hq" && (
          <button className="btn btn-sm btn-danger" onClick={() => void props.onSave("")} title="Use the HQ channel instead">
            Clear
          </button>
        )}
      </td>
    </tr>
  );
}

export function Integrations({ state, dash }: SectionProps) {
  const d = state.discord;
  const savedEvents = JSON.stringify([d.events, d.dailySummaryHour, d.approvalMention]);
  const [events, setEvents] = useState<DiscordSettings["events"]>(d.events);
  const [hour, setHour] = useState(d.dailySummaryHour);
  const [mention, setMention] = useState(d.approvalMention);
  useEffect(() => {
    setEvents(d.events);
    setHour(d.dailySummaryHour);
    setMention(d.approvalMention);
  }, [savedEvents]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify([events, hour, mention]) !== savedEvents;
  const toggle = (k: keyof Omit<DiscordSettings["events"], "agentLogs">) => setEvents({ ...events, [k]: !events[k] });

  return (
    <>
      <PageHeader
        title="Discord"
        subtitle="Each agent posts updates and reports for its area to its own channel. Approvals, alerts and the daily finance summary go to an HQ channel."
        actions={
          d.enabled ? (
            <button className="btn" onClick={() => void dash.run(() => api.updateDiscord({ enabled: false }), "Discord notifications paused.")}>
              Pause notifications
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!d.defaultWebhookSet} onClick={() => void dash.run(() => api.updateDiscord({ enabled: true }), "Discord notifications on.")}>
              Turn on notifications
            </button>
          )
        }
      />

      <Card
        title={
          <span className="row">
            Status {d.enabled ? <Badge tone="good">On</Badge> : <Badge>Off</Badge>} <span className="muted" style={{ fontWeight: 400 }}>{d.sentCount} messages sent since the dashboard started</span>
          </span>
        }
      >
        {d.lastError && (
          <div className="banner banner-bad">
            Last error {d.lastErrorAt ? `(${formatDateTime(d.lastErrorAt)})` : ""}: {d.lastError}
          </div>
        )}
        <details open={!d.defaultWebhookSet}>
          <summary className="title" style={{ cursor: "pointer" }}>
            How to set it up (about 5 minutes)
          </summary>
          <ol className="steps" style={{ marginTop: 8 }}>
            <li>In Discord, click the “+” in the server list → “Create My Own” to make a server for the business (or use an existing one).</li>
            <li>
              Create a text channel for HQ (e.g. <code>#hq</code>) and one per agent. Suggested names are listed below.
            </li>
            <li>For each channel: click the gear (Edit Channel) → Integrations → Webhooks → New Webhook → Copy Webhook URL.</li>
            <li>Paste each URL below and click Save, then Test. Agents without their own channel post to HQ.</li>
          </ol>
          <p style={{ marginTop: 8 }}>
            <ExtLink href="https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks">Discord's guide to webhooks</ExtLink>
          </p>
        </details>
      </Card>

      <Card title="Channels">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Webhook URL</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <WebhookRow
                label="HQ (approvals, alerts, daily summary)"
                channel="#hq"
                target="hq"
                savedPreview={d.defaultWebhookSet ? d.defaultWebhookPreview : ""}
                dash={dash}
                onSave={(url) => dash.run(() => api.updateDiscord({ defaultWebhookUrl: url, ...(url && !d.enabled ? { enabled: true } : {}) }), "HQ webhook saved and notifications turned on.")}
              />
              {state.agents.map((a) => (
                <WebhookRow
                  key={a.id}
                  label={a.name}
                  channel={slug(a.name)}
                  target={a.id}
                  savedPreview={d.agentWebhooksSet[a.id] ?? ""}
                  dash={dash}
                  onSave={(url) => dash.run(() => api.updateDiscord({ agentWebhooks: { [a.id]: url } }), url ? `${a.name} webhook saved.` : `${a.name} now posts to HQ.`)}
                />
              ))}
            </tbody>
          </table>
        </div>
        {state.agents.length === 0 && <p className="muted">Add agents to give each its own channel.</p>}
      </Card>

      <Card title="What gets posted">
        <div className="stack" style={{ gap: 8 }}>
          {(
            [
              ["approvals", "Approval requests (HQ)"],
              ["denials", "Requests blocked by guardrails (team channel)"],
              ["spending", "Money spent: approvals and completed purchases (team channel)"],
              ["revenue", "Sales reported (team channel)"],
              ["reports", "Agent reports (team channel)"],
              ["dailySummary", "Daily finance summary (HQ)"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={events[k]} onChange={() => toggle(k)} />
              {label}
            </label>
          ))}
        </div>
        <div className="form-grid">
          <Field label="Agent progress logs" htmlFor="d-logs">
            <select id="d-logs" value={events.agentLogs} onChange={(e) => setEvents({ ...events, agentLogs: e.target.value as DiscordSettings["events"]["agentLogs"] })}>
              <option value="important">Warnings, errors and successes only</option>
              <option value="all">Everything</option>
              <option value="none">None</option>
            </select>
          </Field>
          <Field label="Daily summary time" htmlFor="d-hour">
            <select id="d-hour" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {new Date(2026, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" })}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ping on approvals" htmlFor="d-mention" help="@here, or <@YOUR_USER_ID> to ping only you">
            <input id="d-mention" value={mention} onChange={(e) => setMention(e.target.value)} placeholder="@here" />
          </Field>
        </div>
        <div className="form-actions">
          <button className="btn" disabled={!d.defaultWebhookSet} onClick={() => void dash.run(() => api.discordSummary(), "Summary posted to HQ.")}>
            Post summary now
          </button>
          <button className="btn btn-primary" disabled={!dirty} onClick={() => void dash.run(() => api.updateDiscord({ events, dailySummaryHour: hour, approvalMention: mention }), "Saved.")}>
            Save
          </button>
        </div>
        <p className="help">Agents send reports with POST /api/agent/v1/report; the dashboard routes them to the right channel, so agents never need webhook URLs.</p>
      </Card>
    </>
  );
}
