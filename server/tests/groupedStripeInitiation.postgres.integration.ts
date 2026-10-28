import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { customerPaymentBatches, customers, invoices, organizations, users, payments, stripePaymentAttempts, integrationConnections, paymentWebhookEvents } from '../../shared/schema';

const intents = new Map<string, any>();
const keys = new Map<string, any>();
let loseResponse = false;
let verifyProviderLocks = false;
const create = jest.fn<any>(async (data: any, options: any) => {
  if (verifyProviderLocks) {
    // A separate DB connection must acquire the same invoice lock during Stripe I/O.
    let ids = data.metadata.invoiceId ? [data.metadata.invoiceId] : [];
    if (data.metadata.customerPaymentBatchId) {
      const [batch] = await db.select().from(customerPaymentBatches).where(eq(customerPaymentBatches.id, data.metadata.customerPaymentBatchId));
      ids = (batch.providerEvidence.allocations as Array<{ invoiceId: string }>).map(a => a.invoiceId);
    }
    await db.transaction(async tx => {
      for (const id of ids) {
        const result = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${'invoice-payment-context:' + data.metadata.organizationId + ':' + id})) as acquired`);
        expect(result.rows[0].acquired).toBe(true);
      }
    });
  }
  let intent = keys.get(options.idempotencyKey);
  if (!intent) {
    intent = { id: 'pi_test_' + randomUUID(), client_secret: 'test_secret', status: 'requires_payment_method', amount_received: 0, ...data };
    intents.set(intent.id, intent); keys.set(options.idempotencyKey, intent);
  }
  if (loseResponse) { loseResponse = false; throw new Error('Lost provider response'); }
  return intent;
});
const retrieve = jest.fn<any>(async (id: string) => { if (!intents.has(id)) throw new Error('Unknown intent'); return intents.get(id); });
const cancel = jest.fn<any>(async (id: string) => { const intent = intents.get(id); if (intent.status === 'succeeded') throw new Error('Already succeeded'); intent.status = 'canceled'; return intent; });
// Portal imports image services; native image processing is outside this payment test.
jest.unstable_mockModule('sharp', () => ({ default: () => { throw new Error('Unexpected image processing in payment test'); } }));
jest.unstable_mockModule('../lib/stripe', () => ({ getStripeClient: () => ({ paymentIntents: { create, retrieve, cancel } }) }));
let initiateGroupedStripePayment: typeof import('../services/groupedStripePaymentInitiation.service').initiateGroupedStripePayment;
beforeAll(async () => { ({ initiateGroupedStripePayment } = await import('../services/groupedStripePaymentInitiation.service')); });
let reserveStripePaymentAttempt: typeof import('../services/stripePaymentAttempt.service').reserveStripePaymentAttempt;
let recordStripePaymentAttemptIntent: typeof import('../services/stripePaymentAttempt.service').recordStripePaymentAttemptIntent;
beforeAll(async () => { ({ reserveStripePaymentAttempt, recordStripePaymentAttemptIntent } = await import('../services/stripePaymentAttempt.service')); });
let recoverStripeInvoiceClaims: typeof import('../services/stripeInvoicePaymentClaims.service').recoverStripeInvoiceClaims;
beforeAll(async () => { ({ recoverStripeInvoiceClaims } = await import('../services/stripeInvoicePaymentClaims.service')); });
let initiateFullBalanceStripePayment: typeof import('../services/billing/groupedStripePaymentOperations').initiateFullBalanceStripePayment;
let confirmGroupedStripePayment: typeof import('../services/billing/groupedStripePaymentOperations').confirmGroupedStripePayment;
let readGroupedStripePayment: typeof import('../services/billing/groupedStripePaymentOperations').readGroupedStripePayment;
beforeAll(async () => { ({ initiateFullBalanceStripePayment, confirmGroupedStripePayment, readGroupedStripePayment } = await import('../services/billing/groupedStripePaymentOperations')); });
let runtimeReady = true;
jest.unstable_mockModule('../services/stripeRuntimeConfig.service', () => ({
  resolveStripeRuntimeConfig: async () => runtimeReady
    ? { ok: true, data: { provider: 'stripe', mode: 'test', publishableKey: 'pk_test_fixture', connectedAccountId: 'acct_test', readyForPayments: true } }
    : { ok: false, code: 'STRIPE_UNAVAILABLE', error: 'Stripe unavailable' }
}));
let portal: typeof import('../services/portal.service');
let registerRoutes: typeof import('../routes/groupedStripePayments.routes').registerGroupedStripePaymentRoutes;
beforeAll(async () => {
  portal = await import('../services/portal.service');
  ({ registerGroupedStripePaymentRoutes: registerRoutes } = await import('../routes/groupedStripePayments.routes'));
});
let organizationId = '', userId = '', customerId = '';
beforeAll(async () => {
  const suffix = randomUUID();
  const [org] = await db.insert(organizations).values({ name: 'Payment initiation test', slug: 'payment-init-test-' + suffix }).returning(); organizationId = org.id;
  await db.insert(integrationConnections).values({ organizationId, provider: 'stripe', externalAccountId: 'acct_test', status: 'connected', mode: 'test' });
  const [user] = await db.insert(users).values({ email: 'payment-init-' + suffix + '@example.test', firstName: 'Test', lastName: 'User', role: 'admin' }).returning(); userId = user.id;
  const [customer] = await db.insert(customers).values({ organizationId, companyName: 'Synthetic Customer', email: 'synthetic-' + suffix + '@example.test' }).returning(); customerId = customer.id;
});
afterAll(async () => {
  if (organizationId) {
    await db.delete(paymentWebhookEvents).where(eq(paymentWebhookEvents.organizationId, organizationId));
    await db.delete(integrationConnections).where(eq(integrationConnections.organizationId, organizationId));
    await db.delete(payments).where(eq(payments.organizationId, organizationId));
    await db.delete(stripePaymentAttempts).where(eq(stripePaymentAttempts.organizationId, organizationId));
    await db.delete(customerPaymentBatches).where(eq(customerPaymentBatches.organizationId, organizationId));
    await db.delete(invoices).where(eq(invoices.organizationId, organizationId));
    await db.delete(customers).where(eq(customers.organizationId, organizationId));
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  }
  if (userId) await db.delete(users).where(eq(users.id, userId));
});
async function fixture() {
  const selected = await db.insert(invoices).values([1, 2].map(() => ({ organizationId, customerId, createdByUserId: userId, invoiceNumber: Math.floor(Math.random() * 1000000000), status: 'billed', customerReleasedAt: new Date(), subtotal: '100.00', tax: '0.00', total: '100.00', subtotalCents: 10000, taxCents: 0, totalCents: 10000, amountPaid: '0.00', balanceDue: '100.00' }))).returning();
  const invoiceIds = selected.map(row => row.id), allocations = invoiceIds.map(invoiceId => ({ invoiceId, amountCents: 10000 }));
  return { organizationId, customerId, actorUserId: userId, requestKey: randomUUID(), stripeAccountId: 'acct_test', invoiceIds, allocations, amountCents: 20000, currency: 'USD', providerEvidence: { portal: true, invoiceIds, allocations, expectedRemainingCents: Object.fromEntries(invoiceIds.map(id => [id, 10000])) } };
}
function single(input: Awaited<ReturnType<typeof fixture>>) {
  return { organizationId, invoiceId: input.invoiceIds[0], channel: 'staff' as const, amountCents: 10000, currency: 'USD', stripeAccountId: 'acct_test', createdByUserId: userId, expectedCustomerId: customerId, metadata: { invoiceNumber: 'fixture', importedQuickBooksInvoice: false, qbInvoiceId: null } };
}
test('concurrent same grouped operation creates one intent and replays the durable batch', async () => {
  const input = await fixture(), before = keys.size;
  const results = await Promise.allSettled([initiateGroupedStripePayment(input), initiateGroupedStripePayment(input)]);
  expect(results.filter(r => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
  const first = (results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>).value;
  const replay = await initiateGroupedStripePayment(input);
  expect(replay.paymentBatchId).toBe(first.paymentBatchId); expect(keys.size - before).toBe(1);
  await expect(initiateGroupedStripePayment({ ...input, requestKey: randomUUID() })).rejects.toThrow('Another Stripe payment is unresolved');
});
test('single first blocks grouped; grouped first blocks single; compatible single replay is stable', async () => {
  const a = await fixture();
  const first = await reserveStripePaymentAttempt(single(a));
  expect((await reserveStripePaymentAttempt(single(a))).attempt.id).toBe(first.attempt.id);
  await expect(reserveStripePaymentAttempt({ ...single(a), channel: 'portal' })).rejects.toThrow('different Stripe checkout');
  await expect(initiateGroupedStripePayment(a)).rejects.toThrow('Another Stripe payment is unresolved');
  const b = await fixture(); await initiateGroupedStripePayment(b);
  await expect(reserveStripePaymentAttempt(single(b))).rejects.toThrow('Another Stripe payment is unresolved');
});
test('simultaneous single versus grouped has exactly one durable winner', async () => {
  const a = await fixture();
  const results = await Promise.allSettled([reserveStripePaymentAttempt(single(a)), initiateGroupedStripePayment(a)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
});
test('staff and portal concurrent overlapping groups have one winner through the shared initiation', async () => {
  const a = await fixture(), before = keys.size;
  const results = await Promise.allSettled([initiateGroupedStripePayment(a), initiateFullBalanceStripePayment({ ...a, requestKey: randomUUID(), expectedRemainingCents: a.providerEvidence.expectedRemainingCents })]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(keys.size - before).toBe(1);
});
test('declined intent resumes the same checkout; explicit abandonment cancels before replacement', async () => {
  const a = await fixture(), first = await initiateGroupedStripePayment(a);
  const intent = Array.from(intents.values()).find(i => i.metadata.customerPaymentBatchId === first.paymentBatchId);
  intent.last_payment_error = { code: 'card_declined' };
  expect((await initiateGroupedStripePayment(a)).paymentBatchId).toBe(first.paymentBatchId);
  await recoverStripeInvoiceClaims({ organizationId, invoiceIds: a.invoiceIds, customerId, cancelUnfunded: true });
  expect(intent.status).toBe('canceled');
  const replacement = await initiateGroupedStripePayment({ ...a, requestKey: randomUUID() });
  expect(replacement.paymentBatchId).not.toBe(first.paymentBatchId);
});
test('provider canceled single is retired and releases grouped claim', async () => {
  const a = await fixture(), { attempt } = await reserveStripePaymentAttempt(single(a));
  const intent = await create({ amount: 10000, currency: 'usd', metadata: { organizationId, invoiceId: a.invoiceIds[0], stripePaymentAttemptId: attempt.id, stripeAccountId: 'acct_test' } }, { idempotencyKey: attempt.idempotencyKey });
  await recordStripePaymentAttemptIntent({ organizationId, attemptId: attempt.id, stripePaymentIntentId: intent.id });
  intent.status = 'canceled';
  await expect(initiateGroupedStripePayment(a)).resolves.toHaveProperty('clientSecret');
});
test('lost Stripe create response retries original batch and provider key', async () => {
  const a = await fixture(), before = keys.size; loseResponse = true;
  await expect(initiateGroupedStripePayment(a)).rejects.toThrow('Lost provider response');
  await initiateGroupedStripePayment(a); expect(keys.size - before).toBe(1);
});
test('staff completion uses shared finalizer and returns persisted invoice balances; repeat confirmation never charges', async () => {
  const a = await fixture(), before = keys.size;
  const result = await initiateFullBalanceStripePayment({ ...a, expectedRemainingCents: a.providerEvidence.expectedRemainingCents });
  const intent = Array.from(intents.values()).find(i => i.metadata.customerPaymentBatchId === result.paymentBatchId);
  intent.status = 'succeeded'; intent.amount_received = intent.amount;
  const access = { organizationId, paymentIntentId: intent.id, actorUserId: userId };
  const saved = await confirmGroupedStripePayment(access);
  expect(saved.finalized).toBe(true); expect(saved.allocations).toHaveLength(2);
  expect(saved.invoices.every(i => i.amountDueCents === 0)).toBe(true);
  expect((await confirmGroupedStripePayment(access)).allocations).toEqual(saved.allocations);
  await recoverStripeInvoiceClaims({ organizationId, invoiceIds: a.invoiceIds, cancelUnfunded: true });
  expect(intent.status).toBe('succeeded'); expect(keys.size - before).toBe(1);
  await expect(readGroupedStripePayment({ ...access, organizationId: randomUUID() })).rejects.toThrow('Payment not found');
});
test('staff rejects stale displayed balances and another customer without creating an intent', async () => {
  const a = await fixture(), before = keys.size;
  await expect(initiateFullBalanceStripePayment({ ...a, expectedRemainingCents: {} })).rejects.toThrow('balances changed');
  await expect(initiateGroupedStripePayment({ ...a, customerId: randomUUID() })).rejects.toThrow('billing context changed');
  expect(keys.size).toBe(before);
});
test('processing intent cannot be canceled to unlock another charge', async () => {
  const a = await fixture(), result = await initiateGroupedStripePayment(a);
  const intent = Array.from(intents.values()).find(i => i.metadata.customerPaymentBatchId === result.paymentBatchId); intent.status = 'processing';
  await expect(recoverStripeInvoiceClaims({ organizationId, invoiceIds: a.invoiceIds, cancelUnfunded: true })).rejects.toThrow('processing or authorized');
  await expect(reserveStripePaymentAttempt(single(a))).rejects.toThrow('Another Stripe payment is unresolved');
});

function portalRequest(a: Awaited<ReturnType<typeof fixture>>, body?: any) {
  return { organizationId, portalCustomerId: customerId, portalCustomer: { id: customerId, organizationId }, user: { id: userId },
    body: body || { invoiceIds: a.invoiceIds, idempotencyKey: a.requestKey, expectedRemainingCents: a.providerEvidence.expectedRemainingCents } } as any;
}
function staffApp(role = 'admin', org = organizationId, authenticated = true) {
  const app = express(); app.use(express.json());
  registerRoutes(app, {
    isAuthenticated: (req: any, res, next) => { if (!authenticated) { res.sendStatus(401); return; } req.user = { id: userId, role: 'admin' }; next(); },
    tenantContext: (req: any, _res, next) => { req.organizationId = org; req.orgRole = role; next(); }
  });
  return app;
}
test('actual portal adapter and authorized staff HTTP entry use one canonical batch engine', async () => {
  const a = await fixture(), before = keys.size;
  const initiated = await portal.createPortalGroupedStripePaymentIntent(portalRequest(a));
  expect(initiated).toHaveProperty('paymentBatchId');
  const denied = await request(staffApp()).post('/api/invoices/customer-payment/stripe/create-intent').send({
    invoiceIds: a.invoiceIds, idempotencyKey: randomUUID(), expectedRemainingCents: a.providerEvidence.expectedRemainingCents });
  expect(denied.status).toBe(409); expect(keys.size - before).toBe(1);
  const b = await fixture();
  const response = await request(staffApp()).post('/api/invoices/customer-payment/stripe/create-intent').send({
    organizationId: 'forged', actorUserId: 'forged', invoiceIds: b.invoiceIds, idempotencyKey: b.requestKey, expectedRemainingCents: b.providerEvidence.expectedRemainingCents });
  expect(response.status).toBe(200);
  const intent = Array.from(intents.values()).find(i => i.metadata.customerPaymentBatchId === response.body.data.paymentBatchId);
  expect(intent.metadata.organizationId).toBe(organizationId);
  await expect(portal.createPortalGroupedStripePaymentIntent(portalRequest(b))).rejects.toThrow('Another Stripe payment is unresolved');
  intent.status = 'succeeded'; intent.amount_received = intent.amount;
  const confirmed = await request(staffApp()).post('/api/invoices/customer-payment/stripe/confirm').send({ paymentIntentId: intent.id });
  expect(confirmed.status).toBe(200); expect(confirmed.body.data.finalized).toBe(true);
  expect(confirmed.body.data.invoices.every((i: any) => i.amountDueCents === 0)).toBe(true);
});
test('staff HTTP enforces authentication, tenant role, configuration and invoice tenant scope', async () => {
  const a = await fixture(), body = { invoiceIds: a.invoiceIds, idempotencyKey: a.requestKey, expectedRemainingCents: a.providerEvidence.expectedRemainingCents }, before = keys.size;
  for (const action of ['runtime-config', 'create-intent', 'validate', 'confirm', 'status', 'recover']) {
    expect((await request(staffApp('employee')).post('/api/invoices/customer-payment/stripe/' + action).send(body)).status).toBe(403);
    expect((await request(staffApp('admin', organizationId, false)).post('/api/invoices/customer-payment/stripe/' + action).send(body)).status).toBe(401);
  }
  const foreign = await request(staffApp('admin', randomUUID())).post('/api/invoices/customer-payment/stripe/create-intent').send(body);
  expect(foreign.status).not.toBe(200);
  runtimeReady = false;
  try { expect((await request(staffApp()).post('/api/invoices/customer-payment/stripe/create-intent').send(body)).status).toBe(409); }
  finally { runtimeReady = true; }
  expect(keys.size).toBe(before);
});

test('explicit recovery finds a lost grouped response by original key and cancels only that identity', async () => {
  const a = await fixture(), before = keys.size; loseResponse = true;
  await expect(initiateGroupedStripePayment(a)).rejects.toThrow('Lost provider response');
  const original = Array.from(keys.values()).at(-1);
  await recoverStripeInvoiceClaims({ organizationId, invoiceIds: a.invoiceIds, customerId, cancelUnfunded: true });
  expect(keys.size - before).toBe(1); expect(original.status).toBe('canceled');
  await expect(initiateGroupedStripePayment({ ...a, requestKey: randomUUID() })).resolves.toHaveProperty('clientSecret');
});
test('explicit recovery releases an abandoned single reservation using its original request', async () => {
  const a = await fixture(), before = keys.size;
  await reserveStripePaymentAttempt(single(a));
  await recoverStripeInvoiceClaims({ organizationId, invoiceIds: a.invoiceIds, cancelUnfunded: true });
  expect(keys.size - before).toBe(1); expect(Array.from(keys.values()).at(-1).status).toBe('canceled');
  await expect(initiateGroupedStripePayment(a)).resolves.toHaveProperty('clientSecret');
});

test('portal single checkout replays one intent and blocks grouped entry', async () => {
  const a = await fixture(), before = keys.size, req = portalRequest(a);
  const first = await portal.createPortalStripePaymentIntent(req, a.invoiceIds[0]);
  expect(first).toHaveProperty('clientSecret');
  const second = await portal.createPortalStripePaymentIntent(req, a.invoiceIds[0]);
  expect(second?.paymentAttemptId).toBe(first?.paymentAttemptId);
  expect(keys.size - before).toBe(1);
  await expect(portal.createPortalGroupedStripePaymentIntent(req)).rejects.toThrow('Another Stripe payment is unresolved');
});
test('staff single preserves approved imported A/R while grouped checkout remains excluded', async () => {
  const a = await fixture(), invoiceId = a.invoiceIds[0];
  await db.update(invoices).set({ importSource: 'quickbooks', qbInvoiceId: 'qb_fixture', historicalArState: 'historical_open_ar_reconciled',
    historicalArSourceBalanceCents: 6000, historicalArApprovedAt: new Date(), historicalArApprovedByUserId: userId,
    historicalArApprovalEvidence: { sourceInvoiceId: 'qb_fixture', customerId, sourceStatus: 'open', sourceDate: '2026-10-01',
      paymentEvidence: 'synthetic approval', originalCents: 10000, remainingCents: 6000 },
  }).where(eq(invoices.id, invoiceId));
  await expect(reserveStripePaymentAttempt({ ...single(a), amountCents: 6000 })).resolves.toHaveProperty('attempt');
  await expect(initiateFullBalanceStripePayment({ ...a, expectedRemainingCents: a.providerEvidence.expectedRemainingCents })).rejects.toThrow('separately approved reconciliation');
});

test('provider initiation runs after invoice claim locks have been released', async () => {
  const a = await fixture(); verifyProviderLocks = true;
  try { await initiateGroupedStripePayment(a); } finally { verifyProviderLocks = false; }
});

test('duplicate webhook observations and browser confirmation allocate the same grouped payment once', async () => {
  const a = await fixture(), result = await initiateGroupedStripePayment(a);
  const intent = Array.from(intents.values()).find(i => i.metadata.customerPaymentBatchId === result.paymentBatchId);
  intent.status = 'succeeded'; intent.amount_received = intent.amount;
  const { captureAndApply } = await import('../services/stripePaymentReconciliationService');
  const observation = { eventId: 'evt_test_' + randomUUID(), type: 'payment_intent.succeeded', organizationId,
    paymentIntentId: intent.id, stripeAccountId: 'acct_test', amountCents: intent.amount, currency: 'USD', occurredAt: new Date() };
  const results = await Promise.all([captureAndApply(observation), captureAndApply(observation),
    confirmGroupedStripePayment({ organizationId, paymentIntentId: intent.id, actorUserId: userId })]);
  expect(results[0].processed).toBe(true); expect(results[1].processed).toBe(true);
  const saved = await readGroupedStripePayment({ organizationId, paymentIntentId: intent.id });
  expect(saved.finalized).toBe(true); expect(saved.allocations).toHaveLength(2);
  expect(saved.invoices.every(i => i.amountDueCents === 0)).toBe(true);
});
