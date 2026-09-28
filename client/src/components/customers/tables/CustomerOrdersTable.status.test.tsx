import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, jest, test } from '@jest/globals';
let mockOrders: any[] = [];
jest.mock('@/hooks/useOrders', () => ({ useOrders: () => ({ data: mockOrders, isLoading: false }) }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: {}, isAdmin: false }) }));
jest.mock('@/hooks/useTableColumnConfig', () => ({ useTableColumnConfig: () => ({ columns: [{ id: 'status', label: 'Status', visible: true }] }) }));
jest.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: '/customers/customer' }), Link: () => null }));
jest.mock('@/components/orders/CloseJobOverrideDialog', () => ({ CloseJobOverrideDialog: () => null, CloseJobOverrideAction: () => null, getOrderJobStatus: () => 'Closed' }));
import { CustomerOrdersTable } from './CustomerOrdersTable';

test.each(['invoiced', 'completed', 'operationally_complete'])('customer history shows Closed over legacy %s', async status => {
  mockOrders = [{ id: 'order', state: 'closed', status, statusPillValue: 'Invoiced' }];
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div'); const root = createRoot(container);
  await act(async () => root.render(<CustomerOrdersTable customerId="customer" />));
  expect(container.querySelector('tbody')?.textContent).toBe('Closed');
  await act(async () => root.unmount());
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});
