import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { firstApprovalInvoiceDate } from '../lib/invoiceDocumentDate';

let invoice: any;
let organizationTimezone = 'America/New_York';
const updates: any[] = [];
const audits: any[] = [];
const dialect = new PgDialect();
const database: any = {
  transaction: async (work: any) => work(database),
  execute: async () => ({}),
  select: () => {
    let tableName = '';
    let params: unknown[] = [];
    const query: any = {
      from: (table: any) => { tableName = getTableName(table); return query; },
      where: (where: any) => { params = dialect.sqlToQuery(where).params; return query; },
      limit: async () => tableName === 'invoices'
        ? (params.includes(invoice.id) && params.includes(invoice.organizationId) ? [{ ...invoice }] : [])
        : tableName === 'organizations'
          ? [{ settings: { timezone: organizationTimezone, preferences: { quickbooks: { autoQueueApprovedInvoices: false } } } }]
          : [{ paymentTerms: 'net_30' }],
    };
    return query;
  },
  update: () => ({ set: (patch: any) => ({ where: async () => { updates.push(patch); Object.assign(invoice, patch); } }) }),
  insert: () => ({ values: async (event: any) => { audits.push(event); } }),
};
jest.unstable_mockModule('../db', () => ({ db: database }));
jest.unstable_mockModule('../services/invoicePaymentSession.service', () => ({ lockInvoicePaymentContext: async () => {} }));
jest.unstable_mockModule('../services/billingOwnershipReview.service', () => ({ getBillingOwnershipReview: async () => null }));
const { approveInvoicesForAccounting } = await import('../services/invoiceAccountingApproval.service');

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-09T03:30:00.000Z')); // October 8 in New York
  organizationTimezone = 'America/New_York';
  invoice = {
    id: 'invoice-1', organizationId: 'org-1', customerId: 'customer-1', status: 'billed',
    invoiceNumber: 20001, invoiceVersion: 1, terms: 'net_30',
    createdAt: new Date('2026-10-05T16:00:00.000Z'),
    issueDate: new Date('2026-10-05T16:00:00.000Z'),
    issuedAt: new Date('2026-10-05T16:00:00.000Z'),
    accountingApprovedAt: null, accountingApprovedVersion: null,
    qbSyncStatus: 'not_synced', syncStatus: 'pending',
  };
  updates.length = 0;
  audits.length = 0;
});
afterEach(() => jest.useRealTimers());

test('first approval replaces the draft date with the organization business date and preserves creation time', async () => {
  const result = await approveInvoicesForAccounting({ organizationId: 'org-1', invoiceIds: ['invoice-1'], actorUserId: 'accountant' });
  expect(result.approved).toBe(1);
  expect(invoice.createdAt.toISOString()).toBe('2026-10-05T16:00:00.000Z');
  expect(invoice.issueDate.toISOString()).toBe('2026-10-08T12:00:00.000Z');
  expect(invoice.issuedAt).toEqual(invoice.issueDate);
  expect(invoice.accountingApprovedAt.toISOString()).toBe('2026-10-09T03:30:00.000Z');
  expect(invoice.termsStartedAt).toEqual(invoice.accountingApprovedAt);
  expect(invoice.dueDate.toISOString()).toBe('2026-11-07T12:00:00.000Z');
  expect(audits[0].newValues).toMatchObject({ approvedAt: '2026-10-09T03:30:00.000Z', invoiceDate: '2026-10-08' });
});

test('reapproval after revocation keeps the first document date', async () => {
  await approveInvoicesForAccounting({ organizationId: 'org-1', invoiceIds: ['invoice-1'] });
  const originalDate = invoice.issueDate;
  const originalTermsStart = invoice.termsStartedAt;
  invoice.invoiceVersion = 2;
  invoice.accountingApprovedAt = null;
  invoice.accountingApprovalRevokedAt = new Date('2026-10-10T12:00:00.000Z');
  jest.setSystemTime(new Date('2026-10-11T13:00:00.000Z'));
  await approveInvoicesForAccounting({ organizationId: 'org-1', invoiceIds: ['invoice-1'] });
  expect(invoice.issueDate).toBe(originalDate);
  expect(invoice.issuedAt).toBe(originalDate);
  expect(invoice.termsStartedAt).toBe(originalTermsStart);
  expect(invoice.accountingApprovedAt.toISOString()).toBe('2026-10-11T13:00:00.000Z');
  expect(audits[1].newValues.invoiceDate).toBe('2026-10-08');
});

test('automatic first approval uses the same Invoice Date rule', async () => {
  await approveInvoicesForAccounting({ organizationId: 'org-1', invoiceIds: ['invoice-1'], source: 'invoice_delivery_automation' });
  expect(invoice.issueDate.toISOString().slice(0, 10)).toBe('2026-10-08');
  expect(audits[0].newValues.source).toBe('invoice_delivery_automation');
});

test('draft created and first approved on the same business day uses approval day', async () => {
  invoice.createdAt = new Date('2026-10-08T15:00:00.000Z');
  invoice.issueDate = invoice.createdAt;
  invoice.issuedAt = invoice.createdAt;
  await approveInvoicesForAccounting({ organizationId: 'org-1', invoiceIds: ['invoice-1'] });
  expect(invoice.issueDate.toISOString()).toBe('2026-10-08T12:00:00.000Z');
  expect(invoice.createdAt.toISOString()).toBe('2026-10-08T15:00:00.000Z');
});

test('historical/imported Invoice is never redated by native approval', async () => {
  invoice.importSource = 'quickbooks';
  const result = await approveInvoicesForAccounting({ organizationId: 'org-1', invoiceIds: ['invoice-1'] });
  expect(result.skipped).toBe(1);
  expect(updates).toHaveLength(0);
  expect(invoice.issueDate.toISOString()).toBe('2026-10-05T16:00:00.000Z');
});

test('existing provider-linked Invoice preserves its accounting date', async () => {
  invoice.qbInvoiceId = 'qb-123';
  await approveInvoicesForAccounting({ organizationId: 'org-1', invoiceIds: ['invoice-1'] });
  expect(updates[0]).not.toHaveProperty('issueDate');
  expect(invoice.issueDate.toISOString()).toBe('2026-10-05T16:00:00.000Z');
});

test('organization timezone determines the calendar Invoice Date at a UTC boundary', () => {
  const instant = new Date('2026-10-09T03:30:00.000Z');
  expect(firstApprovalInvoiceDate(instant, 'America/New_York').toISOString()).toBe('2026-10-08T12:00:00.000Z');
  expect(firstApprovalInvoiceDate(instant, 'Asia/Tokyo').toISOString()).toBe('2026-10-09T12:00:00.000Z');
});
