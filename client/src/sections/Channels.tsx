import { CHANNELS, type ChannelDef } from "../../../shared/channels.ts";
import { bpsToInput } from "../../../shared/economics.ts";
import type { SectionProps } from "../App.tsx";
import { api } from "../api.ts";
import { Badge, Card, ExtLink } from "../components/ui.tsx";

const APPROVAL_TONE = { Easy: "good", Moderate: "warn", Hard: "bad" } as const;

function feesMatch(def: ChannelDef, e: SectionProps["state"]["economics"]): boolean {
  const f = def.typicalFees;
  return !!f && e.marketplaceFeeBps === f.marketplaceFeeBps && e.paymentFeeBps === f.paymentFeeBps && e.perOrderFeeCents === f.perOrderFeeCents;
}

function commission(def: ChannelDef): string {
  const f = def.typicalFees;
  if (!f) return "Varies (check)";
  const parts: string[] = [];
  if (f.marketplaceFeeBps > 0) parts.push(`${bpsToInput(f.marketplaceFeeBps)}%`);
  if (f.paymentFeeBps > 0) parts.push(`${bpsToInput(f.paymentFeeBps)}% card`);
  if (f.perOrderFeeCents > 0) parts.push(`${f.perOrderFeeCents}¢/order`);
  return parts.length ? parts.join(" + ") : "None";
}

export function ChannelChooser({ state, dash, go }: SectionProps) {
  const selected = state.business.channels;
  const save = (next: string[], msg: string) => void dash.run(() => api.updateChannels(next), msg);
  const toggle = (key: string, name: string) =>
    selected.includes(key) ? save(selected.filter((k) => k !== key), `Removed ${name}.`) : save([...selected, key], `Added ${name}. Its setup steps are on your checklist.`);
  const makePrimary = (key: string, name: string) => save([key, ...selected.filter((k) => k !== key)], `${name} is now your primary channel.`);

  return (
    <Card title="Where will you sell?">
      <p className="muted">
        Pick one or more. The first is your <strong>primary</strong> channel: agents use its credentials, ads platform and fulfillment by default. Each channel
        you pick adds an “Open your account” step with exact instructions to your checklist.
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Channel</th>
              <th>Type</th>
              <th>Monthly cost</th>
              <th>Typical fees per sale</th>
              <th>Getting approved</th>
            </tr>
          </thead>
          <tbody>
            {CHANNELS.map((c) => (
              <tr key={c.key}>
                <td className="title">{c.name}</td>
                <td>{c.type}</td>
                <td className="muted">{c.monthlyCost}</td>
                <td className="num">{commission(c)}</td>
                <td>
                  <Badge tone={APPROVAL_TONE[c.approval]}>{c.approval}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="help">Fees are typical figures at the time of writing and change over time. Always check each channel's fee page (linked below) before relying on them.</p>

      <div className="grid grid-2">
        {CHANNELS.map((c) => {
          const on = selected.includes(c.key);
          const primary = selected[0] === c.key;
          return (
            <div key={c.key} className={`card choice-card ${on ? "selected" : ""}`} style={{ cursor: "default" }}>
              <div className="row between">
                <label className="check" style={{ fontWeight: 650 }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(c.key, c.name)} aria-label={`Sell on ${c.name}`} />
                  {c.name}
                </label>
                <div className="row">
                  {primary && <Badge tone="info">Primary</Badge>}
                  <Badge>{c.type}</Badge>
                  <Badge tone={APPROVAL_TONE[c.approval]}>{c.approval} to open</Badge>
                </div>
              </div>
              <div>
                <strong>Best for:</strong> {c.bestFor}
              </div>
              {c.warning && (
                <div className="banner banner-bad" style={{ padding: "8px 10px" }}>
                  <span>⚠ {c.warning}</span>
                </div>
              )}
              <div className="muted" style={{ fontSize: 13 }}>
                <div>
                  <strong>Cost:</strong> {c.monthlyCost} {c.feeSummary}
                </div>
                <div>
                  <strong>Approval:</strong> {c.approvalNote}
                </div>
              </div>
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13 }}>
                <div>
                  <strong>Pros</strong>
                  <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
                    {c.pros.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Cons</strong>
                  <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
                    {c.cons.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="row">
                <ExtLink href={c.signupUrl} className="link-btn">
                  Sign up
                </ExtLink>
                <ExtLink href={c.feesUrl} className="link-btn">
                  Fees
                </ExtLink>
                {on && !primary && (
                  <button className="btn btn-sm" onClick={() => makePrimary(c.key, c.name)}>
                    Make primary
                  </button>
                )}
                {on &&
                  c.typicalFees &&
                  (feesMatch(c, state.economics) ? (
                    <Badge tone="good">Plan uses {c.name} fees</Badge>
                  ) : (
                    <button
                      className="btn btn-sm"
                      onClick={() => void dash.run(() => api.applyChannelFees(c.key), `Plan now uses typical ${c.name} fees. Check them on Financials.`)}
                    >
                      Use {c.name} fees in my plan
                    </button>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
      {selected.length > 0 && (
        <div className="row between">
          <span className="muted">
            Selling on {selected.length} channel{selected.length === 1 ? "" : "s"}. Next: open the account{selected.length === 1 ? "" : "s"}.
          </span>
          <button className="btn btn-primary btn-sm" onClick={() => go("todo")}>
            See account steps
          </button>
        </div>
      )}
    </Card>
  );
}
