import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, jest, test } from '@jest/globals';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { customerPaymentBatches, customers, invoices, orders, organizations, users, payments, stripePaymentAttempts, integrationConnections, paymentWebhookEvents } from '../../shared/schema';

const intents = new Map<string, any>();
const keys = new Map<string, any>();
const sessions = new Map<string, any>();
const listSessions = jest.fn<any>(async (input: any) => ({ data: [...sessions.values()].filter(session => session.payment_intent === input.payment_intent), has_more: false }));
const expireSession = jest.fn<any>(async (id: string) => { const session = sessions.get(id); session.status = 'expired'; intents.get(session.payment_intent).status = 'canceled'; return session; });
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
jest.unstable_mockModule('../lib/stripe', () => ({ getStripeClient: () => ({ paymentIntents: { create, retrieve, cancel }, checkout: { sessions: { list: listSessions, expire: expireSession } } }) }));
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
    await db.delete(orders).where(eq(orders.organizationId, organizationId));
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
  expect((await initiateGroupedStripePayment({ ...input, requestKey: randomUUID() })).paymentBatchId).toBe(first.paymentBatchId);
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
  await expect(recoverStripeInvoiceClaims({ organizationId, invoiceIds: a.invoiceIds, cancelUnfunded: true })).rejects.toMatchObject({ code: 'STRIPE_PAYMENT_SUBMITTED' });
  await expect(reserveStripePaymentAttempt(single(a))).rejects.toThrow('Another Stripe payment is unresolved');
});

function portalRequest(a: Awaited<ReturnType<typeof fixture>>, body?: any) {
  return { organizationId, portalCustomerId: customerId, portalCustomer: { id: customerId, organizationId }, user: { id: userId },
    portalAccess: { organizationId, customerId, userId, status: 'ACTIVE', accessRole: 'BILLING' },
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

test('ordinary native Orders with null Redo provenance use existing grouped initiation and finalization exactly once',async()=>{
 const a=await fixture(),before=keys.size;
 for(const invoiceId of a.invoiceIds){const [order]=await db.insert(orders).values({organizationId,customerId,createdByUserId:userId,orderNumber:'SYNTHETIC-'+randomUUID()}).returning();expect(order.redoRootOrderId).toBeNull();await db.update(invoices).set({orderId:order.id}).where(eq(invoices.id,invoiceId));}
 const result=await initiateFullBalanceStripePayment({...a,expectedRemainingCents:a.providerEvidence.expectedRemainingCents});const intent=Array.from(intents.values()).find(i=>i.metadata.customerPaymentBatchId===result.paymentBatchId);expect(intent.amount).toBe(20000);expect(keys.size-before).toBe(1);
 intent.status='succeeded';intent.amount_received=intent.amount;
 const access={organizationId,paymentIntentId:intent.id,actorUserId:userId};const saved=await confirmGroupedStripePayment(access);expect(saved.finalized).toBe(true);expect(saved.allocations).toHaveLength(2);expect(saved.invoices.every(i=>i.amountDueCents===0)).toBe(true);expect((await confirmGroupedStripePayment(access)).allocations).toEqual(saved.allocations);expect(keys.size-before).toBe(1);
 const savedPayments=await db.select().from(payments).where(eq(payments.customerPaymentBatchId,result.paymentBatchId));expect(savedPayments).toHaveLength(2);expect(savedPayments.every(p=>p.status==='succeeded'&&p.amountCents===10000)).toBe(true);
});

async function startSingle(input: ReturnType<typeof single> & { checkoutRequestKey?: string; restartUnsubmitted?: boolean }) {
  const { resumeStripePaymentAttemptIntent } = await import('../services/stripePaymentAttempt.service');
  const { attempt } = await reserveStripePaymentAttempt(input);
  return { attempt, intent: await resumeStripePaymentAttemptIntent(attempt) };
}
async function idleAttempt(attempt: any) {
  await db.update(stripePaymentAttempts).set({ metadata: { ...attempt.metadata, checkoutLastActivityAt: new Date(Date.now() - 120001).toISOString() } }).where(eq(stripePaymentAttempts.id, attempt.id));
}
test('an abandoned single checkout is reused before two minutes and safely replaced after inactivity', async () => {
  const a = await fixture(), input = { ...single(a), checkoutRequestKey: randomUUID() };
  const first = await startSingle(input);
  expect((await startSingle({ ...input, checkoutRequestKey: randomUUID() })).intent.id).toBe(first.intent.id);
  await idleAttempt(first.attempt);
  const second = await startSingle({ ...input, channel: 'portal', metadata: { ...input.metadata, customerId }, checkoutRequestKey: randomUUID() });
  expect(second.intent.id).not.toBe(first.intent.id);
  expect(intents.get(first.intent.id).status).toBe('canceled');
  const [saved] = await db.select().from(stripePaymentAttempts).where(eq(stripePaymentAttempts.id, first.attempt.id));
  expect(saved.status).toBe('canceled');
  expect(await db.select().from(payments).where(eq(payments.invoiceId, input.invoiceId))).toHaveLength(0);
});
test('repeated restart retries use one replacement and simultaneous attempts leave one collectible identity', async () => {
  const a = await fixture(), input = { ...single(a), checkoutRequestKey: randomUUID() };
  const first = await startSingle(input); await idleAttempt(first.attempt);
  const retry = { ...input, restartUnsubmitted: true, checkoutRequestKey: randomUUID() };
  const concurrent = await Promise.allSettled([startSingle(retry), startSingle(retry)]);
  expect(concurrent.some(result => result.status === 'fulfilled')).toBe(true);
  const next = await startSingle(retry);
  for (let index = 0; index < 4; index++) expect((await startSingle(retry)).intent.id).toBe(next.intent.id);
  expect(next.intent.id).not.toBe(first.intent.id);
  expect([...intents.values()].filter(intent => intent.metadata.invoiceId === input.invoiceId && intent.status !== 'canceled')).toHaveLength(1);
});
test.each(['requires_action', 'processing', 'requires_capture'])('inactivity and explicit restart preserve a submitted %s payment', async status => {
  const a = await fixture(), input = { ...single(a), checkoutRequestKey: randomUUID() };
  const first = await startSingle(input); intents.get(first.intent.id).status = status; await idleAttempt(first.attempt);
  await expect(startSingle({ ...input, checkoutRequestKey: randomUUID(), restartUnsubmitted: true })).rejects.toMatchObject({ code: 'STRIPE_PAYMENT_SUBMITTED' });
  expect(intents.get(first.intent.id).status).toBe(status);
  expect([...intents.values()].filter(intent => intent.metadata.invoiceId === input.invoiceId)).toHaveLength(1);
});
test('a success with a delayed webhook updates balance before another checkout can be created', async () => {
  const a = await fixture(), input = single(a), first = await startSingle(input);
  const pi = intents.get(first.intent.id); pi.status = 'succeeded'; pi.amount_received = pi.amount;
  await expect(startSingle({ ...input, checkoutRequestKey: randomUUID() })).rejects.toMatchObject({ code: 'PAYMENT_ALLOCATION_STALE' });
  const { captureAndApply } = await import('../services/stripePaymentReconciliationService');
  const observation = { eventId: 'evt_late_' + randomUUID(), type: 'payment_intent.succeeded', organizationId, invoiceId: input.invoiceId,
    paymentIntentId: pi.id, paymentAttemptId: first.attempt.id, stripeAccountId: 'acct_test', amountCents: pi.amount, currency: pi.currency };
  await captureAndApply(observation); await captureAndApply(observation);
  await captureAndApply({ ...observation, eventId: 'evt_old_failure_' + randomUUID(), type: 'payment_intent.payment_failed', amountCents: 0 });
  const rows = await db.select().from(payments).where(eq(payments.invoiceId, input.invoiceId));
  expect(rows).toHaveLength(1); expect(rows[0].status).toBe('succeeded'); expect(rows[0].amountCents).toBe(10000);
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, input.invoiceId));
  expect(Number(invoice.balanceDue)).toBe(0);
  expect([...intents.values()].filter(intent => intent.metadata.invoiceId === input.invoiceId)).toHaveLength(1);
});
test('a superseded hosted Session is expired at Stripe before replacing its intent', async () => {
  const a = await fixture(), input = single(a), first = await startSingle(input); await idleAttempt(first.attempt);
  const session = { id: 'cs_fixture_' + randomUUID(), payment_intent: first.intent.id, status: 'open', payment_status: 'unpaid' }; sessions.set(session.id, session);
  const before = expireSession.mock.calls.length;
  const next = await startSingle(input);
  expect(next.intent.id).not.toBe(first.intent.id); expect(session.status).toBe('expired');
  expect(expireSession.mock.calls[before][0]).toBe(session.id);
  expect(expireSession.mock.invocationCallOrder[before]).toBeLessThan(create.mock.invocationCallOrder[create.mock.calls.length - 1]);
});
test('recovery failure retains the claim; another tenant cannot release it', async () => {
  const a = await fixture(), input = single(a), first = await startSingle(input); await idleAttempt(first.attempt);
  listSessions.mockRejectedValueOnce(new Error('Synthetic Stripe unavailable'));
  await expect(startSingle(input)).rejects.toThrow('Synthetic Stripe unavailable');
  expect(intents.get(first.intent.id).status).toBe('requires_payment_method');
  await recoverStripeInvoiceClaims({ organizationId: randomUUID(), invoiceIds: [input.invoiceId], retireInactive: true, restartUnsubmitted: true });
  expect(intents.get(first.intent.id).status).toBe('requires_payment_method');
  expect((await startSingle(input)).intent.id).not.toBe(first.intent.id);
});
test('a stale grouped checkout can be reopened with a new browser key and then replaced after inactivity', async () => {
  const a = await fixture(), first = await initiateGroupedStripePayment(a);
  expect((await initiateGroupedStripePayment({ ...a, requestKey: randomUUID() })).paymentBatchId).toBe(first.paymentBatchId);
  const [batch] = await db.select().from(customerPaymentBatches).where(eq(customerPaymentBatches.id, first.paymentBatchId));
  await db.update(customerPaymentBatches).set({ providerEvidence: { ...batch.providerEvidence, checkoutLastActivityAt: new Date(Date.now() - 120001).toISOString() } }).where(eq(customerPaymentBatches.id, batch.id));
  const next = await initiateGroupedStripePayment({ ...a, requestKey: randomUUID() });
  expect(next.paymentBatchId).not.toBe(first.paymentBatchId);
  expect([...intents.values()].find(intent => intent.metadata.customerPaymentBatchId === first.paymentBatchId).status).toBe('canceled');
});

test('customer email links and the BILLING portal share stale recovery, without weakening token access', async () => {
  const a = await fixture(), req = portalRequest(a, { checkoutKey: randomUUID() });
  const first = await portal.createPortalStripePaymentIntent(req, a.invoiceIds[0]);
  const [attempt] = await db.select().from(stripePaymentAttempts).where(eq(stripePaymentAttempts.id, first!.paymentAttemptId!));
  await idleAttempt(attempt);
  const guest = await import('../services/guestInvoicePayment.service');
  const token = await guest.issueGuestInvoicePaymentToken({ organizationId, invoiceId: a.invoiceIds[0] });
  const next = await guest.createGuestStripePaymentIntent(token, { checkoutKey: randomUUID() });
  expect(next!.paymentAttemptId).not.toBe(first!.paymentAttemptId);
  expect(intents.get(attempt.stripePaymentIntentId!).status).toBe('canceled');
  expect((await guest.createGuestStripePaymentIntent(token, { checkoutKey: randomUUID() }))!.paymentAttemptId).toBe(next!.paymentAttemptId);
  const before = keys.size;
  expect(await guest.createGuestStripePaymentIntent('invalid-token', { restartCheckout: true, checkoutKey: randomUUID() })).toBeNull();
  expect(keys.size).toBe(before);
});
test('a recovery lease blocks reuse and activity renewal until Stripe retirement has finished', async () => {
  const a = await fixture(), input = single(a), first = await startSingle(input); await idleAttempt(first.attempt);
  let release!: () => void, entered!: () => void;
  const providerEntered = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  listSessions.mockImplementationOnce(async () => { entered(); await blocked; return { data: [], has_more: false }; });
  const recovery = startSingle({ ...input, checkoutRequestKey: randomUUID(), restartUnsubmitted: true });
  await providerEntered;
  try {
    await expect(startSingle(input)).rejects.toMatchObject({ code: 'STRIPE_PAYMENT_INITIALIZING' });
    const { touchStripeCheckoutActivity } = await import('../services/stripeInvoicePaymentClaims.service');
    await expect(touchStripeCheckoutActivity(organizationId, input.invoiceId, first.intent.id)).rejects.toMatchObject({ code: 'STRIPE_PAYMENT_INITIALIZING' });
  } finally { release(); }
  expect((await recovery).intent.id).not.toBe(first.intent.id);
});
test('payment submission winning a cancellation race is reconciled without a replacement', async () => {
  const a = await fixture(), input = single(a), first = await startSingle(input); await idleAttempt(first.attempt);
  cancel.mockImplementationOnce(async (id: string) => {
    const intent = intents.get(id); intent.status = 'succeeded'; intent.amount_received = intent.amount;
    throw new Error('Payment completed before cancellation');
  });
  await expect(startSingle(input)).rejects.toMatchObject({ code: 'PAYMENT_ALLOCATION_STALE' });
  expect([...intents.values()].filter(intent => intent.metadata.invoiceId === input.invoiceId)).toHaveLength(1);
  const rows = await db.select().from(payments).where(eq(payments.invoiceId, input.invoiceId));
  expect(rows).toHaveLength(1); expect(rows[0].status).toBe('succeeded');
});
