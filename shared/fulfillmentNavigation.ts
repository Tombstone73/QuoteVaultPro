/**
 * Canonical internal UI locations for the Order-owned fulfillment workspace
 * and its shipment detail. Keep these builders dependency-free so server-side
 * investigation resources and client navigation cannot drift apart.
 */
export const fulfillmentWorkspaceRoute = "/fulfillment/orders/:orderId";
export const fulfillmentShipmentDetailRoute = "/fulfillment/shipments/:shipmentId";

export function fulfillmentWorkspaceHref(orderId: string): string {
  return `/fulfillment/orders/${encodeURIComponent(orderId)}`;
}

export function fulfillmentShipmentDetailHref(shipmentId: string): string {
  return `/fulfillment/shipments/${encodeURIComponent(shipmentId)}`;
}
