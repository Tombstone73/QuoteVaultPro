import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { TextEncoder, TextDecoder } from 'node:util';
Object.assign(globalThis, { TextEncoder, TextDecoder, IS_REACT_ACT_ENVIRONMENT: true });
const mockNavigate = jest.fn(), mockCreateShipment = jest.fn(), mockToast = jest.fn();
let mockFilters: any, mockDialog: any, mockType = 'PICKUP', mockHistory = false;
const row = (id: string) => ({ orderId: id, orderNumber: id, customerName: 'Synthetic customer', fulfillmentType: mockType, status: mockHistory ? 'PICKED_UP' : 'READY', remainingQuantity: mockHistory ? 0 : 10,
  readyWaitingQuantity: 10, notReadyQuantity: 0, shippedQuantity: mockType === 'SHIP' ? 4 : 0, pickedUpQuantity: mockHistory ? 10 : 0, readySince: null, shipTo: 'Carmel', isHistorical: mockHistory, isArchived: mockHistory });
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate, useLocation: () => ({ pathname: '/fulfillment', search: '' }) }));
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock('@/hooks/useShipments', () => ({}));
jest.mock('@/lib/getThumbSrc', () => ({}));
jest.mock('@/lib/fulfillmentArtwork', () => ({}));
jest.mock('@/components/PackingSlipModal', () => ({}));
jest.mock('@/components/production/PrintTicketButton', () => ({}));
jest.mock('@/components/fulfillment/FulfillmentDebugPanel', () => ({ FulfillmentDebugPanel: () => null }));
jest.mock('@/components/fulfillment/BulkFulfillmentDialog', () => ({ BulkFulfillmentDialog: (props: any) => { mockDialog = props; return <div role="dialog">Reviewed bulk selection</div>; } }));
jest.mock('@/components/ui/dropdown-menu', () => ({ DropdownMenu: ({ children }: any) => <div>{children}</div>, DropdownMenuTrigger: ({ children }: any) => children,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>, DropdownMenuItem: ({ children, onSelect, disabled }: any) => <button disabled={disabled} onClick={onSelect}>{children}</button> }));
jest.mock('@/hooks/useBulkFulfillment', () => ({ useBulkFulfillmentPermissions: () => ({ data: { canOperate: true, canReconcileLegacy: true } }),
  useBulkFulfillmentContext: (orderId: string) => ({ data: { orderId, orderNumber: orderId, fulfillmentType: mockType, lines: ['First line', 'Second line'].map((label, index) => ({
    orderLineItemId: `${orderId}-${index}`, label, orderedQuantity: 10, remainingQuantity: 10, readyQuantity: 10, productionCompleteQuantity: 10, shippedQuantity: 4, pickedUpQuantity: 0, deliveredQuantity: 0,
    deliverySources: mockType === 'SHIP' ? [{ shipmentId: 'source-a', label: 'Shipment A', pendingQuantity: 2 }, { shipmentId: 'source-b', label: 'Shipment B', pendingQuantity: 2 }] : [] })) } }) }));
jest.mock('@/hooks/useFulfillment', () => ({ useCreateShipmentMutation: () => ({ isPending: false, mutateAsync: mockCreateShipment }), useCreatePickupTicketMutation: () => ({ isPending: false }),
  apiCall: jest.fn(async () => ({ total: 100, rows: [row('one'), row('two')] })),
  toFulfillmentError: (error: any) => ({ message: error.message }),
  useFulfillmentQueueQuery: (filters: any) => { mockFilters = filters; return { isLoading: false, data: { total: 100, rows: [row(filters.search ? 'filtered' : filters.page === 2 ? 'two' : 'one')] } }; } }));
const Page = require('./fulfillment').default;
let root: Root, host: HTMLDivElement;
beforeEach(() => { jest.clearAllMocks(); mockType = 'PICKUP'; mockHistory = false; mockDialog = null; host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root.render(<Page />)); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const button = (text: string) => [...host.querySelectorAll('button')].find(node => node.textContent === text)!;
const checkbox = (label: string) => host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
const change = (input: HTMLInputElement, checked: boolean) => act(() => Simulate.change(input, { target: { checked } } as any));
test('page select-all retains other-page selection and filtered actions retain exact selected IDs', () => {
  change(checkbox('Select all 1 orders on this page'), true);
  act(() => Simulate.click(button('Next')));
  expect(mockFilters.page).toBe(2);
  change(checkbox('Select order two'), true);
  expect(host.textContent).toContain('2 whole orders');
  act(() => Simulate.click(button('Previous')));
  change(checkbox('Select all 1 orders on this page'), false);
  expect(host.textContent).toContain('1 whole orders');
  const search = host.querySelector('input[type="text"]')!;
  act(() => Simulate.change(search, { target: { value: 'filtered customer' } } as any));
  act(() => Simulate.click(button('Mark Picked Up')));
  expect(mockDialog.selection).toEqual([{ orderId: 'two' }]);
  expect(mockFilters.search).toBe('filtered customer');
});
test('expanded line selection and a partial quantity reach the review dialog without selecting sibling lines', () => {
  act(() => Simulate.click(host.querySelector('[aria-label="Expand lines for order one"]')!));
  change(checkbox('Select line First line'), true);
  const quantity = host.querySelector('input[aria-label="Quantity for First line"]')!;
  act(() => Simulate.change(quantity, { target: { value: '2' } } as any));
  expect(host.textContent).toContain('1 individual lines selected');
  expect((button('Mark Shipped') as HTMLButtonElement).disabled).toBe(true);
  act(() => Simulate.click(button('Mark Picked Up')));
  expect(mockDialog.selection).toEqual([{ orderId: 'one', items: [{ orderLineItemId: 'one-0', quantity: 2 }] }]);
});
test('successful lines clear while failed or skipped siblings stay selected', () => {
  change(checkbox('Select order one'), true); act(() => Simulate.click(button('Mark Picked Up')));
  const items = ['one-0', 'one-1'].map(orderLineItemId => ({ orderId: 'one', orderLineItemId, eligible: orderLineItemId === 'one-0', quantity: 1, requirements: [], label: orderLineItemId }));
  act(() => mockDialog.onProcessed({ units: [{ key: 'order:one', eligible: true, items }] }, { results: [{ key: 'order:one', status: 'succeeded', items: [{ orderId: 'one', orderLineItemId: 'one-0' }] }] }));
  expect(host.textContent).toContain('0 whole orders · 1 individual lines selected');
});
test('completed history can be selected by authorized operators without changing correction navigation', () => {
  mockHistory = true; act(() => root.render(<Page />));
  change(checkbox('Select order one'), true);
  expect(checkbox('Select order one').disabled).toBe(false);
  act(() => Simulate.click(button('Archive Completed')));
  expect(mockDialog.selection).toEqual([{ orderId: 'one' }]);
});
test('Create Combined Shipment retains its existing canonical mutation and all selected order IDs across pages', async () => {
  mockType = 'SHIP'; act(() => root.render(<Page />));
  change(checkbox('Select order one'), true); act(() => Simulate.click(button('Next'))); change(checkbox('Select order two'), true);
  mockCreateShipment.mockResolvedValue({ shipmentId: 'combined' });
  await act(async () => { Simulate.click(button('Create Combined Shipment')); });
  expect(mockCreateShipment).toHaveBeenCalledWith({ scope: 'MULTI_ORDER', orderIds: ['one', 'two'] });
  expect(mockNavigate).toHaveBeenCalledWith('/fulfillment/shipments/combined', expect.anything());
});

test('partial delivery selection preserves the actual source shipment through review', () => {
  mockType = 'SHIP'; act(() => root.render(<Page />));
  act(() => Simulate.click(host.querySelector('button[aria-label="Expand lines for order one"]')!));
  change(checkbox('Select line First line'), true);
  const quantity = host.querySelector('input[aria-label="Quantity for First line"]')!;
  act(() => Simulate.change(quantity, { target: { value: '2' } } as any));
  const source = host.querySelector('select[aria-label="Delivery shipment for First line"]')!;
  act(() => Simulate.change(source, { target: { value: 'source-b' } } as any));
  act(() => Simulate.click(button('Mark Delivered')));
  expect(mockDialog.selection).toEqual([{ orderId: 'one', items: [{ orderLineItemId: 'one-0', quantity: 2, shipmentId: 'source-b' }] }]);
});
