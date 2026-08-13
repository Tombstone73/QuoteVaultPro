import { describe, expect, test } from '@jest/globals';
import { resolveFulfillmentWorkspaceMode } from './fulfillmentWorkspaceMode';

describe('fulfillment workspace execution mode', () => {
  test('Pickup wins over a retained draft shipment', () => {
    const state = resolveFulfillmentWorkspaceMode({ fulfillmentType: 'PICKUP', shipments: [{ id: 'draft-ship', status: 'DRAFT', scope: 'SINGLE_ORDER', orderCount: 1 }] });
    expect(state).toMatchObject({ mode: 'pickup', singleDraftShipmentId: null, historicalDrafts: [{ id: 'draft-ship' }] });
  });

  test('Ship embeds only a single-order draft and leaves combined shipments to the full view', () => {
    const state = resolveFulfillmentWorkspaceMode({ fulfillmentType: 'SHIP', shipments: [
      { id: 'single', status: 'DRAFT', scope: 'SINGLE_ORDER', orderCount: 1 },
      { id: 'combined', status: 'DRAFT', scope: 'MULTI_ORDER', orderCount: 2 },
    ] });
    expect(state.singleDraftShipmentId).toBe('single');
    expect(state.combinedShipments.map((shipment) => shipment.id)).toEqual(['combined']);
  });

  test('a new Ship workspace has no child execution record until the operator starts one', () => {
    expect(resolveFulfillmentWorkspaceMode({ fulfillmentType: 'SHIP', shipments: [] })).toMatchObject({
      mode: 'ship', singleDraftShipmentId: null, combinedShipments: [],
    });
  });

  test('deduplicates duplicate shipment relationships and hides voided combined history', () => {
    const state = resolveFulfillmentWorkspaceMode({ fulfillmentType: 'SHIP', shipments: [
      { id: 'combined', status: 'DRAFT', scope: 'MULTI_ORDER', orderCount: 2 },
      { id: 'combined', status: 'DRAFT', scope: 'MULTI_ORDER', orderCount: 2 },
      { id: 'voided', status: 'VOIDED', scope: 'MULTI_ORDER', orderCount: 2 },
    ] });
    expect(state.combinedShipments.map((shipment) => shipment.id)).toEqual(['combined']);
  });
});
