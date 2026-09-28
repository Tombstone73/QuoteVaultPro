import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import express from 'express';
import request from 'supertest';
const update = jest.fn<any>();
const acknowledge = jest.fn<any>();
jest.unstable_mockModule('../services/orders/canonicalOrderOperations', () => ({ canonicalOrderOperations: { updateEditableHeader: update } }));
jest.unstable_mockModule('../db', () => ({ db: {} }));
jest.unstable_mockModule('../tenantContext', () => ({ getRequestOrganizationId: (req: any) => req.organizationId }));
jest.unstable_mockModule('../services/billingOwnershipReview.service', () => ({
  acknowledgeBillingOwnershipReview: acknowledge, getBillingOwnershipReview: jest.fn(),
  requireBillingOwnershipReviewer: (role: string) => { if (!['admin', 'owner'].includes(role)) throw Object.assign(new Error('Admin or Owner required.'), { statusCode: 403 }); },
}));
let app: express.Express;
beforeAll(async () => {
  const { registerBillingOwnershipRoutes } = await import('../routes/billingOwnership.routes');
  app = express(); app.use(express.json());
  registerBillingOwnershipRoutes(app, {
    isAuthenticated: (req: any, _res: any, next: any) => { req.user = { id: 'staff', isAdmin: true }; next(); },
    tenantContext: (req: any, _res: any, next: any) => { req.organizationId = 'tenant-from-session'; req.actorOrgRole = req.headers['x-test-role'] || 'employee'; next(); },
  });
});
beforeEach(() => { update.mockReset().mockResolvedValue({ id: 'order' }); acknowledge.mockReset().mockResolvedValue(undefined); });
const body = { customerId: null, contactId: 'janet', invoiceId: 'invoice', invoiceVersion: 3, orderUpdatedAt: '2026-09-28T17:00:00.000Z', reason: 'Correct billing identity.', confirmed: true };
describe('billing ownership override HTTP boundary', () => {
  test('global admin flags and forged body roles cannot bypass organization membership', async () => {
    expect((await request(app).post('/api/orders/order/billing-ownership-override').send({ ...body, actorOrgRole: 'owner' })).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });
  test.each(['admin', 'owner'])('%s uses the existing canonical transaction with session tenant/actor', async role => {
    expect((await request(app).post('/api/orders/order/billing-ownership-override').set('x-test-role', role).send(body)).status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'tenant-from-session', actorUserId: 'staff', actorOrgRole: role,
      changes: { customerId: null, contactId: 'janet' }, billingOwnershipOverride: expect.objectContaining({ confirmed: true, reason: body.reason }) }));
  });
  test.each([{ confirmed: false }, { reason: ' ' }, { total: '0' }, { organizationId: 'other-tenant' }, { invoiceVersion: 0 }])('rejects invalid or additional fields %j', async patch => {
    expect((await request(app).post('/api/orders/order/billing-ownership-override').set('x-test-role', 'admin').send({ ...body, ...patch })).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
  test('acknowledgment requires organization role, explicit confirmation, and a note', async () => {
    const path = '/api/invoices/invoice/billing-ownership-review/resolve';
    expect((await request(app).post(path).send({ overrideId: 'event', reason: 'Corrected', confirmed: true })).status).toBe(403);
    expect((await request(app).post(path).set('x-test-role', 'admin').send({ overrideId: 'event', reason: '', confirmed: true })).status).toBe(400);
    expect((await request(app).post(path).set('x-test-role', 'admin').send({ overrideId: 'event', reason: 'Corrected in QB', confirmed: true })).status).toBe(200);
    expect(acknowledge).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'tenant-from-session', overrideId: 'event', actorUserId: 'staff' }));
  });
});
