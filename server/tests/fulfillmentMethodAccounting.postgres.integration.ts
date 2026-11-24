import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, test } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { auditLogs, customers, fulfillmentAdministrativeReconciliations, fulfillmentEvents, invoiceLineItems,
  invoices, orderLineItems, orders, orderStatusPills, organizations, payments, pickupHandoffItems, pickupHandoffs, pickupTickets,
  products, productionJobs, shipmentOrders, shipments, users } from '@shared/schema';
import { fulfillmentServiceV2 } from '../services/fulfillment/service';
import { canonicalOrderOperations } from '../services/orders/canonicalOrderOperations';
import { methodChangeAccountingBlock } from '../services/fulfillment/methodChangePolicy';
import { pool } from '../db';
import { registerFulfillmentRoutes } from '../routes/fulfillment.routes';
import { createInvoiceFromOrderInTransaction } from '../invoicesService';
import { ORDER_SHIPPING_INVOICE_MILESTONE } from '@shared/billingInvoicePolicy';
import { buildQuickBooksInvoiceProjection } from '../lib/quickBooksInvoiceProjection';
import { loadOrderPaymentSummaries } from '../services/orderPaymentSummary';
import { applyInvoiceSendSuccessLifecycle } from '../services/invoiceSendLifecycleAutomation';
import { PickupRepo } from '../services/fulfillment/repository';

const created: Array<{ organizationId: string; userId: string }> = [];

async function fixture(options: { paymentCents?: number; invoiceStatus?: string; draft?: boolean; invoiceOverrides?: Partial<typeof invoices.$inferInsert> } = {}) {
  const suffix = randomUUID();
  const [organization] = await db.insert(organizations).values({ name: `Shipping PG ${suffix}`, slug: `shipping-pg-${suffix}` }).returning();
  const [user] = await db.insert(users).values({ email: `shipping-pg-${suffix}@example.test`, firstName: 'Shipping', lastName: 'Test', role: 'admin' }).returning();
  created.push({ organizationId: organization.id, userId: user.id });
  const [customer] = await db.insert(customers).values({ organizationId: organization.id, companyName: `Shipping Customer ${suffix}`, email: `shipping-${suffix}@example.test` }).returning();
  const [order] = await db.insert(orders).values({
    organizationId: organization.id, orderNumber: `SP-${suffix}`.slice(0, 50), customerId: customer.id,
    status: 'ready_for_fulfillment', state: 'production_complete', routingTarget: 'fulfillment',
    fulfillmentStatus: 'packed', shippingMethod: 'ship', shippingCents: 1250,
    subtotal: '0.00', tax: '0.00', total: '12.50', createdByUserId: user.id,
    shipToName: 'QA Recipient', shipToAddress1: '100 Test Street', shipToCity: 'Carmel',
    shipToState: 'IN', shipToPostalCode: '46032', shipToCountry: 'US',
  }).returning();
  const paid = options.paymentCents ?? 0;
  const [invoice] = await db.insert(invoices).values({
    organizationId: organization.id, invoiceNumber: Math.floor(Math.random() * 1_000_000_000),
    orderId: order.id, customerId: customer.id, createdByUserId: user.id,
    status: options.invoiceStatus ?? 'billed', subtotal: '0.00', tax: '0.00', total: '12.50',
    subtotalCents: 0, taxCents: 0, shippingCents: 1250, totalCents: 1250,
    amountPaid: (paid / 100).toFixed(2), balanceDue: ((1250 - paid) / 100).toFixed(2),
    ...options.invoiceOverrides,
  }).returning();
  let paymentId: string | null = null;
  if (paid) {
    const [payment] = await db.insert(payments).values({
      organizationId: organization.id, invoiceId: invoice.id, provider: 'manual', status: 'succeeded',
      amount: (paid / 100).toFixed(2), amountCents: paid, method: 'other', createdByUserId: user.id,
    }).returning();
    paymentId = payment.id;
  }
  let draftId: string | null = null;
  if (options.draft !== false) {
    const [draft] = await db.insert(shipments).values({ organizationId: organization.id, orderId: order.id,
      primaryOrderId: order.id, status: 'DRAFT', scope: 'SINGLE_ORDER', createdByUserId: user.id }).returning();
    await db.insert(shipmentOrders).values({ organizationId: organization.id, shipmentId: draft.id, orderId: order.id });
    draftId = draft.id;
  }
  return { organization, user, customer, order, invoice, paymentId, draftId };
}

async function readback(f: Awaited<ReturnType<typeof fixture>>) {
  const [order] = await db.select().from(orders).where(eq(orders.id, f.order.id));
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, f.invoice.id));
  const draft = f.draftId ? (await db.select().from(shipments).where(eq(shipments.id, f.draftId)))[0] : null;
  const paymentRows = await db.select().from(payments).where(eq(payments.invoiceId, f.invoice.id));
  const orderAudit = await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, f.organization.id), eq(auditLogs.entityId, f.order.id)));
  const draftEvents = f.draftId ? await db.select().from(fulfillmentEvents).where(and(eq(fulfillmentEvents.organizationId, f.organization.id), eq(fulfillmentEvents.entityId, f.draftId))) : [];
  return { order, invoice, draft, paymentRows, orderAudit, draftEvents };
}

function routeFor(f: Awaited<ReturnType<typeof fixture>>) {
  const app = express();
  app.use(express.json());
  registerFulfillmentRoutes(app, {
    isAuthenticated: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { user: { id: f.user.id } }); next();
    },
    tenantContext: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      Object.assign(req, { organizationId: f.organization.id }); next();
    },
    requireOrgOwnerAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  });
  return app;
}

async function completedPickupFixture(protection: 'editable' | 'locked' | 'paid' = 'editable') {
  const f = await fixture({ draft: false });
  const organizationId = f.organization.id;
  const [completePill] = await db.insert(orderStatusPills).values({
    organizationId, stateScope: 'production_complete', key: 'complete', name: 'Complete', isActive: true,
  }).returning();
  await db.update(orders).set({ state: 'production_complete', status: 'operationally_complete',
    fulfillmentStatus: 'delivered', routingTarget: null, shippingMethod: 'pickup',
    shippingCents: 0, shippingChargeDecision: 'free', subtotal: '12.00', tax: '0.00', total: '12.00',
    statusPillId: completePill.id, statusPillValue: completePill.name,
  }).where(eq(orders.id, f.order.id));
  const [product] = await db.insert(products).values({ organizationId, name: 'Synthetic printed item',
    description: 'Synthetic printed item', requiresProductionJob: true }).returning();
  const [line] = await db.insert(orderLineItems).values({ orderId: f.order.id, productId: product.id,
    description: 'Synthetic printed item', quantity: 1, unitPrice: '12.00', totalPrice: '12.00', workflowState: 'completed', status: 'complete',
    standaloneProductionCompletedQuantity: 1 }).returning();
  const [job] = await db.insert(productionJobs).values({ organizationId, orderId: f.order.id,
    lineItemId: line.id, stationKey: 'roll', stepKey: 'done', status: 'done', completedAt: new Date() }).returning();
  const [ticket] = await db.insert(pickupTickets).values({ organizationId, orderId: f.order.id,
    status: 'READY_FOR_PICKUP', readyAt: new Date() }).returning();
  await db.delete(invoices).where(eq(invoices.id, f.invoice.id));
  const createdInvoice = await db.transaction(tx => createInvoiceFromOrderInTransaction(tx, organizationId, f.order.id, f.user.id, { terms: 'net_30' }));
  const [invoice] = await db.update(invoices).set({ accountingApprovedAt: new Date(), accountingApprovedByUserId: f.user.id,
    accountingApprovedVersion: 1, lastSentAt: new Date(), lastSentVia: 'email', lastSentVersion: 1, qbInvoiceId: 'SYNTHETIC-QB-INVOICE',
    qbSyncStatus: 'synced', lastQbSyncedVersion: 1, lockedReason: protection === 'locked' ? 'historic_document' : null,
    ...(protection === 'paid' ? { status: 'paid', amountPaid: '12.00', balanceDue: '0.00' } : {}),
  }).where(eq(invoices.id, createdInvoice.id)).returning();
  if (protection === 'paid') await db.insert(payments).values({
    organizationId, invoiceId: invoice.id, provider: 'manual', status: 'succeeded',
    amount: '12.00', amountCents: 1200, method: 'other', createdByUserId: f.user.id,
  });
  const [resolution] = await db.insert(fulfillmentAdministrativeReconciliations).values({
    organizationId, orderId: f.order.id, lineItemId: line.id, reconciledQuantity: 1, source: 'close_job_override',
    reason: 'Synthetic administrative closure', sourceInvoiceId: invoice.id, actorUserId: f.user.id,
  }).returning();
  return { ...f, invoice, line, job, ticket, resolution, organizationId };
}

test.each(['editable', 'locked', 'paid'] as const)('completed Pickup reopens shipping and bills $18 once (%s invoice)', async protection => {
  const f = await completedPickupFixture(protection);
  const protectedInvoice = protection !== 'editable';
  const paidCents = protection === 'paid' ? 1200 : 0;
  const app = routeFor(f);
  const paymentRowsBefore = (await readback(f)).paymentRows;
  const invoiceLinesBefore = await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, f.invoice.id));
  const orderPath = `/api/fulfillment/orders/${f.order.id}`;
  const changed = await request(app).post(`${orderPath}/change-method`).send({ method: 'ship' });
  expect(changed.status).toBe(200);
  const detail = await request(app).get(orderPath);
  expect(detail.body.data).toMatchObject({ fulfillmentMethod: 'ship', remainingQuantity: 1, readyWaitingQuantity: 1, pickedUpQuantity: 0 });
  const after = await readback(f);
  expect(after.order).toMatchObject({ orderNumber: f.order.orderNumber, shippingMethod: 'ship',
    state: 'production_complete', routingTarget: 'fulfillment', shippingChargeDecision: 'unset' });
  expect(after.invoice).toEqual(f.invoice);
  expect((await db.select().from(productionJobs).where(eq(productionJobs.id, f.job.id)))[0]).toEqual(f.job);
  expect((await db.select().from(fulfillmentAdministrativeReconciliations)
    .where(eq(fulfillmentAdministrativeReconciliations.id, f.resolution.id)))[0]).toEqual(f.resolution);
  expect((await db.select().from(pickupTickets).where(eq(pickupTickets.id, f.ticket.id)))[0].status).toBe('DRAFT');
  expect(await new PickupRepo().recordPartialPickup(f.organizationId, f.ticket.id, {
    items: [{ orderLineItemId: f.line.id, quantity: 1 }],
  }, f.user.id)).toMatchObject({ ok: false, code: 'FULFILLMENT_METHOD_MISMATCH' });
  expect((await request(app).post(`${orderPath}/change-method`).send({ method: 'ship' })).status).toBe(200);
  const started = await request(app).post('/api/fulfillment/shipments').send({ scope: 'SINGLE_ORDER', orderIds: [f.order.id] });
  expect(started.status).toBe(200);
  const draft = started.body.data.shipment;
  expect(draft.items).toEqual([expect.objectContaining({ orderLineItemId: f.line.id, quantity: 1 })]);
  await expect(fulfillmentServiceV2.markShipmentShipped(f.organizationId, draft.id, f.user.id, { suppressBillingAutomation: true }))
    .rejects.toMatchObject({ code: 'SHIPPING_BILLING_REQUIRED' });

  const shipmentPath = `/api/fulfillment/shipments/${draft.id}`;
  const [beforeCharge] = (await request(app).get(`${shipmentPath}/ups-customer-charges`)).body.data;
  expect(beforeCharge).toMatchObject({ billingStatus: 'pending', shippingCents: 0, billedInvoice: null });
  const bill = () => request(app).post(`${shipmentPath}/ups-customer-charge`).send({
    intent: 'bill_manual', shippingCents: 1800, expectedOrderUpdatedAt: new Date(beforeCharge.updatedAt).toISOString(),
  });
  const replies = await Promise.all([bill(), bill()]);
  expect(replies.map(reply => reply.status)).toEqual([200, 200]);
  expect(replies.map(reply => reply.body.data.applied).sort()).toEqual([false, true]);
  const invoiceId = replies[0].body.data.invoiceId;
  expect(replies[1].body.data.invoiceId).toBe(invoiceId);
  const differentCharge = await request(app).post(`${shipmentPath}/ups-customer-charge`).send({
    intent: 'bill_manual', shippingCents: 2200, expectedOrderUpdatedAt: new Date(beforeCharge.updatedAt).toISOString(),
  });
  expect(differentCharge.body).toMatchObject({ code: 'SHIPPING_BILLING_REVIEW' });
  const [charge] = (await request(app).get(`${shipmentPath}/ups-customer-charges`)).body.data;
  expect(charge).toMatchObject({ shippingCents: 1800, shippingChargeDecision: 'manual', billingStatus: 'invoiced', billedInvoice: { id: invoiceId } });
  const invoiceRows = await db.select().from(invoices).where(eq(invoices.orderId, f.order.id));
  const billed = invoiceRows.find(row => row.id === invoiceId)!;
  expect(invoiceRows).toHaveLength(protectedInvoice ? 2 : 1);
  expect(billed).toMatchObject({ shippingCents: 1800, subtotalCents: protectedInvoice ? 0 : 1200,
    totalCents: protectedInvoice ? 1800 : 3000, amountPaid: '0.00' });
  if (protectedInvoice) {
    expect(invoiceRows.find(row => row.id === f.invoice.id)).toEqual(f.invoice);
    expect(billed).toMatchObject({ billingMilestone: ORDER_SHIPPING_INVOICE_MILESTONE, customerId: f.customer.id, qbSyncStatus: 'not_synced' });
    expect(await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, billed.id))).toEqual([]);
    expect(buildQuickBooksInvoiceProjection({ invoice: billed, qbCustomerId: 'synthetic',
      docNumber: String(billed.invoiceNumber), txnDate: '2026-11-24', productLines: [] }).economics.shippingCents).toBe(1800);
  } else {
    expect(billed).toMatchObject({ invoiceVersion: 2, qbInvoiceId: f.invoice.qbInvoiceId, qbSyncStatus: 'needs_resync',
      lastSentAt: f.invoice.lastSentAt, accountingApprovedAt: null });
  }
  expect(await db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, f.invoice.id))).toEqual(invoiceLinesBefore);
  const summaries = await loadOrderPaymentSummaries(db, f.organizationId, invoiceRows);
  expect(summaries.get(f.order.id)).toMatchObject({ totalCents: 3000, paidCents, remainingCents: 3000 - paidCents });
  expect((await fulfillmentServiceV2.markShipmentShipped(f.organizationId, draft.id, f.user.id, { suppressBillingAutomation: true })).status).toBe('SHIPPED');
  // Simulate provider-confirmed delivery by calling the existing post-send
  // lifecycle. The test performs no email or accounting network operation.
  await applyInvoiceSendSuccessLifecycle({ organizationId: f.organizationId, invoiceId: billed.id,
    successfulSentAt: new Date(), suppressAutomaticAccountingApproval: true });
  const [sent] = await db.select().from(invoices).where(eq(invoices.id, billed.id));
  expect(sent).toMatchObject({ shippingCents: 1800, totalCents: billed.totalCents, lastSentVersion: sent.invoiceVersion });
  if (protectedInvoice) expect((await readback(f)).invoice).toEqual(f.invoice);
  expect((await readback(f)).paymentRows).toEqual(paymentRowsBefore);
});

test('recorded Pickup requires reversal even if the Order was also administratively resolved', async () => {
  const f = await completedPickupFixture();
  const [handoff] = await db.insert(pickupHandoffs).values({ organizationId: f.organizationId, orderId: f.order.id,
    pickupTicketId: f.ticket.id, handedOffByUserId: f.user.id }).returning();
  await db.insert(pickupHandoffItems).values({ organizationId: f.organizationId, orderId: f.order.id, pickupHandoffId: handoff.id,
    orderLineItemId: f.line.id, quantity: 1 });
  const reply = await request(routeFor(f)).post(`/api/fulfillment/orders/${f.order.id}/change-method`).send({ method: 'ship' });
  expect(reply.status).toBe(409);
  expect(reply.body).toMatchObject({ code: 'FULFILLMENT_METHOD_TERMINAL', message: expect.stringContaining('Fulfillment History') });
  const after = await readback(f);
  expect(after.order.shippingMethod).toBe('pickup');
  expect(after.invoice).toEqual(f.invoice);
  expect(after.orderAudit).toEqual([]);
});

afterEach(async () => {
  for (const row of created.splice(0)) {
    await db.delete(organizations).where(eq(organizations.id, row.organizationId));
    await db.delete(users).where(eq(users.id, row.userId));
  }
});

describe('fulfillment method accounting on local PostgreSQL', () => {
  test('address-only canonical save preserves the shipping charge and Invoice amounts', async () => {
    const f = await fixture({ draft: false });
    const before = await readback(f);
    await canonicalOrderOperations.updateEditableHeader({
      organizationId: f.organization.id, actorUserId: f.user.id, orderId: f.order.id,
      allowNonNew: true, changes: { shipToName: 'Changed Recipient', shipToAddress1: '200 QA Lane', shipToState: 'OH' },
    });
    const after = await readback(f);
    expect(after.order).toMatchObject({ shipToName: 'Changed Recipient', shipToAddress1: '200 QA Lane', shipToState: 'OH', shippingCents: 1250 });
    expect(after.invoice).toMatchObject({ shippingCents: 1250, totalCents: 1250, amountPaid: '0.00', balanceDue: '12.50', invoiceVersion: before.invoice.invoiceVersion });
  });

  test('unpaid Shipping to Pickup voids its draft and synchronizes the linked Invoice exactly once', async () => {
    const f = await fixture();
    const result = await fulfillmentServiceV2.changeFulfillmentMethod(f.organization.id, f.order.id, 'pickup', f.user.id);
    expect(result.voidedDraftIds).toEqual([f.draftId]);
    const first = await readback(f);
    expect(first.order.shippingMethod).toBe('pickup');
    expect(first.order.shippingCents).toBe(0);
    expect(first.invoice.shippingCents).toBe(0);
    expect(first.invoice.totalCents).toBe(0);
    expect(first.draft?.status).toBe('VOIDED');
    const retry = await fulfillmentServiceV2.changeFulfillmentMethod(f.organization.id, f.order.id, 'pickup', f.user.id);
    expect(retry.voidedDraftIds).toEqual([]);
    const second = await readback(f);
    expect(second.invoice.invoiceVersion).toBe(first.invoice.invoiceVersion);
    expect(second.orderAudit).toHaveLength(first.orderAudit.length);
    expect(second.draftEvents).toHaveLength(first.draftEvents.length);
  });

  test('Delivery keeps the charge; Pickup removes it; returning to Shipping does not invent a charge', async () => {
    const f = await fixture();
    await fulfillmentServiceV2.changeFulfillmentMethod(f.organization.id, f.order.id, 'deliver', f.user.id);
    const delivered = await readback(f);
    expect(delivered.order.shippingMethod).toBe('deliver');
    expect(delivered.draft?.status).toBe('VOIDED');
    expect(delivered.order.shippingCents).toBe(1250);
    expect(delivered.invoice.shippingCents).toBe(1250);
    expect(delivered.invoice.invoiceVersion).toBe(1);
    await fulfillmentServiceV2.changeFulfillmentMethod(f.organization.id, f.order.id, 'pickup', f.user.id);
    const pickup = await readback(f);
    expect(pickup.invoice).toMatchObject({ shippingCents: 0, totalCents: 0, invoiceVersion: 2 });
    await fulfillmentServiceV2.changeFulfillmentMethod(f.organization.id, f.order.id, 'ship', f.user.id);
    const shipping = await readback(f);
    expect(shipping.order.shippingMethod).toBe('ship');
    expect(shipping.order.shippingCents).toBe(0);
    expect(shipping.invoice).toMatchObject({ shippingCents: 0, totalCents: 0, invoiceVersion: 2 });
  });

  test.each([
    { name: 'partially paid', paymentCents: 500, invoiceStatus: 'billed' },
    { name: 'fully paid', paymentCents: 1250, invoiceStatus: 'paid' },
  ])('$name Invoice blocks reclassification and preserves payment evidence', async ({ paymentCents, invoiceStatus }) => {
    const f = await fixture({ paymentCents, invoiceStatus });
    const before = await readback(f);
    let failure: unknown;
    try { await fulfillmentServiceV2.changeFulfillmentMethod(f.organization.id, f.order.id, 'pickup', f.user.id); }
    catch (error) { failure = error; }
    expect(methodChangeAccountingBlock(failure)).toMatchObject({ status: 409, code: 'ORDER_INVOICE_SYNC_BLOCKED' });
    const after = await readback(f);
    expect(after.order.shippingMethod).toBe(before.order.shippingMethod);
    expect(after.order.shippingCents).toBe(before.order.shippingCents);
    expect(after.draft?.status).toBe('DRAFT');
    expect(after.invoice).toMatchObject({ totalCents: before.invoice.totalCents, shippingCents: before.invoice.shippingCents,
      invoiceVersion: before.invoice.invoiceVersion, amountPaid: before.invoice.amountPaid, balanceDue: before.invoice.balanceDue });
    expect(after.paymentRows.map(row => [row.id, row.amountCents, row.status])).toEqual(before.paymentRows.map(row => [row.id, row.amountCents, row.status]));
    expect(after.orderAudit).toHaveLength(before.orderAudit.length);
    expect(after.draftEvents).toHaveLength(before.draftEvents.length);
  });

  test('paid-Invoice reconciliation failure maps to actionable HTTP 409 and retains persisted state', async () => {
    const f = await fixture({ paymentCents: 500 });
    const response = await request(routeFor(f))
      .post(`/api/fulfillment/orders/${f.order.id}/change-method`).send({ method: 'pickup' });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ success: false, code: 'ORDER_INVOICE_SYNC_BLOCKED' });
    expect(String(response.body.message)).toMatch(/invoice|billing|adjustment/i);
    const after = await readback(f);
    expect(after.order.shippingMethod).toBe('ship');
    expect(after.draft?.status).toBe('DRAFT');
    expect(after.invoice.totalCents).toBe(1250);
    expect(after.paymentRows).toHaveLength(1);
  });

  test('void historical Invoice remains untouched when an eligible Order changes method', async () => {
    const f = await fixture({ invoiceStatus: 'void' });
    await fulfillmentServiceV2.changeFulfillmentMethod(f.organization.id, f.order.id, 'pickup', f.user.id);
    const after = await readback(f);
    expect(after.order.shippingMethod).toBe('pickup');
    expect(after.order.shippingCents).toBe(0);
    expect(after.draft?.status).toBe('VOIDED');
    expect(after.invoice).toMatchObject({ status: 'void', shippingCents: 1250, totalCents: 1250, invoiceVersion: 1 });
  });

  test('issued and approved Invoice retains delivery evidence and requires reapproval after an eligible correction', async () => {
    const issuedAt = new Date('2026-10-01T12:00:00Z');
    const f = await fixture({ invoiceOverrides: { issuedAt, lastSentAt: issuedAt,
      accountingApprovedAt: issuedAt, accountingApprovedVersion: 1 } });
    await fulfillmentServiceV2.changeFulfillmentMethod(f.organization.id, f.order.id, 'pickup', f.user.id);
    const after = await readback(f);
    expect(after.invoice.lastSentAt).toEqual(issuedAt);
    expect(after.invoice.issuedAt).toEqual(issuedAt);
    expect(after.invoice.accountingApprovedAt).toBeNull();
    expect(after.invoice.accountingApprovalRevokedAt).not.toBeNull();
    expect(after.invoice.invoiceVersion).toBe(2);
    const approvalAudit = await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, f.organization.id), eq(auditLogs.actionType, 'invoice_accounting_approval_revoked')));
    expect(approvalAudit).toHaveLength(1);
  });

  test('historical QuickBooks import blocks method change without altering its draft or frozen amounts', async () => {
    const f = await fixture({ invoiceOverrides: { importSource: 'quickbooks', isHistorical: true,
      qbInvoiceId: 'QB-HISTORICAL-TEST', qbSyncStatus: 'synced' } });
    const before = await readback(f);
    let failure: unknown;
    try { await fulfillmentServiceV2.changeFulfillmentMethod(f.organization.id, f.order.id, 'pickup', f.user.id); }
    catch (error) { failure = error; }
    expect(methodChangeAccountingBlock(failure)).toMatchObject({ status: 409, code: 'ORDER_INVOICE_SYNC_BLOCKED' });
    const after = await readback(f);
    expect(after.order.shippingMethod).toBe('ship');
    expect(after.draft?.status).toBe('DRAFT');
    expect(after.invoice).toMatchObject({ totalCents: before.invoice.totalCents, invoiceVersion: before.invoice.invoiceVersion,
      qbInvoiceId: before.invoice.qbInvoiceId, qbSyncStatus: before.invoice.qbSyncStatus });
    expect(after.orderAudit).toHaveLength(before.orderAudit.length);
    expect(after.draftEvents).toHaveLength(before.draftEvents.length);
  });

  test('explicitly locked Invoice blocks a shipping-charge change without partial writes', async () => {
    const f = await fixture({ invoiceOverrides: { lockedReason: 'historical_import' } });
    const before = await readback(f);
    let failure: unknown;
    try { await fulfillmentServiceV2.changeFulfillmentMethod(f.organization.id, f.order.id, 'pickup', f.user.id); }
    catch (error) { failure = error; }
    expect(methodChangeAccountingBlock(failure)).toMatchObject({ status: 409, code: 'ORDER_INVOICE_SYNC_BLOCKED' });
    const after = await readback(f);
    expect(after.order.shippingMethod).toBe(before.order.shippingMethod);
    expect(after.order.shippingCents).toBe(before.order.shippingCents);
    expect(after.draft?.status).toBe('DRAFT');
    expect(after.invoice).toMatchObject({ lockedReason: before.invoice.lockedReason,
      totalCents: before.invoice.totalCents, shippingCents: before.invoice.shippingCents,
      invoiceVersion: before.invoice.invoiceVersion });
    expect(after.orderAudit).toHaveLength(before.orderAudit.length);
    expect(after.draftEvents).toHaveLength(before.draftEvents.length);
  });

  test('linked native QuickBooks Invoice keeps its provider ID and is marked for resynchronization locally', async () => {
    const f = await fixture({ invoiceOverrides: { qbInvoiceId: 'QB-LOCAL-TEST', qbSyncStatus: 'synced', lastQbSyncedVersion: 1 } });
    await fulfillmentServiceV2.changeFulfillmentMethod(f.organization.id, f.order.id, 'pickup', f.user.id);
    const after = await readback(f);
    expect(after.invoice).toMatchObject({ qbInvoiceId: 'QB-LOCAL-TEST', qbSyncStatus: 'needs_resync',
      modifiedAfterBilling: true, shippingCents: 0, totalCents: 0 });
  });

  test('combined draft and terminal fulfillment reject without partial writes', async () => {
    const combined = await fixture();
    const [otherOrder] = await db.insert(orders).values({ organizationId: combined.organization.id,
      orderNumber: `OTHER-${randomUUID()}`.slice(0, 50), customerId: combined.customer.id,
      shippingMethod: 'ship', createdByUserId: combined.user.id }).returning();
    await db.insert(shipmentOrders).values({ organizationId: combined.organization.id, shipmentId: combined.draftId!, orderId: otherOrder.id });
    const beforeCombined = await readback(combined);
    await expect(fulfillmentServiceV2.changeFulfillmentMethod(combined.organization.id, combined.order.id, 'pickup', combined.user.id))
      .rejects.toMatchObject({ code: 'COMBINED_DRAFT', status: 409 });
    const afterCombined = await readback(combined);
    expect(afterCombined.order.shippingMethod).toBe(beforeCombined.order.shippingMethod);
    expect(afterCombined.draft?.status).toBe('DRAFT');
    expect(afterCombined.invoice.invoiceVersion).toBe(beforeCombined.invoice.invoiceVersion);
    expect(afterCombined.orderAudit).toHaveLength(beforeCombined.orderAudit.length);

    const terminal = await fixture();
    await db.update(orders).set({ fulfillmentStatus: 'shipped' }).where(eq(orders.id, terminal.order.id));
    const beforeTerminal = await readback(terminal);
    await expect(fulfillmentServiceV2.changeFulfillmentMethod(terminal.organization.id, terminal.order.id, 'pickup', terminal.user.id))
      .rejects.toMatchObject({ code: 'FULFILLMENT_METHOD_TERMINAL', status: 409 });
    const afterTerminal = await readback(terminal);
    expect(afterTerminal.order.shippingMethod).toBe(beforeTerminal.order.shippingMethod);
    expect(afterTerminal.draft?.status).toBe('DRAFT');
    expect(afterTerminal.invoice.invoiceVersion).toBe(beforeTerminal.invoice.invoiceVersion);
    expect(afterTerminal.orderAudit).toHaveLength(beforeTerminal.orderAudit.length);
  });

  test('a PostgreSQL Invoice write failure rolls back Order, draft void, and audit writes', async () => {
    const f = await fixture();
    const before = await readback(f);
    await pool.query(`CREATE FUNCTION shipping_pg_fail_invoice_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic invoice write failure'; END $$`);
    await pool.query(`CREATE TRIGGER shipping_pg_fail_invoice_update BEFORE UPDATE ON invoices FOR EACH ROW WHEN (OLD.id = '${f.invoice.id}') EXECUTE FUNCTION shipping_pg_fail_invoice_update()`);
    try {
      const response = await request(routeFor(f))
        .post(`/api/fulfillment/orders/${f.order.id}/change-method`).send({ method: 'pickup' });
      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({ success: false, message: 'Could not change fulfillment method. Refresh and retry.' });
    } finally {
      await pool.query('DROP TRIGGER shipping_pg_fail_invoice_update ON invoices');
      await pool.query('DROP FUNCTION shipping_pg_fail_invoice_update()');
    }
    const after = await readback(f);
    expect(after.order.shippingMethod).toBe(before.order.shippingMethod);
    expect(after.order.shippingCents).toBe(before.order.shippingCents);
    expect(after.draft?.status).toBe('DRAFT');
    expect(after.invoice.invoiceVersion).toBe(before.invoice.invoiceVersion);
    expect(after.orderAudit).toHaveLength(before.orderAudit.length);
    expect(after.draftEvents).toHaveLength(before.draftEvents.length);
    expect(after.paymentRows).toEqual(before.paymentRows);
  });
});
