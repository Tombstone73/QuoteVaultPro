import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MultiInvoicePaymentDialog } from './MultiInvoicePaymentDialog';
import { apiFetch } from '@/lib/queryClient';
import { staffPaymentMethodDefinitions } from '@shared/paymentMethodCatalog';
import { allocateCustomerPayment } from '@shared/customerPaymentAllocation';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let cardProps: any;
jest.mock('@/components/payments/StripePayDialog', () => ({ __esModule: true, default: (props: any) => { cardProps = props; return <div data-testid="card-dialog">Hosted card dialog</div>; } }));
jest.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: any) => <select value={value} onChange={e => onValueChange(e.target.value)}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null, SelectContent: ({children}: any) => <>{children}</>,
  SelectItem: ({children, value}: any) => <option value={value}>{children}</option>,
}));
let isAdminOrOwner = true;
jest.mock('@/hooks/useActiveOrganizationRole', () => ({ useActiveOrganizationRole: () => ({ isAdminOrOwner }) }));
let runtimeResponse: { status: number; code?: string; error?: string; invalid?: boolean } | null = null;
let networkError = false;
let configured = false; let finalized = false; const success = jest.fn();
jest.mock('@/lib/queryClient', () => ({ apiFetch: jest.fn() }));
const toast = jest.fn();
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
let root: Root; let previewError = ''; let noPayable = false; let posts: any[]; let failPost = false;
const ids = ['a','b','c','d','e'];
const eligible = [{ invoiceId: 'b', invoiceNumber: 'B', remainingCents: 10000, dueDate: '2026-01-02' }, { invoiceId: 'd', invoiceNumber: 'D', remainingCents: 25000, dueDate: '2026-01-04' }, { invoiceId: 'e', invoiceNumber: 'E', remainingCents: 7500, dueDate: '2026-01-05' }];
const button = (text: string) => Array.from(document.querySelectorAll('button')).find(node => node.textContent === text)!;
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); };
const render = async () => {
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><MultiInvoicePaymentDialog open onOpenChange={jest.fn()} invoiceIds={ids} onSuccess={success} /></QueryClientProvider>));
  await flush();
};
const enter = async (value: string) => { await act(async () => Simulate.change(document.querySelector('#customer-payment-amount')!, { target: { value } } as any)); await flush(); };
beforeEach(() => {
  runtimeResponse = null; networkError = false; isAdminOrOwner = true;
  cardProps = null; configured = false; finalized = false; success.mockReset();
  previewError = ''; noPayable = false; posts = []; failPost = false;
  Object.defineProperty(window.crypto, 'randomUUID', { configurable: true, value: jest.fn(() => 'request-key') });
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  (apiFetch as jest.Mock).mockImplementation(async (_path, options) => {
    const body = JSON.parse(options.body);
    if (_path.endsWith('/runtime-config')) {
      if (networkError) throw new Error('offline');
      if (runtimeResponse) return { ok: runtimeResponse.status === 200, status: runtimeResponse.status,
        json: async () => ({ code: runtimeResponse!.code, error: runtimeResponse!.error, ...(runtimeResponse!.invalid ? { data: {} } : {}) }) };
      return configured ? { ok: true, status: 200, json: async () => ({ data: { provider: 'stripe', mode: 'test', publishableKey: 'pk_test_fixture', connectedAccountId: 'acct_fixture', readyForPayments: true } }) }
        : { ok: false, status: 409, json: async () => ({ code: 'STRIPE_SERVER_NOT_CONFIGURED', error: 'Stripe platform server configuration is unavailable.' }) };
    }
    if (_path.endsWith('/stripe/status')) return { ok: true, json: async () => ({ data: { finalized, allocations: eligible } }) };
    if (_path.endsWith('/preview')) {
      if (previewError) return { ok: false, json: async () => ({ error: previewError }) };
      return { ok: true, json: async () => ({ data: { customerId: 'customer', selectedCount: 5, eligibleCount: noPayable ? 0 : 3, excludedCount: noPayable ? 5 : 2,
        totalOutstandingCents: noPayable ? 0 : 42500, message: noPayable ? 'No selected invoices have an open balance.' : null,
        invoices: noPayable ? [] : eligible, allocations: noPayable ? [] : allocateCustomerPayment({ invoices: eligible, amountCents: Math.min(body.amountCents,42500), mode: body.allocationMode }) } }) };
    }
    posts.push({ body, key: options.headers['Idempotency-Key'] });
    if (failPost) throw new Error('Connection interrupted');
    return { ok: true, json: async () => ({ data: { appliedAmountCents: 32500, changeDueCents: 17500 } }) };
  });
});
afterEach(() => { if (root) act(() => root.unmount()); document.body.innerHTML = ''; jest.restoreAllMocks(); jest.clearAllMocks(); });
test('broad selection shows payable/excluded counts and canonical partial/overpayment previews', async () => {
  await render();
  expect(document.body.textContent).toContain('5 invoices selected');
  expect(document.body.textContent).toContain('3 payable invoices · 2 paid/non-payable invoices excluded');
  await enter('300');
  expect(document.body.textContent).toContain('Invoice B: $100.00');
  expect(document.body.textContent).toContain('Invoice D: $200.00');
  expect(document.body.textContent).not.toContain('Invoice E:');
  await enter('500');
  expect(document.body.textContent).toContain('Change due / unapplied: $75.00');
  expect(document.body.textContent).toContain('Invoice E: $75.00');
});
test('all paid is a useful empty state with posting disabled', async () => {
  noPayable = true; await render(); await enter('100');
  expect(document.body.textContent).toContain('No selected invoices have an open balance.');
  expect(button('Record Payment').disabled).toBe(true); expect(posts).toHaveLength(0);
});
test('mixed Customer rejection cannot post a stale valid preview', async () => {
  await render(); await enter('300'); previewError = 'All selected invoices must belong to the same customer.'; await enter('301');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('same customer');
  expect(button('Record Payment').disabled).toBe(true);
});
test('double click posts once, includes broad selection/tender, and reports authoritative recomputed change', async () => {
  await render(); await enter('500');
  await act(async () => { button('Record Payment').click(); button('Record Payment').click(); }); await flush();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ key: 'request-key', body: { invoiceIds: ids, amountCents: 50000, expectedCustomerId: 'customer', expectedRemainingCents: { b: 10000, d: 25000, e: 7500 } } });
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: '$325.00 applied. Change / unapplied: $175.00.' }));
});
test('uncertain network retry reuses the same idempotency key', async () => {
  await render(); await enter('300'); failPost = true;
  await act(async () => button('Record Payment').click()); await flush();
  expect(document.body.textContent).toContain('Connection interrupted');
  failPost = false; await act(async () => button('Record Payment').click()); await flush();
  expect(posts).toHaveLength(2); expect(posts[0].key).toBe(posts[1].key); expect(window.crypto.randomUUID).toHaveBeenCalledTimes(1);
});

const selectCard = async () => {
  await act(async () => Simulate.change(document.querySelector('select')!, { target: { value: 'credit_card' } } as any));
  await flush();
};
const expectNoGateway = () => {
  expect(cardProps).toBeNull(); expect(posts).toHaveLength(0);
  expect((apiFetch as jest.Mock).mock.calls.some(([path]) => /create-intent|\/confirm$|\/recover$/.test(path))).toBe(false);
};
test('DEV-like unconfigured Stripe keeps Credit Card visible, explains setup and never opens checkout', async () => {
  await render();
  expect(Array.from(document.querySelectorAll('select')[0].options).map(o => [o.value, o.textContent]))
    .toEqual(staffPaymentMethodDefinitions.map(m => [m.id, m.label]));
  await selectCard();
  expect(document.body.textContent).toContain('No configured card processor is currently available');
  expect(document.querySelector('a')?.getAttribute('href')).toBe('/settings/integrations');
  expect(button('Continue to Card Payment').disabled).toBe(true);
  await act(async () => button('Continue to Card Payment').click());
  expectNoGateway();
});
test('unconfigured Stripe offers Settings only to a tenant administrator', async () => {
  isAdminOrOwner = false; await render(); await selectCard();
  expect(document.body.textContent).toContain('No configured card processor');
  expect(document.querySelector('a[href="/settings/integrations"]')).toBeNull(); expectNoGateway();
});
test.each([
  [403, 'INVOICE_ACTION_PERMISSION_REQUIRED', 'Forbidden', 'You do not have permission'],
  [401, undefined, 'Unauthorized', 'Your session has expired'],
  [409, 'INVOICE_NOT_PAYABLE', 'Invoice is no longer payable.', 'Invoice is no longer payable.'],
  [404, 'INVOICE_NOT_FOUND', 'One or more invoices are unavailable.', 'One or more invoices are unavailable.'],
  [500, undefined, 'Internal failure', 'Unable to load payment configuration'],
] as const)('availability response %s/%s explains the actual failure without a gateway request', async (status, code, error, message) => {
  configured = true; runtimeResponse = { status, code, error };
  await render(); await selectCard();
  expect(document.body.textContent).toContain(message);
  expect(document.body.textContent).not.toContain('No configured card processor');
  expect(document.querySelector('a[href="/settings/integrations"]')).toBeNull();
  expect(button('Continue to Card Payment').disabled).toBe(true); expectNoGateway();
});
test('network failure is retryable and a fresh successful check enables grouped checkout', async () => {
  configured = true; networkError = true; await render(); await selectCard();
  expect(document.body.textContent).toContain('Check your connection and retry');
  expect(button('Continue to Card Payment').disabled).toBe(true); expectNoGateway();
  networkError = false;
  await act(async () => button('Retry availability check').click()); await flush(); await flush();
  expect(button('Continue to Card Payment').disabled).toBe(false);
  await act(async () => button('Continue to Card Payment').click()); await flush();
  expect(cardProps.groupedApiBasePath).toBe('/api/invoices/customer-payment/stripe');
});
test('malformed configuration is an error, never an executable option', async () => {
  runtimeResponse = { status: 200, invalid: true }; await render(); await selectCard();
  expect(document.body.textContent).toContain('invalid response');
  expect(button('Continue to Card Payment').disabled).toBe(true); expectNoGateway();
});
test('no eligible invoices explains eligibility even though Credit Card remains visible', async () => {
  noPayable = true; await render(); await selectCard();
  expect(document.body.textContent).toContain('No selected invoices have eligible open balances');
  expect(button('Continue to Card Payment').disabled).toBe(true);
  expect((apiFetch as jest.Mock).mock.calls.some(([path]) => path.endsWith('/runtime-config'))).toBe(false);
  expectNoGateway();
});
test('staff selects Credit Card, reviews full balances, and reuses hosted grouped dialog with saved readback', async () => {
  configured = true; await render();
  const select = document.querySelector('select')!;
  await act(async () => Simulate.change(select, { target: { value: 'credit_card' } } as any)); await flush();
  expect(document.querySelector('#customer-payment-amount')).toBeNull();
  expect(document.body.textContent).toContain('Full invoice balances · $425.00 total');
  await act(async () => button('Continue to Card Payment').click()); await flush();
  expect(cardProps).toMatchObject({ groupedInitiation: true, groupedApiBasePath: '/api/invoices/customer-payment/stripe',
    invoiceIds: ['b', 'd', 'e'], checkoutKey: 'request-key' });
  expect(cardProps.invoiceSummaries.map((x: any) => x.amountDue)).toEqual([100,250,75]);
  let outcome: any;
  await act(async () => { outcome = await cardProps.onSettled({ serverConfirmed: true, paymentIntentId: 'pi' }); });
  expect(outcome).toEqual({ reconciled: false }); expect(success).not.toHaveBeenCalled();
  finalized = true;
  await act(async () => { outcome = await cardProps.onSettled({ serverConfirmed: false, paymentIntentId: 'pi' }); });
  expect(outcome).toEqual({ reconciled: true }); expect(success).toHaveBeenCalledTimes(1); expect(posts).toHaveLength(0);
});
