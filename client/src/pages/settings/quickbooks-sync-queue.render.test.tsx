import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import QuickBooksSyncQueuePage from './quickbooks-sync-queue';

jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a>,
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'admin-1' } }),
}));

jest.mock('@/hooks/useActiveOrganizationRole', () => ({
  useActiveOrganizationRole: () => ({ activeOrgId: 'org-1', isAdminOrOwner: true, isLoading: false }),
}));

jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

type QueueState = 'unsynced' | 'queued' | 'failed' | 'synced';

const fixture = [
  { id: 'synced-invoice', resourceType: 'invoice', displayNumber: 'INV-100', queueState: 'synced', eligibility: 'blocked' },
  { id: 'queued-invoice', resourceType: 'invoice', displayNumber: 'INV-101', queueState: 'queued', eligibility: 'syncable' },
  { id: 'queued-payment', resourceType: 'payment', displayNumber: 'Payment for INV-101', queueState: 'queued', eligibility: 'syncable' },
  { id: 'unsynced-invoice', resourceType: 'invoice', displayNumber: 'INV-102', queueState: 'unsynced', eligibility: 'queueable' },
  { id: 'failed-payment', resourceType: 'payment', displayNumber: 'Payment for INV-103', queueState: 'failed', eligibility: 'syncable' },
].map((item) => ({
  ...item,
  customerName: 'Printer Hero',
  amountCents: 1_000,
  status: item.resourceType === 'payment' ? 'succeeded' : 'open',
  syncStatus: item.queueState === 'queued' ? 'pending' : item.queueState,
  accountingUpdatedAt: '2026-09-10T12:00:00.000Z',
  eligible: item.queueState !== 'synced',
  canTransmit: item.queueState === 'queued' || item.queueState === 'failed',
  canManualForce: item.queueState === 'queued' || item.queueState === 'failed',
  ineligibleReason: null,
  lastError: item.queueState === 'failed' ? 'Example failure' : null,
}));

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
let fetchMock: jest.Mock;

const response = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitForText(text: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (container.textContent?.includes(text)) return;
    await settle();
  }
  expect(container.textContent).toContain(text);
}

function visibleRecords() {
  return Array.from(container.querySelectorAll('tbody tr')).map((row) => row.textContent || '');
}

async function chooseTab(label: string, expectedRecord: string) {
  const tab = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === label);
  expect(tab).toBeTruthy();
  act(() => tab?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await waitForText(expectedRecord);
}

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname.endsWith('/queue/items')) {
      const view = (url.searchParams.get('view') || 'all') as 'all' | QueueState;
      const items = view === 'all' ? fixture : fixture.filter((item) => item.queueState === view);
      return response({ success: true, data: { items, total: items.length, totalCount: items.length, totalPages: items.length ? 1 : 0, page: 1, pageSize: 25 } });
    }
    if (url.pathname.endsWith('/queue')) {
      return response({ success: true, data: {
        invoices: { unsynced: 1, pending: 1, failed: 0, synced: 1 },
        payments: { unsynced: 0, pending: 1, failed: 1, synced: 0 },
      } });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  (globalThis as any).fetch = fetchMock;

  await act(async () => {
    root.render(<QueryClientProvider client={queryClient}><QuickBooksSyncQueuePage /></QueryClientProvider>);
  });
  await waitForText('INV-101');
});

afterEach(() => {
  act(() => root.unmount());
  queryClient.clear();
  container.remove();
  delete (globalThis as any).fetch;
  jest.clearAllMocks();
});

test('the rendered console keeps State = queued reachable through the Queued tab without a provider write', async () => {
  expect(visibleRecords().join(' ')).toContain('queued');
  expect(visibleRecords().join(' ')).toContain('INV-101');
  expect(visibleRecords().join(' ')).toContain('Payment for INV-101');
  expect(container.textContent).toContain('Queued2');

  await chooseTab('Queued', 'INV-101');
  const queuedRows = visibleRecords().join(' ');
  expect(queuedRows).toContain('INV-101');
  expect(queuedRows).toContain('Payment for INV-101');
  expect(queuedRows).toContain('queued');
  expect(queuedRows).not.toContain('INV-100');
  expect(queuedRows).not.toContain('INV-102');
  expect(queuedRows).not.toContain('INV-103');

  await chooseTab('Eligible / Unsynced', 'INV-102');
  expect(visibleRecords().join(' ')).not.toContain('INV-101');

  await chooseTab('Synced', 'INV-100');
  expect(visibleRecords().join(' ')).not.toContain('INV-101');

  await chooseTab('Failed', 'INV-103');
  expect(visibleRecords().join(' ')).not.toContain('INV-101');

  const itemViews = fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost'))
    .filter((url) => url.pathname.endsWith('/queue/items'))
    .map((url) => url.searchParams.get('view'));
  expect(itemViews).toEqual(expect.arrayContaining(['all', 'queued', 'unsynced', 'synced', 'failed']));
  expect(fetchMock.mock.calls.every(([, init]) => !init || !init.method || init.method === 'GET')).toBe(true);
});
