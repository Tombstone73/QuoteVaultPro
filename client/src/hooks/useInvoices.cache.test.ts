import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { QueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/queryClient';
import {
  InvoiceDetailRequestError,
  useApproveInvoicesForAccounting,
  useBulkMarkInvoicesSent,
  useCancelInvoiceEmailQueueJobs,
  useInvoice,
  useInvoiceEmailDraft,
  useInvoiceEmailQueue,
  useInvoiceEmailRecipients,
  useInvoicePayments,
  useInvoiceReminderHistory,
  useInvoices,
  useInvoicesPage,
  useQueueInvoiceQbSync,
  useRecordCustomerInvoicePayment,
  useRecordManualInvoicePayment,
  useRecoverStripeInvoiceRefund,
  useRetryInvoiceQbSync,
  useSendInvoice,
  useStripeInvoiceRefundRequests,
} from './useInvoices';

let queryClient: QueryClient;
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual<typeof import('@tanstack/react-query')>('@tanstack/react-query'),
  useQueryClient: () => queryClient,
  useMutation: (options: unknown) => options,
  useQuery: (options: unknown) => options,
}));
jest.mock('@/lib/queryClient', () => ({ apiFetch: jest.fn(), apiRequest: jest.fn() }));

const fetch = jest.mocked(apiFetch);
const invoiceId = 'invoice-a';

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function queryOptions(result: unknown) {
  return result as {
    queryKey: readonly unknown[];
    queryFn: () => Promise<unknown>;
    enabled?: boolean;
    refetchInterval?: (query: { state: { data?: unknown } }) => number | false;
    refetchOnMount?: string;
    staleTime?: number;
  };
}

function mutationOptions<T>(result: { mutate: (variables: T) => void }) {
  return result as unknown as {
    mutationFn: (variables: T) => Promise<unknown>;
    onSuccess?: (data: unknown, variables: T) => unknown;
    onSettled?: (data: unknown, error: Error | null, variables: T) => unknown;
  };
}

beforeEach(() => {
  queryClient = new QueryClient();
  fetch.mockReset();
});

describe('staff invoice query cache contract', () => {
  test('keeps the existing read keys, disabled states, and query refresh options', () => {
    const filters = { orderId: 'order-a' };
    const detail = queryOptions(useInvoice(undefined));
    const list = queryOptions(useInvoicesPage(filters));
    const queue = queryOptions(useInvoiceEmailQueue(true, 'active', 2));
    const closedQueue = queryOptions(useInvoiceEmailQueue(false, 'active', 2));
    const draft = queryOptions(useInvoiceEmailDraft(invoiceId, false));

    expect([
      queryOptions(useInvoices()).queryKey, list.queryKey, detail.queryKey,
      queryOptions(useInvoice(invoiceId)).queryKey, queryOptions(useInvoicePayments(invoiceId)).queryKey,
      queue.queryKey, queryOptions(useInvoiceEmailRecipients(invoiceId)).queryKey, draft.queryKey,
      queryOptions(useStripeInvoiceRefundRequests(invoiceId, true)).queryKey,
      queryOptions(useInvoiceReminderHistory(invoiceId)).queryKey,
    ]).toStrictEqual([
      ['invoices', undefined], ['invoices', filters], ['invoices', undefined],
      ['invoices', invoiceId], ['invoicePayments', invoiceId], ['invoices', 'email-queue', 'active', 2],
      ['invoices', invoiceId, 'email-recipients'], ['invoices', invoiceId, 'email-draft'],
      ['stripeInvoiceRefundRequests', invoiceId], ['invoiceReminderHistory', invoiceId],
    ]);
    expect(detail.enabled).toBe(false);
    expect(queryOptions(useInvoicePayments(undefined)).enabled).toBe(false);
    expect(draft).toMatchObject({ enabled: false, staleTime: 0, refetchOnMount: 'always' });
    const active = { state: { data: { counts: { active: 1 } } } };
    expect(queue.refetchInterval?.(active)).toBe(5000);
    expect(closedQueue.refetchInterval?.(active)).toBe(false);
    expect(queue.refetchInterval?.({ state: { data: { counts: { active: 0 } } } })).toBe(false);
    expect(list.refetchInterval?.({ state: { data: { items: [{ emailDeliveryStatus: 'retrying' }] } } })).toBe(5000);
    expect(list.refetchInterval?.({ state: { data: { items: [{ emailDeliveryStatus: 'sent' }] } } })).toBe(false);
  });

  test('loads detail and payment history without browser cache and preserves the detail error status', async () => {
    const detail = queryOptions(useInvoice(invoiceId));
    const payments = queryOptions(useInvoicePayments(invoiceId));
    fetch.mockResolvedValueOnce(response(200, { data: { invoice: { id: invoiceId } } }));
    fetch.mockResolvedValueOnce(response(200, { data: [{ id: 'payment-a' }] }));
    fetch.mockResolvedValueOnce(response(403, { error: 'Access denied' }));

    await expect(queryOptions(useInvoice(undefined)).queryFn()).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    await expect(detail.queryFn()).resolves.toEqual({ invoice: { id: invoiceId } });
    await expect(payments.queryFn()).resolves.toEqual([{ id: 'payment-a' }]);
    const error = await detail.queryFn().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(InvoiceDetailRequestError);
    expect(error).toMatchObject({ message: 'Access denied', status: 403 });
    expect(fetch.mock.calls).toStrictEqual([
      ['/api/invoices/invoice-a', { credentials: 'include', cache: 'no-store' }],
      ['/api/invoices/invoice-a/payments', { credentials: 'include', cache: 'no-store' }],
      ['/api/invoices/invoice-a', { credentials: 'include', cache: 'no-store' }],
    ]);
  });

  test('manual payment success invalidates five targets in order using prefix matching', async () => {
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const descendants = [
      ['orders', 'order-a'], ['invoices', { orderId: 'order-a' }], ['invoices', invoiceId, 'email-draft'],
      ['invoicePayments', invoiceId, 'history'], ['/api/operational-summary', 'today'],
    ];
    const unrelated = ['portal', 'invoices', invoiceId];
    for (const key of [...descendants, unrelated]) queryClient.setQueryData(key, { fixture: true });
    const mutation = mutationOptions(useRecordManualInvoicePayment());
    const variables = { invoiceId, amountCents: 500, method: 'cash', idempotencyKey: 'payment-key' };
    fetch.mockResolvedValueOnce(response(200, { payment: { invoiceId } }));
    const result = await mutation.mutationFn(variables);
    expect(fetch).toHaveBeenCalledWith('/api/invoices/invoice-a/payments/manual', expect.objectContaining({
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'payment-key' },
      body: JSON.stringify({ amountCents: 500, method: 'cash' }), credentials: 'include',
    }));
    expect(invalidate).not.toHaveBeenCalled();

    expect(mutation.onSuccess?.(result, variables)).toBeUndefined();
    expect(invalidate.mock.calls).toStrictEqual([
      [{ queryKey: ['orders'] }], [{ queryKey: ['invoices'] }], [{ queryKey: ['invoices', invoiceId] }],
      [{ queryKey: ['invoicePayments', invoiceId] }], [{ queryKey: ['/api/operational-summary'] }],
    ]);
    expect(descendants.map((key) => queryClient.getQueryState(key)?.isInvalidated)).toEqual(Array(5).fill(true));
    expect(queryClient.getQueryState(unrelated)?.isInvalidated).toBe(false);
  });

  test('customer payment retains the batch, per-invoice, and customer refresh order', () => {
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    mutationOptions(useRecordCustomerInvoicePayment()).onSuccess?.({}, {
      expectedCustomerId: 'customer-a', invoiceIds: [invoiceId, 'invoice-b'], amountCents: 500,
      allocationMode: 'oldest_first', method: 'cash', idempotencyKey: 'batch-key', expectedRemainingCents: {},
    });
    expect(invalidate.mock.calls).toStrictEqual([
      [{ queryKey: ['orders'] }], [{ queryKey: ['invoices'] }], [{ queryKey: ['payments'] }],
      [{ queryKey: ['/api/customers/customer-a/transactions'] }],
      [{ queryKey: ['invoices', invoiceId] }], [{ queryKey: ['invoicePayments', invoiceId] }],
      [{ queryKey: ['invoices', 'invoice-b'] }], [{ queryKey: ['invoicePayments', 'invoice-b'] }],
      [{ queryKey: ['/api/operational-summary'] }], [{ queryKey: ['accounts-receivable-report'] }],
      [{ queryKey: ['customerFinancialExposure'] }],
    ]);
  });

  test('refund recovery refreshes invoice, Order, refund, and summary caches in order', () => {
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    mutationOptions(useRecoverStripeInvoiceRefund()).onSuccess?.({}, {
      invoiceId, paymentId: 'payment-a', refundRequestId: 'refund-a',
    });
    expect(invalidate.mock.calls).toStrictEqual([
      [{ queryKey: ['orders'] }], [{ queryKey: ['invoices'] }], [{ queryKey: ['invoices', invoiceId] }],
      [{ queryKey: ['invoicePayments', invoiceId] }], [{ queryKey: ['stripeInvoiceRefundRequests', invoiceId] }],
      [{ queryKey: ['/api/operational-summary'] }],
    ]);
  });

  test('QuickBooks queue retains both summary invalidations while retry and approval use their own targets', () => {
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    mutationOptions(useQueueInvoiceQbSync()).onSuccess?.({}, invoiceId);
    expect(invalidate.mock.calls).toStrictEqual([
      [{ queryKey: ['invoices'] }], [{ queryKey: ['invoices', invoiceId] }],
      [{ queryKey: ['/api/operational-summary'] }], [{ queryKey: ['/api/operational-summary'] }],
    ]);
    invalidate.mockClear();
    mutationOptions(useRetryInvoiceQbSync()).onSuccess?.({}, invoiceId);
    expect(invalidate.mock.calls).toStrictEqual([
      [{ queryKey: ['invoices'] }], [{ queryKey: ['invoices', invoiceId] }],
    ]);
    invalidate.mockClear();
    mutationOptions(useApproveInvoicesForAccounting()).onSuccess?.({}, [invoiceId, 'invoice-b']);
    expect(invalidate.mock.calls).toStrictEqual([
      [{ queryKey: ['invoices'] }], [{ queryKey: ['invoices', invoiceId] }], [{ queryKey: ['invoices', 'invoice-b'] }],
      [{ queryKey: ['quickbooksSyncQueue'] }],
    ]);
  });

  test('bulk mark sent refreshes the invoice list, selected details, summary, and timeline', async () => {
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const mutation = mutationOptions(useBulkMarkInvoicesSent());
    const selected = [invoiceId, 'invoice-b'];
    fetch.mockResolvedValueOnce(response(200, { data: { selected: 2, marked: 2, skipped: [] } }));
    const result = await mutation.mutationFn(selected);
    expect(fetch).toHaveBeenCalledWith('/api/invoices/mark-sent/bulk', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ invoiceIds: selected }),
    }));
    expect(invalidate).not.toHaveBeenCalled();
    mutation.onSuccess?.(result, selected);
    expect(invalidate.mock.calls).toStrictEqual([
      [{ queryKey: ['invoices'] }], [{ queryKey: ['invoices', invoiceId] }], [{ queryKey: ['invoices', 'invoice-b'] }],
      [{ queryKey: ['/api/operational-summary'] }], [{ queryKey: ['/api/timeline'] }],
    ]);
  });

  test.each([200, 409])('email queue cancellation invalidates invoices at settlement for HTTP %i', async (status) => {
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const mutation = mutationOptions(useCancelInvoiceEmailQueueJobs());
    const variables = { jobIds: ['job-a'] };
    const data = { canceled: ['job-a'] };
    fetch.mockResolvedValueOnce(response(status, { success: status === 200, data, error: 'Job already claimed' }));
    const result = mutation.mutationFn(variables);
    if (status === 200) await expect(result).resolves.toEqual(data);
    else await expect(result).rejects.toThrow('Job already claimed');
    expect(mutation.onSuccess).toBeUndefined();
    expect(invalidate).not.toHaveBeenCalled();
    await result.then(
      (value) => mutation.onSettled?.(value, null, variables),
      (error: Error) => mutation.onSettled?.(undefined, error, variables),
    );
    expect(invalidate.mock.calls).toStrictEqual([[{ queryKey: ['invoices'] }]]);
  });

  test('invoice send writes only matching list rows before the ordered invalidations', async () => {
    const listKey = ['invoices', { orderId: 'order-a' }];
    const pageKey = ['invoices', { page: 2 }];
    const detailKey = ['invoices', invoiceId];
    const queueKey = ['invoices', 'email-queue', 'active', 1];
    const row = { id: invoiceId, emailDeliveryStatus: 'failed', emailDeliveryFailureReason: 'previous' };
    const other = { id: 'invoice-b', emailDeliveryStatus: 'sent' };
    queryClient.setQueryData(listKey, [row, other]);
    queryClient.setQueryData(pageKey, { items: [row, other], pagination: { totalCount: 2 } });
    queryClient.setQueryData(detailKey, row);
    queryClient.setQueryData(queueKey, { items: [row] });
    const write = jest.spyOn(queryClient, 'setQueriesData');
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const mutation = mutationOptions(useSendInvoice());
    const variables = { id: invoiceId, idempotencyKey: 'send-key' };

    fetch.mockResolvedValueOnce(response(409, { error: 'Already queued', code: 'QUEUE_CONFLICT' }));
    await expect(mutation.mutationFn(variables)).rejects.toMatchObject({ message: 'Already queued', code: 'QUEUE_CONFLICT' });
    expect(write).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce(response(202, { success: true }));
    const accepted = await mutation.mutationFn(variables);
    expect(mutation.onSuccess?.(accepted, variables)).toBeUndefined();

    const marked = { ...row, emailDeliveryStatus: 'queued', emailDeliveryFailureReason: null, emailDeliveryUpdatedAt: expect.any(String) };
    expect(queryClient.getQueryData(listKey)).toEqual([marked, other]);
    expect(queryClient.getQueryData(pageKey)).toEqual({ items: [marked, other], pagination: { totalCount: 2 } });
    expect(queryClient.getQueryData(detailKey)).toEqual(row);
    expect(queryClient.getQueryData(queueKey)).toEqual({ items: [row] });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.invocationCallOrder[0]).toBeLessThan(invalidate.mock.invocationCallOrder[0]);
    expect(invalidate.mock.calls).toStrictEqual([
      [{ queryKey: ['invoices'] }], [{ queryKey: ['invoices', invoiceId] }],
      [{ queryKey: ['invoices', 'email-queue'] }], [{ queryKey: ['/api/operational-summary'] }],
    ]);
  });
});
