import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import type { ShipmentTrackingPackage } from '@shared/shipmentTracking';
let mockOrders: any[] = [];
jest.mock('@/hooks/useOrders', () => ({ useOrders: () => ({ data: mockOrders, isLoading: false }) }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: {}, isAdmin: false }) }));
jest.mock('@/hooks/useTableColumnConfig', () => ({ useTableColumnConfig: () => ({ columns: [{ id: 'status', label: 'Status', visible: true }] }) }));
jest.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: '/customers/customer' }), Link: () => null }));
jest.mock('@/components/orders/CloseJobOverrideDialog', () => ({ CloseJobOverrideDialog: () => null, CloseJobOverrideAction: () => null, getOrderJobStatus: () => 'Closed' }));
import { CustomerOrdersTable } from './CustomerOrdersTable';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

async function renderOrders(orders: typeof mockOrders) {
  mockOrders = orders;
  await act(async () => root.render(<CustomerOrdersTable customerId="customer" />));
}

const trackingPackage: ShipmentTrackingPackage = {
  shipmentId: 'shipment',
  packageId: 'box-1',
  carrier: 'UPS',
  trackingNumber: '1Z1234567890123456',
  serviceLevel: null,
  trackingUrl: null,
  status: 'unavailable',
  lastCarrierUpdateAt: null,
  lastCheckedAt: null,
  estimatedDeliveryDate: null,
  deliveredAt: null,
  updatesUnavailable: true,
};

test.each(['invoiced', 'completed', 'operationally_complete'])('customer history shows Closed over legacy %s', async status => {
  await renderOrders([{ id: 'order', state: 'closed', status, statusPillValue: 'Invoiced' }]);
  expect(container.querySelector('tbody td span')?.textContent).toBe('Closed');
});

test.each([undefined, { statusLabel: 'Shipped', trackingPackages: [] }])('uses a compact tracking fallback for missing tracking (%j)', async shipmentTracking => {
  await renderOrders([{ id: 'order', status: 'shipped', shipmentTracking }]);
  const cell = container.querySelector('tbody td');
  expect(cell?.querySelector('span:first-child')?.textContent).toBe('Shipped');
  expect(cell?.querySelector('span:last-child')?.textContent).toBe('Tracking: Not Avail.');
  expect(cell?.querySelector('a')).toBeNull();
  expect(cell?.textContent).not.toContain('Tracking Unavailable');
});

test('keeps tracking and partial fulfillment separate, with a safe carrier link and full number tooltip', async () => {
  const number = '1Z' + '1234567890'.repeat(6);
  await renderOrders([{ id: 'order', status: 'in_production', shipmentTracking: {
    statusLabel: 'Partially shipped',
    trackingPackages: [{ ...trackingPackage, trackingNumber: number, trackingUrl: 'https://example.invalid' }],
  } }]);

  const tracking = container.querySelector('[aria-label="Shipment tracking"]');
  expect(tracking?.previousElementSibling?.textContent).toBe('Partially shipped');
  expect(tracking?.textContent).toBe(`Tracking: ${number}`);
  expect(tracking?.classList.contains('whitespace-nowrap')).toBe(true);
  const link = tracking?.querySelector('a');
  expect(link?.getAttribute('href')).toBe(`https://www.ups.com/track?tracknum=${number}`);
  expect(link?.getAttribute('target')).toBe('_blank');
  expect(link?.getAttribute('title')).toBe(number);
  expect(link?.classList.contains('truncate')).toBe(true);
});

test('preserves plain tracking numbers and access to additional carrier links', async () => {
  const number = 'CUSTOM12345';
  const secondPackage = { ...trackingPackage, packageId: 'box-2' };
  await renderOrders([{ id: 'order', status: 'shipped', shipmentTracking: {
    trackingPackages: [{ ...trackingPackage, carrier: 'Other', trackingNumber: number }, secondPackage],
  } }]);

  const tracking = container.querySelector('[aria-label="Shipment tracking"]');
  expect(tracking?.querySelector(`span[title="${number}"]`)?.textContent).toBe(number);
  expect(tracking?.querySelector('a')).toBeNull();
  const more = tracking?.querySelector<HTMLButtonElement>('[aria-label="Show 1 more tracking numbers"]');
  expect(more).not.toBeNull();
  await act(async () => more?.click());
  expect(document.querySelector('[role="dialog"] a')?.getAttribute('href')).toBe(
    `https://www.ups.com/track?tracknum=${secondPackage.trackingNumber}`,
  );
});
