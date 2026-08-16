/**
 * Fulfillment mock data (UI prototype only).
 * The ORDER is the commercial container; the LINE ITEM stays the operational unit.
 * Partial handoffs remain legal — grouping is for awareness, not restriction.
 */

export type FulfillMethod = "Pickup" | "Delivery" | "Shipment";

export interface FulfillLine {
  id: string;
  item: string;
  size?: string;
  media: string;
  qty: number;
  done: number;
  method: FulfillMethod;
  status: "Ready" | "In Production" | "Complete" | "Partially Picked Up" | "Staged";
  note?: string;
}

export interface FulfillOrder {
  order: string;
  customer: string;
  due: string;
  rush?: boolean;
  method: FulfillMethod;
  /** recorded handoff events for this order */
  visits: { date: string; by: string; what: string }[];
  lines: FulfillLine[];
}

export const fulfillOrders: FulfillOrder[] = [
  {
    order: "10671",
    customer: "Delta Faucet Company",
    due: "Aug 18, 2026",
    rush: true,
    method: "Pickup",
    visits: [
      { date: "Aug 15", by: "R. Ortiz (customer)", what: "Picked up 40 of 75 Coroplast signs" },
      { date: "Aug 16", by: "R. Ortiz (customer)", what: "Picked up 6 lobby banners" },
    ],
    lines: [
      { id: "f1", item: "4mm Coroplast Sign", size: '24" × 36"', media: "4mm Coroplast", qty: 75, done: 40, method: "Pickup", status: "Partially Picked Up" },
      { id: "f2", item: "13oz Banner — Lobby", size: '36" × 120"', media: "13oz Scrim", qty: 6, done: 6, method: "Pickup", status: "Complete" },
      { id: "f3", item: "Adhesive Vinyl Decal Set", size: '12" × 12"', media: "Adhesive Vinyl", qty: 40, done: 40, method: "Pickup", status: "Complete" },
      { id: "f4", item: "Contour Cut Stickers — Logo 3in", media: "Adhesive Vinyl", qty: 500, done: 0, method: "Pickup", status: "In Production", note: "Waiting on proof approval" },
    ],
  },
  {
    order: "10668",
    customer: "Purdue Athletics",
    due: "Aug 19, 2026",
    method: "Delivery",
    visits: [],
    lines: [
      { id: "f5", item: "13oz Banner — Gate C", size: '36" × 120"', media: "13oz Scrim", qty: 4, done: 0, method: "Delivery", status: "Ready" },
      { id: "f6", item: "Mesh Fence Banner — Gate D", size: '48" × 144"', media: "Mesh", qty: 2, done: 0, method: "Delivery", status: "Ready" },
      { id: "f7", item: "Field Marker Signs", size: '18" × 24"', media: "4mm Coroplast", qty: 24, done: 0, method: "Delivery", status: "Staged" },
    ],
  },
  {
    order: "10664",
    customer: "Midwest Concrete",
    due: "Aug 20, 2026",
    method: "Pickup",
    visits: [{ date: "Aug 14", by: "J. Wells (customer)", what: "Picked up 12 truck decals" }],
    lines: [
      { id: "f8", item: "A-Frame Insert", size: '24" × 36"', media: "3mm ACM", qty: 20, done: 0, method: "Pickup", status: "Ready" },
      { id: "f9", item: "Job Site Sign", size: '48" × 96"', media: "3mm ACM", qty: 3, done: 1, method: "Pickup", status: "Partially Picked Up" },
      { id: "f10", item: "Truck Door Decals", size: '18" × 18"', media: "Adhesive Vinyl", qty: 12, done: 12, method: "Pickup", status: "Complete" },
    ],
  },
  {
    order: "10659",
    customer: "Lafayette Schools",
    due: "Aug 21, 2026",
    method: "Pickup",
    visits: [],
    lines: [
      { id: "f11", item: "Coroplast Yard Sign", size: '18" × 24"', media: "4mm Coroplast", qty: 250, done: 0, method: "Pickup", status: "In Production" },
      { id: "f12", item: "Hallway Banner", size: '30" × 96"', media: "13oz Scrim", qty: 5, done: 0, method: "Pickup", status: "In Production" },
    ],
  },
  {
    order: "10655",
    customer: "Riverside Dental",
    due: "Aug 22, 2026",
    method: "Shipment",
    visits: [{ date: "Aug 15", by: "UPS Ground 1Z…4471", what: "Shipped 1 of 2 window perf panels" }],
    lines: [
      { id: "f13", item: "Window Perf — Storefront", size: '48" × 96"', media: "Perf Vinyl", qty: 2, done: 1, method: "Shipment", status: "Partially Picked Up" },
      { id: "f14", item: "Reception Decal", size: '24" × 24"', media: "Frosted Vinyl", qty: 1, done: 0, method: "Shipment", status: "Ready" },
    ],
  },
];

export interface FulfillSummary {
  total: number;
  complete: number;
  remaining: number;
  partial: boolean;
  label: string;
  tone: "ok" | "warn" | "info" | "neutral";
}

/** Aggregate presentation only — line statuses stay the source of truth. */
export function summarize(o: FulfillOrder): FulfillSummary {
  const total = o.lines.length;
  const complete = o.lines.filter((l) => l.done >= l.qty).length;
  const remaining = total - complete;
  const partial = o.lines.some((l) => l.done > 0 && l.done < l.qty) || (complete > 0 && remaining > 0);
  if (remaining === 0) return { total, complete, remaining, partial, label: "All items handed off", tone: "ok" };
  if (partial) return { total, complete, remaining, partial, label: "Partial pickup", tone: "warn" };
  return { total, complete, remaining, partial, label: "Nothing handed off", tone: "info" };
}
