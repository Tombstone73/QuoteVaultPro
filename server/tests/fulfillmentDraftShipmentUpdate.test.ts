import { expect, jest, test } from '@jest/globals';
import { FulfillmentService } from '../services/fulfillment/service';
import { patchShipmentSchema } from '../services/fulfillment/schemas';

const orgId = 'org-a';
const shipmentId = 'shipment-a';

function draftShipment(overrides: Record<string, unknown> = {}) {
  return {
    id: shipmentId,
    status: 'DRAFT',
    orders: [{ orderId: 'order-a' }],
    items: [],
    packages: [{ id: 'package-a', ordinal: 1 }],
    ...overrides,
  };
}

function serviceForDraftUpdate() {
  const persisted = draftShipment({
    carrier: 'UPS',
    serviceLevel: 'Ground',
    trackingNumber: '1Z-TRACKING',
    shipDate: '2026-08-26',
    packages: [{ id: 'package-a', ordinal: 1, weightLbs: '4', dimLengthIn: '10', dimWidthIn: '6', dimHeightIn: '5' }],
  });
  const shipmentRepo = {
    getShipmentById: jest.fn()
      .mockResolvedValueOnce(draftShipment())
      .mockResolvedValueOnce(persisted),
    patchDraftShipment: jest.fn(async () => draftShipment()),
    patchDraftShipmentPackages: jest.fn(async () => undefined),
    replaceDraftShipmentItems: jest.fn(async () => ({ ok: true })),
    insertEvent: jest.fn(async () => undefined),
    markShipped: jest.fn(),
  };
  const dashboardRepo = {
    listLineEligibility: jest.fn(async () => []),
  };
  return {
    shipmentRepo,
    dashboardRepo,
    service: new FulfillmentService({
      shipmentRepo: shipmentRepo as any,
      dashboardRepo: dashboardRepo as any,
      pickupRepo: {} as any,
      dbInstance: {} as any,
    }),
  };
}

test('an existing DRAFT shipment persists the representative logistics and package update as a date column value', async () => {
  const { service, shipmentRepo, dashboardRepo } = serviceForDraftUpdate();

  const result = await service.patchShipment(orgId, shipmentId, {
    carrier: 'UPS',
    serviceLevel: 'Ground',
    trackingNumber: '1Z-TRACKING',
    shipDate: '2026-08-26',
    packages: [{ id: 'package-a', weightLbs: 4, dims: { length: 10, width: 6, height: 5 }, notes: null }],
    actorUserId: 'user-a',
  });

  expect(shipmentRepo.patchDraftShipment).toHaveBeenCalledWith(orgId, shipmentId, expect.objectContaining({
    carrier: 'UPS',
    serviceLevel: 'Ground',
    trackingNumber: '1Z-TRACKING',
    shipDate: expect.any(Date),
  }));
  const patch = shipmentRepo.patchDraftShipment.mock.calls[0][2];
  expect(patch.shipDate.toISOString()).toBe('2026-08-26T00:00:00.000Z');
  expect(shipmentRepo.patchDraftShipmentPackages).toHaveBeenCalledWith(orgId, shipmentId, [{
    id: 'package-a', weightLbs: 4, dimLengthIn: 10, dimWidthIn: 6, dimHeightIn: 5, notes: null,
  }]);
  expect(result).toMatchObject({ status: 'DRAFT', carrier: 'UPS', serviceLevel: 'Ground', trackingNumber: '1Z-TRACKING' });
  expect(shipmentRepo.markShipped).not.toHaveBeenCalled();
  expect(dashboardRepo.listLineEligibility).not.toHaveBeenCalled();
});

test('draft metadata saves accept optional fields and do not create or hand off fulfillment allocations', async () => {
  const { service, shipmentRepo, dashboardRepo } = serviceForDraftUpdate();

  await service.patchShipment(orgId, shipmentId, {
    carrier: null,
    serviceLevel: null,
    trackingNumber: null,
    shipDate: null,
    internalNotes: null,
    packages: [{ id: 'package-a', weightLbs: null, dims: { length: null, width: null, height: null }, notes: null }],
  });

  expect(shipmentRepo.replaceDraftShipmentItems).not.toHaveBeenCalled();
  expect(shipmentRepo.markShipped).not.toHaveBeenCalled();
  expect(dashboardRepo.listLineEligibility).not.toHaveBeenCalled();
  expect(shipmentRepo.patchDraftShipment).toHaveBeenCalledWith(orgId, shipmentId, expect.objectContaining({ shipDate: null }));
});

test('draft updates reject missing, cross-tenant, non-draft, and invalid-date requests without bypassing shipment ownership', async () => {
  const missingRepo = { getShipmentById: jest.fn(async () => null) };
  const missingService = new FulfillmentService({ shipmentRepo: missingRepo as any, pickupRepo: {} as any, dashboardRepo: {} as any, dbInstance: {} as any });
  await expect(missingService.patchShipment(orgId, shipmentId, { carrier: 'UPS' })).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  expect(missingRepo.getShipmentById).toHaveBeenCalledWith(orgId, shipmentId);

  const shippedRepo = { getShipmentById: jest.fn(async () => draftShipment({ status: 'SHIPPED' })) };
  const shippedService = new FulfillmentService({ shipmentRepo: shippedRepo as any, pickupRepo: {} as any, dashboardRepo: {} as any, dbInstance: {} as any });
  await expect(shippedService.patchShipment(orgId, shipmentId, { carrier: 'UPS' })).rejects.toMatchObject({ status: 400, code: 'INVALID_STATE' });

  const { service } = serviceForDraftUpdate();
  await expect(service.patchShipment(orgId, shipmentId, { shipDate: '2026-02-30' })).rejects.toMatchObject({ status: 400, code: 'SHIP_DATE_INVALID' });
  expect(() => patchShipmentSchema.parse({ shipDate: '08/26/2026' })).toThrow();
});
