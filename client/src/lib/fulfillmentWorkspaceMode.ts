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
  const singleDraft = drafts.find((shipment) => shipment.scope === 'SINGLE_ORDER' && shipment.orderCount === 1) ?? null;
  const combinedShipments = uniqueShipments.filter((shipment) => shipment.status !== 'VOIDED' && (shipment.scope === 'MULTI_ORDER' || shipment.orderCount > 1));
  return { mode: 'ship' as const, singleDraftShipmentId: singleDraft?.id ?? null, historicalDrafts: drafts, combinedShipments };
}
