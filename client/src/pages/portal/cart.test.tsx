import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TextDecoder, TextEncoder } from 'node:util';
import { portalCartRequest, usePortalCart, usePortalSession } from '@/hooks/usePortal';

jest.mock('@/hooks/usePortal', () => ({
  usePortalCart: jest.fn(), usePortalSession: jest.fn(), portalCartRequest: jest.fn(),
  PortalApiError: jest.requireActual<typeof import('@/hooks/usePortal')>('@/hooks/usePortal').PortalApiError,
}));
jest.mock('@tanstack/react-query', () => ({ ...jest.requireActual('@tanstack/react-query'), useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));

Object.assign(globalThis, { TextDecoder, TextEncoder });
Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => 'submission-key-1' }, configurable: true });
const { MemoryRouter } = jest.requireActual<typeof import('react-router-dom')>('react-router-dom');
const { default: PortalCartPage } = jest.requireActual<typeof import('./cart')>('./cart');
const cartHook = usePortalCart as jest.Mock;
const sessionHook = usePortalSession as jest.Mock;
const request = portalCartRequest as jest.Mock;
let host: HTMLDivElement;
let root: Root;

beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  cartHook.mockReturnValue({ isPending: false, data: { id: 'cart-1', version: 2, canOrder: true,
    lines: [
      { id: 'line-1', productId: 'p1', productName: 'Banner', treeVersionId: 'v1', quantity: 2, widthIn: 24, heightIn: 18, selections: {} },
      { id: 'line-2', productId: 'p1', productName: 'Banner', treeVersionId: 'v1', quantity: 1, widthIn: 12, heightIn: 12, selections: {} },
    ], files: [{ id: 'file-1', lineId: 'line-1', fileName: 'design.pdf', sizeBytes: 100 }] } });
  sessionHook.mockReturnValue({ data: { permissions: { canPlaceOrders: true } } });
  request.mockReset();
  act(() => { root.render(<MemoryRouter><PortalCartPage /></MemoryRouter>); });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

test('shows separate configurations of one product and line-specific staged artwork', () => {
  expect(host.textContent).toContain('Quantity 2 · 24 × 18 in');
  expect(host.textContent).toContain('Quantity 1 · 12 × 12 in');
  expect(host.textContent?.match(/design.pdf/g)).toHaveLength(1);
  expect(host.textContent).toContain('Pickup only');
});

test('a read-only portal role cannot review or submit', () => {
  sessionHook.mockReturnValue({ data: { permissions: { canPlaceOrders: false } } });
  act(() => { root.render(<MemoryRouter><PortalCartPage /></MemoryRouter>); });
  expect(host.textContent).toContain('Buyer or Company Admin');
  expect(host.querySelector<HTMLButtonElement>('button')?.disabled).not.toBe(false);
  expect(request).not.toHaveBeenCalled();
});

test('reviews authoritative pickup totals and places the Order without a payment action', async () => {
  request.mockImplementation((path: string) => path === '/review' ? Promise.resolve({
    cartVersion: 2, reviewToken: 'review-1', currency: 'USD', fulfillmentMethod: 'pickup',
    pickupLocation: { name: 'Shop', line1: '1 Main', city: 'Town', state: 'IN', postalCode: '46000' },
    lines: [{ id: 'line-1', productName: 'Banner', quantity: 2, totalCents: 4000 }, { id: 'line-2', productName: 'Banner', quantity: 1, totalCents: 2000 }],
    subtotalCents: 6000, taxCents: 420, shippingCents: 0, totalCents: 6420,
  }) : Promise.resolve({ status: 'placed', orderId: 'order-1', orderNumber: '20799', totalCents: 6420, currency: 'USD', artworkStatus: 'Pending staff review' }));
  await act(async () => { Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Review totals')?.click(); });
  expect(host.textContent).toContain('$64.20');
  expect(host.textContent).toContain('Tax');
  await act(async () => { Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Place Order')?.click(); });
  expect(request).toHaveBeenCalledWith('/submit', 'POST', expect.objectContaining({ reviewToken: 'review-1', submissionKey: expect.any(String) }));
  expect(host.textContent).toContain('Order 20799');
  expect(host.textContent).toContain('No payment was taken');
});

test('changed checkout totals require a second explicit acceptance', async () => {
  const original = { cartVersion: 2, reviewToken: 'review-1', currency: 'USD', fulfillmentMethod: 'pickup',
    pickupLocation: { name: 'Shop', line1: '1 Main', city: 'Town', state: 'IN', postalCode: '46000' },
    lines: [{ id: 'line-1', productName: 'Banner', quantity: 2, totalCents: 4000 }],
    subtotalCents: 4000, taxCents: 280, shippingCents: 0, totalCents: 4280 };
  request.mockImplementation((path: string) => Promise.resolve(path === '/review' ? original : {
    status: 'changed', review: { ...original, reviewToken: 'review-2', taxCents: 350, totalCents: 4350 },
  }));
  await act(async () => { Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Review totals')?.click(); });
  await act(async () => { Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Place Order')?.click(); });
  expect(host.textContent).toContain('$43.50');
  expect(host.textContent).toContain('Review the updated total');
  expect(host.textContent).not.toContain('Order received');
  expect(request).toHaveBeenCalledTimes(2);
});

test('failed submission preserves reviewed inputs and retries with the same key', async () => {
  const review = { cartVersion: 2, reviewToken: 'review-1', currency: 'USD', fulfillmentMethod: 'pickup',
    pickupLocation: { name: 'Shop', line1: '1 Main', city: 'Town', state: 'IN', postalCode: '46000' },
    lines: [], subtotalCents: 1000, taxCents: 0, shippingCents: 0, totalCents: 1000 };
  request.mockImplementation((path: string) => path === '/review' ? Promise.resolve(review) : Promise.reject(new Error('Network interrupted')));
  await act(async () => { Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Review totals')?.click(); });
  await act(async () => { Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Place Order')?.click(); });
  expect(host.textContent).toContain('Network interrupted');
  expect(host.textContent).toContain('$10.00');
  await act(async () => { Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Place Order')?.click(); });
  const submitCalls = request.mock.calls.filter(([path]) => path === '/submit');
  expect(submitCalls).toHaveLength(2);
  expect(submitCalls[0][2].submissionKey).toBe(submitCalls[1][2].submissionKey);
});
