import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, test } from '@jest/globals';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import {
  auditLogs, customerAccountCreditApplicationBatches, customerAccountCreditApplications,
  customerAccountCredits, customerPaymentBatches, customers, invoices, organizations,
  payments, users,
} from '@shared/schema';
import { recordCustomerPayment } from '../services/billing/customerPaymentOperations';
import { applyCustomerCredit, recordCustomerAdvance, reverseCustomerCreditApplication } from '../services/billing/customerAccountCreditOperations';

const fixtures: Array<{ organizationId: string; userId: string }> = [];

async function fixture(status = 'billed') {
  const suffix = randomUUID();
  const [organization] = await db.insert(organizations).values({ name: 'Billing lifecycle test ' + suffix, slug: 'billing-test-' + suffix }).returning();
  const [user] = await db.insert(users).values({ email: 'billing-' + suffix + '@example.test', firstName: 'Billing', lastName: 'Test', role: 'admin' }).returning();
  fixtures.push({ organizationId: organization.id, userId: user.id });
  const [customer] = await db.insert(customers).values({ organizationId: organization.id, companyName: 'Synthetic Customer ' + suffix, email: 'customer-' + suffix + '@example.test' }).returning();
  const [invoice] = await db.insert(invoices).values({
    organizationId: organization.id, invoiceNumber: Math.floor(Math.random() * 1_000_000_000),
    customerId: customer.id, createdByUserId: user.id, status,
    subtotal: '100.00', tax: '0.00', total: '100.00',
    subtotalCents: 10000, taxCents: 0, totalCents: 10000,
    amountPaid: '0.00', balanceDue: '100.00',
  }).returning();
  return { organization, user, customer, invoice };
}

async function readback(f: Awaited<ReturnType<typeof fixture>>) {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, f.invoice.id));
  const paymentRows = await db.select().from(payments).where(eq(payments.invoiceId, f.invoice.id));
  const creditApplications = await db.select().from(customerAccountCreditApplications).where(eq(customerAccountCreditApplications.invoiceId, f.invoice.id));
  const auditRows = await db.select().from(auditLogs).where(eq(auditLogs.organizationId, f.organization.id));
  return { invoice, paymentRows, creditApplications, auditRows };
}

async function pay(f: Awaited<ReturnType<typeof fixture>>, amountCents: number, key: string, staffSelection = true) {
  return recordCustomerPayment({
    organizationId: f.organization.id, actorUserId: f.user.id, expectedCustomerId: f.customer.id,
    invoiceIds: [f.invoice.id], amountCents, allocationMode: 'oldest_first', method: 'check',
    appliedAt: new Date('2026-10-16T12:00:00Z'), idempotencyKey: key, staffSelection,
    provider: 'manual',
  });
}

async function advance(f: Awaited<ReturnType<typeof fixture>>, amountCents: number) {
  return recordCustomerAdvance({
    organizationId: f.organization.id, customerId: f.customer.id, actorUserId: f.user.id,
    amountCents, idempotencyKey: 'advance-' + f.invoice.id, receivedMethod: 'check',
    receivedAt: new Date('2026-10-16T12:00:00Z'),
  });
}

async function apply(f: Awaited<ReturnType<typeof fixture>>, amountCents: number, key: string) {
  return applyCustomerCredit({
    organizationId: f.organization.id, customerId: f.customer.id, actorUserId: f.user.id,
    invoiceIds: [f.invoice.id], amountCents, allocationMode: 'oldest_first', idempotencyKey: key,
    appliedAt: new Date('2026-10-16T12:00:00Z'),
  });
}

afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await db.delete(payments).where(eq(payments.organizationId, f.organizationId));
    await db.delete(customerAccountCreditApplications).where(eq(customerAccountCreditApplications.organizationId, f.organizationId));
    await db.delete(customerAccountCreditApplicationBatches).where(eq(customerAccountCreditApplicationBatches.organizationId, f.organizationId));
    await db.delete(customerAccountCredits).where(eq(customerAccountCredits.organizationId, f.organizationId));
    await db.delete(customerPaymentBatches).where(eq(customerPaymentBatches.organizationId, f.organizationId));
    await db.delete(invoices).where(eq(invoices.organizationId, f.organizationId));
    await db.delete(customers).where(eq(customers.organizationId, f.organizationId));
    await db.delete(organizations).where(eq(organizations.id, f.organizationId));
    await db.delete(users).where(eq(users.id, f.userId));
  }
});

describe('customer settlement lifecycle on isolated PostgreSQL', () => {
  test('staff partial then full payment persists status and exactly one allocation per request', async () => {
    const f = await fixture('sent');
    const first = await pay(f, 3000, 'partial-' + f.invoice.id);
    const partial = await readback(f);
    expect(first.reused).toBe(false);
    expect(partial.invoice).toMatchObject({ status: 'partially_paid', amountPaid: '30.00', balanceDue: '70.00', totalCents: 10000 });
    expect(partial.paymentRows).toHaveLength(1);
    expect(partial.auditRows.filter(row => row.actionType === 'customer_payment_allocated')).toHaveLength(1);
    const full = await pay(f, 7000, 'full-' + f.invoice.id);
    const settled = await readback(f);
    expect(full.reused).toBe(false);
    expect(settled.invoice).toMatchObject({ status: 'paid', amountPaid: '100.00', balanceDue: '0.00', totalCents: 10000 });
    expect(settled.paymentRows.map(row => [row.id, row.amountCents, row.status])).toEqual(expect.arrayContaining([
      [first.payments[0].id, 3000, 'succeeded'], [full.payments[0].id, 7000, 'succeeded'],
    ]));
    expect(settled.auditRows.filter(row => row.actionType === 'customer_payment_allocated')).toHaveLength(2);
    expect((await pay(f, 7000, 'full-' + f.invoice.id)).reused).toBe(true);
    const replay = await readback(f);
    expect(replay.paymentRows).toHaveLength(2);
    expect(replay.auditRows.filter(row => row.actionType === 'customer_payment_allocated')).toHaveLength(2);
  });

  test('non-staff batch finalization also persists canonical paid status without provider writes', async () => {
    const f = await fixture();
    const result = await pay(f, 10000, 'finalize-' + f.invoice.id, false);
    const after = await readback(f);
    expect(result.reused).toBe(false);
    expect(after.invoice).toMatchObject({ status: 'paid', amountPaid: '100.00', balanceDue: '0.00' });
    expect(after.paymentRows).toHaveLength(1);
    expect(after.paymentRows[0]).toMatchObject({ provider: 'manual', syncStatus: 'skipped' });
    expect(after.auditRows.filter(row => row.actionType === 'customer_payment_allocated')).toHaveLength(1);
  });

  test('credit application and reversal preserve ledger evidence and recalculate lifecycle once', async () => {
    const f = await fixture('finalized');
    await advance(f, 10000);
    const applied = await apply(f, 4000, 'credit-partial-' + f.invoice.id);
    if (!applied.applications) throw new Error('Expected a new credit application');
    const partial = await readback(f);
    expect(partial.invoice).toMatchObject({ status: 'partially_paid', amountPaid: '40.00', balanceDue: '60.00' });
    expect(partial.creditApplications).toHaveLength(1);
    expect(partial.paymentRows).toHaveLength(1);
    expect((await apply(f, 4000, 'credit-partial-' + f.invoice.id)).reused).toBe(true);
    expect((await readback(f)).paymentRows).toHaveLength(1);
    const final = await apply(f, 6000, 'credit-final-' + f.invoice.id);
    if (!final.applications) throw new Error('Expected a new credit application');
    const settled = await readback(f);
    expect(settled.invoice).toMatchObject({ status: 'paid', amountPaid: '100.00', balanceDue: '0.00' });
    expect(settled.paymentRows).toHaveLength(2);
    expect(settled.creditApplications).toHaveLength(2);
    expect(settled.auditRows.filter(row => row.actionType === 'customer_account_credit_applied')).toHaveLength(2);
    await reverseCustomerCreditApplication({
      organizationId: f.organization.id, customerId: f.customer.id, actorUserId: f.user.id,
      applicationId: final.applications[0].id, reason: 'Synthetic correction',
    });
    const reversed = await readback(f);
    expect(reversed.invoice).toMatchObject({ status: 'partially_paid', amountPaid: '40.00', balanceDue: '60.00' });
    expect(reversed.creditApplications.find(row => row.id === final.applications[0].id)?.status).toBe('reversed');
    expect(reversed.paymentRows.find(row => row.customerAccountCreditApplicationId === final.applications[0].id)?.status).toBe('canceled');
    expect(reversed.paymentRows.find(row => row.customerAccountCreditApplicationId === applied.applications[0].id)?.status).toBe('succeeded');
    expect(reversed.auditRows.filter(row => row.actionType === 'customer_account_credit_application_reversed')).toHaveLength(1);
    await reverseCustomerCreditApplication({
      organizationId: f.organization.id, customerId: f.customer.id, actorUserId: f.user.id,
      applicationId: applied.applications[0].id, reason: 'Synthetic correction',
    });
    const reopened = await readback(f);
    expect(reopened.invoice).toMatchObject({ status: 'billed', amountPaid: '0.00', balanceDue: '100.00' });
    expect(reopened.paymentRows).toHaveLength(2);
    expect(reopened.creditApplications).toHaveLength(2);
    expect(reopened.auditRows.filter(row => row.actionType === 'customer_account_credit_application_reversed')).toHaveLength(2);
  });

  test.each(['void', 'canceled'])('%s Invoice rejects payment and credit without writes', async status => {
    const f = await fixture(status);
    await advance(f, 10000);
    const before = await readback(f);
    await expect(pay(f, 1000, 'blocked-' + f.invoice.id)).rejects.toMatchObject({ code: 'NO_PAYABLE_BALANCE' });
    await expect(apply(f, 1000, 'blocked-credit-' + f.invoice.id)).rejects.toMatchObject({ code: 'INVOICE_NOT_PAYABLE' });
    const after = await readback(f);
    expect(after.invoice.status).toBe(before.invoice.status);
    expect(after.paymentRows).toEqual(before.paymentRows);
    expect(after.creditApplications).toEqual(before.creditApplications);
    expect(after.auditRows).toEqual(before.auditRows);
  });

  test('historically locked imported Invoice rejects both paths without financial writes', async () => {
    const f = await fixture('paid');
    await db.update(invoices).set({ importSource: 'quickbooks', isHistorical: true, lockedReason: 'historical_import' }).where(eq(invoices.id, f.invoice.id));
    await advance(f, 10000);
    const before = await readback(f);
    await expect(pay(f, 1000, 'imported-' + f.invoice.id)).rejects.toMatchObject({ code: 'IMPORTED_AR_PAYMENT_REVIEW_REQUIRED' });
    await expect(apply(f, 1000, 'imported-credit-' + f.invoice.id)).rejects.toMatchObject({ code: 'IMPORTED_AR_CREDIT_REVIEW_REQUIRED' });
    const after = await readback(f);
    expect(after.invoice).toMatchObject({ status: 'paid', amountPaid: '0.00', balanceDue: '100.00', lockedReason: 'historical_import' });
    expect(after.paymentRows).toEqual(before.paymentRows);
    expect(after.creditApplications).toEqual(before.creditApplications);
    expect(after.auditRows).toEqual(before.auditRows);
  });
});
