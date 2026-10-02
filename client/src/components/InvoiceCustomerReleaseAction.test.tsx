import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InvoiceCustomerReleaseAction, type InvoiceCustomerReleaseState } from './InvoiceCustomerReleaseAction';

const mockFetch = jest.fn();
const mockToast = jest.fn();
jest.mock('@/lib/queryClient', () => ({ apiFetch: (...args: unknown[]) => mockFetch(...args) }));
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let cache: QueryClient;
const base = { id: 'invoice', customerVisible: false, customerReleaseEligible: true };
function render(invoice: InvoiceCustomerReleaseState = base, canRelease = true, compact = false) {
  act(() => root.render(<QueryClientProvider client={cache}><InvoiceCustomerReleaseAction invoice={invoice} canRelease={canRelease} compact={compact} /></QueryClientProvider>));
}
const releaseButton = () => Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Release to Customer')!;
beforeEach(() => {
  mockFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }); mockToast.mockClear();
  cache = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); cache.clear(); document.body.innerHTML = ''; });

test('requires confirmation and sends one release request; no approval or email request', async () => {
  render();
  expect(document.body.textContent).toContain('Internal Only');
  act(() => releaseButton().click());
  const dialog = document.querySelector('[role="alertdialog"]')!;
  expect(dialog.textContent).toContain('does not approve accounting, queue QuickBooks sync, or send email');
  expect(mockFetch).not.toHaveBeenCalled();
  const confirm = Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'Release to Customer')!;
  await act(async () => { confirm.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockFetch).toHaveBeenCalledWith('/api/invoices/invoice/release-to-customer', { method: 'POST', credentials: 'include' });
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Released to Customer' }));
});

test('cancel makes no mutation; unauthorized users see state without a release action', () => {
  render(); act(() => releaseButton().click());
  act(() => Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Cancel')!.click());
  expect(mockFetch).not.toHaveBeenCalled();
  render(base, false); expect(releaseButton()).toBeUndefined();
});

test('compact list menu opens the same release confirmation without mutating', () => {
  render(base, true, true);
  expect(document.body.textContent).not.toContain('Internal Only');
  const menu = document.querySelector('button[aria-label="Customer access actions"]')!;
  act(() => menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(element => element.textContent === 'Release to Customer')!;
  expect(item).toBeDefined();
  act(() => (item as HTMLElement).click());
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(mockFetch).not.toHaveBeenCalled();
});

test('compact list presentation only shows a subtle accessible indicator after customer visibility is explicit', () => {
  render({ ...base, customerVisible: true, customerReleaseEligible: false }, false, true);
  const indicator = document.querySelector('[role="img"][aria-label="Customer Visible"]');
  expect(indicator).not.toBeNull();
  expect(document.body.textContent).not.toContain('Internal Only');
});

test.each([
  [{ ...base, customerVisible: true, customerReleaseEligible: false, customerReleasedAt: new Date() }, 'Customer Released'],
  [{ ...base, customerVisible: true, customerReleaseEligible: false }, 'Customer Visible'],
] as const)('shows server-projected release/compatibility state separately', (invoice, label) => {
  render(invoice); expect(document.body.textContent).toContain(label); expect(releaseButton()).toBeUndefined();
});

test('failed release keeps confirmation open and shows the server error', async () => {
  mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Invoice billing ownership requires review.' }) });
  render(); act(() => releaseButton().click());
  const confirm = Array.from(document.querySelector('[role="alertdialog"]')!.querySelectorAll('button')).find(button => button.textContent === 'Release to Customer')!;
  await act(async () => { confirm.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Release failed', description: 'Invoice billing ownership requires review.' }));
});
