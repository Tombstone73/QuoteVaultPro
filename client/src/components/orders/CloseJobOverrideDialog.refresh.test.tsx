import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { CloseJobOverrideAction, CloseJobOverrideDialog } from './CloseJobOverrideDialog';
import { apiRequest } from '@/lib/queryClient';

jest.mock('@/lib/queryClient', () => ({ apiRequest: jest.fn() }));
const mockToast = jest.fn();
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock('@/contexts/WorkspaceContext', () => ({ WorkspaceLabel: (props: any) => <label {...props}/>, useWorkspaceFieldProps: (props: any) => props }));
jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: any) => open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <footer>{children}</footer>,
}));
jest.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <span>{children}</span>, SelectValue: () => null,
}));
const target = { orderId: 'order', invoiceId: 'invoice', orderNumber: 'QA-20881' };
const previewKey = ['orders', 'order', 'historical-fulfillment-reconciliation'];
const invoiceKey = ['invoices', { search: 'Brainstorm', page: 3, sortDir: 'desc' }];
const openPreview = {
  canCloseJobOverride: true, productionComplete: false, remainingProductionQuantity: 30,
  remainingFulfillmentQuantity: 30, requiresProductionBootstrap: false, productionStarted: true,
  activeProductionJobCount: 1,
};
const completedPreview = { ...openPreview, canCloseJobOverride: false, productionComplete: true,
  remainingProductionQuantity: 0, remainingFulfillmentQuantity: 0, activeProductionJobCount: 0 };
let client: QueryClient, root: Root, host: HTMLDivElement;
let serverPreview: typeof openPreview, failAt: string | undefined, failPreview: boolean;
let releaseFulfillment: (() => void) | undefined;
const response = (data: unknown) => ({ json: async () => ({ success: true, data }) }) as Response;

function InvoiceActionsHarness() {
  const [dialog, setDialog] = useState(false);
  const [search, setSearch] = useState('Brainstorm');
  const invoices = useQuery({ queryKey: invoiceKey, queryFn: async () => ({ orderState: serverPreview.productionComplete ? 'production_complete' : 'in_production' }) });
  return <div>
    <input aria-label="Search invoices" value={search} onChange={event => setSearch(event.target.value)}/>
    <span>Page 3 · Descending</span><span data-testid="invoice-state">{invoices.data?.orderState}</span>
    <CloseJobOverrideAction target={target} isAdminOrOwner onOpen={() => setDialog(true)} label="Close Job"/>
    <CloseJobOverrideDialog target={dialog ? target : null} onOpenChange={setDialog}/>
  </div>;
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
function button(text: string) { return Array.from(host.querySelectorAll('button')).find(item => item.textContent === text)!; }
async function mount() {
  act(() => root.render(<QueryClientProvider client={client}><InvoiceActionsHarness/></QueryClientProvider>));
  await flush();
}
async function openDialog() { await act(async () => button('Close Job').click()); await flush(); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  serverPreview = { ...openPreview }; failAt = undefined; failPreview = false; releaseFulfillment = undefined;
  mockToast.mockClear(); jest.mocked(apiRequest).mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  jest.mocked(apiRequest).mockImplementation(async (method, path) => {
    if (method === 'GET') {
      if (failPreview) throw new Error('Preview unavailable');
      return response({ ...serverPreview });
    }
    if (path.endsWith(failAt || 'never')) throw new Error('Operation rejected; original state preserved');
    if (path.endsWith('/complete-production')) serverPreview = { ...serverPreview, productionComplete: true, remainingProductionQuantity: 0 };
    if (path.endsWith('/reconcile-historical-fulfillment')) {
      if (releaseFulfillment) await new Promise<void>(resolve => { releaseFulfillment = resolve; });
      serverPreview = { ...completedPreview };
    }
    return response({ id: 'order' });
  });
});
afterEach(() => { act(() => root.unmount()); client.clear(); host.remove(); });

test('confirmed completion refetches canonical action eligibility and Invoice state without losing list state', async () => {
  await mount(); await openDialog();
  const search = host.querySelector('input')!;
  act(() => Simulate.change(search, { target: { value: 'preserved filter' } } as any));
  host.scrollTop = 170;
  await act(async () => button('Close Job Override').click()); await flush();
  expect(button('Close Job')).toBeUndefined();
  expect(client.getQueryData(previewKey)).toMatchObject({ canCloseJobOverride: false });
  expect(host.querySelector('[data-testid="invoice-state"]')?.textContent).toBe('production_complete');
  expect(host.querySelector('input')).toBe(search); expect(search.value).toBe('preserved filter');
  expect(host.textContent).toContain('Page 3 · Descending'); expect(host.scrollTop).toBe(170);
  expect(client.getQueryCache().find({ queryKey: invoiceKey, exact: true })).toBeDefined();
});

test('pending fulfillment does not optimistically remove the action', async () => {
  await mount(); await openDialog(); releaseFulfillment = () => {};
  await act(async () => button('Close Job Override').click());
  expect(button('Close Job')).toBeDefined(); expect(host.textContent).toContain('Reconciling…');
  await act(async () => releaseFulfillment!()); await flush();
  expect(button('Close Job')).toBeUndefined();
});

test.each(['/complete-production', '/reconcile-historical-fulfillment'])('failure at %s refreshes eligibility and retains recovery', async stage => {
  await mount(); await openDialog(); failAt = stage;
  const readsBefore = jest.mocked(apiRequest).mock.calls.filter(call => call[0] === 'GET').length;
  await act(async () => button('Close Job Override').click()); await flush();
  expect(jest.mocked(apiRequest).mock.calls.filter(call => call[0] === 'GET').length).toBeGreaterThan(readsBefore);
  expect(button('Close Job')).toBeDefined(); expect(button('Refresh live preview')).toBeDefined();
  expect(button('Close Job Override').disabled).toBe(true);
  expect(client.getQueryData(previewKey)).toMatchObject({ productionComplete: stage === '/reconcile-historical-fulfillment', canCloseJobOverride: true });
  expect(host.querySelector('[data-testid="invoice-state"]')?.textContent).toBe(stage === '/reconcile-historical-fulfillment' ? 'production_complete' : 'in_production');
  if (stage === '/reconcile-historical-fulfillment') expect(mockToast).toHaveBeenLastCalledWith(expect.objectContaining({ description: expect.stringContaining('Production is complete; fulfillment was not confirmed.') }));
});

test('failed eligibility refetch preserves the known action instead of assuming completion', async () => {
  await mount(); await openDialog(); failPreview = true;
  await act(async () => button('Close Job Override').click()); await flush();
  expect(button('Close Job')).toBeDefined();
  expect(client.getQueryData(previewKey)).toMatchObject({ canCloseJobOverride: true });
});
