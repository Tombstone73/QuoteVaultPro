import { beforeAll, expect, jest, test } from "@jest/globals";

jest.unstable_mockModule("../db", () => ({ db: {} }));
jest.unstable_mockModule("../emailService", () => ({ emailService: { sendEmail: jest.fn() } }));
jest.unstable_mockModule("../services/billingInvoiceAutomation", () => ({
  billingInvoiceAutomationService: {
    ensureOrderBackedInvoiceForOrderTrigger: jest.fn(),
  },
}));

let FulfillmentService: typeof import("../services/fulfillment/service").FulfillmentService;

beforeAll(async () => {
  ({ FulfillmentService } = await import("../services/fulfillment/service"));
});

function selectChain(rows: any[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

function selectRowsChain(rows: any[]) {
  return {
    from: () => ({
      innerJoin: () => ({ where: async () => rows }),
      where: async () => rows,
    }),
  };
}

test("historical reconciliation completes fulfilled-only backlog without billing automation", async () => {
  const events: any[] = [];
  const audits: any[] = [];
  const orderUpdates: any[] = [];
  const lockedSelectChain = (rows: any[]) => ({
    from: () => ({
      where: () => ({
        for: () => ({ limit: async () => rows }),
      }),
    }),
  });
  const fakeTx = {
    select: () => lockedSelectChain([{
      state: "production_complete",
      status: "in_production",
      canceledAt: null,
      fulfillmentStatus: "pending",
      routingTarget: "fulfillment",
    }]),
    update: () => ({
      set: (values: any) => {
        orderUpdates.push(values);
        return { where: async () => undefined };
      },
    }),
    insert: () => ({
      values: async (values: any) => {
        if (values.eventType) events.push(values);
        if (values.actionType) audits.push(values);
      },
    }),
  };
  const fakeDb = {
    select: jest.fn()
      .mockImplementationOnce(() => selectChain([{
        id: "order-1",
        state: "production_complete",
        status: "in_production",
        canceledAt: null,
        fulfillmentStatus: "pending",
        routingTarget: "fulfillment",
      }]))
      // The actor resolver safely produces a nullable audit actor when the
      // session identity has no corresponding persisted user record.
      .mockImplementationOnce(() => selectChain([])),
    transaction: async (callback: any) => callback(fakeTx),
  };
  const dashboardRepo = {
    listLineEligibility: jest.fn(async () => [{
      id: "line-1",
      orderId: "order-1",
      projection: {
        requiresFulfillment: true,
        orderedQuantity: 2,
        productionCompleteQuantity: 2,
        fulfilledQuantity: 0,
      },
    }]),
    updateChecklistItem: jest.fn(async () => ({ ok: true })),
    assertOrderChecklistComplete: jest.fn(async () => ({ ok: true })),
  };
  const billingAutomationService = {
    ensureOrderBackedInvoiceForOrderTrigger: jest.fn(async () => {
      throw new Error("historical reconciliation must not invoke billing");
    }),
  };
  const service = new FulfillmentService({
    dbInstance: fakeDb as any,
    dashboardRepo: dashboardRepo as any,
    shipmentRepo: {} as any,
    pickupRepo: {} as any,
    billingAutomationService: billingAutomationService as any,
    autoCloseReconciler: jest.fn(async () => null),
  });

  await expect(service.reconcileHistoricalFulfillment("org-1", {
    orderId: "order-1",
    actorUserId: "session-user-1",
    actorUserName: "Operator",
    reason: "historical_backlog_cleanup",
  })).resolves.toMatchObject({ alreadyCompleted: false, remainingFulfillmentQuantity: 2 });

  expect(dashboardRepo.updateChecklistItem).toHaveBeenCalledWith("org-1", "order-1", "line-1", {
    checked: true,
    fulfilledQuantity: 2,
    administrativeReconciliation: true,
  }, "session-user-1");
  expect(orderUpdates).toEqual([expect.objectContaining({ fulfillmentStatus: "delivered", routingTarget: null })]);
  expect(events).toEqual([expect.objectContaining({
    eventType: "FULFILLMENT_HISTORICAL_RECONCILED",
    payloadJson: expect.objectContaining({ remainingFulfillmentQuantity: 2, billingAutomationSuppressed: true }),
  })]);
  expect(audits).toEqual([expect.objectContaining({ actionType: "ORDER_HISTORICAL_FULFILLMENT_RECONCILED" })]);
  expect(billingAutomationService.ensureOrderBackedInvoiceForOrderTrigger).not.toHaveBeenCalled();
});

test("historical reconciliation preview identifies a physical order that needs production bootstrap", async () => {
  const fakeDb = {
    select: jest.fn()
      .mockImplementationOnce(() => selectChain([{
        id: "order-1",
        state: "open",
        status: "new",
        canceledAt: null,
        fulfillmentStatus: "pending",
      }]))
      .mockImplementationOnce(() => selectRowsChain([{
        id: "line-1", lineItemRole: "standalone", productionBypassed: false,
        requiresProductionJob: true, workflowIntent: "standard_production",
        workflowState: "new", lifecycleStatus: "new",
      }]))
      .mockImplementationOnce(() => selectRowsChain([])),
  };
  const service = new FulfillmentService({
    dbInstance: fakeDb as any,
    dashboardRepo: {
      listLineEligibility: jest.fn(async () => [{
        id: "line-1",
        orderId: "order-1",
        projection: {
          requiresFulfillment: true,
          orderedQuantity: 5,
          productionCompleteQuantity: 0,
          fulfilledQuantity: 0,
        },
      }]),
    } as any,
    shipmentRepo: {} as any,
    pickupRepo: {} as any,
  });

  await expect(service.getHistoricalFulfillmentReconciliationPreview("org-1", "order-1")).resolves.toMatchObject({
    productionStarted: false,
    activeProductionJobCount: 0,
    requiresProductionBootstrap: true,
    remainingProductionQuantity: 5,
    remainingFulfillmentQuantity: 5,
  });
});

test("historical reconciliation preview requires bootstrap for an unowned line even when another line has active production", async () => {
  const fakeDb = {
    select: jest.fn()
      .mockImplementationOnce(() => selectChain([{
        id: "order-1", state: "open", status: "in_production", canceledAt: null, fulfillmentStatus: "pending",
      }]))
      .mockImplementationOnce(() => selectRowsChain([
        { id: "line-active", lineItemRole: "standalone", productionBypassed: false, requiresProductionJob: true, workflowIntent: "standard_production", workflowState: "in_production", lifecycleStatus: "in_progress" },
        { id: "line-missing", lineItemRole: "standalone", productionBypassed: false, requiresProductionJob: true, workflowIntent: "standard_production", workflowState: "new", lifecycleStatus: "new" },
      ]))
      .mockImplementationOnce(() => selectRowsChain([
        { lineItemId: "line-active", stationKey: "flatbed", status: "in_progress" },
      ])),
  };
  const service = new FulfillmentService({
    dbInstance: fakeDb as any,
    dashboardRepo: {
      listLineEligibility: jest.fn(async () => [
        { id: "line-active", orderId: "order-1", projection: { requiresFulfillment: true, orderedQuantity: 1, productionCompleteQuantity: 0, fulfilledQuantity: 0 } },
        { id: "line-missing", orderId: "order-1", projection: { requiresFulfillment: true, orderedQuantity: 1, productionCompleteQuantity: 0, fulfilledQuantity: 0 } },
      ]),
    } as any,
    shipmentRepo: {} as any,
    pickupRepo: {} as any,
  });

  await expect(service.getHistoricalFulfillmentReconciliationPreview("org-1", "order-1")).resolves.toMatchObject({
    productionStarted: true,
    activeProductionJobCount: 1,
    requiresProductionBootstrap: true,
    productionBootstrapLineCount: 1,
    remainingProductionQuantity: 2,
  });
});
