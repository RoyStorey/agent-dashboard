import type { DashboardState, Shipment } from "../shared/types.ts";
import { log, newId, type Store } from "./store.ts";

/** Admin API version. 2026-10 is the version Shopify's Dev Dashboard offers for new apps. */
export const SHOPIFY_API_VERSION = "2026-10";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface ShopifyCredential {
  /** e.g. my-store.myshopify.com */
  shop: string;
  /** Either an Admin API access token (shpat_…) … */
  accessToken?: string;
  /** … or the app's Client ID and Client secret, exchanged for a token. */
  clientId?: string;
  clientSecret?: string;
}

export class ShopifyError extends Error {}

/** Reads the three lines saved on Credentials: store address, Client ID, Client secret (or an shpat_ token). */
export function parseShopifyCredential(value: string): ShopifyCredential {
  const lines = value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new ShopifyError("The Shopify credential needs your store address on the first line, then the Client ID and Client secret.");
  const shop = lines[0]!
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new ShopifyError(`The first line should be your store's myshopify address (like my-store.myshopify.com), not "${lines[0]}".`);
  }
  const token = lines.slice(1).find((l) => l.startsWith("shpat_"));
  if (token) return { shop, accessToken: token };
  if (lines.length < 3) throw new ShopifyError("After the store address, paste the Client ID on line 2 and the Client secret on line 3.");
  return { shop, clientId: lines[1]!, clientSecret: lines[2]! };
}

interface OrderNode {
  name: string;
  createdAt: string;
  note: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  shippingLine: { title: string | null } | null;
  shippingAddress: {
    name: string | null;
    company: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    provinceCode: string | null;
    zip: string | null;
    countryCodeV2: string | null;
  } | null;
  lineItems: { nodes: Array<{ title: string; quantity: number; requiresShipping: boolean }> };
}

const ORDERS_QUERY = `query OrdersToShip {
  orders(first: 50, sortKey: CREATED_AT, reverse: true, query: "status:open") {
    nodes {
      name
      createdAt
      note
      displayFinancialStatus
      displayFulfillmentStatus
      shippingLine { title }
      shippingAddress { name company address1 address2 city provinceCode zip countryCodeV2 }
      lineItems(first: 50) { nodes { title quantity requiresShipping } }
    }
  }
}`;

/** Paid (or partly refunded) orders that still need shipping and have a shipping address. */
export function ordersToShip(nodes: OrderNode[]): OrderNode[] {
  return nodes.filter(
    (o) =>
      (o.displayFinancialStatus === "PAID" || o.displayFinancialStatus === "PARTIALLY_REFUNDED") &&
      (o.displayFulfillmentStatus === "UNFULFILLED" || o.displayFulfillmentStatus === "PARTIALLY_FULFILLED") &&
      o.shippingAddress !== null &&
      o.lineItems.nodes.some((li) => li.requiresShipping && li.quantity > 0),
  );
}

export function formatAddress(a: NonNullable<OrderNode["shippingAddress"]>): string {
  const cityLine = [a.city, [a.provinceCode, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.company, a.address1, a.address2, cityLine, a.countryCodeV2 && a.countryCodeV2 !== "US" ? a.countryCodeV2 : null]
    .filter((x): x is string => Boolean(x && x.trim()))
    .join("\n");
}

/** Turns a Shopify order into a packing-queue entry, linked to stock at home where it's clear which item it is. */
export function orderToShipment(o: OrderNode, s: DashboardState, now: Date): Shipment {
  const products = s.supplies.filter((x) => x.kind === "product");
  const mailer = s.supplies.find((x) => x.kind === "packaging" && /mailer|box/i.test(x.name));
  const items = o.lineItems.nodes
    .filter((li) => li.requiresShipping && li.quantity > 0)
    .map((li) => {
      const byName = products.find((p) => p.name.trim().toLowerCase() === li.title.trim().toLowerCase());
      // A one-product shop: every line item is that product.
      const supply = byName ?? (products.length === 1 ? products[0] : undefined);
      return { name: li.title, qty: li.quantity, supplyId: supply?.id ?? null };
    });
  const addr = o.shippingAddress!;
  return {
    id: newId(),
    orderRef: o.name,
    channel: "Shopify",
    recipientName: (addr.name ?? "").trim() || "Customer",
    address: formatAddress(addr),
    items,
    packaging: mailer?.name ?? "",
    packagingSupplyId: mailer?.id ?? null,
    service: o.shippingLine?.title?.trim() ?? "",
    notes: (o.note ?? "").trim().slice(0, 2000),
    status: "to_pack",
    trackingNumber: "",
    createdAt: now.toISOString(),
    createdBy: "Shopify",
    packedAt: null,
    shippedAt: null,
  };
}

function explainGraphQLErrors(errors: Array<{ message?: string }>): string {
  const text = errors.map((e) => e.message ?? "").join(" ");
  if (/protected customer data|not approved to access/i.test(text)) {
    return "Shopify blocked access to customer names and addresses. In the Shopify Dev Dashboard, open your app's API access settings and request access to protected customer data (name and address), then try again.";
  }
  if (/access denied|scope/i.test(text)) {
    return `Shopify says the app lacks a permission (${text.slice(0, 200)}). Check the app's scopes include read_orders, then reinstall the app on your store.`;
  }
  return `Shopify returned an error: ${text.slice(0, 300)}`;
}

/**
 * Talks to one Shopify store for the dashboard: gets an access token,
 * tests the connection and imports orders to ship. Tokens are kept in
 * memory only and refreshed before they expire.
 */
export class ShopifyService {
  private token: { value: string; expiresAt: number; forKey: string } | null = null;
  private syncing = false;

  constructor(
    private readonly store: Store,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly now: () => Date = () => new Date(),
  ) {}

  credential(): ShopifyCredential {
    const raw = this.store.get().vault.shopify_admin?.value ?? "";
    if (!raw.trim()) throw new ShopifyError("Save your Shopify details on Credentials first (store address, Client ID, Client secret).");
    return parseShopifyCredential(raw);
  }

  private async accessToken(c: ShopifyCredential): Promise<string> {
    if (c.accessToken) return c.accessToken;
    const key = `${c.shop}|${c.clientId}|${c.clientSecret}`;
    if (this.token && this.token.forKey === key && this.token.expiresAt > this.now().getTime()) return this.token.value;
    let res;
    try {
      res = await this.fetchImpl(`https://${c.shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.clientId!, client_secret: c.clientSecret! }).toString(),
      });
    } catch (err) {
      throw new ShopifyError(`Couldn't reach ${c.shop}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const body = await res.text();
    if (!res.ok) {
      if (res.status === 404) throw new ShopifyError(`No Shopify store found at ${c.shop}. Check the store address on Credentials.`);
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        throw new ShopifyError(
          `Shopify refused the Client ID / Client secret (HTTP ${res.status}: ${body.slice(0, 200)}). Check they're copied exactly and that the app is installed on this store.`,
        );
      }
      throw new ShopifyError(`Shopify didn't issue an access token (HTTP ${res.status}): ${body.slice(0, 200)}`);
    }
    let data: { access_token?: string; expires_in?: number };
    try {
      data = JSON.parse(body) as typeof data;
    } catch {
      throw new ShopifyError("Shopify's token reply wasn't readable.");
    }
    if (!data.access_token) throw new ShopifyError("Shopify's reply didn't include an access token.");
    const ttlMs = (data.expires_in && data.expires_in > 120 ? data.expires_in - 60 : 3600) * 1000;
    this.token = { value: data.access_token, expiresAt: this.now().getTime() + ttlMs, forKey: key };
    return data.access_token;
  }

  private async graphql<T>(query: string): Promise<T> {
    const c = this.credential();
    const token = await this.accessToken(c);
    let res;
    try {
      res = await this.fetchImpl(`https://${c.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query }),
      });
    } catch (err) {
      throw new ShopifyError(`Couldn't reach ${c.shop}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const body = await res.text();
    if (res.status === 401 || res.status === 403) {
      this.token = null;
      throw new ShopifyError(`Shopify rejected the access token (HTTP ${res.status}). Reinstall the app on your store, or check the details on Credentials.`);
    }
    if (!res.ok) throw new ShopifyError(`Shopify returned HTTP ${res.status}: ${body.slice(0, 200)}`);
    const parsed = JSON.parse(body) as { data?: T; errors?: Array<{ message?: string }> };
    if (parsed.errors?.length) throw new ShopifyError(explainGraphQLErrors(parsed.errors));
    if (!parsed.data) throw new ShopifyError("Shopify returned no data.");
    return parsed.data;
  }

  private record(update: (s: DashboardState) => void): void {
    this.store.mutate(update);
  }

  /** Reads only the shop's name, to prove the connection works. */
  async test(): Promise<string> {
    try {
      const data = await this.graphql<{ shop: { name: string } }>("query { shop { name } }");
      const t = this.now();
      this.record((s) => {
        const first = s.shopify.shopName === null;
        s.shopify.shopName = data.shop.name;
        s.shopify.connectedAt = s.shopify.connectedAt ?? t.toISOString();
        s.shopify.lastError = null;
        if (first) log(s, "System", "success", `Connected to Shopify store “${data.shop.name}”. New paid orders will appear in Pack & ship.`, t);
      });
      return data.shop.name;
    } catch (err) {
      this.fail(err);
      throw err;
    }
  }

  private fail(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const t = this.now();
    this.record((s) => {
      const changed = s.shopify.lastError !== message;
      s.shopify.lastError = message;
      s.shopify.lastErrorAt = t.toISOString();
      // Log each new problem once, not on every 5-minute retry.
      if (changed) log(s, "System", "error", `Shopify: ${message}`, t, { kind: "system", title: "Shopify connection problem" });
    });
  }

  /** Adds paid, unshipped Shopify orders to the packing queue. Returns how many were added. */
  async sync(trigger: "auto" | "manual"): Promise<number> {
    if (this.syncing) return 0;
    this.syncing = true;
    try {
      const data = await this.graphql<{ orders: { nodes: OrderNode[] } }>(ORDERS_QUERY);
      const candidates = ordersToShip(data.orders.nodes).reverse(); // oldest first, so the queue reads in order
      const t = this.now();
      let added = 0;
      this.record((s) => {
        for (const o of candidates) {
          // Skip anything already in the queue, including orders you cancelled there.
          if (s.shipments.some((sh) => sh.orderRef === o.name)) continue;
          const sh = orderToShipment(o, s, t);
          s.shipments.push(sh);
          added++;
          const items = sh.items.map((i) => `${i.qty} × ${i.name}`).join(", ");
          log(s, "Shopify", "info", `Queued to pack: Order ${sh.orderRef}: ${items}.`, t, { kind: "report", agentId: null, title: "New order to pack" });
        }
        s.shopify.lastSyncAt = t.toISOString();
        s.shopify.lastSyncAdded = added;
        s.shopify.lastError = null;
        if (trigger === "manual" && added === 0) log(s, "Owner", "info", "Checked Shopify: no new orders to ship.", t);
      });
      return added;
    } catch (err) {
      this.fail(err);
      throw err;
    } finally {
      this.syncing = false;
    }
  }

  /** Called on a timer: syncs only when shipping yourself, Shopify is saved, and auto-import is on. */
  async tick(): Promise<void> {
    const s = this.store.get();
    if (!s.shopify.autoSync || s.business.fulfillmentMode !== "self" || !(s.vault.shopify_admin?.value ?? "").trim()) return;
    try {
      await this.sync("auto");
    } catch {
      // Already recorded in lastError and the activity log.
    }
  }
}
