import { beforeEach, expect, jest, test } from '@jest/globals';
import { getTableName } from 'drizzle-orm';

let invoiceRows: Record<string, unknown>[] = [];
let paymentRows: Record<string, unknown>[] = [];
let batch: Record<string, unknown> | null = null;
const stripeRetrieve = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const stripeCreate = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const runtime = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const writes: string[] = [];
const query = (fields?: Record<string, unknown>) => {
  let result: unknown[] = [];
  const q: any = {
    from: (table: any) => {
      const name = getTableName(table);
      result = name === 'invoices' ? invoiceRows.splice(0, 1) : name === 'payments' ? (fields && Object.keys(fields).length === 2 ? [] : paymentRows) : name === 'customer_payment_batches' && batch ? [batch] : [];
      return q;
    },
    leftJoin: () => q, where: () => q, orderBy: () => q,
    limit: async () => result,
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return q;
};
const database: any = { select: query, execute: async () => ({}), transaction: async (work: any) => work(database),
  insert: (table: any) => ({ values: (value: any) => {
    writes.push(getTableName(table));
    return { returning: async () => [{ id: 'batch', ...value }] };
  } }),
  update: (table: any) => ({ set: () => ({ where: async () => { writes.push(getTableName(table)); } }) }),
};
jest.unstable_mockModule('../db', () => ({ db: database, pool: {}, hasQuoteAttachmentPagesTable: () => true, hasPageCountStatusColumn: () => true }));
jest.unstable_mockModule('../lib/stripe', () => ({ assertStripeServerConfig: () => ({}), getStripeWebhookSecret: () => "fixture", getStripeClient: () => ({ paymentIntents: { retrieve: stripeRetrieve, create: stripeCreate } }) }));
jest.unstable_mockModule('../services/stripeRuntimeConfig.service', () => ({ resolveStripeRuntimeConfig: runtime }));
const service = await import('../services/portal.service');
const invoice = (approved = false, id = 'invoice') => ({ id, status: 'billed', totalCents: 25000, currency: 'USD', invoiceVersion: 2, accountingApprovedAt: approved ? new Date() : null, accountingApprovedVersion: approved ? 2 : null });
const request = (body: Record<string, unknown> = {}) => ({ organizationId: 'org', user: { id: 'user' }, portalCustomerId: 'customer', portalCustomer: { id: 'customer', organizationId: 'org' }, body } as any);
beforeEach(() => {
  invoiceRows = []; paymentRows = []; batch = null; writes.length = 0;
  stripeRetrieve.mockReset().mockResolvedValue({ status: 'requires_payment_method', amount: 25000, client_secret: 'pi_fixture_secret_fixture', metadata: { organizationId: 'org', customerId: 'customer', invoiceId: 'invoice' } });
  stripeCreate.mockReset().mockResolvedValue({ id: 'pi_fixture', status: 'requires_payment_method', client_secret: 'pi_fixture_secret_fixture' });
  runtime.mockReset().mockResolvedValue({ ok: true, data: { connectedAccountId: 'acct_fixture' } });
});
test.each(['runtime', 'create', 'confirm', 'validate'])('stale portal client cannot bypass approval at %s', async entry => {
  invoiceRows.push(invoice());
  const req = request({ paymentIntentId: 'pi_fixture' });
  const call = entry === 'runtime' ? service.getPortalStripeRuntimeConfig : entry === 'create' ? service.createPortalStripePaymentIntent : entry === 'confirm' ? service.confirmPortalStripePayment : service.validatePortalStripePayment;
  await expect(call(req, 'invoice')).rejects.toThrow('Awaiting approval');
  expect(runtime).not.toHaveBeenCalled(); expect(stripeCreate).not.toHaveBeenCalled(); expect(stripeRetrieve).not.toHaveBeenCalled();
  expect(writes).toEqual([]);
});
test('guest scope uses the same approval gate', async () => {
  invoiceRows.push(invoice());
  const req = { guestPaymentScope: { organizationId: 'org', customerId: 'customer', userId: null } } as any;
  await expect(service.createPortalStripePaymentIntent(req, 'invoice')).rejects.toThrow('Awaiting approval');
  expect(stripeCreate).not.toHaveBeenCalled();
});
test('grouped checkout rejects one unapproved member before creating a batch or intent', async () => {
  invoiceRows.push(invoice(true, 'a'), invoice(false, 'b'));
  await expect(service.createPortalGroupedStripePaymentIntent(request({ invoiceIds: ['a', 'b'], idempotencyKey: 'fixture-key' }))).rejects.toThrow('Awaiting approval');
  expect(writes).toEqual([]); expect(stripeCreate).not.toHaveBeenCalled();
});
test('all approved grouped invoices retain canonical allocations and create exactly one intent', async () => {
  invoiceRows.push(invoice(true, 'a'), invoice(true, 'b'));
  const result = await service.createPortalGroupedStripePaymentIntent(request({ invoiceIds: ['a', 'b'], idempotencyKey: 'fixture-key' }));
  expect(result).toMatchObject({ amount: 500, allocations: [{ invoiceId: 'a', amountCents: 25000 }, { invoiceId: 'b', amountCents: 25000 }] });
  expect(stripeCreate).toHaveBeenCalledTimes(1);
});
test('an approved invoice can reuse an incomplete intent; new approval is observed on requery', async () => {
  invoiceRows.push(invoice(), invoice(true));
  paymentRows = [{ id: 'payment', status: 'pending', amountCents: 25000, stripePaymentIntentId: 'pi_fixture', metadata: { customerId: 'customer' } }];
  await expect(service.createPortalStripePaymentIntent(request(), 'invoice')).rejects.toThrow('Awaiting approval');
  await expect(service.createPortalStripePaymentIntent(request(), 'invoice')).resolves.toMatchObject({ paymentId: 'payment', amount: 250 });
  expect(stripeCreate).not.toHaveBeenCalled();
});
test.each(['validate', 'confirm'])('open grouped checkout checks persisted members again at %s', async action => {
  invoiceRows.push(invoice(true, 'a'), invoice(false, 'b'));
  batch = { id: 'batch', status: 'pending', stripeAccountId: 'acct_fixture', providerEvidence: { allocations: [{ invoiceId: 'a', amountCents: 25000 }, { invoiceId: 'b', amountCents: 25000 }] } };
  const call = action === 'validate' ? service.validatePortalGroupedStripePayment : service.confirmPortalGroupedStripePayment;
  await expect(call(request({ paymentIntentId: 'pi_fixture' }))).rejects.toThrow('Awaiting approval');
  expect(stripeRetrieve).not.toHaveBeenCalled();
});
