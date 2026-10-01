import { beforeEach, expect, jest, test } from '@jest/globals';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import express from 'express';
import request from 'supertest';

let invoice: any;
let hold = false;
const updates: any[] = [];
const audits: any[] = [];
const lock = jest.fn<any>();
const dialect = new PgDialect();
const database: any = {
  transaction: async (work: any) => work(database), execute: async () => ({}),
  select: () => {
    let tableName = ''; let params: unknown[] = [];
    const q: any = { from: (table: any) => { tableName = getTableName(table); return q; },
      where: (where: any) => { params = dialect.sqlToQuery(where).params; return q; },
      limit: async () => tableName === 'invoices' ? (params.includes(invoice.id) && params.includes(invoice.organizationId) ? [{ ...invoice }] : [])
        : tableName === 'organizations' ? [{ settings: { preferences: { quickbooks: { autoQueueApprovedInvoices: true } } } }]
        : [{ paymentTerms: 'due_on_receipt' }],
    }; return q;
  },
  update: () => ({ set: (patch: any) => ({ where: async (where: any) => {
    const params = dialect.sqlToQuery(where).params;
    expect(params).toContain(invoice.organizationId); expect(params).toContain(invoice.id);
    updates.push(patch); Object.assign(invoice, patch);
  } }) }),
  insert: () => ({ values: async (event: any) => { audits.push(event); } }),
};
jest.unstable_mockModule('../db', () => ({ db: database }));
jest.unstable_mockModule('../services/invoicePaymentSession.service', () => ({ lockInvoicePaymentContext: lock }));
jest.unstable_mockModule('../services/billingOwnershipReview.service', () => ({ getBillingOwnershipReview: async () => hold ? {} : null }));
const { releaseInvoiceToCustomer } = await import('../services/invoiceCustomerRelease.service');
const { approveInvoicesForAccounting } = await import('../services/invoiceAccountingApproval.service');
const { registerInvoiceCustomerReleaseRoutes } = await import('../routes/invoiceCustomerRelease.routes');
const input = { organizationId: 'org', invoiceId: 'invoice', actorUserId: 'operator', actorUserName: 'Operator' };
beforeEach(() => {
  invoice = { id: 'invoice', organizationId: 'org', customerId: 'customer', status: 'draft', invoiceNumber: 20001, invoiceVersion: 2,
    accountingApprovedAt: null, accountingApprovedByUserId: null, accountingApprovedVersion: null, qbSyncStatus: 'not_synced', terms: 'due_on_receipt' };
  updates.length = 0; audits.length = 0; hold = false; lock.mockClear();
});

test('release writes only customer checkpoints and audit; retry is idempotent', async () => {
  const original = { ...invoice };
  const result = await releaseInvoiceToCustomer(input);
  expect(lock).toHaveBeenCalledWith(database, 'org', ['invoice']);
  expect(invoice).toMatchObject(original);
  expect(Object.keys(updates[0]).sort()).toEqual(['customerReleasedAt', 'customerReleasedByUserId', 'updatedAt']);
  expect(audits[0]).toMatchObject({ actionType: 'invoice_customer_released', organizationId: 'org', entityId: 'invoice', userId: 'operator', newValues: { source: 'staff_manual', invoiceVersion: 2 } });
  expect(await releaseInvoiceToCustomer(input)).toEqual({ releasedAt: result.releasedAt, alreadyReleased: true });
  expect(updates).toHaveLength(1); expect(audits).toHaveLength(1);
});

test('approval after release retains the release checkpoint and uses existing approval operation', async () => {
  const release = await releaseInvoiceToCustomer(input);
  const result = await approveInvoicesForAccounting({ organizationId: 'org', invoiceIds: ['invoice'], actorUserId: 'accountant' });
  expect(result.approved).toBe(1);
  expect(invoice.accountingApprovedVersion).toBe(2);
  expect(invoice.customerReleasedAt).toEqual(release.releasedAt);
  expect(invoice.accountingApprovedByUserId).toBe('accountant');
});

test('cross-tenant and held invoices cannot be released', async () => {
  await expect(releaseInvoiceToCustomer({ ...input, organizationId: 'other-org' })).rejects.toThrow('not found');
  hold = true;
  await expect(releaseInvoiceToCustomer(input)).rejects.toThrow();
  expect(updates).toHaveLength(0); expect(audits).toHaveLength(0);
});

function app(role = 'owner', preview = false, withPermission = true) {
  const app = express();
  registerInvoiceCustomerReleaseRoutes(app, {
    isAuthenticated: (req: any, _res, next) => { req.user = { id: 'operator' }; next(); },
    tenantContext: (req: any, _res, next) => { req.organizationId = 'org'; req.staffPortalPreview = preview; next(); },
    ...(withPermission ? { requireOrgOwnerAdmin: (_req: any, res: any, next: any) => ['owner', 'admin'].includes(role) ? next() : res.sendStatus(403) } : {}),
  }); return app;
}

test.each(['member', 'customer', 'unknown'])('unauthorized %s cannot release via HTTP', async role => {
  expect((await request(app(role)).post('/api/invoices/invoice/release-to-customer')).status).toBe(403);
  expect(updates).toHaveLength(0);
});
test('preview and missing permission middleware fail closed', async () => {
  expect((await request(app('owner', true)).post('/api/invoices/invoice/release-to-customer')).status).toBe(403);
  expect((await request(app('owner', false, false)).post('/api/invoices/invoice/release-to-customer')).status).toBe(403);
  expect(updates).toHaveLength(0);
});
test('list/detail release endpoint is idempotent and ignores body approval/queue injection', async () => {
  const server = app('admin');
  expect((await request(server).post('/api/invoices/invoice/release-to-customer').send({ accountingApprovedAt: 'now', qbSyncStatus: 'pending' })).status).toBe(200);
  expect((await request(server).post('/api/invoices/invoice/release-to-customer')).body.data.alreadyReleased).toBe(true);
  expect(invoice.accountingApprovedAt).toBeNull(); expect(invoice.qbSyncStatus).toBe('not_synced');
  expect(audits).toHaveLength(1);
});
