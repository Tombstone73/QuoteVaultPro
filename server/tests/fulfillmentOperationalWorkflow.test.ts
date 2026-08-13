import { describe, expect, jest, test } from "@jest/globals";
import { FulfillmentDashboardRepo, isPickedUpArchivedForRetention, resolveFulfillmentUnreadyTransition, summarizeFulfillmentChecklist } from "../services/fulfillment/repository";
import { canRevertFulfillmentStatus, FULFILLMENT_REVERT_STATUS_PERMISSION, FulfillmentService } from "../services/fulfillment/service";
import { fulfillmentChecklistItemSchema } from "../services/fulfillment/schemas";

function selectChain(rows: any[]) {
  return {
    from: () => ({
      where: () => ({
        limit: async () => rows,
      }),
    }),
  };
}

describe("fulfillment operational workflow helpers", () => {
  test("picked-up rows remain active before retention window", () => {
    const now = new Date("2026-05-28T12:00:00Z").getTime();
    expect(isPickedUpArchivedForRetention({
      status: "PICKED_UP",
      pickedUpAt: "2026-05-25T12:00:01Z",
    }, 3, now)).toBe(false);
  });

  test("picked-up rows archive after retention window", () => {
    const now = new Date("2026-05-28T12:00:00Z").getTime();
    expect(isPickedUpArchivedForRetention({
      status: "PICKED_UP",
      pickedUpAt: "2026-05-25T12:00:00Z",
    }, 3, now)).toBe(true);
  });

  test("non-picked-up rows do not archive through pickup retention", () => {
    const now = new Date("2026-05-28T12:00:00Z").getTime();
    expect(isPickedUpArchivedForRetention({
      status: "READY_FOR_PICKUP",
      pickedUpAt: "2026-05-20T12:00:00Z",
    }, 3, now)).toBe(false);
  });

  test("checklist summary requires every generated item to be checked", () => {
    expect(summarizeFulfillmentChecklist([
      { checked: true },
      { checked: false },
      { checked: true },
    ])).toEqual({
      total: 3,
      checked: 2,
      unchecked: 1,
      complete: false,
    });

    expect(summarizeFulfillmentChecklist([
      { checked: true },
      { checked: true },
    ])).toEqual({
      total: 2,
      checked: 2,
      unchecked: 0,
      complete: true,
    });
  });

  test("empty checklist is not treated as ready for terminal fulfillment", () => {
    expect(summarizeFulfillmentChecklist([])).toEqual({
      total: 0,
      checked: 0,
      unchecked: 0,
      complete: false,
    });
  });

  test("checklist mutation schema accepts checked and legacy verified payloads", () => {
    expect(fulfillmentChecklistItemSchema.parse({ checked: true })).toEqual({
      checked: true,
      notes: null,
    });
    expect(fulfillmentChecklistItemSchema.parse({ verified: false, notes: "missing package" })).toEqual({
      checked: false,
      notes: "missing package",
    });
    expect(() => fulfillmentChecklistItemSchema.parse({ notes: "missing checked flag" })).toThrow();
  });

  test("un-ready transition helper only allows controlled backward fulfillment moves", () => {
    expect(resolveFulfillmentUnreadyTransition("READY_FOR_PICKUP")).toEqual({
      ok: true,
      previousStatus: "READY_FOR_PICKUP",
      newStatus: "READY",
    });

    expect(resolveFulfillmentUnreadyTransition("ready")).toEqual({
      ok: true,
      previousStatus: "READY",
      newStatus: "DRAFT",
    });

    expect(resolveFulfillmentUnreadyTransition("picked_up")).toEqual({
      ok: false,
      code: "TERMINAL_STATUS_REVERT_BLOCKED",
    });

    expect(resolveFulfillmentUnreadyTransition("shipped")).toEqual({
      ok: false,
      code: "TERMINAL_STATUS_REVERT_BLOCKED",
    });

    expect(resolveFulfillmentUnreadyTransition("draft")).toEqual({
      ok: false,
      code: "INVALID_STATE",
    });
  });

  test("fulfillment revert permission fallback preserves owner admin manager access", () => {
    expect(FULFILLMENT_REVERT_STATUS_PERMISSION).toBe("fulfillment.revert_status");
    expect(canRevertFulfillmentStatus("owner")).toBe(true);
    expect(canRevertFulfillmentStatus("admin")).toBe(true);
    expect(canRevertFulfillmentStatus("manager")).toBe(true);
    expect(canRevertFulfillmentStatus("member")).toBe(false);
    expect(canRevertFulfillmentStatus(null)).toBe(false);
  });

  test("a fulfillment-method flip allows inactive draft execution history but blocks terminal fulfillment", async () => {
    const chain = (rows: any[], combined = false) => ({
      from: () => combined
        ? ({ innerJoin: () => ({ where: () => ({ limit: async () => rows }) }) })
        : ({ where: () => ({ limit: async () => rows }) }),
    });
    const draftOnlyDb = {
      select: jest.fn()
        .mockImplementationOnce(() => chain([{ id: "order-1", shippingMethod: "ship", fulfillmentStatus: "pending" }]))
        .mockImplementationOnce(() => chain([{ status: "DRAFT" }]))
        .mockImplementationOnce(() => chain([], true)),
    };
    const service = new FulfillmentService({ dbInstance: draftOnlyDb as any, shipmentRepo: {} as any, pickupRepo: {} as any, dashboardRepo: {} as any });
    await expect(service.assertFulfillmentMethodChangeAllowed("org-1", "order-1", "pickup")).resolves.toBeUndefined();

    const terminalDb = {
      select: jest.fn()
        .mockImplementationOnce(() => chain([{ id: "order-1", shippingMethod: "ship", fulfillmentStatus: "shipped" }]))
        .mockImplementationOnce(() => chain([]))
        .mockImplementationOnce(() => chain([], true)),
    };
    const terminalService = new FulfillmentService({ dbInstance: terminalDb as any, shipmentRepo: {} as any, pickupRepo: {} as any, dashboardRepo: {} as any });
    await expect(terminalService.assertFulfillmentMethodChangeAllowed("org-1", "order-1", "pickup")).rejects.toMatchObject({
      status: 409,
      code: "FULFILLMENT_METHOD_TERMINAL",
    });
  });

  test("mark ready writes fulfillment event with nullable actor when request actor is not a persisted user", async () => {
    const insertedEvents: any[] = [];
    const updatedOrders: any[] = [];
    const fakeTx = {
      update: () => ({
        set: (values: any) => {
          updatedOrders.push(values);
          return { where: async () => undefined };
        },
      }),
      insert: () => ({
        values: async (values: any) => {
          insertedEvents.push(values);
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
          routingTarget: "fulfillment",
          shippingMethod: "ship",
        }]))
        .mockImplementationOnce(() => selectChain([])),
      transaction: async (callback: any) => callback(fakeTx),
    };
    const repo = new FulfillmentDashboardRepo(fakeDb as any);

    const result = await repo.markOrderReady("org-1", "order-1", "claims-user-not-in-users-table");

    expect(result).toEqual({ ok: true });
    expect(updatedOrders[0]).toMatchObject({ fulfillmentStatus: "packed" });
    expect(insertedEvents[0]).toMatchObject({
      organizationId: "org-1",
      actorUserId: null,
      entityType: "ORDER",
      entityId: "order-1",
      eventType: "FULFILLMENT_READY",
      payloadJson: { fulfillmentStatus: "packed" },
    });
  });

  test("mark ready returns detail without requiring checklist or invoking invoice automation", async () => {
    const fakeDashboardRepo = {
      markOrderReady: jest.fn(async () => ({ ok: true })),
      getFulfillmentDetail: jest.fn(async () => ({
        orderId: "order-1",
        status: "READY",
        permissions: { canRevertStatus: false, revertPermission: FULFILLMENT_REVERT_STATUS_PERMISSION },
      })),
    };
    const billingAutomationService = {
      ensureDraftInvoiceForOrderTrigger: jest.fn(async () => {
        throw new Error("invoice service unavailable");
      }),
    };
    const service = new FulfillmentService({
      dashboardRepo: fakeDashboardRepo as any,
      shipmentRepo: {} as any,
      pickupRepo: {} as any,
      dbInstance: {} as any,
      billingAutomationService: billingAutomationService as any,
    });

    const result = await service.markOrderReady("org-1", "order-1", "user-1", "manager");

    expect(fakeDashboardRepo.markOrderReady).toHaveBeenCalledWith("org-1", "order-1", "user-1");
    expect(result.status).toBe("READY");
    expect(billingAutomationService.ensureDraftInvoiceForOrderTrigger).not.toHaveBeenCalled();
    expect(result.billingAutomation).toBeUndefined();
  });

  test("ready for pickup requires completed checklist with specific error message", async () => {
    const fakeDashboardRepo = {
      assertOrderChecklistComplete: jest.fn(async () => ({
        ok: false,
        code: "FULFILLMENT_CHECKLIST_INCOMPLETE",
        message: "old generic message",
        summary: { total: 1, checked: 0, unchecked: 1, complete: false },
      })),
    };
    const service = new FulfillmentService({
      dashboardRepo: fakeDashboardRepo as any,
      shipmentRepo: {} as any,
      pickupRepo: {} as any,
      dbInstance: {} as any,
    });

    await expect(service.markOrderReadyForPickup("org-1", "order-1", {}, "user-1", "manager")).rejects.toMatchObject({
      status: 409,
      code: "FULFILLMENT_CHECKLIST_INCOMPLETE",
      message: "Verify all fulfillment checklist items before marking ready for pickup.",
    });
  });

  test("mark shipped requires completed checklist with shipped-specific error message", async () => {
    const fakeShipmentRepo = {
      getShipmentById: jest.fn(async () => ({
        id: "shipment-1",
        status: "DRAFT",
        orders: [{ orderId: "order-1", orderState: "production_complete", orderStatus: "in_production", orderCanceledAt: null }],
      })),
      markShipped: jest.fn(),
    };
    const fakeDashboardRepo = {
      getOrdersForCombinedShipmentValidation: jest.fn(async () => [{ id: "order-1", shippingMethod: "ship" }]),
      assertOrderChecklistComplete: jest.fn(async () => ({
        ok: false,
        code: "FULFILLMENT_CHECKLIST_INCOMPLETE",
        message: "old generic message",
        summary: { total: 1, checked: 0, unchecked: 1, complete: false },
      })),
    };
    const service = new FulfillmentService({
      dashboardRepo: fakeDashboardRepo as any,
      shipmentRepo: fakeShipmentRepo as any,
      pickupRepo: {} as any,
      dbInstance: { select: jest.fn(() => selectChain([{ settings: { preferences: { fulfillment: { verificationPolicy: "strict_separate_verification" } } } }])) } as any,
    });

    await expect(service.markShipmentShipped("org-1", "shipment-1", "user-1")).rejects.toMatchObject({
      status: 409,
      code: "FULFILLMENT_CHECKLIST_INCOMPLETE",
      message: "1 item still require fulfillment verification.",
    });
    expect(fakeShipmentRepo.markShipped).not.toHaveBeenCalled();
  });
});
