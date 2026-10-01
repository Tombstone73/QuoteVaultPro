export interface FulfillmentWorkspaceShipment {
  id: string;
  status: string;
  scope: 'SINGLE_ORDER' | 'MULTI_ORDER';
  orderCount: number;
  shipmentReference?: string | null;
}

/** Current Order intent always selects the workspace mode. Historical shipment
 * rows are execution history, never a routing override. */
export function resolveFulfillmentWorkspaceMode(input: {
  fulfillmentType: 'SHIP' | 'PICKUP';
  shipments: FulfillmentWorkspaceShipment[];
}) {
  const uniqueShipments = Array.from(new Map(input.shipments.map((shipment) => [shipment.id, shipment])).values());
  const drafts = uniqueShipments.filter((shipment) => shipment.status === 'DRAFT');
  if (input.fulfillmentType === 'PICKUP') {
    return { mode: 'pickup' as const, singleDraftShipmentId: null, historicalDrafts: drafts, combinedShipments: [] as FulfillmentWorkspaceShipment[] };
  }
  const singleDrafts = drafts.filter((shipment) => shipment.scope === 'SINGLE_ORDER' && shipment.orderCount === 1);
  const combinedShipments = uniqueShipments.filter((shipment) => shipment.status !== 'VOIDED' && (shipment.scope === 'MULTI_ORDER' || shipment.orderCount > 1));
  return { mode: 'ship' as const, singleDraftShipmentId: singleDrafts.length === 1 ? singleDrafts[0].id : null, historicalDrafts: drafts, combinedShipments };
}
import type { ReferrerRoute } from "@/lib/nav/smartBack";

/** Accept only known workflow parents, never an arbitrary location from state. */
export function fulfillmentReturnRoute(value: unknown, allowedPathnames: string[]): ReferrerRoute | null {
  if (!value || typeof value !== "object") return null;
  const route = value as ReferrerRoute;
  if (!allowedPathnames.includes(route.pathname)) return null;
  if (route.search && (typeof route.search !== "string" || !route.search.startsWith("?"))) return null;
  if (route.hash && (typeof route.hash !== "string" || !route.hash.startsWith("#"))) return null;
  if (`${route.pathname}${route.search || ""}${route.hash || ""}`.includes("\\")) return null;
  return { pathname: route.pathname, search: route.search || "", hash: route.hash || "" };
}
