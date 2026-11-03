import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
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
const acceptChange = async () => { await act(async () => (document.querySelector('input[type=checkbox]') as HTMLInputElement).click()); await flush(); };
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
const render = async (selectedIds = ids) => {
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><MultiInvoicePaymentDialog open onOpenChange={jest.fn()} invoiceIds={selectedIds} onSuccess={success} /></QueryClientProvider>));
  await flush();
};
const enter = async (value: string) => { await act(async () => Simulate.change(document.querySelector('#customer-payment-amount')!, { target: { value } } as any)); await flush(); };
beforeEach(() => {
  runtimeResponse = null; networkError = false; isAdminOrOwner = true;
  cardProps = null; configured = false; finalized = false; success.mockReset();
  previewError = ''; noPayable = false; posts = []; failPost = false;
  Object.defineProperty(window.crypto, 'randomUUID', { configurable: true, value: jest.fn(() => 'request-key') });
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  (apiFetch as jest.Mock<(_path: string, options: any) => Promise<any>>).mockImplementation(async (_path, options) => {
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
        customerName: 'Canonical Buyer', totalOutstandingCents: noPayable ? 0 : 42500, message: noPayable ? 'No selected invoices have an open balance.' : null,
        invoices: noPayable ? [] : eligible, allocations: noPayable ? [] : allocateCustomerPayment({ invoices: eligible, amountCents: Math.min(body.amountCents,42500), mode: body.allocationMode }) } }) };
    }
    posts.push({ body, key: options.headers['Idempotency-Key'] });
    if (failPost) throw new Error('Connection interrupted');
    return { ok: true, json: async () => ({ data: { appliedAmountCents: 42500, changeDueCents: 7500 } }) };
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
  expect(document.body.textContent).toContain('Unresolved funds: $75.00');
  expect(button('Record Payment').disabled).toBe(true); await acceptChange();
  expect(document.body.textContent).toContain('Change due: $75.00');
  expect(document.body.textContent).toContain('Unresolved funds: $0.00');
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
test('double click posts once with confirmed allocations, broad selection and explicit returned change', async () => {
  await render(); await enter('500'); await acceptChange();
  await act(async () => { button('Record Payment').click(); button('Record Payment').click(); }); await flush();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ key: 'request-key', body: { invoiceIds: ids, amountCents: 50000, expectedCustomerId: 'customer', expectedRemainingCents: { b: 10000, d: 25000, e: 7500 } } });
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: '$425.00 applied. Change due: $75.00. No account credit created.' }));
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
  expect((apiFetch as jest.Mock<(_path: string, options: any) => Promise<any>>).mock.calls.some(([path]) => /create-intent|\/confirm$|\/recover$/.test(path))).toBe(false);
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
] as Array<[number, string | undefined, string, string]>)('availability response %s/%s explains the actual failure without a gateway request', async (status, code, error, message) => {
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
  expect((apiFetch as jest.Mock<(_path: string, options: any) => Promise<any>>).mock.calls.some(([path]) => path.endsWith('/runtime-config'))).toBe(false);
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

test('one-invoice entry uses the same customer payment preview and canonical submit once', async () => {
 (apiFetch as jest.Mock<(_path: string, options: any) => Promise<any>>).mockImplementation(async (path, options) => {
   const body=JSON.parse(options.body);
   if(path.endsWith('/runtime-config')) return {ok:false,status:409,json:async()=>({code:'STRIPE_SERVER_NOT_CONFIGURED'})};
   if(path.endsWith('/preview')) return {ok:true,json:async()=>({data:{customerId:'customer',selectedCount:1,eligibleCount:1,excludedCount:0,totalOutstandingCents:10000,invoices:[eligible[0]],allocations:allocateCustomerPayment({invoices:[eligible[0]],amountCents:body.amountCents,mode:body.allocationMode})}})};
   posts.push({body,key:options.headers['Idempotency-Key']});return {ok:true,json:async()=>({data:{appliedAmountCents:4000,changeDueCents:0}})};
 });
 await render(['b']);await enter('40');await act(async()=>{button('Record Payment').click();button('Record Payment').click();});await flush();expect(posts).toHaveLength(1);expect(posts[0].body).toMatchObject({invoiceIds:['b'],amountCents:4000,expectedCustomerId:'customer',expectedRemainingCents:{b:10000}});expect(success).toHaveBeenCalledTimes(1);
});


const chooseMode = async (mode: string) => { await act(async()=>Simulate.change(document.querySelectorAll('select')[1], {target:{value:mode}} as any)); await flush(); };
const editCustom = async (invoice: string, value: string) => { await act(async()=>Simulate.change(document.querySelector(`input[aria-label="Allocation for invoice ${invoice}"]`)!,{target:{value}} as any)); await flush(); };

test('custom totals and unresolved money update immediately, preserve adjustments, and block invalid posting',async()=>{
 await render();await enter('300');await chooseMode('custom');
 expect((document.querySelector('input[aria-label="Allocation for invoice B"]') as HTMLInputElement).value).toBe('100.00');
 await editCustom('B','50');expect(document.body.textContent).toContain('Applied to invoices: $250.00');expect(document.body.textContent).toContain('Unresolved funds: $50.00');expect(button('Record Payment').disabled).toBe(true);
 await editCustom('E','50');expect(button('Record Payment').disabled).toBe(false);expect(document.body.textContent).toContain('Applied to invoices: $300.00');
 await enter('301');expect((document.querySelector('input[aria-label="Allocation for invoice B"]') as HTMLInputElement).value).toBe('50');expect(button('Record Payment').disabled).toBe(true);
 await enter('300');await act(async()=>button('Record Payment').click());await flush();
 expect(posts[0].body).toMatchObject({allocationMode:'custom',customAllocations:[{invoiceId:'b',amountCents:5000},{invoiceId:'d',amountCents:20000},{invoiceId:'e',amountCents:5000}],expectedAllocations:[{invoiceId:'b',amountCents:5000},{invoiceId:'d',amountCents:20000},{invoiceId:'e',amountCents:5000}]});
});

test('confirmation shows customer, received amount, date/reference and every allocation; cancellation never posts',async()=>{
 await render();await enter('300');
 await act(async()=>Simulate.change(document.querySelector('#customer-payment-reference')!,{target:{value:'CashApp-REF-1'}} as any));
 await act(async()=>Simulate.change(document.querySelector('#customer-payment-date')!,{target:{value:'2026-06-15T10:30'}} as any));
 jest.mocked(window.confirm).mockReturnValueOnce(false);await act(async()=>button('Record Payment').click());expect(posts).toHaveLength(0);
 const message=jest.mocked(window.confirm).mock.calls.at(-1)![0]!;
 for(const text of ['Canonical Buyer','Payment received: $300.00','Method: Check','CashApp-REF-1','Invoice B: $100.00','Invoice D: $200.00','Invoice E: $0.00','Total applied: $300.00','Remaining invoice balance: $125.00','No account credit will be created'])expect(message).toContain(text);
 await act(async()=>button('Record Payment').click());await flush();expect(posts[0].body.reference).toBe('CashApp-REF-1');expect(posts[0].body.appliedAt).toBe(new Date('2026-06-15T10:30').toISOString());expect(posts).toHaveLength(1);
});

test('changing money invalidates a previous change disposition and malformed input cannot post',async()=>{
 await render();await enter('500');await acceptChange();expect(button('Record Payment').disabled).toBe(false);await enter('501');expect(button('Record Payment').disabled).toBe(true);expect((document.querySelector('input[type=checkbox]') as HTMLInputElement).checked).toBe(false);
 await enter('300.001');expect(button('Record Payment').disabled).toBe(true);expect(document.body.textContent).toContain('at most two decimal places');expect(posts).toHaveLength(0);
});

test('failed posting and explicit preview refresh retain custom allocations, date, notes and reference',async()=>{
 await render();await enter('300');await chooseMode('custom');await editCustom('B','50');await editCustom('E','50');
 await act(async()=>Simulate.change(document.querySelector('#customer-payment-reference')!,{target:{value:'retain-ref'}} as any));await act(async()=>Simulate.change(document.querySelector('#customer-payment-notes')!,{target:{value:'Cash App'}} as any));
 failPost=true;await act(async()=>button('Record Payment').click());await flush();await act(async()=>button('Refresh preview').click());await flush();
 expect((document.querySelector('input[aria-label="Allocation for invoice B"]') as HTMLInputElement).value).toBe('50');expect((document.querySelector('#customer-payment-reference') as HTMLInputElement).value).toBe('retain-ref');expect((document.querySelector('#customer-payment-notes') as HTMLInputElement).value).toBe('Cash App');
 failPost=false;await act(async()=>button('Record Payment').click());await flush();expect(posts[0].key).toBe(posts[1].key);expect(posts[1].body.notes).toBe('Cash App');
});
