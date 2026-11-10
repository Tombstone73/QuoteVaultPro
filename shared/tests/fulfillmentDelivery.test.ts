import { expect, test } from '@jest/globals';
import { projectDeliveryQuantities, FULFILLMENT_DELIVERY_CONFIRMED } from '../fulfillmentDelivery';
const allocation = (shipmentId: string, quantity: number) => ({ shipmentId, orderId: 'order', orderLineItemId: 'line', quantity, deliveredAt: null });
test('delivery attestations are quantity-level and never exceed shipped quantities', () => {
  const events = [{ eventType: FULFILLMENT_DELIVERY_CONFIRMED, payloadJson: { items: [{ shipmentId: 'first', orderLineItemId: 'line', quantity: 3 }] } }];
  expect(projectDeliveryQuantities([allocation('first', 10)], events)[0]).toMatchObject({ shippedQuantity: 10, deliveredQuantity: 3, pendingDeliveryQuantity: 7 });
  expect(projectDeliveryQuantities([allocation('first', 2)], events)[0].deliveredQuantity).toBe(2);
});
test('a reversal and a new shipment do not inherit earlier delivered quantities', () => {
  const events = [{ eventType: FULFILLMENT_DELIVERY_CONFIRMED, payloadJson: { items: [{ shipmentId: 'old', orderLineItemId: 'line', quantity: 10 }] } },
    { eventType: 'SHIPMENT_REVERSED', payloadJson: { sourceId: 'old', items: [{ orderLineItemId: 'line', quantity: 4 }] } }];
  const rows = projectDeliveryQuantities([allocation('old', 10), allocation('replacement', 4)], events);
  expect(rows[0]).toMatchObject({ shippedQuantity: 6, deliveredQuantity: 6 });
  expect(rows[1]).toMatchObject({ shippedQuantity: 4, deliveredQuantity: 0, pendingDeliveryQuantity: 4 });
});
test('existing explicit delivery timestamps count only their own current net shipment', () => {
  const rows = projectDeliveryQuantities([{ ...allocation('first', 5), deliveredAt: new Date() }, allocation('second', 3)], []);
  expect(rows.map(row => row.pendingDeliveryQuantity)).toEqual([0, 3]);
});
