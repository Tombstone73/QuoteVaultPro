import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import { apiRequest } from '@/lib/queryClient';
import { OrderReconciliationDiagnostic } from './OrderReconciliationDiagnostic';

jest.mock('@/lib/queryClient', () => ({ apiRequest: jest.fn() }));
jest.mock('@/contexts/WorkspaceContext', () => ({ useWorkspaceFieldProps: (props: unknown) => props }));
jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: any) => open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>, DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>, DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <footer>{children}</footer>,
}));
const report = { readOnly: true, mutationAvailable: false, observedAt: '2026-11-05T12:00:00Z', snapshotToken: 'fixture-hash',
  order: { id: 'order', orderNumber: '20881', poNumber: '152918' },
  canonicalPreview: { remainingProductionQuantity: 30, remainingFulfillmentQuantity: 30, activeProductionJobCount: 1, productionBootstrapLineCount: 2 },
  findings: [{ code: 'TERMINAL_HISTORY_WITH_REMAINING_OBLIGATION', lineItemId: 'line', message: 'Terminal history requires review.' }],
  jobs: [{ id: 'historical-job', status: 'done' }], auditHistory: [{ id: 'audit' }],
};
let root: Root, host: HTMLDivElement, client: QueryClient;
const copy = jest.fn<(value: string) => Promise<void>>();
const button = (text: string) => Array.from(host.querySelectorAll('button')).find(item => item.textContent === text)!;
const props = { orderId: 'order', orderNumber: '20881', poNumber: '152918', organizationId: 'tenant', isOwner: true };
function render(next = props) { act(() => root.render(<QueryClientProvider client={client}><OrderReconciliationDiagnostic {...next}/></QueryClientProvider>)); }
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  jest.mocked(apiRequest).mockReset().mockResolvedValue({ json: async () => ({ success: true, data: report }) } as Response);
  copy.mockReset().mockResolvedValue(); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
});
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove(); jest.useRealTimers(); });

test('only Owners see the action, and opening it is required before any request', async () => {
  render({ ...props, isOwner: false }); await flush(); expect(host.textContent).toBe(''); expect(apiRequest).not.toHaveBeenCalled();
  render(); await flush(); expect(button('Order diagnostic')).toBeDefined(); expect(apiRequest).not.toHaveBeenCalled();
});

test('authenticated GET returns and copies the complete report without a mutation or localStorage write', async () => {
  const storage = jest.spyOn(Storage.prototype, 'setItem'); render();
  await act(async () => button('Order diagnostic').click()); await flush();
  expect(apiRequest).toHaveBeenCalledWith('GET', '/api/orders/order/reconciliation-diagnostic?expectedOrderNumber=20881&expectedPoNumber=152918', undefined,
    expect.objectContaining({ signal: expect.any(AbortSignal), cache: 'no-store' }));
  expect(host.textContent).toContain('Remaining production: 30');
  const area = host.querySelector('textarea')!; expect(area.readOnly).toBe(true); expect(JSON.parse(area.value)).toEqual(report);
  await act(async () => button('Copy diagnostic').click()); expect(copy).toHaveBeenCalledWith(JSON.stringify(report, null, 2));
  expect(host.textContent).toContain('Diagnostic copied'); expect(storage).not.toHaveBeenCalled();
  expect(jest.mocked(apiRequest).mock.calls.every(call => call[0] === 'GET')).toBe(true);
  expect(button('Apply')).toBeUndefined(); expect(button('Repair')).toBeUndefined(); storage.mockRestore();
});

test('failure remains visible and a deliberate refresh safely recovers', async () => {
  jest.mocked(apiRequest).mockRejectedValueOnce(new Error('503 unavailable')); render();
  await act(async () => button('Order diagnostic').click()); await flush();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('No repair was attempted'); expect(button('Copy diagnostic').disabled).toBe(true);
  await act(async () => button('Refresh report').click()); await flush();
  expect(button('Copy diagnostic').disabled).toBe(false); expect(apiRequest).toHaveBeenCalledTimes(2);
});

test('clipboard failure provides manual selection fallback without falsely claiming a copy', async () => {
  copy.mockRejectedValueOnce(new Error('Not allowed')); render();
  await act(async () => button('Order diagnostic').click()); await flush();
  await act(async () => button('Copy diagnostic').click());
  expect(host.textContent).toContain('Select the report text and copy it manually'); expect(host.textContent).not.toContain('Diagnostic copied');
});

test('an unbounded network request times out without retry or a business mutation', async () => {
  jest.useFakeTimers(); jest.mocked(apiRequest).mockImplementation(() => new Promise(() => {})); render();
  await act(async () => button('Order diagnostic').click());
  expect(host.textContent).toContain('Retrieving a consistent');
  await act(async () => jest.advanceTimersByTimeAsync(20_001));
  await act(async () => jest.advanceTimersByTimeAsync(100));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('timed out'); expect(button('Refresh report').disabled).toBe(false);
  expect(apiRequest).toHaveBeenCalledTimes(1);
});
