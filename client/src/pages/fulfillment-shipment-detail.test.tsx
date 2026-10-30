import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => 'shipment-reversal-request' } });
const destination = { name: 'Receiving Contact', company: 'Destination Company', address1: '123 Saved Street', address2: 'Dock B', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US', phone: '512-555-0100', email: 'receiving@example.test' };
const sourceSender = { ...destination, name: 'Saved Organization Sender', address1: '456 Sender Street' };
let documentSource: any = { data: { sender: sourceSender }, isLoading: false };
const shipment: any = { id: 'shipment-1', status: 'DRAFT', shipmentReference: 'SH-20306-01', packingMode: 'simple_verified_packing', updatedAt: '2026-10-01T12:00:00Z', orders: [{ orderId: 'order-1', orderNumber: '20306', customerName: 'DG Graphics' }], shippingContext: { version: 1, source: 'order', sourceOrderId: 'order-1', destination, blindShipping: false, blindSender: null }, packages: [{ id: 'package-1', packageReference: 'SH-20306-01-P1', ordinal: 1, upsPackagingType: '02' }], items: [{ id: 'allocation-1', orderId: 'order-1', orderLineItemId: 'line-1', quantity: 2, packageId: 'package-1' }], lineAvailability: [{ orderLineItemId: 'line-1', orderedQuantity: 2, readyQuantity: 2, shippedQuantity: 0, remainingQuantity: 2, reservedHere: 2, reservedElsewhere: 0 }], events: [] };
const initialShipment = JSON.parse(JSON.stringify(shipment));
let fulfillment: any = { lineItems: [{ id: 'line-1', productName: 'Magnetic', size: '24 x 18 in', materialName: 'Magnet', optionSummary: ['Rounded corners'], production: { orderedQuantity: 2, remainingQuantity: 2 }, artwork: [] }] };
let fulfillmentByOrder: Record<string, any> = {};
let location: any = { pathname: '/fulfillment/shipments/shipment-1', search: '', hash: '', state: null };
let immutableQuery = false;
let shipmentFixtures: Record<string, any> = {};
const navigate = jest.fn();
const voidDraft = jest.fn(async () => shipment);
const addPackage = jest.fn(async () => ({ packageReference: 'P2' }));
const reverse = jest.fn(async () => ({ success: true }));
const persistDraft = async (payload: any) => {
  Object.assign(shipment, {
    carrier: payload.carrier, serviceLevel: payload.serviceLevel, trackingNumber: payload.trackingNumber,
    shipDate: payload.shipDate, internalNotes: payload.internalNotes,
    shippingContext: payload.shippingContext ?? shipment.shippingContext,
  });
  shipment.packages = shipment.packages.map((pkg: any) => {
    const patch = payload.packages?.find((entry: any) => entry.id === pkg.id);
    return patch ? { ...pkg, upsPackagingType: patch.upsPackagingType, weightLbs: patch.weightLbs == null ? null : String(patch.weightLbs),
      dimLengthIn: patch.dims.length == null ? null : String(patch.dims.length),
      dimWidthIn: patch.dims.width == null ? null : String(patch.dims.width),
      dimHeightIn: patch.dims.height == null ? null : String(patch.dims.height), notes: patch.notes } : pkg;
  });
  if (payload.shipmentItems) shipment.items = payload.shipmentItems.map((item: any, index: number) => ({ ...item, id: `saved-${index}` }));
  return shipment;
};
const save = jest.fn(persistDraft);
const mark = jest.fn(async () => ({ status: 'SHIPPED' }));
type MockUpsRateResponse = { rates: Array<{ optionId: string; serviceCode: string; serviceName: string; currency: string; total: string;
  negotiated: boolean; estimatedArrival: string | null; estimatedDeliveryTime?: string | null }>; quoteId?: string; environment?: 'live' | 'test'; expiresAt?: string };
const upsRateCall = jest.fn(async (_path: string, _init?: RequestInit): Promise<MockUpsRateResponse> => ({ rates: [
  { optionId: '0', serviceCode: '03', serviceName: 'UPS Ground', currency: 'USD', total: '18.75', negotiated: false, estimatedArrival: null }] }));
const upsPurchaseCall = jest.fn(async (_path: string, _init?: RequestInit) => ({ environment: 'live', carrierCostCents: 1875,
  carrierCurrency: 'USD', mappingRequired: false, labels: [{ trackingNumber: '1ZTEST' }] }));
const upsChargeCall = jest.fn(async (_path: string, _init?: RequestInit) => ({ applied: false, reason: 'Existing customer shipping charge preserved.' }));
const readyCall = jest.fn(async (_path: string, _init?: RequestInit) => ({ success: true }));
const upsVerifyCall = jest.fn(async (_path: string, _init?: RequestInit) => ({ status: 'suggested', message: 'UPS suggests a correction.',
  normalized: destination, candidates: [{ ...destination, address1: '123 SAVED ST', postalCode: '78701-1234' }] }));
jest.mock('react-router-dom', () => ({ useLocation: () => location, useParams: () => ({ shipmentId: 'shipment-1' }) }));
jest.mock('@/lib/queryClient', () => ({ apiFetch: jest.fn() }));
jest.mock('@/contexts/NavigationGuardContext', () => ({ useNavigationGuard: () => ({ guardedNavigate: navigate }) }));
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('@/components/fulfillment/FulfillmentDebugPanel', () => ({ FulfillmentDebugPanel: () => null }));
jest.mock('@/components/artwork/AuthenticatedArtworkThumbnail', () => ({ AuthenticatedArtworkThumbnail: ({ fileRecordId, previewStatus, fallback }: any) => previewStatus === 'pending' ? <span>Preview pending</span> : fileRecordId ? <span data-file-record-id={fileRecordId}>Artwork</span> : fallback }));
jest.mock('@/components/AttachmentViewerDialog', () => ({ AttachmentViewerDialog: ({ open, attachments, initialIndex, onOpenChange }: any) => open ? <div data-testid="artwork-viewer" data-file-record-id={attachments[initialIndex].fileRecordId}>{JSON.stringify(attachments)}<button onClick={() => onOpenChange(false)}>Close artwork</button></div> : null }));
jest.mock('@/components/production/ShippingDocumentPrintDialog', () => ({ ShippingDocumentPrintDialog: ({ shipmentId, documentType, packageId, label }: any) => <button data-print-document={documentType} data-shipment-id={shipmentId} data-package-id={packageId}>{label}</button> }), { virtual: true });
jest.mock('@/hooks/useFulfillment', () => ({
  apiCall: (path: string, init?: RequestInit) => /\/ups-(?:customer-charges|labels)$/.test(path)
    ? Promise.resolve([]) : path === '/api/fulfillment/ups-environment' ? Promise.resolve({ mode: 'live' })
      : path.endsWith('/ready-quantities') ? readyCall(path, init)
      : path.endsWith('/ups-customer-charge') ? upsChargeCall(path, init)
        : path.endsWith('/ups-labels/purchase') ? upsPurchaseCall(path, init)
          : path.endsWith('/ups-verify-address') ? upsVerifyCall(path, init) : upsRateCall(path, init),
  useShipmentDetailQuery: (id: string) => {
    const read = () => JSON.parse(JSON.stringify(shipmentFixtures[id] ?? shipment));
    const [data, setData] = jest.requireActual('react').useState(read);
    return { data: immutableQuery ? data : shipmentFixtures[id] ?? shipment, refetch: async () => {
      const saved = read(); if (immutableQuery) setData(saved);
      return { data: immutableQuery ? saved : shipmentFixtures[id] ?? shipment, isError: false };
    } };
  },
  useShippingDocumentSourceQuery: () => documentSource,
  useUpdateShipmentMutation: () => ({ mutateAsync: save, isPending: false }),
  useMarkShippedMutation: () => ({ mutateAsync: mark, isPending: false }),
  useVoidShipmentMutation: () => ({ mutateAsync: voidDraft, isPending: false }),
  useReverseTerminalFulfillmentMutation: () => ({ mutateAsync: reverse, isPending: false }),
  useCreateShipmentPackageMutation: () => ({ mutateAsync: addPackage, isPending: false }),
  getOrderDetails: async (id: string) => ({ id, orderNumber: '20306', shipToAddress1: 'LIVE ADDRESS SHOULD NOT BE USED' }),
  getFulfillmentOrderDetail: async (id: string) => fulfillmentByOrder[id] ?? fulfillment,
  toFulfillmentError: (error: any) => ({ message: error.message }),
}));

test('UPS estimates remain read-only, clear when package type changes, and retain inputs after a provider failure', async () => {
  const originalPackages = shipment.packages;
  shipment.packages = [{ ...originalPackages[0], weightLbs: '2', dimLengthIn: '10', dimWidthIn: '8', dimHeightIn: '4' }];
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    await act(async () => Simulate.click(button(container, 'Get UPS Rates')));
    expect(upsRateCall).toHaveBeenCalledWith('/api/fulfillment/shipments/shipment-1/ups-rates', expect.objectContaining({ method: 'POST' }));
    expect(container.textContent).toContain('USD 18.75');
    expect(container.textContent).toContain('Delivery estimate unavailable');
    expect(save).not.toHaveBeenCalled(); expect(mark).not.toHaveBeenCalled();
    const type = container.querySelector('select[aria-label="UPS package type: SH-20306-01-P1"]') as HTMLSelectElement;
    act(() => Simulate.change(type, { target: { value: '21' } } as any));
    expect(container.textContent).toContain('USD 18.75');
    expect(container.textContent).toContain('Previous UPS rates are for different shipping details');
    expect((container.querySelector('input[aria-label="Select UPS Ground USD 18.75 estimate"]') as HTMLInputElement).disabled).toBe(true);
    upsRateCall.mockRejectedValueOnce(new Error('UPS temporarily unavailable'));
    await act(async () => Simulate.click(button(container, 'Get UPS Rates')));
    expect(container.textContent).toContain('UPS temporarily unavailable');
    expect(type.value).toBe('21');
    const weightLabel = Array.from(container.querySelectorAll('label')).find(label => label.textContent?.includes('Weight (lbs)'));
    expect((weightLabel?.querySelector('input') as HTMLInputElement).value).toBe('2');
  } finally { act(() => root.unmount()); container.remove(); shipment.packages = originalPackages; upsRateCall.mockClear(); }
});
const { FulfillmentShipmentEditor, matchRefreshedUpsOption } = require('./fulfillment-shipment-detail');
function button(container: HTMLElement, text: string) { return Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === text)!; }
function packageInput(container: HTMLElement, label: string) { return Array.from(container.querySelectorAll('label')).find(element => element.textContent?.includes(label))?.querySelector('input') as HTMLInputElement; }
afterEach(() => { for (const key of Object.keys(shipment)) delete shipment[key]; Object.assign(shipment, JSON.parse(JSON.stringify(initialShipment))); save.mockImplementation(persistDraft); upsRateCall.mockImplementation(async () => ({ rates: [{ optionId: '0', serviceCode: '03', serviceName: 'UPS Ground', currency: 'USD', total: '18.75', negotiated: false, estimatedArrival: null }] })); jest.clearAllMocks(); fulfillmentByOrder = {}; immutableQuery = false; shipmentFixtures = {}; documentSource = { data: { sender: sourceSender }, isLoading: false }; location = { pathname: '/fulfillment/shipments/shipment-1', search: '', hash: '', state: null }; });
async function blurAndSave(input: Element) { await act(async () => { Simulate.blur(input); }); }

test('immutable JSONB readback acknowledges the saved revision and unlocks documents without refresh', async () => {
  immutableQuery = true;
  save.mockImplementationOnce(async payload => {
    await persistDraft(payload);
    shipment.shippingContext = Object.fromEntries(Object.entries(shipment.shippingContext).reverse());
    shipment.shippingContext.destination = Object.fromEntries(Object.entries(shipment.shippingContext.destination).reverse());
    shipment.updatedAt = '2026-10-29T12:00:01Z';
    return JSON.parse(JSON.stringify(shipment));
  });
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    act(() => Simulate.change(packageInput(container, 'Weight (lbs)'), { target: { value: '2' } } as any));
    expect(container.textContent).toContain('Waiting for draft autosave');
    await blurAndSave(packageInput(container, 'Weight (lbs)'));
    expect(container.textContent).not.toContain('Unsaved changes');
    expect(container.textContent).not.toContain('Waiting for draft autosave');
    expect(container.querySelector('a[aria-label^="Preview"]')?.getAttribute('aria-disabled')).not.toBe('true');
    await act(async () => Simulate.click(button(container, 'MARK AS SHIPPED')));
    expect(mark).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  } finally { act(() => root.unmount()); }
});

test('dispatch awaits the newest save and double clicks cannot initiate a second shipment', async () => {
  immutableQuery = true;
  let finishFirst!: () => void; let finishSecond!: () => void;
  save.mockImplementationOnce(payload => new Promise(resolve => { finishFirst = () => { void persistDraft(payload).then(resolve); }; }))
    .mockImplementationOnce(payload => new Promise(resolve => { finishSecond = () => { void persistDraft(payload).then(resolve); }; }));
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    const weight = packageInput(container, 'Weight (lbs)');
    act(() => Simulate.change(weight, { target: { value: '1' } } as any));
    act(() => Simulate.blur(weight));
    act(() => Simulate.change(weight, { target: { value: '2' } } as any));
    const dispatch = button(container, 'MARK AS SHIPPED');
    act(() => { Simulate.click(dispatch); Simulate.click(dispatch); });
    await act(async () => finishFirst());
    expect(container.textContent).toContain('Waiting for draft autosave');
    expect(container.textContent).toContain('Saving draft…');
    expect(packageInput(container, 'Weight (lbs)').value).toBe('2');
    expect(mark).not.toHaveBeenCalled();
    await act(async () => finishSecond());
    expect(shipment.packages[0].weightLbs).toBe('2');
    expect(mark).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('Unsaved changes');
  } finally { act(() => root.unmount()); }
});

test('switching records isolates a pending save and prevents its queued dispatch', async () => {
  immutableQuery = true;
  shipmentFixtures['shipment-2'] = { ...JSON.parse(JSON.stringify(initialShipment)), id: 'shipment-2', shipmentReference: 'SECOND' };
  let finish!: () => void;
  save.mockImplementationOnce(payload => new Promise(resolve => { finish = () => { void persistDraft(payload).then(resolve); }; }));
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor shipmentId="shipment-1" />));
    act(() => Simulate.change(packageInput(container, 'Weight (lbs)'), { target: { value: '9' } } as any));
    act(() => Simulate.click(button(container, 'MARK AS SHIPPED')));
    await act(async () => root.render(<FulfillmentShipmentEditor shipmentId="shipment-2" />));
    expect(packageInput(container, 'Weight (lbs)').value).toBe('');
    await act(async () => finish());
    expect(mark).not.toHaveBeenCalled();
    expect(packageInput(container, 'Weight (lbs)').value).toBe('');
    expect(container.textContent).not.toContain('Unsaved changes');
    expect(container.textContent).not.toContain('Save failed');
  } finally { act(() => root.unmount()); }
});

test('carrier-generated label fields update the clean draft without dispatching or losing revision identity', async () => {
  immutableQuery = true;
  shipment.packages[0] = { ...shipment.packages[0], weightLbs: '2', dimLengthIn: '10', dimWidthIn: '8', dimHeightIn: '4' };
  upsRateCall.mockResolvedValueOnce({ rates: [quotedGround()], quoteId: 'quote-carrier-fields', environment: 'live', expiresAt: '2099-01-01T00:00:00Z' });
  upsPurchaseCall.mockImplementationOnce(async () => {
    shipment.carrier = 'UPS'; shipment.serviceLevel = 'Ground'; shipment.trackingNumber = '1ZREALTESTFIXTURE';
    shipment.updatedAt = '2026-10-29T12:00:02Z';
    return { environment: 'live', carrierCostCents: 1875, carrierCurrency: 'USD', mappingRequired: false, labels: [{ trackingNumber: shipment.trackingNumber }] };
  });
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    await selectGroundRate(container);
    await act(async () => Simulate.click(button(container, 'Buy UPS Label')));
    expect(shipment.status).toBe('DRAFT'); expect(mark).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Waiting for draft autosave');
    expect(container.textContent).not.toContain('Unsaved changes');
    act(() => Simulate.change(packageInput(container, 'Weight (lbs)'), { target: { value: '3' } } as any));
    await blurAndSave(packageInput(container, 'Weight (lbs)'));
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedUpdatedAt: '2026-10-29T12:00:02.000Z', trackingNumber: '1ZREALTESTFIXTURE' }));
  } finally { act(() => root.unmount()); }
});

test('simple packing exposes quantity and saves the reduced package allocation before marking shipped', async () => {
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
  await act(async () => { root.render(<FulfillmentShipmentEditor />); });
  const quantity = container.querySelector('input[aria-label="Qty in this shipment: Magnetic"]') as HTMLInputElement;
  expect(quantity).toBeTruthy(); expect(quantity.closest('div.hidden')).toBeNull();
  expect(quantity.closest('tr')?.className).toContain('grid-cols-2');
  expect(container.querySelectorAll('input[aria-label="Qty in this shipment: Magnetic"]')).toHaveLength(1);
  expect(container.querySelector('select[aria-label="Package assignment: Magnetic, Order 20306"]')?.className).toContain('min-w-0');
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
  await blurAndSave(quantity);
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ shipmentItems: [] }));
  act(() => root.unmount()); container.remove();
});

test('existing split package quantities remain separate and zero removes only that package allocation', async () => {
  shipment.packingMode = 'advanced_separate_packing';
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
    const first = container.querySelector('input[aria-label="Quantity in box for Magnetic allocation allocation-1"]') as HTMLInputElement;
    const second = container.querySelector('input[aria-label="Quantity in box for Magnetic allocation allocation-2"]') as HTMLInputElement;
    expect(first.value).toBe('1'); expect(second.value).toBe('1');
    expect(save).not.toHaveBeenCalled();
    act(() => Simulate.change(first, { target: { value: '0.5' } } as any));
    act(() => Simulate.change(second, { target: { value: '0.5' } } as any));
    expect(button(container, 'MARK AS SHIPPED').disabled).toBe(true);
    act(() => Simulate.change(first, { target: { value: '0' } } as any));
    act(() => Simulate.change(second, { target: { value: '1' } } as any));
    await blurAndSave(second);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ shipmentItems: [
      { orderId: 'order-1', orderLineItemId: 'line-1', packageId: 'package-2', quantity: 1 },
    ] }));
  } finally {
    act(() => root.unmount()); container.remove();
    shipment.items = originalItems; shipment.packages = originalPackages;
  }
});

test('destination leads packing, documents precede Save/Mark, and each document has explicit Preview and direct Print', async () => {
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    expect(container.textContent).toContain('Receiving Contact');
    expect(container.textContent).toContain('512-555-0100');
    expect(container.textContent).toContain('receiving@example.test');
    expect(container.textContent).not.toContain('LIVE ADDRESS SHOULD NOT BE USED');
    expect(container.textContent).toContain('24 x 18 in · Magnet');
    expect(container.textContent).toContain('Rounded corners');
    const text = container.textContent!;
    expect(text.indexOf('Ship To')).toBeLessThan(text.indexOf('Items in Shipment'));
    expect(text.indexOf('Items in Shipment')).toBeLessThan(text.indexOf('Carrier & Tracking'));
    expect(text.indexOf('Documents')).toBeLessThan(text.indexOf('MARK AS SHIPPED'));
    expect(text).not.toContain('SAVE DRAFT');
    expect(Array.from(container.querySelectorAll('a[aria-label^="Preview"]')).map(a => a.getAttribute('href'))).toEqual([
      '/fulfillment/shipments/shipment-1/manifest?documentType=packing_slip',
      '/fulfillment/shipments/shipment-1/manifest?documentType=shipment_manifest',
      '/fulfillment/shipments/shipment-1/manifest?documentType=package_ticket&packageId=package-1',
    ]);
    expect(Array.from(container.querySelectorAll('[data-print-document]')).map(b => b.getAttribute('data-print-document'))).toEqual(['packing_slip', 'shipment_manifest', 'package_ticket']);
    expect(container.textContent).toContain('No artwork available');
    expect(save).not.toHaveBeenCalled(); expect(mark).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); }
});

test('exact clicked canonical file opens a line/order-scoped gallery, production first, without mutations', async () => {
  const file = (id: string, role: string, previewStatus: string = 'ready') => ({ id, fileRecordId: `record-${id}`, fileName: `${id}.ai`, role, source: 'canonical', mimeType: 'application/postscript', previewStatus });
  const originalOrders = shipment.orders;
  fulfillmentByOrder = {
    'order-1': { lineItems: [{ ...fulfillment.lineItems[0], artwork: [file('customer', 'customer_source'), file('production', 'production', 'pending'), file('modified', 'modified_production')] }] },
    'order-2': { lineItems: [{ ...fulfillment.lineItems[0], id: 'foreign-line', productName: 'Other order artwork', artwork: [file('foreign', 'production')] }] },
  };
  shipment.orders = [...originalOrders, { orderId: 'order-2', orderNumber: '20307' }];
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    const artworkButtons = Array.from(container.querySelectorAll('button[aria-label^="View artwork"]'));
    expect(artworkButtons.map(b => b.getAttribute('aria-label'))).toEqual([
      'View artwork modified.ai for Magnetic, Order 20306', 'View artwork production.ai for Magnetic, Order 20306', 'View artwork customer.ai for Magnetic, Order 20306', 'View artwork foreign.ai for Other order artwork, Order 20307',
    ]);
    expect(container.textContent).toContain('Preview pending');
    act(() => Simulate.click(artworkButtons[1]));
    const viewer = container.querySelector('[data-testid="artwork-viewer"]')!;
    expect(viewer.getAttribute('data-file-record-id')).toBe('record-production');
    expect(viewer.textContent).toContain('record-modified');
    expect(viewer.textContent).not.toContain('record-foreign');
    act(() => Simulate.click(button(container, 'Close artwork')));
    expect(container.querySelector('[data-testid="artwork-viewer"]')).toBeNull();
    expect(save).not.toHaveBeenCalled(); expect(mark).not.toHaveBeenCalled(); expect(addPackage).not.toHaveBeenCalled(); expect(voidDraft).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); shipment.orders = originalOrders; }
});

test('missing destination is actionable and staff draft edits preserve the bound Order and allocations', async () => {
  const originalContext = shipment.shippingContext;
  shipment.shippingContext = { ...originalContext, destination: { ...destination, address1: null } };
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    expect(button(container, 'MARK AS SHIPPED').disabled).toBe(true);
    expect(container.textContent).toContain('Shipping destination incomplete: street address required');
    act(() => Simulate.click(button(container, 'Edit Shipping Address')));
    const input = container.querySelector('input[aria-label="Ship To Street address"]')!;
    act(() => Simulate.change(input, { target: { value: '789 Corrected Street' } } as any));
    expect(button(container, 'MARK AS SHIPPED').disabled).toBe(false);
    await blurAndSave(input);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ shippingContext: expect.objectContaining({ version: 1, source: 'staff', sourceOrderId: 'order-1', destination: expect.objectContaining({ address1: '789 Corrected Street', phone: destination.phone, email: destination.email }) }), shipmentItems: [{ orderId: 'order-1', orderLineItemId: 'line-1', packageId: 'package-1', quantity: 2 }] }));
    expect(mark).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); shipment.shippingContext = originalContext; }
});

test('blind shipments never guess normal sender and alternate sender edits use the canonical context', async () => {
  const originalContext = shipment.shippingContext;
  shipment.shippingContext = { ...originalContext, blindShipping: true, blindSender: null };
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    expect(container.textContent).toContain('Blind shipment');
    expect(container.textContent).toContain('No sender will be guessed');
    expect(container.textContent).not.toContain('Saved Organization Sender');
    expect(button(container, 'MARK AS SHIPPED').disabled).toBe(true);
    act(() => Simulate.click(button(container, 'Edit Sender')));
    for (const [label, value] of [['Contact name', 'Alternate Sender'], ['Street address', '45 Alternate Street'], ['City', 'Dallas'], ['State / province', 'TX'], ['ZIP / postal code', '75201']]) {
      act(() => Simulate.change(container.querySelector(`input[aria-label="Alternate sender ${label}"]`)!, { target: { value } } as any));
    }
    expect(button(container, 'MARK AS SHIPPED').disabled).toBe(false);
    await blurAndSave(container.querySelector('input[aria-label="Alternate sender ZIP / postal code"]')!);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ shippingContext: expect.objectContaining({ source: 'staff', sourceOrderId: 'order-1', blindShipping: true, blindSender: expect.objectContaining({ name: 'Alternate Sender', address1: '45 Alternate Street', city: 'Dallas', state: 'TX', postalCode: '75201' }) }) }));
  } finally { act(() => root.unmount()); shipment.shippingContext = originalContext; }
});

test('enabling blind shipping defaults to the ordering customer snapshot and can switch to a custom sender', async () => {
  const originalOrderingCustomer = shipment.orderingCustomer;
  shipment.orderingCustomer = { sender: { ...destination, name: null, company: 'Ordering Company', address1: '100 Billing Street', city: 'Indianapolis', state: 'IN', postalCode: '46250' }, issue: null };
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    act(() => Simulate.click(button(container, 'Edit Sender')));
    const blind = Array.from(container.querySelectorAll('input[type="checkbox"]')).find(input => input.parentElement?.textContent?.includes('Blind shipping'))!;
    act(() => Simulate.change(blind, { target: { checked: true } } as any));
    expect((container.querySelector('input[type="radio"][name="blind-sender-source"]') as HTMLInputElement).checked).toBe(true);
    expect(container.textContent).toContain('Ordering Company');
    expect(container.textContent).toContain('100 Billing Street');
    expect(container.textContent).toContain('123 Saved Street'); // Ship To remains distinct.
    expect(container.querySelector('input[aria-label="Alternate sender Street address"]')).toBeNull();
    await blurAndSave(blind);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ shippingContext: expect.objectContaining({
      blindShipping: true, blindSenderSource: 'ordering_customer', blindSender: expect.objectContaining({ company: 'Ordering Company', address1: '100 Billing Street' }),
      destination: expect.objectContaining({ address1: '123 Saved Street' }),
    }) }));
    act(() => Simulate.change(container.querySelectorAll('input[type="radio"][name="blind-sender-source"]')[1]));
    expect(container.querySelector('input[aria-label="Alternate sender Street address"]')).toBeTruthy();
    act(() => Simulate.change(container.querySelector('input[aria-label="Alternate sender Street address"]')!, { target: { value: '45 Custom Street' } } as any));
    await blurAndSave(container.querySelector('input[aria-label="Alternate sender Street address"]')!);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ shippingContext: expect.objectContaining({
      blindSenderSource: 'custom', blindSender: expect.objectContaining({ address1: '45 Custom Street' }),
    }) }));
  } finally { act(() => root.unmount()); shipment.orderingCustomer = originalOrderingCustomer; }
});

test('existing custom blind sender stays custom even when the ordering customer is available', async () => {
  const originalContext = shipment.shippingContext;
  const originalOrderingCustomer = shipment.orderingCustomer;
  shipment.shippingContext = { ...originalContext, blindShipping: true, blindSender: { ...destination, company: 'Saved Custom Sender', address1: '45 Existing Street' } };
  shipment.orderingCustomer = { sender: { ...destination, company: 'Ordering Company', address1: '100 Billing Street' }, issue: null };
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    act(() => Simulate.click(button(container, 'Edit Sender')));
    expect((container.querySelectorAll('input[type="radio"][name="blind-sender-source"]')[1] as HTMLInputElement).checked).toBe(true);
    expect((container.querySelector('input[aria-label="Alternate sender Street address"]') as HTMLInputElement).value).toBe('45 Existing Street');
    expect(save).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); shipment.shippingContext = originalContext; shipment.orderingCustomer = originalOrderingCustomer; }
});

test('incomplete ordering customer falls back to custom entry without inventing an address', async () => {
  const originalOrderingCustomer = shipment.orderingCustomer;
  shipment.orderingCustomer = { sender: { ...destination, company: 'Ordering Company', address1: null }, issue: 'Ordering customer billing address is incomplete: street address.' };
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    act(() => Simulate.click(button(container, 'Edit Sender')));
    const blind = Array.from(container.querySelectorAll('input[type="checkbox"]')).find(input => input.parentElement?.textContent?.includes('Blind shipping'))!;
    act(() => Simulate.change(blind, { target: { checked: true } } as any));
    expect((container.querySelectorAll('input[type="radio"][name="blind-sender-source"]')[1] as HTMLInputElement).checked).toBe(true);
    expect(container.textContent).toContain('Ordering customer billing address is incomplete');
    expect((container.querySelector('input[aria-label="Alternate sender Street address"]') as HTMLInputElement).value).toBe('');
    expect(button(container, 'MARK AS SHIPPED').disabled).toBe(true);
  } finally { act(() => root.unmount()); shipment.orderingCustomer = originalOrderingCustomer; }
});

test('historical contexts are read-only and use frozen destination/sender rather than live fields', async () => {
  const originalStatus = shipment.status;
  shipment.status = 'SHIPPED';
  shipment.documentSnapshot = { destination: { ...destination, name: 'Frozen Recipient', address1: 'Frozen Street' }, blindShipping: true, sender: { ...destination, name: 'Frozen Alternate Sender', address1: 'Frozen Sender Street' } };
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    expect(container.textContent).toContain('Frozen Recipient'); expect(container.textContent).toContain('Frozen Street'); expect(container.textContent).toContain('Frozen Alternate Sender');
    expect(container.textContent).not.toContain('123 Saved Street'); expect(container.textContent).not.toContain('LIVE ADDRESS SHOULD NOT BE USED');
    expect(button(container, 'Edit Shipping Address')).toBeUndefined(); expect(button(container, 'SAVE DRAFT')).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); shipment.status = originalStatus; delete shipment.documentSnapshot; }
});

test('compact notes retain saved data and exceptional actions remain disclosed, not primary', async () => {
  shipment.internalNotes = 'Internal shipment sentinel'; shipment.packages[0].notes = 'Package handling sentinel';
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    const shipmentNotes = container.querySelector('textarea[aria-label="Shipment internal notes"]') as HTMLTextAreaElement;
    expect(shipmentNotes.value).toBe('Internal shipment sentinel'); expect(shipmentNotes.closest('details')?.open).toBe(true);
    const packageNotes = container.querySelector('textarea[aria-label^="Package notes:"]') as HTMLTextAreaElement;
    expect(packageNotes.value).toBe('Package handling sentinel'); expect(packageNotes.closest('details')).toBeNull();
    expect(button(container, 'Void Shipment').closest('details')?.open).toBe(false);
    expect(save).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); delete shipment.internalNotes; delete shipment.packages[0].notes; }
});

test('save failure never marks shipped or reallocates', async () => {
  save.mockRejectedValueOnce(new Error('Saved allocations rejected'));
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    act(() => Simulate.change(container.querySelector('input[aria-label="Qty in this shipment: Magnetic"]')!, { target: { value: '1' } } as any));
    await act(async () => Simulate.click(button(container, 'MARK AS SHIPPED')));
    expect(mark).not.toHaveBeenCalled(); expect(container.textContent).toContain('Saved allocations rejected');
  } finally { act(() => root.unmount()); }
});

test('shipment guarded Back restores its bound workspace query/hash/state and rejects external parents', async () => {
  const state = { referrer: { pathname: '/orders/order-1', search: '?returnTo=%2Forders', hash: '#original' }, orderReturnState: { listContext: 'kept' } };
  location.state = { referrer: { pathname: '/fulfillment/orders/order-1', search: '?debug=1', hash: '#packing' }, referrerState: state };
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    act(() => Simulate.click(container.querySelector('button[aria-label="Back to fulfillment workspace"]')!));
    expect(navigate).toHaveBeenLastCalledWith('/fulfillment/orders/order-1?debug=1#packing', { state });
    location.state = { referrer: { pathname: '//external.example/fulfillment/orders/order-1' } };
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    act(() => Simulate.click(container.querySelector('button[aria-label="Back to fulfillment workspace"]')!));
    expect(navigate).toHaveBeenLastCalledWith('/fulfillment', { state: undefined });
  } finally { act(() => root.unmount()); }
});

test('unsaved edits disable stale document actions, viewer close preserves edits, and confirmed draft save re-enables documents', async () => {
  const originalItems = shipment.items;
  fulfillmentByOrder['order-1'] = { lineItems: [{ ...fulfillment.lineItems[0], artwork: [{ id: 'art', fileRecordId: 'exact-art', fileName: 'art.png', role: 'production', source: 'canonical', mimeType: 'image/png', previewStatus: 'ready' }] }] };
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    const quantity = container.querySelector('input[aria-label="Qty in this shipment: Magnetic"]') as HTMLInputElement;
    act(() => Simulate.change(quantity, { target: { value: '1' } } as any));
    expect(container.textContent).toContain('Waiting for draft autosave before previewing or printing');
    expect(container.querySelector('a[aria-label="Preview Packing Slip"]')).toBeNull();
    expect(container.querySelector('[data-print-document]')).toBeNull();
    expect((container.querySelector('button[aria-label="Print Packing Slip"]') as HTMLButtonElement).disabled).toBe(true);
    act(() => Simulate.click(container.querySelector('button[aria-label^="View artwork"]')!));
    act(() => Simulate.click(button(container, 'Close artwork')));
    expect(quantity.value).toBe('1'); expect(save).not.toHaveBeenCalled(); expect(mark).not.toHaveBeenCalled();
    await blurAndSave(quantity);
    expect(container.querySelector('a[aria-label="Preview Packing Slip"]')).not.toBeNull();
    expect(container.querySelector('[data-print-document="packing_slip"]')).not.toBeNull();
    expect(mark).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); shipment.items = originalItems; }
});

test('document source error for incomplete sender stays local and never prevents draft editing', async () => {
  documentSource = { isLoading: false, isError: true, error: new Error('Alternate sender is incomplete') };
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    expect(container.textContent).toContain('Alternate sender is incomplete');
    expect(container.querySelector('input[aria-label="Qty in this shipment: Magnetic"]')).not.toBeNull();
    expect(container.textContent).toContain('Draft saved');
    act(() => Simulate.click(button(container, 'Edit Shipping Address')));
    expect(container.querySelector('input[aria-label="Ship To Street address"]')).not.toBeNull();
  } finally { act(() => root.unmount()); }
});

test('exceptional split-package reversal aggregates each original line once and keeps reason/confirmation requirements', async () => {
  const originalItems = shipment.items; const originalPackages = shipment.packages; const originalStatus = shipment.status;
  shipment.status = 'SHIPPED';
  shipment.items = [{ ...originalItems[0], quantity: 1 }, { ...originalItems[0], id: 'allocation-2', packageId: 'package-2', quantity: 1 }];
  shipment.packages = [...originalPackages, { id: 'package-2', packageReference: 'P2', ordinal: 2 }];
  fulfillmentByOrder['order-1'] = { ...fulfillment, permissions: { canReverseTerminalFulfillment: true } };
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    expect(button(container, 'Reverse Shipment').closest('details')?.open).toBe(false);
    act(() => Simulate.click(button(container, 'Reverse Shipment')));
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
    const quantity = dialog.querySelector('input[aria-label="Reverse quantity: line-1"]') as HTMLInputElement;
    expect(quantity.value).toBe('2'); expect(dialog.querySelectorAll('input[aria-label^="Reverse quantity:"]')).toHaveLength(1);
    expect(button(dialog, 'Reverse Shipment').disabled).toBe(true);
    act(() => Simulate.change(dialog.querySelector('textarea[aria-label="Shipment reversal reason"]')!, { target: { value: 'Wrong physical shipment' } } as any));
    act(() => Simulate.change(dialog.querySelector('input[type="checkbox"]')!, { target: { checked: true } } as any));
    await act(async () => Simulate.click(button(dialog, 'Reverse Shipment')));
    expect(reverse).toHaveBeenCalledWith({ sourceType: 'SHIPMENT', sourceId: 'shipment-1', items: [{ orderLineItemId: 'line-1', quantity: 2 }], reason: 'Wrong physical shipment', clientRequestId: 'shipment-reversal-request' });
    expect(save).not.toHaveBeenCalled(); expect(mark).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); container.remove(); shipment.items = originalItems; shipment.packages = originalPackages; shipment.status = originalStatus; }
});

test('package inputs are visible immediately and Get UPS Rates saves the current values first', async () => {
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    const values = [['Weight (lbs)', '2'], ['Length (in)', '10'], ['Width (in)', '8'], ['Height (in)', '4']];
    for (const [label, value] of values) {
      const input = packageInput(container, label);
      expect(input).toBeTruthy(); expect(input.closest('details')).toBeNull();
      act(() => Simulate.change(input, { target: { value } } as any));
    }
    act(() => Simulate.change(container.querySelector('select[aria-label^="UPS package type"]')!, { target: { value: '21' } } as any));
    expect(save).not.toHaveBeenCalled();
    await act(async () => Simulate.click(button(container, 'Get UPS Rates')));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ packages: [expect.objectContaining({ upsPackagingType: '21', weightLbs: 2, dims: { length: 10, width: 8, height: 4 } })] }));
    expect(upsRateCall).toHaveBeenCalledTimes(1);
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(upsRateCall.mock.invocationCallOrder[0]);
    const rateRequest = upsRateCall.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(rateRequest[1].body as string).packages[0].packagingType).toBe('21');
    expect(container.textContent).toContain('USD 18.75');
    act(() => root.unmount());
    const reopened = createRoot(container);
    await act(async () => reopened.render(<FulfillmentShipmentEditor />));
    expect(packageInput(container, 'Weight (lbs)').value).toBe('2');
    expect(packageInput(container, 'Height (in)').value).toBe('4');
    expect((container.querySelector('select[aria-label^="UPS package type"]') as HTMLSelectElement).value).toBe('21');
    act(() => reopened.unmount());
  } finally { container.remove(); }
});

test('debounced package edits persist nullable partial drafts and the package type on reopen', async () => {
  jest.useFakeTimers();
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    act(() => Simulate.change(packageInput(container, 'Weight (lbs)'), { target: { value: '2.5' } } as any));
    act(() => Simulate.change(container.querySelector('select[aria-label^="UPS package type"]')!, { target: { value: '21' } } as any));
    expect(save).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(500); await Promise.resolve(); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ packages: [expect.objectContaining({ weightLbs: 2.5,
      upsPackagingType: '21', dims: { length: null, width: null, height: null } })] }));
    expect(container.textContent).toContain('Saved');
    act(() => root.unmount());
    const reopened = createRoot(container);
    await act(async () => reopened.render(<FulfillmentShipmentEditor />));
    expect(packageInput(container, 'Weight (lbs)').value).toBe('2.5');
    expect((container.querySelector('select[aria-label^="UPS package type"]') as HTMLSelectElement).value).toBe('21');
    act(() => reopened.unmount());
  } finally { jest.useRealTimers(); container.remove(); }
});

test('rapid package edits serialize saves and retain the newest input after an older readback', async () => {
  let finishFirst!: () => void;
  save.mockImplementationOnce(payload => new Promise(resolve => { finishFirst = () => { void persistDraft(payload).then(resolve); }; }));
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    const weight = packageInput(container, 'Weight (lbs)');
    act(() => Simulate.change(weight, { target: { value: '1' } } as any));
    act(() => Simulate.blur(weight));
    expect(save).toHaveBeenCalledTimes(1);
    act(() => Simulate.change(weight, { target: { value: '2' } } as any));
    expect(weight.value).toBe('2');
    await act(async () => { finishFirst(); await Promise.resolve(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect((save.mock.calls[1][0] as any).packages[0].weightLbs).toBe(2);
    expect(weight.value).toBe('2');
    expect(shipment.packages[0].weightLbs).toBe('2');
  } finally { act(() => root.unmount()); }
});

test('failed draft save keeps inputs, blocks rates, and retries without using stale saved values', async () => {
  save.mockRejectedValueOnce(new Error('Draft persistence unavailable'));
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    for (const [label, value] of [['Weight (lbs)', '2'], ['Length (in)', '10'], ['Width (in)', '8'], ['Height (in)', '4']])
      act(() => Simulate.change(packageInput(container, label), { target: { value } } as any));
    await act(async () => Simulate.click(button(container, 'Get UPS Rates')));
    expect(upsRateCall).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Save failed');
    expect(packageInput(container, 'Weight (lbs)').value).toBe('2');
    await act(async () => Simulate.click(button(container, 'Retry save')));
    expect(shipment.packages[0].weightLbs).toBe('2');
    await act(async () => Simulate.click(button(container, 'Get UPS Rates')));
    expect(upsRateCall).toHaveBeenCalledTimes(1);
  } finally { act(() => root.unmount()); }
});

test('partially typed numeric values stay local and never clear a saved package measurement', async () => {
  shipment.packages[0].weightLbs = '2';
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    const weight = packageInput(container, 'Weight (lbs)');
    act(() => Simulate.change(weight, { target: { value: '2.' } } as any));
    await blurAndSave(weight);
    expect(weight.value).toBe('2.');
    expect(save).not.toHaveBeenCalled();
    expect(shipment.packages[0].weightLbs).toBe('2');
    expect(container.textContent).toContain('Unsaved changes');
    act(() => Simulate.change(weight, { target: { value: '2.5' } } as any));
    await blurAndSave(weight);
    expect(shipment.packages[0].weightLbs).toBe('2.5');
  } finally { act(() => root.unmount()); }
});

test('late UPS responses are discarded after package type changes', async () => {
  shipment.packages[0] = { ...shipment.packages[0], weightLbs: '2', dimLengthIn: '10', dimWidthIn: '8', dimHeightIn: '4' };
  let finishRate!: (value: any) => void;
  upsRateCall.mockImplementationOnce(() => new Promise(resolve => { finishRate = resolve; }));
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    act(() => Simulate.click(button(container, 'Get UPS Rates')));
    await act(async () => { await Promise.resolve(); });
    act(() => Simulate.change(container.querySelector('select[aria-label^="UPS package type"]')!, { target: { value: '21' } } as any));
    await act(async () => finishRate({ rates: [{ optionId: '0', serviceCode: '03', serviceName: 'UPS Ground', currency: 'USD', total: '99.00', negotiated: false, estimatedArrival: null }] }));
    expect(container.textContent).not.toContain('USD 99.00');
    expect(button(container, 'Get UPS Rates').disabled).toBe(false);
  } finally { act(() => root.unmount()); }
});

test('shows a provider delivery date and clears it when the planned ship date changes', async () => {
  shipment.shipDate = '2026-10-23';
  shipment.packages[0] = { ...shipment.packages[0], weightLbs: '2', dimLengthIn: '10', dimWidthIn: '8', dimHeightIn: '4' };
  upsRateCall.mockResolvedValueOnce({ rates: [{ optionId: '0', serviceCode: '03', serviceName: 'UPS Ground', currency: 'USD', total: '18.75',
    negotiated: false, estimatedArrival: '2026-10-27', estimatedDeliveryTime: '1600' }], quoteId: 'quote-1', environment: 'live' });
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    await act(async () => Simulate.click(button(container, 'Get UPS Rates')));
    expect(container.textContent).toContain('Tuesday, October 27, 2026 by 4:00 PM');
    const date = container.querySelector('input[aria-label="Planned Ship Date"]') as HTMLInputElement;
    act(() => Simulate.change(date, { target: { value: '2026-10-24' } } as any));
    expect(container.textContent).toContain('Tuesday, October 27, 2026');
    expect(container.textContent).toContain('Previous UPS rates are for different shipping details');
  } finally { act(() => root.unmount()); }
});

const quotedGround = (total = '18.75', estimatedArrival: string | null = '2026-10-27') => ({
  optionId: '0', serviceCode: '03', serviceName: 'UPS Ground', currency: 'USD', total, negotiated: false, estimatedArrival,
});

async function selectGroundRate(container: HTMLElement) {
  await act(async () => Simulate.click(button(container, 'Get UPS Rates')));
  await act(async () => Simulate.change(container.querySelector('input[name="ups-rate"]')!));
}

test('two Ground options keep the clicked price and option identity through charge and purchase', async () => {
  shipment.packages[0] = { ...shipment.packages[0], weightLbs: '2', dimLengthIn: '10', dimWidthIn: '8', dimHeightIn: '4' };
  upsRateCall.mockResolvedValueOnce({ rates: [
    { ...quotedGround('19.77', '2026-10-26'), optionId: '0' },
    { ...quotedGround('23.77', '2026-10-27'), optionId: '1' },
  ], quoteId: 'quote-two-ground', environment: 'live', expiresAt: '2099-01-01T00:00:00Z' });
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    await act(async () => Simulate.click(button(container, 'Get UPS Rates')));
    const radios = Array.from(container.querySelectorAll('input[name="ups-rate"]')) as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    await act(async () => Simulate.change(radios[1]));
    expect(radios[0].checked).toBe(false);
    expect(radios[1].checked).toBe(true);
    expect(container.textContent).toContain('Estimated UPS carrier cost: USD 23.77');
    expect(JSON.parse((upsChargeCall.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({
      quoteId: 'quote-two-ground', optionId: '1',
    });
    await act(async () => Simulate.click(button(container, 'Buy UPS Label')));
    expect(JSON.parse((upsPurchaseCall.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      quoteId: 'quote-two-ground', optionId: '1',
    });
  } finally { act(() => root.unmount()); }
});

test('refresh never substitutes an ambiguous Ground option with a different date', () => {
  const selected = { ...quotedGround('19.77', '2026-10-26'), optionId: '0' };
  expect(matchRefreshedUpsOption(selected, [
    { ...quotedGround('23.77', '2026-10-27'), optionId: '0' },
    { ...quotedGround('25.77', '2026-10-28'), optionId: '1' },
  ])).toBeNull();
  expect(matchRefreshedUpsOption(selected, [
    { ...quotedGround('23.77', '2026-10-27'), optionId: '0' },
    { ...quotedGround('21.50', '2026-10-26'), optionId: '1' },
  ])?.optionId).toBe('1');
});

test('zero quantity can be replaced naturally and an incomplete entry is not reported saved', async () => {
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    const quantity = container.querySelector('input[aria-label="Qty in this shipment: Magnetic"]') as HTMLInputElement;
    await act(async () => Simulate.change(quantity, { target: { value: '01' } } as any));
    expect(quantity.value).toBe('1');
    await act(async () => Simulate.change(quantity, { target: { value: '' } } as any));
    expect(quantity.value).toBe('');
    expect(container.textContent).toContain('Unsaved changes');
    expect(container.textContent).toContain('Enter a whole quantity');
  } finally { act(() => root.unmount()); }
});

test('missing authoritative readiness blocks allocation instead of using remaining quantity', async () => {
  const previousAvailability = shipment.lineAvailability;
  shipment.lineAvailability = [];
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    expect(container.textContent).toContain('Shipment readiness is unavailable. Reload before allocating this line.');
    expect(container.textContent).toContain('Items packed: 0');
    expect((button(container, 'MARK AS SHIPPED') as HTMLButtonElement).disabled).toBe(true);
  } finally { act(() => root.unmount()); shipment.lineAvailability = previousAvailability; }
});

test('two unready 100-unit lines never appear packed; package measurements still autosave', async () => {
  const previousFulfillment = fulfillment;
  shipment.items = [];
  shipment.lineAvailability = ['line-1', 'line-2'].map(orderLineItemId => ({ orderLineItemId,
    orderedQuantity: 100, readyQuantity: 0, shippedQuantity: 0, remainingQuantity: 100,
    reservedHere: 0, reservedElsewhere: 0 }));
  fulfillment = { lineItems: ['line-1', 'line-2'].map((id, index) => ({ ...previousFulfillment.lineItems[0], id,
    productName: `PVC ${index + 1}`, production: { orderedQuantity: 100, remainingQuantity: 100 } })) };
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    const first = container.querySelector('input[aria-label="Qty in this shipment: PVC 1"]') as HTMLInputElement;
    const second = container.querySelector('input[aria-label="Qty in this shipment: PVC 2"]') as HTMLInputElement;
    act(() => Simulate.change(first, { target: { value: '0100' } } as any));
    act(() => Simulate.change(second, { target: { value: '100' } } as any));
    expect(first.value).toBe('100');
    expect(container.textContent).toContain('No units are production-ready');
    expect(container.textContent).toContain('0 saved eligible unit(s)');
    expect((button(container, 'MARK AS SHIPPED') as HTMLButtonElement).disabled).toBe(true);
    act(() => Simulate.change(packageInput(container, 'Weight (lbs)'), { target: { value: '4.5' } } as any));
    await blurAndSave(packageInput(container, 'Weight (lbs)'));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ packages: [expect.objectContaining({ weightLbs: 4.5 })] }));
    expect((save.mock.calls[0][0] as any).shipmentItems).toBeUndefined();
    expect(shipment.items).toEqual([]);
    expect(container.textContent).toContain('Package and address details saved');
    expect(mark).not.toHaveBeenCalled();
    expect(upsPurchaseCall).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); container.remove(); fulfillment = previousFulfillment; delete shipment.lineAvailability; }
});

test('ready 100-unit lines save a full and a partial allocation before showing packed totals', async () => {
  const previousFulfillment = fulfillment;
  shipment.items = [];
  shipment.lineAvailability = ['line-1', 'line-2'].map(orderLineItemId => ({ orderLineItemId,
    orderedQuantity: 100, readyQuantity: 100, shippedQuantity: 0, remainingQuantity: 100,
    reservedHere: 0, reservedElsewhere: 0 }));
  fulfillment = { lineItems: ['line-1', 'line-2'].map((id, index) => ({ ...previousFulfillment.lineItems[0], id,
    productName: `PVC ${index + 1}`, production: { orderedQuantity: 100, remainingQuantity: 100 } })) };
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    const first = container.querySelector('input[aria-label="Qty in this shipment: PVC 1"]') as HTMLInputElement;
    const second = container.querySelector('input[aria-label="Qty in this shipment: PVC 2"]') as HTMLInputElement;
    act(() => Simulate.change(first, { target: { value: '0100' } } as any));
    act(() => Simulate.change(second, { target: { value: '50' } } as any));
    for (const label of ['PVC 1', 'PVC 2']) act(() => Simulate.change(
      container.querySelector(`select[aria-label="Package assignment: ${label}, Order 20306"]`)!,
      { target: { value: 'package-1' } } as any));
    expect(container.textContent).toContain('Items packed: 0');
    await blurAndSave(second);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ shipmentItems: [
      expect.objectContaining({ orderLineItemId: 'line-1', quantity: 100 }),
      expect.objectContaining({ orderLineItemId: 'line-2', quantity: 50 }),
    ] }));
    expect(container.textContent).toContain('Items packed: 150');
    expect(container.textContent).toContain('150 saved eligible unit(s)');
  } finally { act(() => root.unmount()); container.remove(); fulfillment = previousFulfillment; delete shipment.lineAvailability; }
});

test('missing production owner has an Order recovery link and an audited readiness action', async () => {
  const previousAvailability = shipment.lineAvailability;
  shipment.lineAvailability = [{ orderLineItemId: 'line-1', orderedQuantity: 2, readyQuantity: 0,
    shippedQuantity: 0, remainingQuantity: 2, reservedHere: 0, reservedElsewhere: 0 }];
  fulfillmentByOrder['order-1'] = { ...fulfillment, permissions: { canConfirmPhysicalReadiness: true },
    lineItems: [{ ...fulfillment.lineItems[0], production: { ...fulfillment.lineItems[0].production,
      orderedQuantity: 2, productionCompleteQuantity: 0, remainingQuantity: 2, jobId: null, label: 'Awaiting production' } }] };
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    expect(container.textContent).toContain('No active production job is assigned');
    expect(container.querySelector('a[href="/orders/order-1"]')?.textContent).toContain('Save & Route Jobs');
    const quantity = container.querySelector('input[aria-label="Ready quantity for Magnetic"]')!;
    const reason = container.querySelector('input[aria-label="Physical readiness reason for Magnetic"]')!;
    act(() => Simulate.change(quantity, { target: { value: '1' } } as any));
    act(() => Simulate.change(reason, { target: { value: 'Inspected finished unit at packing bench' } } as any));
    await act(async () => Simulate.click(button(container, 'Confirm items ready')));
    expect(JSON.parse((readyCall.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      items: [{ orderLineItemId: 'line-1', quantityDelta: 1 }], reason: 'Inspected finished unit at packing bench',
    });
  } finally { act(() => root.unmount()); shipment.lineAvailability = previousAvailability; }
});

test('expired quote remains visible and refreshes without a second selection when the UPS result is unchanged', async () => {
  shipment.packages[0] = { ...shipment.packages[0], weightLbs: '2', dimLengthIn: '10', dimWidthIn: '8', dimHeightIn: '4' };
  upsRateCall.mockResolvedValueOnce({ rates: [quotedGround()], quoteId: 'old-quote', environment: 'live', expiresAt: '2020-01-01T00:00:00Z' })
    .mockResolvedValueOnce({ rates: [quotedGround()], quoteId: 'fresh-quote', environment: 'live', expiresAt: '2099-01-01T00:00:00Z' });
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    await selectGroundRate(container);
    expect(container.textContent).toContain('UPS quote expired; displayed rates are for reference');
    expect(container.textContent).toContain('USD 18.75');
    act(() => window.dispatchEvent(new Event('focus')));
    expect(container.textContent).toContain('USD 18.75');
    expect(container.textContent).not.toContain('Previous UPS rates are for different shipping details');
    await act(async () => Simulate.click(button(container, 'Buy UPS Label')));
    expect(upsRateCall).toHaveBeenCalledTimes(2);
    expect(upsPurchaseCall).toHaveBeenCalledTimes(1);
    expect(JSON.parse((upsPurchaseCall.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ quoteId: 'fresh-quote', optionId: '0' });
  } finally { act(() => root.unmount()); }
});

test('changed UPS price requires confirmation before purchase and preserves the selected service', async () => {
  shipment.packages[0] = { ...shipment.packages[0], weightLbs: '2', dimLengthIn: '10', dimWidthIn: '8', dimHeightIn: '4' };
  upsRateCall.mockResolvedValueOnce({ rates: [quotedGround()], quoteId: 'old-quote', environment: 'live', expiresAt: '2020-01-01T00:00:00Z' })
    .mockResolvedValueOnce({ rates: [quotedGround('21.50', '2026-10-28')], quoteId: 'fresh-quote', environment: 'live', expiresAt: '2099-01-01T00:00:00Z' });
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    await selectGroundRate(container);
    await act(async () => Simulate.click(button(container, 'Buy UPS Label')));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('New: USD 21.50'));
    expect(upsPurchaseCall).not.toHaveBeenCalled();
    expect(container.textContent).toContain('USD 21.50');
    expect((container.querySelector('input[name="ups-rate"]') as HTMLInputElement).checked).toBe(true);
    await act(async () => Simulate.click(button(container, 'Buy UPS Label')));
    expect(upsRateCall).toHaveBeenCalledTimes(2);
    expect(upsPurchaseCall).toHaveBeenCalledTimes(1);
  } finally { confirm.mockRestore(); act(() => root.unmount()); }
});

test('failed expiry refresh retains displayed rate and does not send a purchase', async () => {
  shipment.packages[0] = { ...shipment.packages[0], weightLbs: '2', dimLengthIn: '10', dimWidthIn: '8', dimHeightIn: '4' };
  upsRateCall.mockResolvedValueOnce({ rates: [quotedGround()], quoteId: 'old-quote', environment: 'live', expiresAt: '2020-01-01T00:00:00Z' })
    .mockRejectedValueOnce(new Error('UPS unavailable'));
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    await selectGroundRate(container);
    await act(async () => Simulate.click(button(container, 'Buy UPS Label')));
    expect(upsPurchaseCall).not.toHaveBeenCalled();
    expect(container.textContent).toContain('UPS unavailable');
    expect(container.textContent).toContain('No label was purchased');
    expect(container.textContent).toContain('USD 18.75');
  } finally { act(() => root.unmount()); }
});

test('saving an unrelated package note keeps the existing UPS rate and selected service', async () => {
  shipment.packages[0] = { ...shipment.packages[0], weightLbs: '2', dimLengthIn: '10', dimWidthIn: '8', dimHeightIn: '4' };
  upsRateCall.mockResolvedValueOnce({ rates: [quotedGround()], quoteId: 'quote-1', environment: 'live', expiresAt: '2099-01-01T00:00:00Z' });
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    await selectGroundRate(container);
    const notes = container.querySelector('textarea[aria-label="Package notes: SH-20306-01-P1"]')!;
    act(() => Simulate.change(notes, { target: { value: 'Leave at receiving dock' } } as any));
    await blurAndSave(notes);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ packages: [expect.objectContaining({ notes: 'Leave at receiving dock' })] }));
    expect(container.textContent).toContain('USD 18.75');
    expect(container.textContent).not.toContain('Previous UPS rates are for different shipping details');
    expect((container.querySelector('input[name="ups-rate"]') as HTMLInputElement).checked).toBe(true);
  } finally { act(() => root.unmount()); }
});

test('accepting a UPS address suggestion saves only the draft destination and survives reopen', async () => {
  jest.useFakeTimers();
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<FulfillmentShipmentEditor />));
    act(() => Simulate.click(button(container, 'Edit Shipping Address')));
    await act(async () => Simulate.click(button(container, 'Verify Address')));
    expect(upsVerifyCall).toHaveBeenCalledWith('/api/fulfillment/shipments/shipment-1/ups-verify-address', expect.objectContaining({ method: 'POST' }));
    expect(container.textContent).toContain('Entered:');
    expect(container.textContent).toContain('UPS candidate 1:');
    expect(shipment.shippingContext.destination.address1).toBe(destination.address1);
    act(() => Simulate.click(button(container, 'Accept this address')));
    await act(async () => { jest.advanceTimersByTime(500); await Promise.resolve(); });
    expect(shipment.shippingContext.destination).toMatchObject({ address1: '123 SAVED ST', address2: 'Dock B', postalCode: '78701-1234' });
    expect(shipment.shippingContext.blindSender).toBeNull();
    act(() => root.unmount());
    const reopened = createRoot(container);
    await act(async () => reopened.render(<FulfillmentShipmentEditor />));
    expect(container.textContent).toContain('123 SAVED ST');
    expect(container.textContent).toContain('Dock B');
    act(() => reopened.unmount());
  } finally { jest.useRealTimers(); container.remove(); }
});
