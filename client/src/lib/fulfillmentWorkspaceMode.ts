export interface FulfillmentWorkspaceShipment {
  id: string;
  status: string;
  scope: 'SINGLE_ORDER' | 'MULTI_ORDER';
  orderCount: number;
}

/** Current Order intent always selects the workspace mode. Historical shipment
 * rows are execution history, never a routing override. */
export function resolveFulfillmentWorkspaceMode(input: {
  fulfillmentType: 'SHIP' | 'PICKUP';
  shipments: FulfillmentWorkspaceShipment[];
}) {
  const drafts = input.shipments.filter((shipment) => shipment.status === 'DRAFT');
  if (input.fulfillmentType === 'PICKUP') {
    return { mode: 'pickup' as const, singleDraftShipmentId: null, historicalDrafts: drafts, combinedShipments: [] as FulfillmentWorkspaceShipment[] };
  }
  const singleDraft = drafts.find((shipment) => shipment.scope === 'SINGLE_ORDER' && shipment.orderCount === 1) ?? null;
  const combinedShipments = input.shipments.filter((shipment) => shipment.scope === 'MULTI_ORDER' || shipment.orderCount > 1);
  return { mode: 'ship' as const, singleDraftShipmentId: singleDraft?.id ?? null, historicalDrafts: drafts, combinedShipments };
}
