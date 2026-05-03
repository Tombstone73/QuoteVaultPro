/**
 * Integration tests for the invoice reminder job execution layer.
 *
 * Uses the real test database for data setup and verification.
 * Mocks email sending, PDF generation, and email config via injectable deps.
 *
 * Tests cover:
 * - Eligible invoice → sends reminder, writes sent log
 * - Failed send → writes failed log, continues to next invoice
 * - Paid invoice → skipped
 * - Void invoice → skipped
 * - Draft invoice → skipped
 * - Disabled settings → skips org
 * - Max reminders reached → skipped
 * - Repeat interval prevents early duplicate
 * - Second run does not duplicate within same interval
 * - Job returns accurate summary counts
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
import {
  runInvoiceReminderJob,
  sendManualInvoiceReminder,
  type ReminderJobDeps,
} from '../invoiceReminderJob';
import { upsertInvoiceReminderSettingsForOrg } from '../invoiceReminderService';
import { runMigrations } from '../runMigrations';

// Apply all pending migrations before tests run so reminder tables exist.
beforeAll(async () => {
  await runMigrations();
}, 60_000);

// ---------------------------------------------------------------------------
// Mock deps factory
// ---------------------------------------------------------------------------

function makeMockDeps(overrides: Partial<ReminderJobDeps> = {}): ReminderJobDeps & {
  sentEmails: Array<{ to: string; subject: string }>;
  emailLogWrites: Array<{ status: string; invoiceId: string }>;
} {
  const sentEmails: Array<{ to: string; subject: string }> = [];
  const emailLogWrites: Array<{ status: string; invoiceId: string }> = [];

  return {
    sentEmails,
    emailLogWrites,
    sendEmail: async (_orgId: string, opts: any) => {
      sentEmails.push({ to: opts.to, subject: opts.subject });
      return `mock-msg-${Date.now()}`;
    },
    writeEmailLog: async (input: any) => {
      emailLogWrites.push({ status: input.status, invoiceId: input.invoiceId });
    },
    getEmailConfig: async (_orgId: string) => ({ provider: 'gmail', id: 'test' }),
    generatePdf: async (_opts: any) => new Uint8Array(Buffer.from('fake-pdf')),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

const TS = Date.now();

async function createTestOrg(suffix: string) {
  const [org] = await db
    .insert(organizations)
    .values({ name: `Reminder Test Org ${suffix}`, slug: `reminder-test-${suffix}-${TS}` })
    .returning();
  return org;
}

async function createTestUser(orgId: string, suffix: string) {
  const [user] = await db
    .insert(users)
    .values({
      email: `reminder-test-user-${suffix}-${TS}@test.com`,
      firstName: 'Test',
      lastName: 'User',
      role: 'admin',
    })
    .returning();
  return user;
}

async function createTestCustomer(orgId: string, email = `customer-${TS}@acme.com`) {
  const [customer] = await db
    .insert(customers)
    .values({
      organizationId: orgId,
      companyName: `Acme Corp ${TS}`,
      email,
    })
    .returning();
  return customer;
}

async function createTestInvoice(opts: {
  orgId: string;
  customerId: string;
  userId: string;
  status?: string;
  balanceDueCents?: number;
  daysOverdue?: number;
}) {
  const {
    orgId,
    customerId,
    userId,
    status = 'billed',
    balanceDueCents = 5000,
    daysOverdue = 10,
  } = opts;

  const dueDate = new Date(Date.now() - daysOverdue * 24 * 60 * 60 * 1000);
  const balanceDue = (balanceDueCents / 100).toFixed(2);

  const [inv] = await db
    .insert(invoices)
    .values({
      organizationId: orgId,
      customerId,
      invoiceNumber: Math.floor(Math.random() * 90000) + 10000,
      status,
      terms: 'net_30',
      dueDate,
      totalCents: balanceDueCents,
      balanceDue,
      subtotalCents: balanceDueCents,
      taxCents: 0,
      shippingCents: 0,
      total: balanceDue,
      subtotal: balanceDue,
      tax: '0',
      amountPaid: '0',
      createdByUserId: userId,
    })
    .returning();
  return inv;
}

async function createTestReminderSettings(
  orgId: string,
  overrides: Record<string, unknown> = {},
) {
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

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------

const cleanupInvoiceIds: string[] = [];
const cleanupOrgIds: string[] = [];
const cleanupUserIds: string[] = [];
const cleanupCustomerIds: string[] = [];

afterEach(async () => {
  if (cleanupOrgIds.length > 0) {
    for (const orgId of cleanupOrgIds) {
      try {
        await db.delete(invoiceReminderLogs).where(eq(invoiceReminderLogs.organizationId, orgId));
        await db.delete(invoiceEmailLogs).where(eq(invoiceEmailLogs.organizationId, orgId));
        await db.delete(invoiceReminderSettings).where(eq(invoiceReminderSettings.organizationId, orgId));
        await db.delete(invoices).where(eq(invoices.organizationId, orgId));
        await db.delete(customers).where(eq(customers.organizationId, orgId));
        await db.delete(organizations).where(eq(organizations.id, orgId));
      } catch (_) { /* best-effort cleanup */ }
    }
    cleanupOrgIds.length = 0;
  }
  cleanupInvoiceIds.length = 0;
  cleanupUserIds.length = 0;
  cleanupCustomerIds.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runInvoiceReminderJob', () => {
  test('eligible invoice: sends reminder and writes sent log', async () => {
    const org = await createTestOrg('eligible');
    const user = await createTestUser(org.id, 'eligible');
    const customer = await createTestCustomer(org.id);
    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id });
    await createTestReminderSettings(org.id);
    cleanupOrgIds.push(org.id);
    cleanupUserIds.push(user.id);

    const deps = makeMockDeps();
    const summary = await runInvoiceReminderJob(new Date(), deps);

    expect(summary.remindersSent).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.remindersFailed).toBe(0);
    expect(deps.sentEmails).toHaveLength(1);
    expect(deps.sentEmails[0].to).toBe(customer.email);
    expect(deps.sentEmails[0].subject).toMatch(/REMINDER/i);

    // Verify DB log was written with status = 'sent'
    const logs = await db
      .select()
      .from(invoiceReminderLogs)
      .where(and(eq(invoiceReminderLogs.invoiceId, inv.id), eq(invoiceReminderLogs.status, 'sent')));
    expect(logs).toHaveLength(1);
    expect(logs[0].reminderNumber).toBe(1);
    expect(logs[0].recipientEmail).toBe(customer.email);
  });

  test('failed send: writes failed log and continues to next invoice', async () => {
    const org = await createTestOrg('fail');
    const user = await createTestUser(org.id, 'fail');
    const cust1 = await createTestCustomer(org.id, `fail1-${TS}@acme.com`);
    const cust2 = await createTestCustomer(org.id, `fail2-${TS}@acme.com`);
    const inv1 = await createTestInvoice({ orgId: org.id, customerId: cust1.id, userId: user.id });
    const inv2 = await createTestInvoice({ orgId: org.id, customerId: cust2.id, userId: user.id });
    await createTestReminderSettings(org.id);
    cleanupOrgIds.push(org.id);
    cleanupUserIds.push(user.id);

    let callCount = 0;
    const deps = makeMockDeps({
      sendEmail: async (_orgId: string, opts: any) => {
        callCount++;
        if (callCount === 1) throw new Error('SMTP timeout');
        (deps as any).sentEmails.push({ to: opts.to, subject: opts.subject });
        return `mock-msg-${Date.now()}`;
      },
    });

    const summary = await runInvoiceReminderJob(new Date(), deps);

    // One failed, one succeeded (or both attempted)
    expect(summary.remindersFailed + summary.remindersSent).toBe(2);
    // Job does not throw even though one failed
    expect(Array.isArray(summary.errors)).toBe(true);

    // Failed log exists
    const failedLogs = await db
      .select()
      .from(invoiceReminderLogs)
      .where(and(eq(invoiceReminderLogs.organizationId, org.id), eq(invoiceReminderLogs.status, 'failed')));
    expect(failedLogs.length).toBeGreaterThanOrEqual(1);
  });

  test('paid invoice (balanceDueCents = 0): skipped', async () => {
    const org = await createTestOrg('paid');
    const user = await createTestUser(org.id, 'paid');
    const customer = await createTestCustomer(org.id, `paid-${TS}@acme.com`);
    await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id, balanceDueCents: 0 });
    await createTestReminderSettings(org.id);
    cleanupOrgIds.push(org.id);
    cleanupUserIds.push(user.id);

    const deps = makeMockDeps();
    const summary = await runInvoiceReminderJob(new Date(), deps);

    expect(summary.remindersSent).toBe(0);
    expect(deps.sentEmails).toHaveLength(0);
  });

  test('void invoice: skipped', async () => {
    const org = await createTestOrg('void');
    const user = await createTestUser(org.id, 'void');
    const customer = await createTestCustomer(org.id, `void-${TS}@acme.com`);
    await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id, status: 'void' });
    await createTestReminderSettings(org.id);
    cleanupOrgIds.push(org.id);
    cleanupUserIds.push(user.id);

    const deps = makeMockDeps();
    const summary = await runInvoiceReminderJob(new Date(), deps);

    expect(summary.remindersSent).toBe(0);
    expect(deps.sentEmails).toHaveLength(0);
  });

  test('draft invoice: skipped', async () => {
    const org = await createTestOrg('draft');
    const user = await createTestUser(org.id, 'draft');
    const customer = await createTestCustomer(org.id, `draft-${TS}@acme.com`);
    await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id, status: 'draft' });
    await createTestReminderSettings(org.id);
    cleanupOrgIds.push(org.id);
    cleanupUserIds.push(user.id);

    const deps = makeMockDeps();
    const summary = await runInvoiceReminderJob(new Date(), deps);

    // draft invoices are filtered by getCandidateInvoicesForReminderRun (NOT IN ('draft','void'))
    expect(deps.sentEmails).toHaveLength(0);
  });

  test('disabled settings: skips org entirely', async () => {
    const org = await createTestOrg('disabled');
    const user = await createTestUser(org.id, 'disabled');
    const customer = await createTestCustomer(org.id, `disabled-${TS}@acme.com`);
    await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id });
    await createTestReminderSettings(org.id, { enabled: false });
    cleanupOrgIds.push(org.id);
    cleanupUserIds.push(user.id);

    const deps = makeMockDeps();
    const summary = await runInvoiceReminderJob(new Date(), deps);

    // disabled org is not returned by getAllEnabledReminderSettings
    expect(deps.sentEmails).toHaveLength(0);
    // org with disabled settings doesn't show up in organizationsChecked
    // (the job fetches only enabled settings)
    expect(summary.remindersSent).toBe(0);
  });

  test('max reminders reached: skipped', async () => {
    const org = await createTestOrg('maxrem');
    const user = await createTestUser(org.id, 'maxrem');
    const customer = await createTestCustomer(org.id, `maxrem-${TS}@acme.com`);
    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id });
    await createTestReminderSettings(org.id, { maxReminders: 1, repeatIntervalDays: 7 });
    cleanupOrgIds.push(org.id);
    cleanupUserIds.push(user.id);

    // Pre-write a successful log to simulate max already reached
    await db.insert(invoiceReminderLogs).values({
      organizationId: org.id,
      invoiceId: inv.id,
      reminderNumber: 1,
      sentAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      status: 'sent',
      recipientEmail: customer.email,
    });

    const deps = makeMockDeps();
    const summary = await runInvoiceReminderJob(new Date(), deps);

    expect(summary.remindersSent).toBe(0);
    expect(deps.sentEmails).toHaveLength(0);
  });

  test('repeat interval: too soon after last reminder, skipped', async () => {
    const org = await createTestOrg('toosoon');
    const user = await createTestUser(org.id, 'toosoon');
    const customer = await createTestCustomer(org.id, `toosoon-${TS}@acme.com`);
    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id });
    await createTestReminderSettings(org.id, { repeatIntervalDays: 7, maxReminders: 5 });
    cleanupOrgIds.push(org.id);
    cleanupUserIds.push(user.id);

    // Pre-write a successful log sent only 2 days ago
    await db.insert(invoiceReminderLogs).values({
      organizationId: org.id,
      invoiceId: inv.id,
      reminderNumber: 1,
      sentAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      status: 'sent',
      recipientEmail: customer.email,
    });

    const deps = makeMockDeps();
    const summary = await runInvoiceReminderJob(new Date(), deps);

    expect(summary.remindersSent).toBe(0);
    expect(deps.sentEmails).toHaveLength(0);
    expect(summary.skipped).toBeGreaterThan(0);
  });

  test('second run does not duplicate: idempotency after successful first run', async () => {
    const org = await createTestOrg('idempotent');
    const user = await createTestUser(org.id, 'idempotent');
    const customer = await createTestCustomer(org.id, `idempotent-${TS}@acme.com`);
    await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id });
    await createTestReminderSettings(org.id, { repeatIntervalDays: 7, maxReminders: 5 });
    cleanupOrgIds.push(org.id);
    cleanupUserIds.push(user.id);

    const deps = makeMockDeps();

    // First run — should send
    const summary1 = await runInvoiceReminderJob(new Date(), deps);
    expect(summary1.remindersSent).toBe(1);

    // Second run immediately after — should be blocked by repeat interval
    const deps2 = makeMockDeps();
    const summary2 = await runInvoiceReminderJob(new Date(), deps2);
    expect(summary2.remindersSent).toBe(0);
    expect(deps2.sentEmails).toHaveLength(0);
  });

  test('failed logs do not count toward max reminders or repeat interval', async () => {
    const org = await createTestOrg('failcount');
    const user = await createTestUser(org.id, 'failcount');
    const customer = await createTestCustomer(org.id, `failcount-${TS}@acme.com`);
    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id });
    await createTestReminderSettings(org.id, { maxReminders: 1, repeatIntervalDays: 7 });
    cleanupOrgIds.push(org.id);
    cleanupUserIds.push(user.id);

    // Pre-write a FAILED log (should not count as sent)
    await db.insert(invoiceReminderLogs).values({
      organizationId: org.id,
      invoiceId: inv.id,
      reminderNumber: 1,
      sentAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      status: 'failed',
      recipientEmail: customer.email,
      failureReason: 'Test failure',
    });

    const deps = makeMockDeps();
    const summary = await runInvoiceReminderJob(new Date(), deps);

    // Failed log should NOT count — invoice is still eligible for first reminder
    expect(summary.remindersSent).toBe(1);
    expect(deps.sentEmails).toHaveLength(1);
  });

  test('job returns accurate summary counts', async () => {
    const org = await createTestOrg('counts');
    const user = await createTestUser(org.id, 'counts');
    // Two eligible invoices, two skipped (paid)
    const cust = await createTestCustomer(org.id, `counts-${TS}@acme.com`);
    const cust2 = await createTestCustomer(org.id, `counts2-${TS}@acme.com`);
    const cust3 = await createTestCustomer(org.id, `counts3-${TS}@acme.com`);
    const cust4 = await createTestCustomer(org.id, `counts4-${TS}@acme.com`);
    await createTestInvoice({ orgId: org.id, customerId: cust.id, userId: user.id });
    await createTestInvoice({ orgId: org.id, customerId: cust2.id, userId: user.id });
    await createTestInvoice({ orgId: org.id, customerId: cust3.id, userId: user.id, balanceDueCents: 0 }); // paid
    await createTestInvoice({ orgId: org.id, customerId: cust4.id, userId: user.id, status: 'void' }); // void
    await createTestReminderSettings(org.id);
    cleanupOrgIds.push(org.id);
    cleanupUserIds.push(user.id);

    const deps = makeMockDeps();
    const summary = await runInvoiceReminderJob(new Date(), deps);

    expect(summary.organizationsChecked).toBeGreaterThanOrEqual(1);
    expect(summary.remindersSent).toBe(2);
    expect(summary.remindersFailed).toBe(0);
    // 2 paid + void invoices are filtered out before eligibility check by getCandidateInvoicesForReminderRun
    // So invoicesChecked = 2 (only billed with balance > 0)
    expect(summary.invoicesChecked).toBeGreaterThanOrEqual(2);
  });

  test('no email config for org: org is skipped entirely', async () => {
    const org = await createTestOrg('noemail');
    const user = await createTestUser(org.id, 'noemail');
    const customer = await createTestCustomer(org.id, `noemail-${TS}@acme.com`);
    await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id });
    await createTestReminderSettings(org.id);
    cleanupOrgIds.push(org.id);
    cleanupUserIds.push(user.id);

    const deps = makeMockDeps({
      getEmailConfig: async () => null, // No email config
    });
    const summary = await runInvoiceReminderJob(new Date(), deps);

    expect(summary.remindersSent).toBe(0);
    expect(deps.sentEmails).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// sendManualInvoiceReminder
// ---------------------------------------------------------------------------

describe('sendManualInvoiceReminder', () => {
  const CALLER = { userId: 'test-user-id', userName: 'Test User' };

  test('success: sends reminder, writes reminder log and email log', async () => {
    const org = await createTestOrg('manual-ok');
    const user = await createTestUser(org.id, 'mok');
    const customer = await createTestCustomer(org.id);
    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id });
    cleanupOrgIds.push(org.id);
    cleanupUserIds.push(user.id);

    const deps = makeMockDeps();
    const result = await sendManualInvoiceReminder({
      invoiceId: inv.id,
      organizationId: org.id,
      ...CALLER,
      deps,
    });

    expect(result.success).toBe(true);
    expect(result.reminderCount).toBe(1);
    expect(result.lastReminderSentAt).toBeInstanceOf(Date);

    // Reminder log written
    const rLogs = await db
      .select()
      .from(invoiceReminderLogs)
      .where(and(eq(invoiceReminderLogs.invoiceId, inv.id), eq(invoiceReminderLogs.status, 'sent')));
    expect(rLogs).toHaveLength(1);
    expect(rLogs[0].reminderNumber).toBe(1);
    expect(rLogs[0].recipientEmail).toBe(customer.email);

    // Email log written with type = 'reminder_send'
    const eLogs = await db
      .select()
      .from(invoiceEmailLogs)
      .where(and(eq(invoiceEmailLogs.invoiceId, inv.id), eq(invoiceEmailLogs.status, 'sent')));
    expect(eLogs).toHaveLength(1);
    expect((eLogs[0] as any).type).toBe('reminder_send');
  });

  test('blocked for paid invoice: returns success=false', async () => {
    const org = await createTestOrg('manual-paid');
    const user = await createTestUser(org.id, 'mpd');
    const customer = await createTestCustomer(org.id);
    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id, status: 'paid' });
    cleanupOrgIds.push(org.id);
    cleanupUserIds.push(user.id);

    const deps = makeMockDeps();
    const result = await sendManualInvoiceReminder({
      invoiceId: inv.id,
      organizationId: org.id,
      ...CALLER,
      deps,
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/paid/i);
    expect(deps.sentEmails).toHaveLength(0);
  });

  test('blocked for void invoice: returns success=false', async () => {
    const org = await createTestOrg('manual-void');
    const user = await createTestUser(org.id, 'mvd');
    const customer = await createTestCustomer(org.id);
    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id, status: 'void' });
    cleanupOrgIds.push(org.id);
    cleanupUserIds.push(user.id);

    const deps = makeMockDeps();
    const result = await sendManualInvoiceReminder({
      invoiceId: inv.id,
      organizationId: org.id,
      ...CALLER,
      deps,
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/void/i);
    expect(deps.sentEmails).toHaveLength(0);
  });

  test('idempotency: blocks rapid duplicate send within 5 minutes', async () => {
    const org = await createTestOrg('manual-idem');
    const user = await createTestUser(org.id, 'mid');
    const customer = await createTestCustomer(org.id);
    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id });
    cleanupOrgIds.push(org.id);
    cleanupUserIds.push(user.id);

    const deps = makeMockDeps();
    // First send succeeds
    const first = await sendManualInvoiceReminder({ invoiceId: inv.id, organizationId: org.id, ...CALLER, deps });
    expect(first.success).toBe(true);

    // Immediate second send should be blocked
    const second = await sendManualInvoiceReminder({ invoiceId: inv.id, organizationId: org.id, ...CALLER, deps });
    expect(second.success).toBe(false);
    expect(second.message).toMatch(/recently sent/i);
    // Email not sent a second time
    expect(deps.sentEmails).toHaveLength(1);
  });

  test('reminder number increments with each successful send', async () => {
    const org = await createTestOrg('manual-num');
    const user = await createTestUser(org.id, 'mn');
    const customer = await createTestCustomer(org.id);
    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id });
    cleanupOrgIds.push(org.id);
    cleanupUserIds.push(user.id);

    // Pre-seed a successful reminder log from 10 minutes ago (outside idempotency window)
    await db.insert(invoiceReminderLogs).values({
      organizationId: org.id,
      invoiceId: inv.id,
      reminderNumber: 1,
      sentAt: new Date(Date.now() - 10 * 60 * 1000),
      status: 'sent',
      recipientEmail: customer.email ?? null,
      messageId: 'prior-msg',
      failureReason: null,
    });

    const deps = makeMockDeps();
    const result = await sendManualInvoiceReminder({ invoiceId: inv.id, organizationId: org.id, ...CALLER, deps });
    expect(result.success).toBe(true);
    expect(result.reminderCount).toBe(2);

    const rLogs = await db
      .select()
      .from(invoiceReminderLogs)
      .where(and(eq(invoiceReminderLogs.invoiceId, inv.id), eq(invoiceReminderLogs.status, 'sent')));
    expect(rLogs).toHaveLength(2);
    const numbers = rLogs.map((l) => l.reminderNumber).sort();
    expect(numbers).toEqual([1, 2]);
  });

  test('failed send: writes failed reminder log, returns success=false', async () => {
    const org = await createTestOrg('manual-fail');
    const user = await createTestUser(org.id, 'mf');
    const customer = await createTestCustomer(org.id);
    const inv = await createTestInvoice({ orgId: org.id, customerId: customer.id, userId: user.id });
    cleanupOrgIds.push(org.id);
    cleanupUserIds.push(user.id);

    const deps = makeMockDeps({
      sendEmail: async () => { throw new Error('SMTP timeout'); },
    });
    const result = await sendManualInvoiceReminder({ invoiceId: inv.id, organizationId: org.id, ...CALLER, deps });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/SMTP timeout|Failed/i);

    // Failed reminder log should have been written
    const rLogs = await db
      .select()
      .from(invoiceReminderLogs)
      .where(and(eq(invoiceReminderLogs.invoiceId, inv.id), eq(invoiceReminderLogs.status, 'failed')));
    expect(rLogs).toHaveLength(1);
    expect(rLogs[0].failureReason).toBeTruthy();

    // Failed log does NOT count toward the idempotency window
    const sent = await db
      .select()
      .from(invoiceReminderLogs)
      .where(and(eq(invoiceReminderLogs.invoiceId, inv.id), eq(invoiceReminderLogs.status, 'sent')));
    expect(sent).toHaveLength(0);
  });

  test('invoice not found: returns success=false without crash', async () => {
    const org = await createTestOrg('manual-404');
    const user = await createTestUser(org.id, 'm404');
    cleanupOrgIds.push(org.id);
    cleanupUserIds.push(user.id);

    const deps = makeMockDeps();
    const result = await sendManualInvoiceReminder({
      invoiceId: 'nonexistent-id',
      organizationId: org.id,
      ...CALLER,
      deps,
    });

    expect(result.success).toBe(false);
    expect(deps.sentEmails).toHaveLength(0);
  });
});
