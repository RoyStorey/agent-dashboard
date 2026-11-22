import { useState } from "react";
import type { BusinessProfile } from "../../../shared/types.ts";
import type { SectionProps } from "../App.tsx";
import { api } from "../api.ts";
import { Card, Field, PageHeader } from "../components/ui.tsx";

export function Business({ state, dash }: SectionProps) {
  const [draft, setDraft] = useState<BusinessProfile>(state.business);
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.business);
  const set = (k: keyof BusinessProfile) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });

  return (
    <>
      <PageHeader
        title="Business profile"
        subtitle="Every agent receives this profile in its configuration, so be specific about what you sell and who buys it."
      />
      <Card>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void dash.run(() => api.updateBusiness({ ...draft }), "Business profile saved.");
          }}
        >
          <div className="form-grid">
            <Field label="Business name" htmlFor="b-name" required>
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
            <Field label="Sales channels" htmlFor="b-channels">
              <textarea id="b-channels" value={draft.salesChannels} onChange={set("salesChannels")} placeholder="e.g. Amazon US, own Shopify store" />
            </Field>
          </div>
          <div className="form-actions">
            <button type="button" className="btn" disabled={!dirty} onClick={() => setDraft(state.business)}>
              Discard changes
            </button>
            <button type="submit" className="btn btn-primary" disabled={!dirty}>
              Save profile
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}
