import { applyStockChanges, stockChanges } from "../shared/shipping.ts";
import type { DashboardState, Shipment, ShipmentStatus, SupplyItem } from "../shared/types.ts";
import { log, newId } from "./store.ts";
import { asBody, bad, str, type Body } from "./validate.ts";

function whole(v: unknown, label: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) throw bad(`${label} must be a whole number from ${min} to ${max}.`);
  return v;
}

function supplyRef(s: DashboardState, id: unknown, label: string): string | null {
  if (id === undefined || id === null || id === "") return null;
  if (typeof id !== "string" || !s.supplies.some((x) => x.id === id)) throw bad(`${label} refers to an unknown stock item.`);
  return id;
}

/** Validates a new shipment from the owner or an agent. */
export function parseShipment(s: DashboardState, body: Body, createdBy: string, now: Date): Shipment {
  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 50) throw bad('"items" must list 1 to 50 items, each { name, qty }.');
  const items = rawItems.map((raw) => {
    const it = asBody(raw);
    return {
      name: (str(it, "name", { max: 200, required: true }) as string).trim(),
      qty: whole(it.qty, "Item quantity", 1, 10_000),
      supplyId: supplyRef(s, it.supplyId, "An item"),
    };
  });
  const address = (str(body, "address", { max: 600, required: true }) as string).trim();
  return {
    id: newId(),
    orderRef: (str(body, "orderRef", { max: 100 }) ?? "").trim(),
    channel: (str(body, "channel", { max: 50 }) ?? "").trim(),
    recipientName: (str(body, "recipientName", { max: 200, required: true }) as string).trim(),
    address,
    items,
    packaging: (str(body, "packaging", { max: 200 }) ?? "").trim(),
    packagingSupplyId: supplyRef(s, body.packagingSupplyId, "packagingSupplyId"),
    service: (str(body, "service", { max: 200 }) ?? "").trim(),
    notes: (str(body, "notes", { max: 2000 }) ?? "").trim(),
    status: "to_pack",
    trackingNumber: "",
    createdAt: now.toISOString(),
    createdBy,
    packedAt: null,
    shippedAt: null,
  };
}

const STATUSES: readonly ShipmentStatus[] = ["to_pack", "packed", "shipped", "cancelled"];

/**
 * Moves a shipment to a new status. Shipping uses up its items, packaging and
 * per-package supplies from stock at home; moving it back out of "shipped" puts them back.
 */
export function setShipmentStatus(s: DashboardState, sh: Shipment, next: ShipmentStatus, trackingNumber: string | undefined, now: Date): void {
  if (!STATUSES.includes(next)) throw bad(`Status must be one of: ${STATUSES.join(", ")}.`);
  const wasShipped = sh.status === "shipped";
  if (next === "shipped" && !wasShipped) applyStockChanges(s, stockChanges(sh, s.supplies, -1));
  if (wasShipped && next !== "shipped") applyStockChanges(s, stockChanges(sh, s.supplies, 1));
  if (trackingNumber !== undefined) sh.trackingNumber = trackingNumber.trim().slice(0, 100);
  if (next === "packed" && !sh.packedAt) sh.packedAt = now.toISOString();
  if (next === "shipped") sh.shippedAt = now.toISOString();
  if (next !== "shipped") sh.shippedAt = null;
  sh.status = next;
}

/** Validates the owner's full stock-at-home list. Existing ids are kept so shipments stay linked. */
export function parseSupplies(s: DashboardState, value: unknown): SupplyItem[] {
  if (!Array.isArray(value) || value.length > 100) throw bad('"supplies" must be a list of up to 100 items.');
  const seen = new Set<string>();
  return value.map((raw) => {
    const b = asBody(raw);
    const idRaw = b.id;
    const id = typeof idRaw === "string" && s.supplies.some((x) => x.id === idRaw) ? idRaw : newId();
    if (seen.has(id)) throw bad("Each stock item can only be listed once.");
    seen.add(id);
    const kind = b.kind === "product" ? "product" : b.kind === "packaging" ? "packaging" : null;
    if (!kind) throw bad('Each stock item needs kind "product" or "packaging".');
    return {
      id,
      name: (str(b, "name", { max: 200, required: true }) as string).trim(),
      kind,
      unit: (str(b, "unit", { max: 30 }) ?? "units").trim() || "units",
      onHand: whole(b.onHand, "On hand", -100_000, 10_000_000),
      reorderAt: whole(b.reorderAt, "Reorder at", 0, 10_000_000),
      reorderQty: whole(b.reorderQty, "Reorder quantity", 0, 10_000_000),
      usedPerShipment: whole(b.usedPerShipment ?? 0, "Used per shipment", 0, 100),
    };
  });
}

/** Removes links to stock items that no longer exist. */
export function unlinkRemovedSupplies(s: DashboardState): void {
  const ids = new Set(s.supplies.map((x) => x.id));
  for (const sh of s.shipments) {
    if (sh.packagingSupplyId && !ids.has(sh.packagingSupplyId)) sh.packagingSupplyId = null;
    for (const it of sh.items) if (it.supplyId && !ids.has(it.supplyId)) it.supplyId = null;
  }
}

/** A Discord-safe one-liner: no street address, only the item summary. */
export function shipmentSummary(sh: Shipment): string {
  const items = sh.items.map((i) => `${i.qty} × ${i.name}`).join(", ");
  return `${sh.orderRef ? `Order ${sh.orderRef}` : "New order"}: ${items}${sh.packaging ? ` in ${sh.packaging}` : ""}${sh.service ? `, ${sh.service}` : ""}.`;
}

/** Logs a new order to pack. It is routed to the HQ Discord channel (you do the packing), without the customer's address. */
export function logQueued(s: DashboardState, sh: Shipment, actor: string, now: Date): void {
  log(s, actor, "info", `Queued to pack: ${shipmentSummary(sh)}`, now, { kind: "report", agentId: null, title: "New order to pack" });
}
