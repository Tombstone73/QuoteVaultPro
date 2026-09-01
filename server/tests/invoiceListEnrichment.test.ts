/**
 * Integration tests for invoice list enrichment.
 *
 * Covers:
 * - getInvoiceEmailStatuses: type filter ensures reminder sends don't contaminate emailStatus
 * - getInvoiceListReminderInfo: batch reminder status derivation matches eligibility logic
 * - Edge cases: empty page, failed sends don't count, maxed_out, stopped statuses
 */

import { afterEach, beforeAll, describe, expect, test } from '@jest/globals';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import {
  customerContacts,
  customers,
  invoiceEmailLogs,
  invoiceReminderLogs,
  invoiceReminderSettings,
  invoices,
  orders,
  payments,
  organizations,
  users,
} from '../../shared/schema';
import { getInvoiceDashboardSummary, getInvoiceEmailStatuses, listInvoicesForOrganization, listInvoicesPageForOrganization } from '../invoicesService';
import {
  getInvoiceListReminderInfo,
  upsertInvoiceReminderSettingsForOrg,
} from '../invoiceReminderService';
import { runMigrations } from '../runMigrations';

beforeAll(async () => {
  await runMigrations();
}, 60_000);

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

const TS = Date.now();

async function createTestOrg(suffix: string) {
  const [org] = await db
    .insert(organizations)
    .values({ name: `Enrich Test Org ${suffix}`, slug: `enrich-test-${suffix}-${TS}` })
    .returning();
  return org;
}

async function createTestUser(orgId: string, suffix: string) {
  const [user] = await db
    .insert(users)
    .values({
      email: `enrich-test-user-${suffix}-${TS}@test.com`,
      firstName: 'Test',
      lastName: 'Enrichment',
      role: 'admin',
    })
    .returning();
  return user;
}

async function createTestCustomer(orgId: string) {
  const [customer] = await db
    .insert(customers)
    .values({
      organizationId: orgId,
      companyName: `Enrich Corp ${TS}`,
      email: `enrich-customer-${TS}@test.com`,
    })
    .returning();
  return customer;
}

async function createTestContact(orgId: string, customerId: string, suffix: string) {
  const [contact] = await db
    .insert(customerContacts)
    .values({
      organizationId: orgId,
      customerId,
      firstName: `Billing${suffix}`,
      lastName: 'Contact',
      email: `billing-${suffix}-${TS}@test.com`,
      isPrimary: true,
    })
    .returning();
  return contact;
}

async function createTestOrder(opts: {
  orgId: string;
  customerId: string;
  userId: string;
  contactId?: string | null;
  orderNumber?: string;
  poNumber?: string | null;
  label?: string | null;
}) {
  const [order] = await db
    .insert(orders)
    .values({
      organizationId: opts.orgId,
      orderNumber: opts.orderNumber ?? `ORD-${Math.floor(Math.random() * 90000) + 10000}`,
      customerId: opts.customerId,
      contactId: opts.contactId ?? null,
      poNumber: opts.poNumber ?? null,
      label: opts.label ?? null,
      subtotal: '100.00',
      tax: '0',
      total: '100.00',
      createdByUserId: opts.userId,
    })
    .returning();
  return order;
}

async function createTestInvoice(opts: {
  orgId: string;
  customerId: string;
  userId: string;
  orderId?: string | null;
  status?: string;
  daysOverdue?: number;
  balanceDue?: string;
  updatedAt?: Date;
  invoiceNumber?: number;
  customerPoNumber?: string | null;
  invoiceCreationSource?: 'manual' | 'automation';
  billingMilestone?: string | null;
  totalCents?: number;
  amountPaid?: string;
  displayNumber?: string | null;
  numberCore?: number | null;
}) {
  const {
    orgId, customerId, userId,
    orderId = null,
    status = 'billed',
    daysOverdue = 10,
    balanceDue = '100.00',
    updatedAt,
    invoiceNumber,
    customerPoNumber = null,
    invoiceCreationSource = 'manual',
    billingMilestone = null,
    totalCents = 10000,
    amountPaid = '0',
    displayNumber = null,
    numberCore = null,
  } = opts;

  const dueDate = new Date(Date.now() - daysOverdue * 24 * 60 * 60 * 1000);

  const values: any = {
    organizationId: orgId,
    customerId,
    orderId,
    invoiceNumber: invoiceNumber ?? Math.floor(Math.random() * 90000) + 10000,
    displayNumber,
    numberCore,
    status,
    terms: 'net_30',
    dueDate,
    totalCents,
    balanceDue,
    subtotalCents: totalCents,
    taxCents: 0,
    shippingCents: 0,
    total: (totalCents / 100).toFixed(2),
    subtotal: (totalCents / 100).toFixed(2),
    tax: '0',
    amountPaid,
    createdByUserId: userId,
    customerPoNumber,
    invoiceCreationSource,
    billingMilestone,
  };
  if (updatedAt) values.updatedAt = updatedAt;

  const [inv] = await db.insert(invoices).values(values).returning();
  return inv;
}

async function writeEmailLog(opts: {
  orgId: string;
  invoiceId: string;
  status: 'sent' | 'failed';
  type: 'invoice_send' | 'reminder_send';
  sentAt: Date;
  recipientEmail?: string;
}) {
  await db.insert(invoiceEmailLogs).values({
    organizationId: opts.orgId,
    invoiceId: opts.invoiceId,
    recipientEmail: opts.recipientEmail ?? 'test@example.com',
    status: opts.status,
    type: opts.type,
    sentAt: opts.sentAt,
  });
}

async function writeReminderLog(opts: {
  orgId: string;
  invoiceId: string;
  status: 'sent' | 'failed';
  sentAt: Date;
  recipientEmail?: string;
  reminderNumber?: number;
}) {
  await db.insert(invoiceReminderLogs).values({
    organizationId: opts.orgId,
    invoiceId: opts.invoiceId,
    reminderNumber: opts.reminderNumber ?? 1,
    recipientEmail: opts.recipientEmail ?? 'test@example.com',
    status: opts.status,
    sentAt: opts.sentAt,
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

const cleanupOrgIds: string[] = [];

afterEach(async () => {
  if (cleanupOrgIds.length === 0) return;

  await db.delete(invoiceReminderLogs)
    .where(inArray(invoiceReminderLogs.organizationId, cleanupOrgIds));
  await db.delete(invoiceEmailLogs)
    .where(inArray(invoiceEmailLogs.organizationId, cleanupOrgIds));
  await db.delete(payments)
    .where(inArray(payments.organizationId, cleanupOrgIds));
  await db.delete(invoiceReminderSettings)
    .where(inArray(invoiceReminderSettings.organizationId, cleanupOrgIds));
  await db.delete(invoices)
    .where(inArray(invoices.organizationId, cleanupOrgIds));
  await db.delete(orders)
    .where(inArray(orders.organizationId, cleanupOrgIds));
  const customerRows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(inArray(customers.organizationId, cleanupOrgIds));
  const customerIds = customerRows.map((row) => row.id);
  if (customerIds.length > 0) {
    await db.delete(customerContacts)
      .where(inArray(customerContacts.customerId, customerIds));
  }
  await db.delete(customers)
    .where(inArray(customers.organizationId, cleanupOrgIds));
  await db.delete(organizations)
    .where(inArray(organizations.id, cleanupOrgIds));

  cleanupOrgIds.length = 0;
});

// ---------------------------------------------------------------------------
// listInvoicesForOrganization
// ---------------------------------------------------------------------------

describe('listInvoicesForOrganization — review queue enrichment/search/sort', () => {
  test('returns real pagination metadata across a tenant-wide 263-invoice result', async () => {
    const org = await createTestOrg('pagination');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'pagination');
    const customer = await createTestCustomer(org.id);
    const dueDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = Array.from({ length: 263 }, (_, index) => {
      const invoiceNumber = 810000 + index;
      return {
        organizationId: org.id,
        customerId: customer.id,
        invoiceNumber,
        displayNumber: `INV-DASH-${invoiceNumber}`,
        numberCore: invoiceNumber,
        status: index === 200 ? 'paid' : 'billed',
        terms: 'net_30',
        dueDate,
        totalCents: 10000,
        balanceDue: index === 200 ? '0.00' : '100.00',
        subtotalCents: 10000,
        taxCents: 0,
        shippingCents: 0,
        total: '100.00',
        subtotal: '100.00',
        tax: '0',
        amountPaid: index === 200 ? '100.00' : '0.00',
        createdByUserId: user.id,
      };
    });
    await db.insert(invoices).values(rows as any);

    const first = await listInvoicesPageForOrganization({ organizationId: org.id, sortBy: 'invoiceNumber', sortDir: 'asc', limit: 50, offset: 0 });
    const second = await listInvoicesPageForOrganization({ organizationId: org.id, sortBy: 'invoiceNumber', sortDir: 'asc', limit: 50, offset: 50 });
    const finalPage = await listInvoicesPageForOrganization({ organizationId: org.id, sortBy: 'invoiceNumber', sortDir: 'asc', limit: 50, offset: 250 });

    expect(first).toMatchObject({ page: 1, pageSize: 50, totalCount: 263, totalPages: 6 });
    expect(first.items).toHaveLength(50);
    expect(second).toMatchObject({ page: 2, totalCount: 263, totalPages: 6 });
    expect(second.items).toHaveLength(50);
    expect(second.items[0]?.invoiceNumber).toBe(810050);
    expect(finalPage).toMatchObject({ page: 6, totalCount: 263, totalPages: 6 });
    expect(finalPage.items).toHaveLength(13);

    await expect(listInvoicesPageForOrganization({ organizationId: org.id, search: 'INV-DASH-810262', limit: 50 }))
      .resolves.toMatchObject({ totalCount: 1, items: [expect.objectContaining({ invoiceNumber: 810262 })] });
    await expect(listInvoicesPageForOrganization({ organizationId: org.id, status: 'paid', limit: 50 }))
      .resolves.toMatchObject({ totalCount: 1, items: [expect.objectContaining({ invoiceNumber: 810200 })] });
  });

  test('derives tenant-wide dashboard facts from canonical payment and QuickBooks balance rules', async () => {
    const org = await createTestOrg('dashboard-summary');
    cleanupOrgIds.push(org.id);
    await db.update(organizations).set({ settings: { timezone: 'America/New_York' } }).where(eq(organizations.id, org.id));
    const user = await createTestUser(org.id, 'dashboard-summary');
    const customer = await createTestCustomer(org.id);
    const dueDate = new Date('2026-08-10T12:00:00.000Z');
    const now = new Date('2026-08-20T12:00:00.000Z');
    const makeInvoice = async (overrides: Record<string, unknown>) => {
      const [invoice] = await db.insert(invoices).values({
        organizationId: org.id,
        customerId: customer.id,
        invoiceNumber: 820000 + Math.floor(Math.random() * 100000),
        status: 'billed', terms: 'net_30', dueDate,
        totalCents: 10000, subtotalCents: 10000, taxCents: 0, shippingCents: 0,
        total: '100.00', subtotal: '100.00', tax: '0', amountPaid: '0', balanceDue: '100.00',
        createdByUserId: user.id,
        ...overrides,
      } as any).returning();
      return invoice;
    };

    const unpaid = await makeInvoice({ invoiceNumber: 820001 });
    const partial = await makeInvoice({ invoiceNumber: 820002 });
    const paid = await makeInvoice({ invoiceNumber: 820003 });
    const reopened = await makeInvoice({ invoiceNumber: 820004 });
    await makeInvoice({ invoiceNumber: 820005, status: 'void' });
    await makeInvoice({ invoiceNumber: 820006, importSource: 'quickbooks', isHistorical: true, qbImportBalanceDue: '0.00', status: 'paid', balanceDue: '0.00', amountPaid: '100.00' });
    await makeInvoice({ invoiceNumber: 820007, importSource: 'quickbooks', qbImportBalanceDue: '40.00', balanceDue: '40.00' });

    const monthPaymentAt = new Date('2026-08-12T12:00:00.000Z');
    await db.insert(payments).values([
      { organizationId: org.id, invoiceId: partial.id, provider: 'manual', method: 'check', status: 'succeeded', amount: '30.00', amountCents: 3000, paidAt: monthPaymentAt, createdByUserId: user.id },
      { organizationId: org.id, invoiceId: paid.id, provider: 'manual', method: 'check', status: 'succeeded', amount: '100.00', amountCents: 10000, paidAt: monthPaymentAt, createdByUserId: user.id },
      { organizationId: org.id, invoiceId: reopened.id, provider: 'stripe', method: 'credit_card', status: 'refunded', amount: '20.00', amountCents: 2000, refundedAt: monthPaymentAt, createdByUserId: user.id },
    ] as any);

    const summary = await getInvoiceDashboardSummary(org.id, { now });

    expect(summary).toEqual({
      totalInvoices: 7,
      totalOutstandingCents: 31000,
      overdueCount: 4,
      paidThisMonthCents: 13000,
    });
    // Keep the variables referenced so the fixture names document their roles.
    expect(unpaid.id).toBeTruthy();
  });

  test('returns linked customer, contact, order name, PO, and order number fields', async () => {
    const org = await createTestOrg('list-fields');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'lf');
    const customer = await createTestCustomer(org.id);
    const contact = await createTestContact(org.id, customer.id, 'fields');
    const order = await createTestOrder({
      orgId: org.id,
      customerId: customer.id,
      userId: user.id,
      contactId: contact.id,
      orderNumber: '1013',
      poNumber: 'PO-ELITE-77',
      label: 'Elite Coroplast Pickup',
    });
    const inv = await createTestInvoice({
      orgId: org.id,
      customerId: customer.id,
      userId: user.id,
      orderId: order.id,
      status: 'draft',
      invoiceNumber: 70013,
    });

    const rows = await listInvoicesForOrganization({ organizationId: org.id });

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(inv.id);
    expect(rows[0].customerName).toBe(customer.companyName);
    expect(rows[0].companyName).toBe(customer.companyName);
    expect(rows[0].contactName).toBe('Billingfields Contact');
    expect(rows[0].contactEmail).toBe(contact.email);
    expect(rows[0].orderNumber).toBe('1013');
    expect(rows[0].orderName).toBe('Elite Coroplast Pickup');
    expect(rows[0].jobName).toBe('Elite Coroplast Pickup');
    expect(rows[0].purchaseOrderNumber).toBe('PO-ELITE-77');
  });

  test('search matches customer name, contact email, PO number, order number, and job name', async () => {
    const org = await createTestOrg('list-search');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'ls');
    const customer = await createTestCustomer(org.id);
    const otherCustomer = await createTestCustomer(org.id);
    const contact = await createTestContact(org.id, customer.id, 'search');
    const order = await createTestOrder({
      orgId: org.id,
      customerId: customer.id,
      userId: user.id,
      contactId: contact.id,
      orderNumber: 'ORD-SEARCH-42',
      poNumber: 'PO-SEARCH-99',
      label: 'Searchable Banner Job',
    });
    const matching = await createTestInvoice({
      orgId: org.id,
      customerId: customer.id,
      userId: user.id,
      orderId: order.id,
      invoiceNumber: 71001,
    });
    await createTestInvoice({
      orgId: org.id,
      customerId: otherCustomer.id,
      userId: user.id,
      invoiceNumber: 71002,
    });

    await expect(listInvoicesForOrganization({ organizationId: org.id, search: customer.companyName }))
      .resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: matching.id })]));
    await expect(listInvoicesForOrganization({ organizationId: org.id, search: 'PO-SEARCH-99' }))
      .resolves.toEqual([expect.objectContaining({ id: matching.id })]);
    await expect(listInvoicesForOrganization({ organizationId: org.id, search: 'ORD-SEARCH-42' }))
      .resolves.toEqual([expect.objectContaining({ id: matching.id })]);
    await expect(listInvoicesForOrganization({ organizationId: org.id, search: contact.email! }))
      .resolves.toEqual([expect.objectContaining({ id: matching.id })]);
    await expect(listInvoicesForOrganization({ organizationId: org.id, search: 'Searchable Banner' }))
      .resolves.toEqual([expect.objectContaining({ id: matching.id })]);
  });

  test('sorting by customer and due date uses enriched fields', async () => {
    const org = await createTestOrg('list-sort');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'sort');
    const zCustomer = await createTestCustomer(org.id);
    const aCustomer = await createTestCustomer(org.id);
    await db.update(customers).set({ companyName: 'Zeta Signs' }).where(eq(customers.id, zCustomer.id));
    await db.update(customers).set({ companyName: 'Alpha Graphics' }).where(eq(customers.id, aCustomer.id));

    const oldInvoice = await createTestInvoice({
      orgId: org.id,
      customerId: zCustomer.id,
      userId: user.id,
      invoiceNumber: 72001,
    });
    const newInvoice = await createTestInvoice({
      orgId: org.id,
      customerId: aCustomer.id,
      userId: user.id,
      invoiceNumber: 72002,
    });
    await db.update(invoices).set({ dueDate: new Date('2026-01-01T00:00:00Z') }).where(eq(invoices.id, oldInvoice.id));
    await db.update(invoices).set({ dueDate: new Date('2026-02-01T00:00:00Z') }).where(eq(invoices.id, newInvoice.id));

    const byCustomer = await listInvoicesForOrganization({ organizationId: org.id, sortBy: 'customer', sortDir: 'asc' });
    expect(byCustomer.map((row) => row.customerName)).toEqual(['Alpha Graphics', 'Zeta Signs']);

    const byDueDate = await listInvoicesForOrganization({ organizationId: org.id, sortBy: 'dueDate', sortDir: 'desc' });
    expect(byDueDate.map((row) => row.id)).toEqual([newInvoice.id, oldInvoice.id]);
  });

  test('automation draft invoices appear with linked order and customer context', async () => {
    const org = await createTestOrg('automation-draft-context');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'adc');
    const customer = await createTestCustomer(org.id);
    const order = await createTestOrder({
      orgId: org.id,
      customerId: customer.id,
      userId: user.id,
      orderNumber: '1013',
      poNumber: 'PO-AUTO-READY',
      label: 'Ready for Pickup Billing Job',
    });
    const invoice = await createTestInvoice({
      orgId: org.id,
      customerId: customer.id,
      userId: user.id,
      orderId: order.id,
      status: 'draft',
      invoiceNumber: 73001,
      invoiceCreationSource: 'automation',
      billingMilestone: 'ready_for_pickup_or_ready_to_ship',
    });

    const rows = await listInvoicesForOrganization({ organizationId: org.id, status: 'draft' });

    expect(rows).toEqual([
      expect.objectContaining({
        id: invoice.id,
        invoiceCreationSource: 'automation',
        billingMilestone: 'ready_for_pickup_or_ready_to_ship',
        customerName: customer.companyName,
        orderNumber: '1013',
        purchaseOrderNumber: 'PO-AUTO-READY',
        orderName: 'Ready for Pickup Billing Job',
      }),
    ]);
  });

  test('invoice smoke fixture-shaped rows are enriched with contact, order name, PO, and order number', async () => {
    const org = await createTestOrg('smoke-fixture-enrichment');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'sfe');
    const customer = await createTestCustomer(org.id);
    await db.update(customers).set({ companyName: 'Portal Test Customer' }).where(eq(customers.id, customer.id));
    const contact = await createTestContact(org.id, customer.id, 'smoke');
    await db.update(customerContacts).set({
      firstName: 'Test Billing',
      lastName: 'Contact',
      email: 'invoice-smoke@example.test',
    }).where(eq(customerContacts.id, contact.id));
    const order = await createTestOrder({
      orgId: org.id,
      customerId: customer.id,
      userId: user.id,
      contactId: contact.id,
      orderNumber: 'ORD-INVOICE-SMOKE-DRAFT-A',
      poNumber: 'TEST-PO-INVOICE-SMOKE',
      label: 'Invoice Smoke Test Order - Draft A',
    });
    const invoice = await createTestInvoice({
      orgId: org.id,
      customerId: customer.id,
      userId: user.id,
      orderId: order.id,
      status: 'draft',
      invoiceNumber: 910102,
      displayNumber: 'INV-910102',
      numberCore: 910102,
    });

    const rows = await listInvoicesForOrganization({ organizationId: org.id, search: 'INV-910102' });

    expect(rows).toEqual([
      expect.objectContaining({
        id: invoice.id,
        customerName: 'Portal Test Customer',
        contactName: 'Test Billing Contact',
        contactEmail: 'invoice-smoke@example.test',
        orderNumber: 'ORD-INVOICE-SMOKE-DRAFT-A',
        purchaseOrderNumber: 'TEST-PO-INVOICE-SMOKE',
        jobName: 'Invoice Smoke Test Order - Draft A',
        orderName: 'Invoice Smoke Test Order - Draft A',
      }),
    ]);
  });

  test('sorting by invoice number uses numeric sequence for INV-prefixed display numbers', async () => {
    const org = await createTestOrg('sort-invoice-number');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'sin');
    const customer = await createTestCustomer(org.id);

    const inv99 = await createTestInvoice({
      orgId: org.id,
      customerId: customer.id,
      userId: user.id,
      invoiceNumber: 99,
      numberCore: 99,
      displayNumber: 'INV-99',
    });
    const inv100 = await createTestInvoice({
      orgId: org.id,
      customerId: customer.id,
      userId: user.id,
      invoiceNumber: 100,
      numberCore: 100,
      displayNumber: 'INV-100',
    });

    const rows = await listInvoicesForOrganization({ organizationId: org.id, sortBy: 'invoiceNumber', sortDir: 'asc' });

    expect(rows.map((row) => row.id)).toEqual([inv99.id, inv100.id]);
  });

  test('sorting by balance uses payment-row computed remaining balance', async () => {
    const org = await createTestOrg('sort-balance-payments');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'sbp');
    const customer = await createTestCustomer(org.id);

    const unpaid = await createTestInvoice({
      orgId: org.id,
      customerId: customer.id,
      userId: user.id,
      invoiceNumber: 74001,
      totalCents: 10000,
      amountPaid: '0.00',
      balanceDue: '100.00',
    });
    const mostlyPaid = await createTestInvoice({
      orgId: org.id,
      customerId: customer.id,
      userId: user.id,
      invoiceNumber: 74002,
      totalCents: 10000,
      amountPaid: '0.00',
      balanceDue: '100.00',
    });
    await db.insert(payments).values({
      organizationId: org.id,
      invoiceId: mostlyPaid.id,
      amount: '75.00',
      amountCents: 7500,
      status: 'succeeded',
      method: 'check',
      provider: 'manual',
      createdByUserId: user.id,
    } as any);

    const rows = await listInvoicesForOrganization({ organizationId: org.id, sortBy: 'balance', sortDir: 'asc' });

    expect(rows.map((row) => row.id)).toEqual([mostlyPaid.id, unpaid.id]);
  });
});

// ---------------------------------------------------------------------------
// getInvoiceEmailStatuses
// ---------------------------------------------------------------------------

describe('getInvoiceEmailStatuses — type filtering', () => {
  test('invoice never emailed returns not_sent', async () => {
    const org = await createTestOrg('never-sent');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'ns');
    const customer = await createTestCustomer(org.id);
    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id });

    const statuses = await getInvoiceEmailStatuses([{ id: inv.id, updatedAt: inv.updatedAt }], org.id);
    const s = statuses.get(inv.id)!;
    expect(s.emailStatus).toBe('not_sent');
    expect(s.lastSentAt).toBeNull();
    expect(s.lastInvoiceEmailRecipient).toBeNull();
  });

  test('invoice with invoice_send returns sent_current', async () => {
    const org = await createTestOrg('invoice-send');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'is');
    const customer = await createTestCustomer(org.id);
    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id });

    const sentAt = new Date(Date.now() + 5000); // sent after updatedAt
    await writeEmailLog({ orgId: org.id, invoiceId: inv.id, status: 'sent', type: 'invoice_send', sentAt, recipientEmail: 'customer@test.com' });

    const statuses = await getInvoiceEmailStatuses([{ id: inv.id, updatedAt: inv.updatedAt }], org.id);
    const s = statuses.get(inv.id)!;
    expect(s.emailStatus).toBe('sent_current');
    expect(s.lastSentAt).not.toBeNull();
    expect(s.lastInvoiceEmailRecipient).toBe('customer@test.com');
  });

  test('reminder_send log does NOT make invoice appear sent', async () => {
    const org = await createTestOrg('reminder-contamination');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'rc');
    const customer = await createTestCustomer(org.id);
    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id });

    // Only a reminder send — no original invoice send
    const sentAt = new Date(Date.now() + 5000);
    await writeEmailLog({ orgId: org.id, invoiceId: inv.id, status: 'sent', type: 'reminder_send', sentAt });

    const statuses = await getInvoiceEmailStatuses([{ id: inv.id, updatedAt: inv.updatedAt }], org.id);
    const s = statuses.get(inv.id)!;
    // Must still be not_sent — reminder did not count
    expect(s.emailStatus).toBe('not_sent');
    expect(s.lastSentAt).toBeNull();
  });

  test('failed invoice_send does NOT make invoice appear sent', async () => {
    const org = await createTestOrg('failed-send');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'fs');
    const customer = await createTestCustomer(org.id);
    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id });

    await writeEmailLog({ orgId: org.id, invoiceId: inv.id, status: 'failed', type: 'invoice_send', sentAt: new Date() });

    const statuses = await getInvoiceEmailStatuses([{ id: inv.id, updatedAt: inv.updatedAt }], org.id);
    const s = statuses.get(inv.id)!;
    expect(s.emailStatus).toBe('not_sent');
    expect(s.lastSentAt).toBeNull();
  });

  test('invoice updated after send returns sent_outdated', async () => {
    const org = await createTestOrg('outdated');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'od');
    const customer = await createTestCustomer(org.id);

    const sentAt = new Date('2026-01-01T10:00:00Z');
    const updatedAt = new Date('2026-01-02T10:00:00Z'); // updated AFTER send

    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id, updatedAt });
    await writeEmailLog({ orgId: org.id, invoiceId: inv.id, status: 'sent', type: 'invoice_send', sentAt });

    const statuses = await getInvoiceEmailStatuses([{ id: inv.id, updatedAt }], org.id);
    const s = statuses.get(inv.id)!;
    expect(s.emailStatus).toBe('sent_outdated');
  });

  test('empty page returns empty map without crashing', async () => {
    const statuses = await getInvoiceEmailStatuses([], 'any-org-id');
    expect(statuses.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getInvoiceListReminderInfo
// ---------------------------------------------------------------------------

describe('getInvoiceListReminderInfo — reminder status enrichment', () => {
  async function makeEnabledSettings(orgId: string, overrides: Record<string, unknown> = {}) {
    return upsertInvoiceReminderSettingsForOrg(orgId, {
      enabled: true,
      firstReminderDaysAfterDue: 3,
      repeatIntervalDays: 7,
      maxReminders: 5,
      sendCopyToInternalEmail: false,
      internalCopyEmail: null,
      pauseForManualBillingCustomers: false,
      ...overrides,
    } as any);
  }

  test('eligible overdue invoice returns reminderStatus=due', async () => {
    const org = await createTestOrg('rl-eligible');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'rle');
    const customer = await createTestCustomer(org.id);
    const settings = await makeEnabledSettings(org.id);

    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id, daysOverdue: 10 });

    const infoMap = await getInvoiceListReminderInfo(
      [{ id: inv.id, invoiceNumber: inv.invoiceNumber, status: inv.status, dueDate: inv.dueDate, totalCents: inv.totalCents, balanceDue: inv.balanceDue }],
      org.id,
      settings,
    );

    const info = infoMap.get(inv.id)!;
    expect(info.reminderStatus).toBe('due');
    expect(info.lastReminderSentAt).toBeNull();
    expect(info.lastReminderRecipient).toBeNull();
  });

  test('reminder sent recently returns reminderStatus=sent', async () => {
    const org = await createTestOrg('rl-sent');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'rls');
    const customer = await createTestCustomer(org.id);
    const settings = await makeEnabledSettings(org.id, { repeatIntervalDays: 7 });

    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id, daysOverdue: 10 });

    // Sent 1 day ago → too soon (interval = 7 days)
    const sentAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    await writeReminderLog({ orgId: org.id, invoiceId: inv.id, status: 'sent', sentAt, recipientEmail: 'cust@test.com' });

    const infoMap = await getInvoiceListReminderInfo(
      [{ id: inv.id, invoiceNumber: inv.invoiceNumber, status: inv.status, dueDate: inv.dueDate, totalCents: inv.totalCents, balanceDue: inv.balanceDue }],
      org.id,
      settings,
    );

    const info = infoMap.get(inv.id)!;
    expect(info.reminderStatus).toBe('sent');
    expect(info.lastReminderSentAt).not.toBeNull();
    expect(info.lastReminderRecipient).toBe('cust@test.com');
  });

  test('failed reminder log does NOT count toward too_soon', async () => {
    const org = await createTestOrg('rl-failed-reminder');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'rlfr');
    const customer = await createTestCustomer(org.id);
    const settings = await makeEnabledSettings(org.id, { repeatIntervalDays: 7 });

    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id, daysOverdue: 10 });

    // Only a failed reminder log — should not affect eligibility
    await writeReminderLog({ orgId: org.id, invoiceId: inv.id, status: 'failed', sentAt: new Date() });

    const infoMap = await getInvoiceListReminderInfo(
      [{ id: inv.id, invoiceNumber: inv.invoiceNumber, status: inv.status, dueDate: inv.dueDate, totalCents: inv.totalCents, balanceDue: inv.balanceDue }],
      org.id,
      settings,
    );

    const info = infoMap.get(inv.id)!;
    // Still eligible — failed attempt doesn't block
    expect(info.reminderStatus).toBe('due');
    expect(info.lastReminderSentAt).toBeNull();
  });

  test('disabled settings returns reminderStatus=disabled', async () => {
    const org = await createTestOrg('rl-disabled');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'rld');
    const customer = await createTestCustomer(org.id);
    const settings = await upsertInvoiceReminderSettingsForOrg(org.id, {
      enabled: false,
      firstReminderDaysAfterDue: 3,
      repeatIntervalDays: 7,
      maxReminders: 5,
      sendCopyToInternalEmail: false,
      internalCopyEmail: null,
      pauseForManualBillingCustomers: false,
    } as any);

    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id, daysOverdue: 10 });

    const infoMap = await getInvoiceListReminderInfo(
      [{ id: inv.id, invoiceNumber: inv.invoiceNumber, status: inv.status, dueDate: inv.dueDate, totalCents: inv.totalCents, balanceDue: inv.balanceDue }],
      org.id,
      settings,
    );

    expect(infoMap.get(inv.id)!.reminderStatus).toBe('disabled');
  });

  test('paid invoice returns reminderStatus=stopped', async () => {
    const org = await createTestOrg('rl-paid');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'rlp');
    const customer = await createTestCustomer(org.id);
    const settings = await makeEnabledSettings(org.id);

    const inv = await createTestInvoice({
      orgId: org.id,
      customerId: customer.id,
      userId: user.id,
      daysOverdue: 10,
      balanceDue: '0.00',
      status: 'paid',
    });

    const infoMap = await getInvoiceListReminderInfo(
      [{ id: inv.id, invoiceNumber: inv.invoiceNumber, status: inv.status, dueDate: inv.dueDate, totalCents: inv.totalCents, balanceDue: inv.balanceDue }],
      org.id,
      settings,
    );

    expect(infoMap.get(inv.id)!.reminderStatus).toBe('stopped');
  });

  test('max reminders reached returns reminderStatus=maxed_out', async () => {
    const org = await createTestOrg('rl-maxed');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'rlm');
    const customer = await createTestCustomer(org.id);
    const settings = await makeEnabledSettings(org.id, { maxReminders: 2, repeatIntervalDays: 7 });

    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id, daysOverdue: 30 });

    // Write 2 sent reminders (= max)
    const now = Date.now();
    await writeReminderLog({ orgId: org.id, invoiceId: inv.id, status: 'sent', sentAt: new Date(now - 20 * 24 * 60 * 60 * 1000), reminderNumber: 1 });
    await writeReminderLog({ orgId: org.id, invoiceId: inv.id, status: 'sent', sentAt: new Date(now - 13 * 24 * 60 * 60 * 1000), reminderNumber: 2 });

    const infoMap = await getInvoiceListReminderInfo(
      [{ id: inv.id, invoiceNumber: inv.invoiceNumber, status: inv.status, dueDate: inv.dueDate, totalCents: inv.totalCents, balanceDue: inv.balanceDue }],
      org.id,
      settings,
    );

    expect(infoMap.get(inv.id)!.reminderStatus).toBe('maxed_out');
  });

  test('empty page returns empty map without crashing', async () => {
    const infoMap = await getInvoiceListReminderInfo([], 'any-org');
    expect(infoMap.size).toBe(0);
  });

  test('not overdue invoice returns reminderStatus=not_due', async () => {
    const org = await createTestOrg('rl-not-due');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'rlnd');
    const customer = await createTestCustomer(org.id);
    const settings = await makeEnabledSettings(org.id);

    // daysOverdue = -5 (due in the future)
    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id, daysOverdue: -5 });

    const infoMap = await getInvoiceListReminderInfo(
      [{ id: inv.id, invoiceNumber: inv.invoiceNumber, status: inv.status, dueDate: inv.dueDate, totalCents: inv.totalCents, balanceDue: inv.balanceDue }],
      org.id,
      settings,
    );

    expect(infoMap.get(inv.id)!.reminderStatus).toBe('not_due');
  });
});
