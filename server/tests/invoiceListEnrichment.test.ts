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
  customers,
  invoiceEmailLogs,
  invoiceReminderLogs,
  invoiceReminderSettings,
  invoices,
  organizations,
  users,
} from '../../shared/schema';
import { getInvoiceEmailStatuses } from '../invoicesService';
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

async function createTestInvoice(opts: {
  orgId: string;
  customerId: string;
  userId: string;
  status?: string;
  daysOverdue?: number;
  balanceDue?: string;
  updatedAt?: Date;
}) {
  const {
    orgId, customerId, userId,
    status = 'billed',
    daysOverdue = 10,
    balanceDue = '100.00',
    updatedAt,
  } = opts;

  const dueDate = new Date(Date.now() - daysOverdue * 24 * 60 * 60 * 1000);

  const values: any = {
    organizationId: orgId,
    customerId,
    invoiceNumber: Math.floor(Math.random() * 90000) + 10000,
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
  await db.delete(customers)
    .where(inArray(customers.organizationId, cleanupOrgIds));
  await db.delete(organizations)
    .where(inArray(organizations.id, cleanupOrgIds));

  cleanupOrgIds.length = 0;
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
