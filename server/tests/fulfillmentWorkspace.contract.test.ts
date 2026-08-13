import { fulfillmentOrderIdSchema } from '../services/fulfillment/schemas';
import { buildFulfillmentWorkspaceQueueRow } from '../services/fulfillment/workspace';

const baseOrder = {
  id: '1f8a7648-89d0-406f-808c-06324b09a819',
  orderNumber: 'SO-1001',
  shippingMethod: 'ship',
  state: 'production_complete',
  status: 'ready_for_shipment',
  canceledAt: null,
  routingTarget: 'fulfillment',
  fulfillmentStatus: 'pending',
  productionCompletedAt: new Date('2026-08-13T12:00:00.000Z'),
  updatedAt: new Date('2026-08-13T12:00:00.000Z'),
  shipToCity: 'Indianapolis',
  shipToState: 'IN',
  customerName: 'Example Customer',
};

describe('fulfillment order workspace contract', () => {
  it('uses a UUID Order ID and rejects invalid route identities before querying', () => {
    expect(fulfillmentOrderIdSchema.parse(baseOrder.id)).toBe(baseOrder.id);
    expect(() => fulfillmentOrderIdSchema.parse('not-an-order-id')).toThrow('Invalid order ID');
  });

  it('constructs an eligible Order workspace without shipment, package, pickup, or checklist child state', () => {
    const workspace = buildFulfillmentWorkspaceQueueRow({
      order: baseOrder,
      orderedQty: 7,
      shippedQty: 0,
      pickupTicket: null,
      shipmentId: null,
      deriveShipStatus: () => 'DRAFT',
    });

    expect(workspace).toMatchObject({
      orderId: baseOrder.id,
      fulfillmentType: 'SHIP',
      status: 'DRAFT',
      shipmentId: null,
      itemsRemaining: '7 item(s)',
    });
  });

  it('keeps a real non-production-complete Order addressable while signaling that shipping remains blocked', () => {
    const workspace = buildFulfillmentWorkspaceQueueRow({
      order: { ...baseOrder, state: 'open', status: 'new', productionCompletedAt: null },
      orderedQty: 7,
      shippedQty: 0,
      pickupTicket: null,
      shipmentId: null,
      deriveShipStatus: () => 'DRAFT',
    });

    expect(workspace).toMatchObject({
      orderId: baseOrder.id,
      status: 'AWAITING_PRODUCTION',
      shipmentId: null,
    });
  });

  it('retains existing combined-shipment identity rather than replacing it with a per-order record', () => {
    const workspace = buildFulfillmentWorkspaceQueueRow({
      order: baseOrder,
      orderedQty: 7,
      shippedQty: 3,
      pickupTicket: null,
      shipmentId: 'a5a08eb8-9991-4c7e-9323-52353b157156',
      deriveShipStatus: () => 'PARTIAL',
    });

    expect(workspace).toMatchObject({
      shipmentId: 'a5a08eb8-9991-4c7e-9323-52353b157156',
      status: 'PARTIAL',
      itemsRemaining: '4 item(s)',
    });
  });
});
