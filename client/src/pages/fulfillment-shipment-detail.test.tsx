import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const shipment: any = { id: 'shipment-1', status: 'DRAFT', shipmentReference: 'SH-20306-01', packingMode: 'simple_verified_packing', updatedAt: '2026-10-01T12:00:00Z', orders: [{ orderId: 'order-1', orderNumber: '20306', customerName: 'DG Graphics' }], packages: [{ id: 'package-1', packageReference: 'SH-20306-01-P1', ordinal: 1 }], items: [{ id: 'allocation-1', orderId: 'order-1', orderLineItemId: 'line-1', quantity: 2, packageId: 'package-1' }], events: [] };
const save = jest.fn(async (_payload: any) => shipment);
const mark = jest.fn(async () => ({ status: 'SHIPPED' }));
jest.mock('react-router-dom', () => ({ useLocation: () => ({ search: '' }), useNavigate: () => jest.fn(), useParams: () => ({ shipmentId: 'shipment-1' }) }));
jest.mock('@/hooks/useSmartBack', () => ({ useSmartBack: () => ({ onSmartBack: jest.fn() }) }));
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('@/components/fulfillment/FulfillmentDebugPanel', () => ({ FulfillmentDebugPanel: () => null }));
jest.mock('@/hooks/useFulfillment', () => ({
  useShipmentDetailQuery: () => ({ data: shipment, refetch: jest.fn() }),
  useUpdateShipmentMutation: () => ({ mutateAsync: save, isPending: false }),
  useMarkShippedMutation: () => ({ mutateAsync: mark, isPending: false }),
  useVoidShipmentMutation: () => ({ isPending: false }),
  useReverseTerminalFulfillmentMutation: () => ({ isPending: false }),
  useCreateShipmentPackageMutation: () => ({ isPending: false }),
  getOrderDetails: async () => ({ id: 'order-1', orderNumber: '20306' }),
  getFulfillmentOrderDetail: async () => ({ lineItems: [{ id: 'line-1', productName: 'Magnetic', production: { orderedQuantity: 2, remainingQuantity: 2 } }] }),
  toFulfillmentError: (error: any) => ({ message: error.message }),
}));
const { FulfillmentShipmentEditor } = require('./fulfillment-shipment-detail');
function button(container: HTMLElement, text: string) { return Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === text)!; }

test('simple packing exposes quantity and saves the reduced package allocation before marking shipped', async () => {
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
  await act(async () => { root.render(<FulfillmentShipmentEditor />); });
  const quantity = container.querySelector('input[aria-label="Qty in this shipment: Magnetic"]') as HTMLInputElement;
  expect(quantity).toBeTruthy(); expect(quantity.closest('div.hidden')).toBeNull();
  expect(quantity.min).toBe('0'); expect(quantity.max).toBe('2'); expect(quantity.value).toBe('2');
  act(() => Simulate.change(quantity, { target: { value: '1' } } as any));
  await act(async () => { Simulate.click(button(container, 'MARK AS SHIPPED')); });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ carrier: null, trackingNumber: null, shipDate: null, shipmentItems: [{ orderId: 'order-1', orderLineItemId: 'line-1', packageId: 'package-1', quantity: 1 }] }));
  expect(mark).toHaveBeenCalledTimes(1);
  expect(save.mock.invocationCallOrder[0]).toBeLessThan(mark.mock.invocationCallOrder[0]);
  act(() => Simulate.change(quantity, { target: { value: '3' } } as any));
  expect(button(container, 'MARK AS SHIPPED').disabled).toBe(true);
  act(() => Simulate.change(quantity, { target: { value: '0' } } as any));
  expect(button(container, 'MARK AS SHIPPED').disabled).toBe(true);
  await act(async () => { Simulate.click(button(container, 'SAVE DRAFT')); });
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ shipmentItems: [] }));
  act(() => root.unmount()); container.remove();
});

test('existing split package quantities remain separate and zero removes only that package allocation', async () => {
  const originalItems = shipment.items;
  const originalPackages = shipment.packages;
  shipment.items = [
    { ...originalItems[0], quantity: 1 },
    { ...originalItems[0], id: 'allocation-2', quantity: 1, packageId: 'package-2' },
  ];
  shipment.packages = [...originalPackages, { id: 'package-2', packageReference: 'SH-20306-01-P2', ordinal: 2 }];
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
  try {
    await act(async () => { root.render(<FulfillmentShipmentEditor />); });
    const first = container.querySelector('input[aria-label="Qty in package package-1: Magnetic"]') as HTMLInputElement;
    const second = container.querySelector('input[aria-label="Qty in package package-2: Magnetic"]') as HTMLInputElement;
    expect(first.value).toBe('1'); expect(second.value).toBe('1');
    await act(async () => { Simulate.click(button(container, 'SAVE DRAFT')); });
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ shipmentItems: [
      { orderId: 'order-1', orderLineItemId: 'line-1', packageId: 'package-1', quantity: 1 },
      { orderId: 'order-1', orderLineItemId: 'line-1', packageId: 'package-2', quantity: 1 },
    ] }));
    act(() => Simulate.change(first, { target: { value: '0.5' } } as any));
    act(() => Simulate.change(second, { target: { value: '0.5' } } as any));
    expect(button(container, 'MARK AS SHIPPED').disabled).toBe(true);
    act(() => Simulate.change(first, { target: { value: '0' } } as any));
    act(() => Simulate.change(second, { target: { value: '1' } } as any));
    await act(async () => { Simulate.click(button(container, 'SAVE DRAFT')); });
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ shipmentItems: [
      { orderId: 'order-1', orderLineItemId: 'line-1', packageId: 'package-2', quantity: 1 },
    ] }));
  } finally {
    act(() => root.unmount()); container.remove();
    shipment.items = originalItems; shipment.packages = originalPackages;
  }
});
