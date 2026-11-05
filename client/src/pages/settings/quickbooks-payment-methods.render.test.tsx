import React, { act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import QuickBooksSyncQueuePage from './quickbooks-sync-queue';

jest.mock('react-router-dom', () => ({ Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a> }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'accountant' } }) }));
jest.mock('@/hooks/useActiveOrganizationRole', () => ({ useActiveOrganizationRole: () => ({ activeOrgId: 'tenant-a', isAdminOrOwner: true, isLoading: false }) }));
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
// Native selects exercise the page state/request contract; the browser check uses real Radix controls.
jest.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: ReactElement[] }) => {
    const [trigger, content] = React.Children.toArray(children) as ReactElement<{ 'aria-label'?: string; children?: ReactNode }>[];
    return <select aria-label={trigger.props['aria-label']} value={value} onChange={event => onValueChange(event.target.value)}>{content.props.children}</select>;
  },
  SelectTrigger: () => null, SelectValue: () => null, SelectContent: () => null,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}));

const rows = [
  ...Array.from({ length: 28 }, (_, index) => ({ id: `check-${index}`, paymentMethods: ['check'], paymentReference: `check-ref-${index}`, queueState: 'failed' })),
  ...['cash', 'credit_card', 'ach', 'other', 'unknown'].map(method => ({ id: method, paymentMethods: [method], paymentReference: null, queueState: 'unsynced' })),
  { id: 'mixed', paymentMethods: ['cash', 'check'], paymentReference: 'mixed-receipt', queueState: 'unsynced' },
].map(row => ({ ...row, resourceType: 'payment', displayNumber: row.id, customerName: 'Synthetic customer', amountCents: 2000, status: 'succeeded', syncStatus: 'not_synced', accountingUpdatedAt: '2026-01-01', eligible: true, canTransmit: false, canManualForce: false, eligibility: 'queueable', ineligibleReason: null, lastError: null }));
let root: Root, container: HTMLDivElement, client: QueryClient;
let requests: URL[];
const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
const response = (data: unknown) => ({ ok: true, json: async () => ({ success: true, data }) });
async function settle(predicate: () => boolean) {
  for (let i = 0; i < 30 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 1)); });
  expect(predicate()).toBe(true);
}
const body = () => container.querySelector('tbody')?.textContent || '';
async function choose(label: string, value: string) {
  const element = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  act(() => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle(() => requests.at(-1)?.searchParams.get(label === 'Payment Method filter' ? 'paymentMethod' : 'view') === value);
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); window.localStorage.clear(); requests = [];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.method || 'GET').toBe('GET');
    const url = new URL(String(input), 'http://localhost');
    if (!url.pathname.endsWith('/items')) return response({ invoices: {}, payments: {} });
    requests.push(url); const p = url.searchParams, method = p.get('paymentMethod'), view = p.get('view'), search = p.get('search') || '';
    const matching = rows.filter(row => (method === 'all' || row.paymentMethods.includes(method!)) && (view === 'all' || row.queueState === view) && `${row.displayNumber} ${row.paymentReference}`.includes(search));
    const page = Number(p.get('page')), pageSize = Number(p.get('pageSize'));
    return response({ items: matching.slice((page - 1) * pageSize, page * pageSize), totalCount: matching.length, totalPages: Math.ceil(matching.length / pageSize), page, pageSize });
  }) });
  await act(async () => root.render(<QueryClientProvider client={client}><QuickBooksSyncQueuePage /></QueryClientProvider>));
  await settle(() => body().includes('check-0'));
});
afterEach(() => {
  act(() => root.unmount()); client.clear(); container.remove();
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch); else Reflect.deleteProperty(globalThis, 'fetch');
});

test('renders recorded methods, compact references, Unknown, and accessible Multiple details', async () => {
  const header = Array.from(container.querySelectorAll('thead th')).map(element => element.textContent);
  expect(header.indexOf('Payment Method')).toBe(header.indexOf('Amount') + 1);
  expect(body()).toContain('Ref: check-ref-0');
  for (const [method, label] of [['cash', 'Cash'], ['credit_card', 'Credit Card'], ['ach', 'ACH'], ['other', 'Other'], ['unknown', 'Unknown']]) {
    await choose('Payment Method filter', method); await settle(() => body().includes(label));
  }
  await choose('Payment Method filter', 'cash'); await settle(() => body().includes('mixed'));
  const multiple = container.querySelector<HTMLButtonElement>('button[aria-label="Multiple payment methods"]')!;
  act(() => multiple.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await settle(() => Boolean(document.querySelector('[aria-label="Recorded payment methods"]')));
  expect(document.querySelector('[aria-label="Recorded payment methods"]')?.textContent).toBe('CashCheck');
});

test('combines method/status/search across pages, resets page, and preserves selected receipt allocations', async () => {
  const selected = container.querySelector<HTMLInputElement>('input[aria-label="Select check-0"]')!;
  act(() => selected.click());
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Next accounting page (top)"]')!.click());
  await settle(() => body().includes('credit_card'));
  await choose('Payment Method filter', 'check'); await settle(() => body().includes('check-0'));
  expect(requests.at(-1)?.searchParams.get('page')).toBe('1');
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Select check-0"]')!.checked).toBe(true);
  await choose('Queue state filter', 'failed'); await settle(() => container.textContent!.includes('of 28 records'));
  const search = container.querySelector<HTMLInputElement>('input[placeholder^="Search invoice"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'check-ref-27');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle(() => body().includes('check-27') && !body().includes('check-0'));
  expect(requests.at(-1)?.searchParams.get('paymentMethod')).toBe('check');
  expect(requests.at(-1)?.searchParams.get('view')).toBe('failed');
  expect(container.textContent).toContain('1 selected');
});
