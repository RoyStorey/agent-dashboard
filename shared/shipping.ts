import type { DashboardState, Shipment, SupplyItem } from "./types.ts";

/** A sensible starting list of what to keep at home when shipping orders yourself. */
export function defaultSupplies(productName: string, monthlyUnits: number, newId: () => string): SupplyItem[] {
  const perMonth = Math.max(10, monthlyUnits);
  return [
    {
      id: newId(),
      name: productName.trim() || "Your product",
      kind: "product",
      unit: "units",
      onHand: 0,
      reorderAt: Math.ceil((perMonth * 44) / 30), // ~30-day supplier lead time + 2 weeks safety
      reorderQty: perMonth * 2,
      usedPerShipment: 0,
    },
    { id: newId(), name: "Mailers or boxes (sized to fit the product)", kind: "packaging", unit: "mailers", onHand: 0, reorderAt: Math.ceil(perMonth / 2), reorderQty: Math.max(50, perMonth * 2), usedPerShipment: 0 },
    { id: newId(), name: "Shipping labels (4×6 in)", kind: "packaging", unit: "labels", onHand: 0, reorderAt: Math.ceil(perMonth / 2), reorderQty: Math.max(100, perMonth * 2), usedPerShipment: 1 },
    { id: newId(), name: "Packing tape", kind: "packaging", unit: "rolls", onHand: 0, reorderAt: 1, reorderQty: 6, usedPerShipment: 0 },
  ];
}

/** Supplies at or below their reorder point. */
export function lowSupplies(supplies: SupplyItem[]): SupplyItem[] {
  return supplies.filter((s) => s.onHand <= s.reorderAt);
}

/**
 * How shipping (sign = -1) or un-shipping (sign = +1) a shipment changes
 * stock at home: its items, its packaging, and anything used for every package.
 */
export function stockChanges(sh: Shipment, supplies: SupplyItem[], sign: 1 | -1): Map<string, number> {
  const out = new Map<string, number>();
  const add = (id: string, n: number) => out.set(id, (out.get(id) ?? 0) + n);
  for (const it of sh.items) if (it.supplyId) add(it.supplyId, sign * it.qty);
  if (sh.packagingSupplyId) add(sh.packagingSupplyId, sign);
  for (const s of supplies) if (s.usedPerShipment > 0) add(s.id, sign * s.usedPerShipment);
  return out;
}

export function applyStockChanges(state: DashboardState, changes: Map<string, number>): void {
  for (const [id, n] of changes) {
    const s = state.supplies.find((x) => x.id === id);
    if (s) s.onHand += n;
  }
}

export interface PickLine {
  name: string;
  qty: number;
}

/** Everything to pull for the orders waiting to be packed, combined by item. */
export function pickList(shipments: Shipment[]): { items: PickLine[]; packaging: PickLine[]; orders: number } {
  const items = new Map<string, number>();
  const packaging = new Map<string, number>();
  let orders = 0;
  for (const sh of shipments) {
    if (sh.status !== "to_pack") continue;
    orders++;
    for (const it of sh.items) items.set(it.name, (items.get(it.name) ?? 0) + it.qty);
    if (sh.packaging.trim()) packaging.set(sh.packaging.trim(), (packaging.get(sh.packaging.trim()) ?? 0) + 1);
  }
  const lines = (m: Map<string, number>) => [...m.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty);
  return { items: lines(items), packaging: lines(packaging), orders };
}

export const FULFILLMENT_LABEL = {
  self: "Ship it myself",
  provider: "Fulfillment company (e.g. ShipBob)",
  marketplace: "Marketplace fulfillment (Amazon FBA)",
} as const;
