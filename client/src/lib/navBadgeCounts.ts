/** Maps the existing operational summary response to sidebar item IDs.
 * An absent response is unknown, not an authoritative zero. */
export type OperationalSummaryBadgeData = {
  orders: number;
  inboundOrders: number;
  overview: number;
  design: number;
  proofing: number;
  prepress: number;
  flatbed: number;
  roll: number;
  fulfillment: number;
  invoices: { readyToFinalizeNeverSent?: number; pendingSend: number; unpaid: number };
};

export function buildBadgeCounts(
  summary: OperationalSummaryBadgeData | undefined,
  approvalCount?: number,
): Record<string, number> {
  const counts: Record<string, number> = {};
  const add = (key: string, value: number | undefined) => {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) counts[key] = value;
  };
  add("approvals", approvalCount);
  if (!summary) return counts;
  add("orders", summary.orders);
  add("inbound-orders", summary.inboundOrders);
  add("production-overview", summary.overview);
  add("production-design", summary.design);
  add("production-proofing", summary.proofing);
  add("production-prepress", summary.prepress);
  add("production-flatbed", summary.flatbed);
  add("production-roll", summary.roll);
  add("fulfillment", summary.fulfillment);
  add("invoices", summary.invoices?.readyToFinalizeNeverSent);
  return counts;
}
