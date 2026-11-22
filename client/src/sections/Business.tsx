import { useEffect, useState } from "react";
import { EMPTY_ECONOMICS, formatBps, unitBreakdown } from "../../../shared/economics.ts";
import { formatCents } from "../../../shared/money.ts";
import { channelNames } from "../../../shared/channels.ts";
import { findService } from "../../../shared/services.ts";
import type { BusinessProfile, ProductIdea, ResearchJob, StateResponse } from "../../../shared/types.ts";
import type { SectionProps } from "../App.tsx";
import { api } from "../api.ts";
import { Badge, Card, ExtLink, Field, MoneyInput, PageHeader, formatDateTime } from "../components/ui.tsx";
import { isVaultSet } from "../lib.ts";
import { ChannelChooser } from "./Channels.tsx";
import { VaultItem } from "./Credentials.tsx";

type Mode = "known" | "research";

export function Business(props: SectionProps) {
  const { state } = props;
  const hasResearch = state.research.length > 0;
  const [mode, setMode] = useState<Mode>(state.business.product ? "known" : hasResearch ? "research" : "known");

  return (
    <>
      <PageHeader title="Business & product" subtitle="Every agent receives this profile, so it shapes everything they do." />

      <Card title="Do you already know what you want to sell?">
        <div className="choice">
          <button className={`card choice-card ${mode === "known" ? "selected" : ""}`} onClick={() => setMode("known")} aria-pressed={mode === "known"}>
            <span className="title">Yes, I know my product</span>
            <span className="muted">Type in the product, customers and sales channels.</span>
          </button>
          <button className={`card choice-card ${mode === "research" ? "selected" : ""}`} onClick={() => setMode("research")} aria-pressed={mode === "research"}>
            <span className="title">No, find me the best product</span>
            <span className="muted">AI searches the web for current opportunities that fit your budget, with real numbers and sources.</span>
          </button>
        </div>
      </Card>

      <ChannelChooser {...props} />
      {mode === "research" && <Research {...props} />}
      <ProfileForm state={state} dash={props.dash} />
      <OwnerDetails state={state} dash={props.dash} />
    </>
  );
}

function ProfileForm({ state, dash }: Pick<SectionProps, "state" | "dash">) {
  const pick = (b: BusinessProfile) => ({ name: b.name, product: b.product, description: b.description, targetMarket: b.targetMarket, salesChannels: b.salesChannels });
  const saved = pick(state.business);
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(pick(state.business)), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== savedKey;
  const set = (k: keyof typeof draft) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });

  return (
    <Card
      title={
        <span className="row">
          Business profile {state.business.productSource === "research" && <Badge tone="info">filled from AI research</Badge>}
        </span>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void dash.run(() => api.updateBusiness({ ...draft }), "Business profile saved.");
        }}
      >
        <div className="form-grid">
          <Field label="Business name" htmlFor="b-name">
            <input id="b-name" value={draft.name} onChange={set("name")} placeholder="e.g. Volt & Co." />
          </Field>
          <Field label="Product" htmlFor="b-product" required help="What exactly do you sell?">
            <input id="b-product" value={draft.product} onChange={set("product")} placeholder="e.g. UL-listed braided power cables" />
          </Field>
        </div>
        <Field label="Description" htmlFor="b-desc" help="Positioning, price range, what makes it different.">
          <textarea id="b-desc" value={draft.description} onChange={set("description")} />
        </Field>
        <div className="form-grid">
          <Field label="Target customers" htmlFor="b-market">
            <textarea id="b-market" value={draft.targetMarket} onChange={set("targetMarket")} placeholder="e.g. Home-office and gaming setups in the US" />
          </Field>
          <Field label="Sales channels" htmlFor="b-channels" help="Set by “Where will you sell?” above; edit to add detail.">
            <textarea id="b-channels" value={draft.salesChannels} onChange={set("salesChannels")} placeholder="e.g. Amazon US, own Shopify store" />
          </Field>
        </div>
        <div className="form-actions">
          <button type="button" className="btn" disabled={!dirty} onClick={() => setDraft(saved)}>
            Discard changes
          </button>
          <button type="submit" className="btn btn-primary" disabled={!dirty}>
            Save profile
          </button>
        </div>
      </form>
    </Card>
  );
}

function OwnerDetails({ state, dash }: Pick<SectionProps, "state" | "dash">) {
  const pick = (b: BusinessProfile) => ({ ownerName: b.ownerName, ownerEmail: b.ownerEmail, shippingAddress: b.shippingAddress });
  const saved = pick(state.business);
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(pick(state.business)), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft) !== savedKey;

  return (
    <Card title="Your details">
      <p className="muted">Entered once and reused: Customer Service escalates to your email; Sourcing ships samples to your address.</p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void dash.run(() => api.updateBusiness({ ...draft }), "Saved. Agents updated.");
        }}
      >
        <div className="form-grid">
          <Field label="Your name" htmlFor="o-name">
            <input id="o-name" value={draft.ownerName} onChange={(e) => setDraft({ ...draft, ownerName: e.target.value })} />
          </Field>
          <Field label="Your email" htmlFor="o-email">
            <input id="o-email" value={draft.ownerEmail} onChange={(e) => setDraft({ ...draft, ownerEmail: e.target.value })} placeholder="you@example.com" />
          </Field>
        </div>
        <Field label="Shipping address for samples" htmlFor="o-addr">
          <textarea id="o-addr" value={draft.shippingAddress} onChange={(e) => setDraft({ ...draft, shippingAddress: e.target.value })} rows={3} />
        </Field>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={!dirty}>
            Save details
          </button>
        </div>
      </form>
    </Card>
  );
}

function Research({ state, dash }: SectionProps) {
  const [budget, setBudget] = useState<number | null>(state.finance.cashBalanceCents > 0 ? state.finance.cashBalanceCents : 300000);
  const [interests, setInterests] = useState("");
  const [avoid, setAvoid] = useState("");
  const [channels, setChannels] = useState(channelNames(state.business.channels));
  const [location, setLocation] = useState("United States");
  const running = state.research.find((r) => r.status === "running");
  const hasKey = isVaultSet(state, "anthropic");
  const jobs = [...state.research].reverse();
  const anthropic = findService("anthropic")!;

  return (
    <>
      <Card title="Find a product with AI">
        <p className="muted">
          Claude searches the web for products with real demand and beatable competition that fit your budget, then shows the numbers and its sources.
          It runs on your Anthropic API credits and usually takes a few minutes.
        </p>
        {!hasKey && <VaultItem svc={anthropic} state={state} dash={dash} />}
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (budget === null || budget <= 0) {
              dash.notify("error", "Enter your total starting budget.");
              return;
            }
            void dash.run(() => api.startResearch({ budgetCents: budget, interests, avoid, channels, location }), "Research started. Results appear here.");
          }}
        >
          <div className="form-grid">
            <Field label="Total starting budget" htmlFor="r-budget" required help="Samples, first inventory, photos and launch ads.">
              <MoneyInput id="r-budget" value={budget} onChange={setBudget} />
            </Field>
            <Field label="Where you sell from / to" htmlFor="r-loc">
              <input id="r-loc" value={location} onChange={(e) => setLocation(e.target.value)} />
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Interests (optional)" htmlFor="r-int" help="Leave empty to let AI pick freely.">
              <input id="r-int" value={interests} onChange={(e) => setInterests(e.target.value)} placeholder="e.g. home office, pets, outdoors" />
            </Field>
            <Field label="Avoid (optional)" htmlFor="r-avoid">
              <input id="r-avoid" value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder="e.g. food, cosmetics, children's products" />
            </Field>
            <Field label="Sales channels (optional)" htmlFor="r-ch">
              <input id="r-ch" value={channels} onChange={(e) => setChannels(e.target.value)} placeholder="e.g. Amazon" />
            </Field>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={!hasKey || Boolean(running)}>
              {running ? "Researching…" : "Research the best products"}
            </button>
          </div>
        </form>
      </Card>

      {running && (
        <div className="banner banner-info">
          <span>
            <strong>Researching</strong> since {formatDateTime(running.startedAt)}. You can leave this page; results will be here when it finishes.
          </span>
        </div>
      )}

      {jobs
        .filter((j) => j.status !== "running")
        .map((j, i) => (
          <ResearchResults key={j.id} job={j} state={state} dash={dash} defaultOpen={i === 0} />
        ))}
    </>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function ideaNumbers(idea: ProductIdea, state: StateResponse) {
  return unitBreakdown({
    ...EMPTY_ECONOMICS,
    paymentFeeBps: state.economics.paymentFeeBps,
    adSpendBps: state.economics.adSpendBps,
    returnRateBps: state.economics.returnRateBps,
    salePriceCents: idea.salePriceCents,
    unitCostCents: idea.unitCostCents,
    inboundShippingCents: idea.inboundShippingCents,
    fulfillmentFeeCents: idea.fulfillmentFeeCents,
    marketplaceFeeBps: idea.marketplaceFeeBps || EMPTY_ECONOMICS.marketplaceFeeBps,
  });
}

function ResearchResults({ job, state, dash, defaultOpen }: { job: ResearchJob; state: StateResponse; dash: SectionProps["dash"]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card
      title={
        <span className="row">
          Research from {formatDateTime(job.startedAt)}
          {job.status === "error" ? <Badge tone="bad">failed</Badge> : <Badge tone="good">{job.ideas.length} ideas</Badge>}
          {job.chosenIndex !== null && <Badge tone="info">chosen</Badge>}
        </span>
      }
      actions={
        <button className="btn btn-sm" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Show"}
        </button>
      }
    >
      {open && job.status === "error" && <p style={{ color: "var(--bad-strong)" }}>{job.error}</p>}
      {open && job.status === "done" && (
        <>
          {job.summary && <p>{job.summary}</p>}
          <p className="help">
            Numbers are AI estimates from public data at the time of research, using your return rate ({formatBps(state.economics.returnRateBps)}) and ad spend ({formatBps(state.economics.adSpendBps)}) assumptions. Verify supplier quotes before ordering.
          </p>
          {job.ideas.map((idea, i) => {
            const u = ideaNumbers(idea, state);
            const chosen = job.chosenIndex === i;
            return (
              <div key={i} className={`card idea ${chosen ? "chosen" : ""}`}>
                <div className="row between">
                  <div className="row">
                    <span className="title">
                      {i + 1}. {idea.title}
                    </span>
                    <Badge tone={idea.competition === "low" ? "good" : idea.competition === "medium" ? "warn" : "bad"}>{idea.competition} competition</Badge>
                  </div>
                  {chosen ? (
                    <Badge tone="good">Your product</Badge>
                  ) : (
                    <button className="btn btn-primary btn-sm" onClick={() => void dash.run(() => api.chooseIdea(job.id, i), `Chose ${idea.title}. Profile and numbers filled in.`)}>
                      Choose this product
                    </button>
                  )}
                </div>
                <div>
                  <strong>{idea.product}</strong>
                  <div className="muted">{idea.niche}</div>
                </div>
                <div className="kv">
                  <div>
                    <span>Sale price</span>
                    <strong>{formatCents(idea.salePriceCents)}</strong>
                  </div>
                  <div>
                    <span>Landed cost / unit</span>
                    <strong>{formatCents(u.landedCost)}</strong>
                  </div>
                  <div>
                    <span>Profit / unit after fees & ads</span>
                    <strong className={u.contribution >= 0 ? "tone-good" : "tone-bad"}>{formatCents(u.contribution)}</strong>
                  </div>
                  <div>
                    <span>Contribution margin</span>
                    <strong>{formatBps(u.contributionMarginBps)}</strong>
                  </div>
                  <div>
                    <span>Est. units / month</span>
                    <strong>{idea.estimatedMonthlyUnits}</strong>
                  </div>
                  <div>
                    <span>Est. monthly profit</span>
                    <strong>{formatCents(u.contribution * idea.estimatedMonthlyUnits)}</strong>
                  </div>
                  <div>
                    <span>Startup cash</span>
                    <strong>{formatCents(idea.startupCostCents)}</strong>
                  </div>
                </div>
                <div>
                  <strong>Who buys:</strong> {idea.targetAudience}
                </div>
                <div>
                  <strong>Why now:</strong> {idea.whyNow}
                </div>
                {idea.compliance.length > 0 && (
                  <div>
                    <strong>Must have:</strong> {idea.compliance.join(", ")}
                  </div>
                )}
                {idea.risks.length > 0 && (
                  <div>
                    <strong>Risks:</strong> {idea.risks.join("; ")}
                  </div>
                )}
                {idea.sources.length > 0 && (
                  <div className="row" style={{ fontSize: 13 }}>
                    <strong>Sources:</strong>
                    {idea.sources.map((s) => (
                      <ExtLink key={s.url} href={s.url}>
                        {s.title || hostOf(s.url)}
                      </ExtLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </Card>
  );
}
