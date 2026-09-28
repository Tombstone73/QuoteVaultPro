import { describe, expect, jest, test } from '@jest/globals';
import {
  useRecordManualInvoicePayment, useRecordCustomerInvoicePayment, useVoidInvoicePayment,
  useInitiateStripeInvoiceRefund, useRecoverStripeInvoiceRefund, useApplyInvoicePayment,
  useCreateInvoice, useCreateOrderInvoice, useUpdateInvoice, useDeleteInvoice, useRefreshInvoiceStatus,
} from './useInvoices';
import { useRecordEpsHostedResult } from './usePaymentSettings';

const mockInvalidateQueries = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  useMutation: (options: unknown) => options,
  useQuery: jest.fn(),
}));
jest.mock('@/lib/queryClient', () => ({ apiFetch: jest.fn(), apiRequest: jest.fn() }));

describe('Order payment display cache refresh', () => {
  test.each([
    useRecordManualInvoicePayment, useRecordCustomerInvoicePayment, useVoidInvoicePayment,
    useInitiateStripeInvoiceRefund, useRecoverStripeInvoiceRefund, useApplyInvoicePayment,
    useCreateInvoice, useCreateOrderInvoice, useUpdateInvoice, useDeleteInvoice, useRefreshInvoiceStatus,
    useRecordEpsHostedResult,
  ])('%p invalidates Order detail/list projections after success', (hook) => {
    mockInvalidateQueries.mockClear();
    const mutation = hook() as any;
    mutation.onSuccess({ payment: { invoiceId: 'invoice-a' } }, { invoiceId: 'invoice-a', invoiceIds: ['invoice-a'], orderId: 'order-a', id: 'invoice-a' });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['orders'] });
  });
});
