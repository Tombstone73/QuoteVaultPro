import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { BulkFulfillmentDialog } from './BulkFulfillmentDialog';
const mockPreview = jest.fn(), mockExecute = jest.fn(), mockProcessed = jest.fn();
jest.mock('@/hooks/useBulkFulfillment', () => ({ useBulkFulfillmentPreview: () => ({ mutateAsync: mockPreview, isPending: false }), useBulkFulfillmentExecute: () => ({ mutateAsync: mockExecute, isPending: false }) }));
jest.mock('@/hooks/useFulfillment', () => ({ toFulfillmentError: (error: any) => ({ message: error.message, code: error.code }) }));
let root: Root, host: HTMLDivElement;
const plan = () => ({ action: 'picked_up', previewToken: 'a'.repeat(64), selectedOrderCount: 2, eligibleCount: 1, skippedCount: 1, units: [
  { key: 'one', orderIds: ['one'], orderNumber: '100', eligible: true, requirements: [], items: [{ orderId: 'one', orderLineItemId: 'line', label: 'Signs', quantity: 2, eligible: true, requirements: [] }] },
  { key: 'two', orderIds: ['two'], orderNumber: '101', eligible: false, requirements: ['Production incomplete'], items: [] },
] });
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => '00000000-0000-4000-8000-000000000001' }); jest.clearAllMocks();
  mockPreview.mockResolvedValue(plan()); mockExecute.mockResolvedValue({ requestId: 'request', results: [{ key: 'one', orderIds: ['one'], items: [], status: 'succeeded', message: 'Picked up' }] });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = async (action = 'picked_up') => { await act(async () => { root.render(<BulkFulfillmentDialog action={action as any} selection={[{ orderId: 'one' }, { orderId: 'two' }]} onClose={() => {}} onProcessed={mockProcessed} />); }); };
const button = (text: string) => [...document.querySelectorAll('button')].find(node => node.textContent === text)!;
const confirm = () => act(() => Simulate.change([...document.querySelectorAll('input[type="checkbox"]')].at(-1)!, { target: { checked: true } } as any));
test('confirmation presents eligibility/skips and requires explicit review before execution', async () => {
  await render(); expect(document.body.textContent).toContain('1 eligible items · 1 skipped items'); expect(document.body.textContent).toContain('Production incomplete');
  expect((button('Confirm Mark Picked Up') as HTMLButtonElement).disabled).toBe(true); confirm();
  await act(async () => { Simulate.click(button('Confirm Mark Picked Up')); });
  expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({ action: 'picked_up', confirmed: true, previewToken: 'a'.repeat(64), requestId: '00000000-0000-4000-8000-000000000001' }));
  expect(mockProcessed).toHaveBeenCalledTimes(1);
});
test('interrupted execution retains exact request identity and disables a fresh preview until safely recovered', async () => {
  mockExecute.mockRejectedValueOnce(new Error('Synthetic connection interrupted'));
  await render(); confirm(); await act(async () => { Simulate.click(button('Confirm Mark Picked Up')); });
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('interrupted');
  expect((button('Refresh preview') as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { Simulate.click(button('Retry same operation')); });
  expect(mockExecute.mock.calls[0][0]).toEqual(mockExecute.mock.calls[1][0]);
});
test('legacy reconciliation requires a reason and a separate administrative authorization checkbox', async () => {
  mockPreview.mockResolvedValue({ ...plan(), action: 'legacy' }); await render('legacy'); confirm();
  expect((button('Confirm Reconcile Historical Fulfillment') as HTMLButtonElement).disabled).toBe(true);
  act(() => Simulate.change(document.querySelector('textarea')!, { target: { value: 'Historically collected and verified by the shop.' } } as any));
  act(() => Simulate.change(document.querySelector('input[type="checkbox"]')!, { target: { checked: true } } as any));
  await act(async () => { Simulate.click(button('Confirm Reconcile Historical Fulfillment')); });
  expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({ legacyConfirmed: true, reason: 'Historically collected and verified by the shop.' }));
});
test('missing shipment information offers the existing workspace and prevents execution', async () => {
  const data = plan(); data.eligibleCount = 0; data.units[0].eligible = false; data.units[0].requirements = ['Enter real tracking information'];
  mockPreview.mockResolvedValue(data); await render('shipped'); confirm();
  expect(document.querySelector('a')?.getAttribute('href')).toBe('/fulfillment/orders/one');
  expect((button('Confirm Mark Shipped') as HTMLButtonElement).disabled).toBe(true); expect(mockExecute).not.toHaveBeenCalled();
});
