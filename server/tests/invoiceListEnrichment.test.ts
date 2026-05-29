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
  organizations,
  users,
} from '../../shared/schema';
import { getInvoiceEmailStatuses, listInvoicesForOrganization } from '../invoicesService';
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

async function createTestContact(customerId: string, suffix: string) {
  const [contact] = await db
    .insert(customerContacts)
    .values({
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
  } = opts;

  const dueDate = new Date(Date.now() - daysOverdue * 24 * 60 * 60 * 1000);

  const values: any = {
    organizationId: orgId,
    customerId,
    orderId,
    invoiceNumber: invoiceNumber ?? Math.floor(Math.random() * 90000) + 10000,
    status,
    terms: 'net_30',
    dueDate,
    totalCents: 10000,
    balanceDue,
    subtotalCents: 10000,
    taxCents: 0,
    shippingCents: 0,
    total: balanceDue,
    subtotal: balanceDue,
    tax: '0',
    amountPaid: '0',
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
  test('returns linked customer, contact, order name, PO, and order number fields', async () => {
    const org = await createTestOrg('list-fields');
    cleanupOrgIds.push(org.id);
    const user = await createTestUser(org.id, 'lf');
    const customer = await createTestCustomer(org.id);
    const contact = await createTestContact(customer.id, 'fields');
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
    const contact = await createTestContact(customer.id, 'search');
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
