import { describe, expect, jest, test } from '@jest/globals';
import { PgDialect } from 'drizzle-orm/pg-core';
import { loadOrderPaymentSummaries } from '../services/orderPaymentSummary';

describe('Order payment evidence loader', () => {
  test('batches associated Invoices and scopes the payment read to tenant and Invoice IDs', async () => {
    const where = jest.fn(async (_query: unknown) => [
      { id: 'payment-a', invoiceId: 'invoice-a', status: 'succeeded', amountCents: 50000 },
      { id: 'payment-b', invoiceId: 'invoice-b', status: 'succeeded', amountCents: 2500 },
    ]);
    const select = jest.fn(() => ({ from: () => ({ where }) }));
    const summaries = await loadOrderPaymentSummaries({ select } as any, 'tenant-a', [
      { id: 'invoice-a', orderId: 'order-a', totalCents: 50000, status: 'paid' },
      { id: 'invoice-a-additional', orderId: 'order-a', totalCents: 10000, status: 'billed' },
      { id: 'invoice-b', orderId: 'order-b', totalCents: 2500, status: 'billed' },
    ]);
    expect(summaries.get('order-a')).toMatchObject({ status: 'partial', paidCents: 50000, remainingCents: 10000 });
    expect(summaries.get('order-b')).toMatchObject({ status: 'paid', remainingCents: 0 });
    expect(select).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0] as any);
    expect(query.params).toEqual(['tenant-a', 'invoice-a', 'invoice-a-additional', 'invoice-b']);
    expect(query.sql).toContain('"organization_id"');
    expect(query.sql).toContain('"invoice_id"');
  });

  test('no Invoice requires no payment query', async () => {
    const select = jest.fn();
    expect((await loadOrderPaymentSummaries({ select } as any, 'tenant-a', [])).size).toBe(0);
    expect(select).not.toHaveBeenCalled();
  });
});
