import { beforeEach, expect, jest, test } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

let invoiceRows: Record<string, unknown>[] = [];
let paymentRows: Record<string, unknown>[] = [];
let batch: Record<string, unknown> | null = null;
const stripeRetrieve = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const stripeCreate = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const runtime = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const applyObservation = jest.fn<(...args: any[]) => Promise<unknown>>();
const writes: string[] = [];
const predicates: Array<{ sql: string; params: unknown[] }> = [];
const query = (fields?: Record<string, unknown>) => {
  let result: unknown[] = [];
  const q: any = {
    from: (table: any) => {
      const name = getTableName(table);
      result = name === 'invoices' ? invoiceRows.splice(0, 1) : name === 'payments' ? (fields && Object.keys(fields).length === 2 ? [] : paymentRows) : name === 'customer_payment_batches' && batch ? [batch] : [];
      return q;
    },
    leftJoin: () => q, where: (condition: any) => { predicates.push(new PgDialect().sqlToQuery(condition)); return q; }, orderBy: () => q,
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
jest.unstable_mockModule('../services/stripePaymentReconciliationService', () => ({ captureAndApply: applyObservation }));
const service = await import('../services/portal.service');
const invoice = (approved = false, id = 'invoice') => ({ id, storedCustomerId: 'customer', billingCustomerId: 'customer', status: 'billed', totalCents: 25000, currency: 'USD', invoiceVersion: 2, accountingApprovedAt: approved ? new Date() : null, accountingApprovedVersion: approved ? 2 : null });
const request = (body: Record<string, unknown> = {}) => ({ organizationId: 'org', user: { id: 'user' }, portalCustomerId: 'customer', portalCustomer: { id: 'customer', organizationId: 'org' }, body } as any);
beforeEach(() => {
  invoiceRows = []; paymentRows = []; batch = null; writes.length = 0; predicates.length = 0;
  stripeRetrieve.mockReset().mockResolvedValue({ status: 'requires_payment_method', amount: 25000, client_secret: 'pi_fixture_secret_fixture', metadata: { organizationId: 'org', customerId: 'customer', invoiceId: 'invoice' } });
  stripeCreate.mockReset().mockResolvedValue({ id: 'pi_fixture', status: 'requires_payment_method', client_secret: 'pi_fixture_secret_fixture' });
  runtime.mockReset().mockResolvedValue({ ok: true, data: { connectedAccountId: 'acct_fixture' } });
  applyObservation.mockReset().mockImplementation(async () => {
    paymentRows = paymentRows.map(row => ({ ...row, status: 'succeeded' }));
    return { applied: true };
  });
});

test('release makes an unapproved draft visible on list/detail with its PDF and remaining balance', async () => {
  const released = { ...invoice(), status: 'draft', customerReleasedAt: new Date(), invoiceNumber: 20001 };
  invoiceRows.push(invoice());
  expect(await service.listPortalInvoices(request())).toEqual([]);
  invoiceRows.push(released);
  expect(await service.listPortalInvoices(request())).toMatchObject([{ id: 'invoice', pdfAvailable: true, amountDue: 250, paymentEligibility: { payable: true } }]);
  invoiceRows.push(released);
  expect(await service.getPortalInvoice(request(), 'invoice')).toMatchObject({ id: 'invoice', pdfAvailable: true });
  expect(predicates.some(p => p.params.includes('org') && p.params.includes('customer') && p.params.includes('invoice'))).toBe(true);
  invoiceRows.push(invoice());
  expect(await service.getPortalInvoice(request(), 'invoice')).toBeNull();
});

test.each(['pdf', 'files', 'payments'])('unreleased unapproved invoice is hidden at %s even with a known ID', async surface => {
  invoiceRows.push(invoice());
  const call = surface === 'pdf' ? service.getPortalInvoicePdf : surface === 'files' ? service.listPortalInvoiceFiles : service.listPortalInvoicePayments;
  expect(await call(request(), 'invoice')).toBeNull();
});

test('released draft exposes its canonical PDF file without changing invoice state', async () => {
  invoiceRows.push({ ...invoice(), status: 'draft', customerReleasedAt: new Date() });
  expect(await service.listPortalInvoiceFiles(request(), 'invoice')).toHaveLength(1);
  expect(writes).toEqual([]);
});

test('released unapproved guest invoice can open the same Stripe runtime', async () => {
  invoiceRows.push({ ...invoice(), customerReleasedAt: new Date() });
  const req = { guestPaymentScope: { organizationId: 'org', customerId: 'customer', invoiceId: 'invoice', userId: null } } as any;
  expect(await service.getPortalStripeRuntimeConfig(req, 'invoice')).toEqual({ connectedAccountId: 'acct_fixture' });
  expect(predicates.some(p => p.params.includes('org') && p.params.includes('customer') && p.params.includes('invoice'))).toBe(true);
});

test('mixed released-unapproved and approved invoices use one canonical grouped intent', async () => {
  invoiceRows.push({ ...invoice(false, 'a'), customerReleasedAt: new Date() }, invoice(true, 'b'));
  const result = await service.createPortalGroupedStripePaymentIntent(request({ invoiceIds: ['a', 'b'], idempotencyKey: 'release-fixture' }));
  expect(result).toMatchObject({ amount: 500, allocations: [{ invoiceId: 'a', amountCents: 25000 }, { invoiceId: 'b', amountCents: 25000 }] });
  expect(stripeCreate).toHaveBeenCalledTimes(1);
  expect(writes).not.toContain('invoices');
});

test('released unapproved invoice reuses existing intent and revalidates stale balances', async () => {
  const released = { ...invoice(), customerReleasedAt: new Date() };
  invoiceRows.push(released);
  paymentRows = [{ id: 'payment', status: 'pending', amountCents: 25000, stripePaymentIntentId: 'pi_fixture', metadata: { customerId: 'customer' } }];
  expect(await service.createPortalStripePaymentIntent(request(), 'invoice')).toMatchObject({ paymentId: 'payment', amount: 250 });
  expect(stripeCreate).not.toHaveBeenCalled();
  invoiceRows.push({ ...released, totalCents: 20000 });
  await expect(service.validatePortalStripePayment(request({ paymentIntentId: 'pi_fixture' }), 'invoice')).rejects.toThrow('Payment context changed');
});

test('released-unapproved success delegates to canonical application then reloads paid state', async () => {
  const released = { ...invoice(), customerReleasedAt: new Date(), invoiceNumber: 20001 };
  invoiceRows.push(released, { ...released, status: 'paid' });
  paymentRows = [{ id: 'payment', invoiceId: 'invoice', status: 'pending', provider: 'stripe', amountCents: 25000, currency: 'USD', stripePaymentIntentId: 'pi_fixture', metadata: { customerId: 'customer', stripeAccountId: 'acct_fixture' } }];
  stripeRetrieve.mockResolvedValue({ id: 'pi_fixture', status: 'succeeded', amount_received: 25000, metadata: { organizationId: 'org', customerId: 'customer', invoiceId: 'invoice' } });
  const result = await service.confirmPortalStripePayment(request({ paymentIntentId: 'pi_fixture' }), 'invoice');
  expect(applyObservation).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org', invoiceId: 'invoice', paymentIntentId: 'pi_fixture', amountCents: 25000 }));
  expect(result).toMatchObject({ payment: { status: 'succeeded' }, invoice: { amountDue: 0, paymentStatusLabel: 'Paid' } });
  expect(writes).not.toContain('invoices');
});
test.each(['runtime', 'create', 'confirm', 'validate'])('stale portal client cannot bypass approval at %s', async entry => {
  invoiceRows.push(invoice());
  const req = request({ paymentIntentId: 'pi_fixture' });
  const call = entry === 'runtime' ? service.getPortalStripeRuntimeConfig : entry === 'create' ? service.createPortalStripePaymentIntent : entry === 'confirm' ? service.confirmPortalStripePayment : service.validatePortalStripePayment;
  await expect(call(req, 'invoice')).rejects.toThrow('Not released to customer');
  expect(runtime).not.toHaveBeenCalled(); expect(stripeCreate).not.toHaveBeenCalled(); expect(stripeRetrieve).not.toHaveBeenCalled();
  expect(writes).toEqual([]);
});
test('guest scope uses the same approval gate', async () => {
  invoiceRows.push(invoice());
  const req = { guestPaymentScope: { organizationId: 'org', customerId: 'customer', userId: null } } as any;
  await expect(service.createPortalStripePaymentIntent(req, 'invoice')).rejects.toThrow('Not released to customer');
  expect(stripeCreate).not.toHaveBeenCalled();
});
test('grouped checkout rejects one unapproved member before creating a batch or intent', async () => {
  invoiceRows.push(invoice(true, 'a'), invoice(false, 'b'));
  await expect(service.createPortalGroupedStripePaymentIntent(request({ invoiceIds: ['a', 'b'], idempotencyKey: 'fixture-key' }))).rejects.toThrow('Not released to customer');
  expect(writes).toEqual([]); expect(stripeCreate).not.toHaveBeenCalled();
});
test('all approved grouped invoices retain canonical allocations and create exactly one intent', async () => {
  invoiceRows.push(invoice(true, 'a'), invoice(true, 'b'));
  const result = await service.createPortalGroupedStripePaymentIntent(request({ invoiceIds: ['a', 'b'], idempotencyKey: 'fixture-key' }));
  expect(result).toMatchObject({ amount: 500, allocations: [{ invoiceId: 'a', amountCents: 25000 }, { invoiceId: 'b', amountCents: 25000 }] });
  expect(stripeCreate).toHaveBeenCalledTimes(1);
});

test('portal Order authorization cannot conceal stale stored Invoice ownership before checkout', async () => {
  invoiceRows.push({ ...invoice(true), storedCustomerId: 'old-customer' });
  await expect(service.createPortalGroupedStripePaymentIntent(request({ invoiceIds: ['invoice'], idempotencyKey: 'fixture-key' })))
    .rejects.toThrow('billing details need staff review');
  expect(stripeCreate).not.toHaveBeenCalled(); expect(writes).toEqual([]);
});

test('an old Customer batch cannot be reused by the current authorized Customer', async () => {
  invoiceRows.push(invoice(true));
  batch = { id: 'old-batch', status: 'pending', customerId: 'old-customer', amountCents: 25000,
    stripeAccountId: 'acct_fixture', currency: 'USD', providerEvidence: { allocations: [{ invoiceId: 'invoice', amountCents: 25000 }] } };
  await expect(service.createPortalGroupedStripePaymentIntent(request({ invoiceIds: ['invoice'], idempotencyKey: 'fixture-key' })))
    .rejects.toThrow('no longer matches');
  expect(stripeCreate).not.toHaveBeenCalled(); expect(stripeRetrieve).not.toHaveBeenCalled(); expect(writes).toEqual([]);
});
test('an approved invoice can reuse an incomplete intent; new approval is observed on requery', async () => {
  invoiceRows.push(invoice(), invoice(true));
  paymentRows = [{ id: 'payment', status: 'pending', amountCents: 25000, stripePaymentIntentId: 'pi_fixture', metadata: { customerId: 'customer' } }];
  await expect(service.createPortalStripePaymentIntent(request(), 'invoice')).rejects.toThrow('Not released to customer');
  await expect(service.createPortalStripePaymentIntent(request(), 'invoice')).resolves.toMatchObject({ paymentId: 'payment', amount: 250 });
  expect(stripeCreate).not.toHaveBeenCalled();
});
test.each(['validate', 'confirm'])('open grouped checkout checks persisted members again at %s', async action => {
  invoiceRows.push(invoice(true, 'a'), invoice(false, 'b'));
  batch = { id: 'batch', status: 'pending', stripeAccountId: 'acct_fixture', providerEvidence: { allocations: [{ invoiceId: 'a', amountCents: 25000 }, { invoiceId: 'b', amountCents: 25000 }] } };
  const call = action === 'validate' ? service.validatePortalGroupedStripePayment : service.confirmPortalGroupedStripePayment;
  await expect(call(request({ paymentIntentId: 'pi_fixture' }))).rejects.toThrow('Not released to customer');
  expect(stripeRetrieve).not.toHaveBeenCalled();
});
