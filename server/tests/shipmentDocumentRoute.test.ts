import { beforeEach, expect, jest, test } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { FulfillmentHttpError } from '../services/fulfillment/types';

const getShipmentDocument = jest.fn<(...args: any[]) => Promise<any>>();
const write = jest.fn(() => { throw new Error('Document GET must not write'); });
jest.unstable_mockModule('../db', () => ({ db: { insert: write, update: write, delete: write } }));
jest.unstable_mockModule('../storage', () => ({ storage: {} }));
jest.unstable_mockModule('../fulfillmentService', () => ({ updateOrderFulfillmentStatus: write, sendShipmentEmail: write }));
jest.unstable_mockModule('../tenantContext', () => ({ getRequestOrganizationId: (req: any) => req.organizationId }));
jest.unstable_mockModule('../services/fulfillment/canonicalFulfillmentOperations', () => ({ canonicalFulfillmentOperations: { getShipmentDocument } }));
const { registerFulfillmentRoutes } = await import('../routes/fulfillment.routes');

const source = { version: 1, basis: 'draft', organizationId: 'org-a', shipmentId: 'shipment-a', packages: [] };
beforeEach(() => { getShipmentDocument.mockReset().mockResolvedValue(source); write.mockClear(); });

function app() {
  const application = express();
  // Exercise the registered middleware chain. Tenant policy itself is covered
  // by its existing tests; this fixture proves the document route uses it.
  registerFulfillmentRoutes(application, {
    isAuthenticated: (req: any, res: any, next: any) => req.headers['x-test-auth'] === 'staff' ? next() : res.status(401).json({ success: false }),
    tenantContext: (req: any, res: any, next: any) => {
      if (req.headers['x-test-portal']) return res.status(403).json({ success: false });
      req.organizationId = req.headers['x-test-org']; next();
    },
  });
  return application;
}

test('document GET is staff/tenant middleware protected and validates closed type/query before source reads', async () => {
  const application = app(); const path = '/api/fulfillment/shipments/shipment-a/documents/packing_slip';
  expect((await request(application).get(path)).status).toBe(401);
  expect((await request(application).get(path).set('x-test-auth', 'staff').set('x-test-portal', 'yes')).status).toBe(403);
  expect((await request(application).get(path).set('x-test-auth', 'staff')).status).toBe(400);
  expect((await request(application).get(path.replace('packing_slip', 'traveler')).set('x-test-auth', 'staff').set('x-test-org', 'org-a')).status).toBe(400);
  expect((await request(application).get(`${path}?packageId=a&packageId=b`).set('x-test-auth', 'staff').set('x-test-org', 'org-a')).status).toBe(400);
  expect(getShipmentDocument).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

test('repeated document GET uses tenant source, canonical envelope and no business writes', async () => {
  const application = app();
  for (let i = 0; i < 2; i++) {
    const response = await request(application).get('/api/fulfillment/shipments/shipment-a/documents/package_ticket?packageId=package-a')
      .set('x-test-auth', 'staff').set('x-test-org', 'org-a');
    expect(response.status).toBe(200); expect(response.body).toEqual({ success: true, data: source });
  }
  expect(getShipmentDocument).toHaveBeenCalledWith('org-a', 'shipment-a', 'package_ticket', 'package-a');
  expect(getShipmentDocument).toHaveBeenCalledTimes(2);
  expect(write).not.toHaveBeenCalled();
});

test('legacy missing snapshot conflict remains actionable 409, never reconstructed or mutated by route', async () => {
  getShipmentDocument.mockRejectedValue(new FulfillmentHttpError(409, 'Historical shipping document snapshot unavailable.', 'HISTORICAL_SNAPSHOT_UNAVAILABLE'));
  const response = await request(app()).get('/api/fulfillment/shipments/shipment-a/documents/packing_slip').set('x-test-auth', 'staff').set('x-test-org', 'org-a');
  expect(response.status).toBe(409);
  expect(response.body).toMatchObject({ success: false, code: 'HISTORICAL_SNAPSHOT_UNAVAILABLE' });
  expect(write).not.toHaveBeenCalled();
});
