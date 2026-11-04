import { beforeEach, expect, jest, test } from '@jest/globals';
import type { Request } from 'express';
import express from 'express';
import request from 'supertest';
import { portalRoleAllows, unsupportedPortalPricingFields, type PortalAction } from '@shared/portalPermissions';
import { portalPaymentLimiter, portalRateLimitKey } from '../middleware/portalRateLimit';

const paymentCapability = jest.fn<(...args: unknown[]) => Promise<boolean>>();
jest.unstable_mockModule('../services/staffPortalPreviewService', () => ({
  canExecuteStaffPortalPreviewPayment: paymentCapability,
  resolveActiveStaffPortalPreview: async () => null,
  isStaffPortalPreviewReadMethod: (method: string) => ['GET', 'HEAD', 'OPTIONS'].includes(method),
  PORTAL_PREVIEW_PAYMENT_EXECUTE: 'customer_portal_preview.payment_execute',
}));
const { requirePortalAction } = await import('../services/portalAuthorization');
const { registerPortalRoutes } = await import('../routes/portal.routes');
const portal = await import('../services/portal.service');

function actor(role: string) {
  return { organizationId: 'org', portalCustomerId: 'customer',
    portalCustomer: { id: 'customer', organizationId: 'org' }, user: { id: 'user' },
    portalAccess: { id: 'access', status: 'ACTIVE', userId: 'user', organizationId: 'org',
      customerId: 'customer', contactId: null, accessRole: role }, body: {} } as unknown as Request;
}

beforeEach(() => { paymentCapability.mockReset().mockResolvedValue(false); });

test.each(['order', 'quote', 'proof', 'file', 'payment', 'profile'] as PortalAction[])('role matrix for %s', async action => {
  for (const role of ['VIEWER', 'BILLING', 'BUYER', 'COMPANY_ADMIN', 'unknown']) {
    const allowed = role === 'COMPANY_ADMIN' || (role === 'BUYER' && action !== 'profile') || (role === 'BILLING' && action === 'payment');
    expect(portalRoleAllows(role, action)).toBe(allowed);
    if (allowed) await expect(requirePortalAction(actor(role), action)).resolves.toBeUndefined();
    else await expect(requirePortalAction(actor(role), action)).rejects.toMatchObject({ statusCode: 403 });
  }
});

test('missing, inactive and mismatched tenant/customer/user contexts fail closed', async () => {
  for (const patch of [{ portalAccess: null }, { portalAccess: { ...actor('BUYER').portalAccess as object, status: 'SUSPENDED' } },
    { organizationId: 'other' }, { portalCustomerId: 'other' }, { user: { id: 'other' } }]) {
    await expect(requirePortalAction(Object.assign(actor('BUYER'), patch), 'quote')).rejects.toMatchObject({ statusCode: 403 });
  }
});

test('verified guest payment and authorized staff payment exceptions do not grant other mutations', async () => {
  const guest = Object.assign(actor('VIEWER'), { guestPaymentScope: { invoiceId: 'verified-by-existing-token-route' } });
  await expect(requirePortalAction(guest, 'payment')).resolves.toBeUndefined();
  await expect(requirePortalAction(guest, 'quote')).rejects.toMatchObject({ statusCode: 403 });
  const preview = Object.assign(actor('COMPANY_ADMIN'), { staffPortalPreview: {} });
  await expect(requirePortalAction(preview, 'payment')).rejects.toMatchObject({ statusCode: 403 });
  paymentCapability.mockResolvedValue(true);
  await expect(requirePortalAction(preview, 'payment')).resolves.toBeUndefined();
  await expect(requirePortalAction(preview, 'profile')).rejects.toMatchObject({ statusCode: 403 });
});

test('all mutation families deny Viewer at the real service boundary', async () => {
  const req = actor('VIEWER');
  const attempts = [() => portal.approvePortalQuote(req, 'quote'), () => portal.declinePortalQuote(req, 'quote'),
    () => portal.requestPortalQuoteRevision(req, 'quote'), () => portal.approvePortalProof(req, 'proof'),
    () => portal.rejectPortalProof(req, 'proof'), () => portal.requestPortalProofRevision(req, 'proof'),
    () => portal.updatePortalProfile(req), () => portal.submitPortalOrderFile(req, 'order'),
    () => portal.submitPortalQuoteFile(req, 'quote'), () => portal.createPortalStripePaymentIntent(req, 'invoice'),
    () => portal.createPortalGroupedStripePaymentIntent(req), () => portal.confirmPortalStripePayment(req, 'invoice'),
    () => portal.confirmPortalGroupedStripePayment(req), () => portal.recoverPortalGroupedStripePayment(req)];
  for (const attempt of attempts) await expect(attempt()).rejects.toMatchObject({ statusCode: 403 });
});

test('actual Quote approval route returns 403 rather than creating an Order or masking the denial', async () => {
  const app = express();
  app.use(express.json());
  registerPortalRoutes(app, { isAuthenticated: (req: Request, _res: unknown, next: () => void) => { Object.assign(req, actor('VIEWER')); next(); },
    portalContext: (_req: unknown, _res: unknown, next: () => void) => next(), tenantContext: (_req: unknown, _res: unknown, next: () => void) => next() });
  const response = await request(app).post('/api/portal/quotes/quote/approve').send({});
  expect(response.status).toBe(403);
  expect(response.body.message).toMatch(/portal role/i);
});

test('authenticated rate keys isolate user and tenant; unsupported pricing fields are explicit', () => {
  expect(portalRateLimitKey(actor('BUYER'))).not.toBe(portalRateLimitKey(Object.assign(actor('BUYER'), { organizationId: 'other' })));
  expect(portalRateLimitKey(actor('BUYER'))).not.toBe(portalRateLimitKey(Object.assign(actor('BUYER'), { user: { id: 'other' } })));
  expect(unsupportedPortalPricingFields({ pricingTier: 'default', defaultDiscountPercent: '0.00' })).toEqual([]);
  expect(unsupportedPortalPricingFields({ pricingTier: 'wholesale', defaultMarginPercent: '25' })).toEqual(['pricingTier', 'defaultMarginPercent']);
});


test('payment rate limit is bounded and does not consume another user quota', async () => {
  const app = express();
  app.use((req, _res, next) => { Object.assign(req, actor('BILLING'), { user: { id: req.get('X-Test-User') || 'rate-fixture' } }); next(); });
  app.get('/bounded', portalPaymentLimiter, (_req, res) => res.json({ success: true }));
  for (let i = 0; i < 30; i++) expect((await request(app).get('/bounded')).status).toBe(200);
  expect((await request(app).get('/bounded')).status).toBe(429);
  expect((await request(app).get('/bounded').set('X-Test-User', 'other-rate-fixture')).status).toBe(200);
});
