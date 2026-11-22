import { useEffect, useState } from "react";
import { FULFILLMENT_LABEL, lowSupplies, pickList } from "../../../shared/shipping.ts";
import type { FulfillmentMode, Shipment, SupplyItem } from "../../../shared/types.ts";
import type { SectionProps } from "../App.tsx";
import { api } from "../api.ts";
import { Badge, Card, EmptyState, Field, PageHeader, formatDateTime } from "../components/ui.tsx";

const MODES: Array<{ key: FulfillmentMode; title: string; body: string }> = [
  {
    key: "self",
    title: "I'll ship orders myself",
    body: "Best to start. The AI queues each order with exactly what to pack, tracks your stock at home and orders supplies (with your approval). You pack, print the label and drop it off.",
  },
  {
    key: "provider",
    title: "A fulfillment company",
    body: "ShipBob or similar stores and ships for you. They usually want an established sales volume first.",
  },
  {
    key: "marketplace",
    title: "Amazon FBA",
    body: "Amazon stores and ships orders from Amazon. Only if you sell on Amazon.",
  },
];

function copy(text: string, dash: SectionProps["dash"], what: string) {
  navigator.clipboard.writeText(text).then(
    () => dash.notify("success", `${what} copied.`),
    () => dash.notify("error", "Couldn't copy automatically. Select the text and copy it."),
  );
}

function ShipmentCard({ sh, dash }: { sh: Shipment; dash: SectionProps["dash"] }) {
  const [tracking, setTracking] = useState(sh.trackingNumber);
  const label = `${sh.recipientName}\n${sh.address}`;
  return (
    <div className="card" style={{ gap: 8 }}>
      <div className="row between">
        <span className="title">
          {sh.orderRef || "Order"} {sh.channel && <Badge>{sh.channel}</Badge>}
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          added {formatDateTime(sh.createdAt)} by {sh.createdBy}
        </span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <div>
          <div className="nav-group" style={{ margin: 0 }}>
            Put in the box
          </div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {sh.items.map((it, i) => (
              <li key={i}>
                <strong>{it.qty} ×</strong> {it.name}
              </li>
            ))}
          </ul>
          {sh.packaging && (
            <div style={{ marginTop: 4 }}>
              <strong>Pack in:</strong> {sh.packaging}
            </div>
          )}
          {sh.service && (
            <div>
              <strong>Ship with:</strong> {sh.service}
            </div>
          )}
          {sh.notes && <div className="help">Note: {sh.notes}</div>}
        </div>
        <div>
          <div className="nav-group" style={{ margin: 0 }}>
            Send to
          </div>
          <pre style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>{label}</pre>
          <button className="btn btn-sm" onClick={() => copy(label, dash, "Address")}>
            Copy address
          </button>
        </div>
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        {sh.status === "to_pack" && (
          <>
            <button className="btn btn-sm btn-danger" onClick={() => window.confirm("Cancel this order in the queue?") && void dash.run(() => api.updateShipment(sh.id, "cancelled"), "Removed from the queue.")}>
              Cancel
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => void dash.run(() => api.updateShipment(sh.id, "packed"), "Marked packed.")}>
              Packed
            </button>
          </>
        )}
        {sh.status === "packed" && (
          <>
            <input
              aria-label="Tracking number"
              placeholder="Tracking number (optional)"
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              style={{ maxWidth: 240 }}
            />
            <button className="btn btn-sm" onClick={() => void dash.run(() => api.updateShipment(sh.id, "to_pack"), "Moved back to To pack.")}>
              Undo
            </button>
            <button className="btn btn-sm btn-good-solid" onClick={() => void dash.run(() => api.updateShipment(sh.id, "shipped", tracking), "Shipped. Stock counts updated.")}>
              Dropped off / shipped
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ShopifyCard({ state, dash, go }: Pick<SectionProps, "state" | "dash" | "go">) {
  const sh = state.shopify;
  const saved = state.vault.some((v) => v.key === "shopify_admin" && v.set);
  const connected = sh.shopName !== null || sh.lastSyncAt !== null;
  const tone = sh.lastError ? "bad" : connected ? "good" : "neutral";
  const status = sh.lastError ? "Problem" : connected ? `Connected${sh.shopName ? ` to ${sh.shopName}` : ""}` : saved ? "Not tested yet" : "Not set up";

  return (
    <Card title={<span className="row">Shopify orders <Badge tone={tone}>{status}</Badge></span>}>
      {!saved ? (
        <>
          <p className="muted">
            Connect your store and every paid order appears below by itself, with the address and items copied exactly. Save your store address, Client ID and
            Client secret on Credentials first.
          </p>
          <div>
            <button className="btn btn-primary" onClick={() => go("credentials")}>
              Open Credentials
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            {sh.autoSync ? "Paid, unshipped orders are imported every 5 minutes." : "Automatic import is off; use “Check for new orders”."} Orders already in the
            queue are never added twice.
          </p>
          {sh.lastError && (
            <div className="banner banner-bad">
              <span>{sh.lastError}</span>
            </div>
          )}
          <div className="kv">
            <div>
              <span>Last checked</span>
              <strong>{sh.lastSyncAt ? formatDateTime(sh.lastSyncAt) : "never"}</strong>
            </div>
            <div>
              <span>New orders last time</span>
              <strong>{sh.lastSyncAt ? sh.lastSyncAdded : "—"}</strong>
            </div>
          </div>
          <div className="row">
            <button className="btn" onClick={() => void dash.run(() => api.testShopify(), "Shopify connected.")}>
              Test connection
            </button>
            <button className="btn btn-primary" onClick={() => void dash.run(() => api.syncShopify(), "Checked Shopify for new orders.")}>
              Check for new orders
            </button>
            <label className="check">
              <input type="checkbox" checked={sh.autoSync} onChange={() => void dash.run(() => api.setShopifyAutoSync(!sh.autoSync), sh.autoSync ? "Automatic import off." : "Automatic import on.")} />
              Import automatically
            </label>
          </div>
        </>
      )}
    </Card>
  );
}

function StockTable({ supplies, dash }: { supplies: SupplyItem[]; dash: SectionProps["dash"] }) {
  const savedKey = JSON.stringify(supplies);
  const [rows, setRows] = useState<SupplyItem[]>(supplies);
  useEffect(() => setRows(supplies), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(rows) !== savedKey;
  const setNum = (i: number, k: "onHand" | "reorderAt" | "reorderQty" | "usedPerShipment", v: string) => {
    const n = v.trim() === "" || v.trim() === "-" ? 0 : Number(v);
    if (!Number.isFinite(n)) return;
    const next = [...rows];
    next[i] = { ...next[i]!, [k]: Math.trunc(n) };
    setRows(next);
  };
  const low = new Set(lowSupplies(rows).map((s) => s.id));

  return (
    <Card
      title="Stock at home"
      actions={
        <button
          className="btn btn-sm"
          onClick={() =>
            setRows([...rows, { id: `new-${rows.length}-${Date.now()}`, name: "New item", kind: "packaging", unit: "units", onHand: 0, reorderAt: 0, reorderQty: 0, usedPerShipment: 0 }])
          }
        >
          Add item
        </button>
      }
    >
      <p className="muted">
        Counts go down automatically when you mark an order shipped (its items, its mailer, and anything used for every package, like labels). When something
        reaches its reorder point, the Inventory agent asks your approval to buy more. Fix any count here.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Type</th>
              <th className="right">On hand</th>
              <th className="right">Reorder at</th>
              <th className="right">Reorder qty</th>
              <th className="right">Used per package</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td>
                  <input
                    aria-label="Item name"
                    value={r.name}
                    onChange={(e) => {
                      const next = [...rows];
                      next[i] = { ...r, name: e.target.value };
                      setRows(next);
                    }}
                  />
                  {low.has(r.id) && <Badge tone="warn">Low</Badge>}
                </td>
                <td>
                  <select
                    aria-label="Type"
                    value={r.kind}
                    onChange={(e) => {
                      const next = [...rows];
                      next[i] = { ...r, kind: e.target.value as SupplyItem["kind"] };
                      setRows(next);
                    }}
                  >
                    <option value="product">Product</option>
                    <option value="packaging">Packaging</option>
                  </select>
                </td>
                {(["onHand", "reorderAt", "reorderQty", "usedPerShipment"] as const).map((k) => (
                  <td key={k} className="right">
                    <input aria-label={k} inputMode="numeric" style={{ width: 80, textAlign: "right" }} value={String(r[k])} onChange={(e) => setNum(i, k, e.target.value)} />
                  </td>
                ))}
                <td className="right">
                  <button className="btn btn-sm btn-danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-actions">
        <button className="btn" disabled={!dirty} onClick={() => setRows(supplies)}>
          Discard changes
        </button>
        <button
          className="btn btn-primary"
          disabled={!dirty}
          onClick={() => void dash.run(() => api.saveSupplies(rows.map((r) => (r.id.startsWith("new-") ? { ...r, id: undefined } : r))), "Stock saved.")}
        >
          Save stock
        </button>
      </div>
    </Card>
  );
}

function AddOrder({ state, dash }: Pick<SectionProps, "state" | "dash">) {
  const product = state.supplies.find((s) => s.kind === "product");
  const mailer = state.supplies.find((s) => s.kind === "packaging" && /mailer|box/i.test(s.name));
  const blank = { orderRef: "", recipientName: "", address: "", item: product?.name ?? state.business.product, qty: "1", packaging: mailer?.name ?? "", service: "" };
  const [f, setF] = useState(blank);
  return (
    <Card title="Add an order by hand">
      <p className="muted">Shopify orders are added automatically once connected. Use this for orders from anywhere else.</p>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const qty = Number(f.qty);
          if (!Number.isSafeInteger(qty) || qty < 1) return dash.notify("error", "Quantity must be a whole number.");
          const ok = await dash.run(
            () =>
              api.addShipment({
                orderRef: f.orderRef,
                recipientName: f.recipientName,
                address: f.address,
                items: [{ name: f.item, qty, supplyId: product && f.item === product.name ? product.id : null }],
                packaging: f.packaging,
                packagingSupplyId: mailer && f.packaging === mailer.name ? mailer.id : null,
                service: f.service,
              }),
            "Added to the packing queue.",
          );
          if (ok) setF(blank);
        }}
      >
        <div className="form-grid">
          <Field label="Order number" htmlFor="o-ref">
            <input id="o-ref" value={f.orderRef} onChange={(e) => setF({ ...f, orderRef: e.target.value })} placeholder="#1001" />
          </Field>
          <Field label="Customer name" htmlFor="o-name" required>
            <input id="o-name" value={f.recipientName} onChange={(e) => setF({ ...f, recipientName: e.target.value })} />
          </Field>
          <Field label="Item" htmlFor="o-item" required>
            <input id="o-item" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} />
          </Field>
          <Field label="Quantity" htmlFor="o-qty" required>
            <input id="o-qty" inputMode="numeric" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
          </Field>
        </div>
        <Field label="Shipping address" htmlFor="o-addr" required>
          <textarea id="o-addr" rows={3} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder={"Street\nCity, State ZIP"} />
        </Field>
        <div className="form-grid">
          <Field label="Pack in" htmlFor="o-pack">
            <input id="o-pack" value={f.packaging} onChange={(e) => setF({ ...f, packaging: e.target.value })} />
          </Field>
          <Field label="Ship with" htmlFor="o-svc">
            <input id="o-svc" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} placeholder="e.g. USPS Ground Advantage" />
          </Field>
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={!f.recipientName.trim() || !f.address.trim() || !f.item.trim()}>
            Add to queue
          </button>
        </div>
      </form>
    </Card>
  );
}

export function Shipping({ state, dash, go }: SectionProps) {
  const mode = state.business.fulfillmentMode;
  const toPack = state.shipments.filter((s) => s.status === "to_pack");
  const packed = state.shipments.filter((s) => s.status === "packed");
  const shipped = state.shipments.filter((s) => s.status === "shipped").slice(0, 20);
  const pick = pickList(state.shipments);

  return (
    <>
      <PageHeader title="Pack & ship" subtitle="How orders get to customers, and when you ship them yourself, exactly what to pack and where it goes." />

      <Card title={<span className="row">How will orders be shipped? {mode && <Badge tone="info">{FULFILLMENT_LABEL[mode]}</Badge>}</span>}>
        <div className="choice">
          {MODES.filter((m) => m.key !== "marketplace" || state.business.channels.includes("amazon")).map((m) => (
            <button
              key={m.key}
              className={`card choice-card ${mode === m.key ? "selected" : ""}`}
              aria-pressed={mode === m.key}
              onClick={() => mode !== m.key && void dash.run(() => api.setFulfillment(m.key), `Shipping: ${FULFILLMENT_LABEL[m.key]}.`)}
            >
              <span className="title">{m.title}</span>
              <span className="muted">{m.body}</span>
            </button>
          ))}
        </div>
      </Card>

      {mode === "self" && (
        <>
          <Card title="Who does what">
            <div className="grid grid-2">
              <div>
                <strong>The AI (Inventory agent)</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  <li>New Shopify orders appear here by themselves (once connected), with what to pack and where it goes</li>
                  <li>Watches stock at home and asks to buy more before you run out</li>
                  <li>Posts new orders and a daily “to pack” count to Discord HQ</li>
                </ul>
              </div>
              <div>
                <strong>You</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  <li>Approve supply purchases, then buy them (agents can't check out on websites yet)</li>
                  <li>Pack, buy and print the label in Shopify (Orders → the order → Create shipping label), drop off</li>
                  <li>Click “Dropped off / shipped” here so stock counts stay right</li>
                </ul>
              </div>
            </div>
          </Card>

          <ShopifyCard state={state} dash={dash} go={go} />

          <Card title={`Today's pick list (${pick.orders} order${pick.orders === 1 ? "" : "s"})`}>
            {pick.orders === 0 ? (
              <EmptyState title="Nothing to pack right now" />
            ) : (
              <div className="grid grid-2">
                <div>
                  <strong>Pull from your shelf</strong>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {pick.items.map((l) => (
                      <li key={l.name}>
                        <strong>{l.qty} ×</strong> {l.name}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Packaging</strong>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {pick.packaging.length === 0 ? <li className="muted">Not specified</li> : pick.packaging.map((l) => <li key={l.name}>{l.qty} × {l.name}</li>)}
                    <li>
                      {pick.orders} shipping label{pick.orders === 1 ? "" : "s"}
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </Card>

          <div className="stack">
            <h3>To pack ({toPack.length})</h3>
            {toPack.length === 0 ? <p className="muted">All caught up.</p> : toPack.map((sh) => <ShipmentCard key={sh.id} sh={sh} dash={dash} />)}
          </div>

          {packed.length > 0 && (
            <div className="stack">
              <h3>Packed, waiting for drop-off ({packed.length})</h3>
              {packed.map((sh) => (
                <ShipmentCard key={sh.id} sh={sh} dash={dash} />
              ))}
            </div>
          )}

          <StockTable supplies={state.supplies} dash={dash} />
          <AddOrder state={state} dash={dash} />

          {shipped.length > 0 && (
            <Card title="Recently shipped">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Shipped</th>
                      <th>Order</th>
                      <th>Items</th>
                      <th>Tracking</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shipped.map((sh) => (
                      <tr key={sh.id}>
                        <td className="muted">{sh.shippedAt ? formatDateTime(sh.shippedAt) : ""}</td>
                        <td>{sh.orderRef || sh.recipientName}</td>
                        <td>{sh.items.map((i) => `${i.qty} × ${i.name}`).join(", ")}</td>
                        <td className="mono">{sh.trackingNumber || "—"}</td>
                        <td className="right">
                          <button className="btn btn-sm" onClick={() => void dash.run(() => api.updateShipment(sh.id, "packed"), "Moved back to packed; stock restored.")}>
                            Undo
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {mode === "provider" && (
        <Card>
          <p>
            A fulfillment company stores your stock and ships every order. Save its API key on Credentials and the Inventory agent will send inbound shipments and
            reorders. Most, including ShipBob, want an established monthly order volume first, so shipping yourself is the usual way to start.
          </p>
        </Card>
      )}
    </>
  );
}
