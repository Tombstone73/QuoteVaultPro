import { describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
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
  test("legacy fulfillment status routes cannot record terminal delivery outside canonical actions", () => {
    const fulfillmentRoutes = fs.readFileSync(path.join(process.cwd(), "server/routes/fulfillment.routes.ts"), "utf8");
    const orderRoutes = fs.readFileSync(path.join(process.cwd(), "server/routes/orders.routes.ts"), "utf8");
    const emailService = fs.readFileSync(path.join(process.cwd(), "server/fulfillmentService.ts"), "utf8");

    expect(fulfillmentRoutes).toContain("FULFILLMENT_TERMINAL_ACTION_REQUIRED");
    expect(orderRoutes).toContain("FULFILLMENT_TERMINAL_ACTION_REQUIRED");
    expect(emailService).toContain("eq(orders.organizationId, organizationId)");
    expect(emailService).toContain("eq(customers.organizationId, organizationId)");
    expect(emailService).toContain("eq(orderLineItems.organizationId, organizationId)");
  });

  test("direct pickup and shipping use remaining-order authority while retaining the immutable paths", () => {
    const repository = fs.readFileSync(path.join(process.cwd(), "server/services/fulfillment/repository.ts"), "utf8");
    const service = fs.readFileSync(path.join(process.cwd(), "server/services/fulfillment/service.ts"), "utf8");

    expect(repository).toContain("ticket.status !== 'DRAFT' && ticket.status !== 'READY_FOR_PICKUP'");
    expect(repository).toContain("handoffQuantity > projection.remainingQuantity");
    expect(repository).toContain("draftQty > projection.remainingQuantity");
    expect(repository).toContain("QTY_EXCEEDS_ORDER");
    expect(service).toContain("remainingQuantityByOrderId");
    expect(service).toContain("Shipment quantity exceeds the remaining order quantity");
    expect(service).not.toContain("At least one quantity must be marked ready before pickup-ready.");
  });

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
      ensureOrderBackedInvoiceForOrderTrigger: jest.fn(async () => {
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
    expect(billingAutomationService.ensureOrderBackedInvoiceForOrderTrigger).not.toHaveBeenCalled();
    expect(result.billingAutomation).toBeUndefined();
  });

  test("terminal billing failures are durably recorded and reconciliation replays only canonical billing", async () => {
    const auditEntries: any[] = [];
    const fakeDb = {
      select: jest.fn(() => selectChain([{ id: "order-1", fulfillmentStatus: "delivered" }])),
      insert: jest.fn(() => ({ values: async (entry: any) => { auditEntries.push(entry); } })),
    };
    const billingAutomationService = {
      ensureOrderBackedInvoiceForOrderTrigger: jest
        .fn()
        .mockResolvedValueOnce({ status: "failed_controlled_error", code: "TRANSIENT", message: "temporary failure" })
        .mockResolvedValueOnce({ status: "succeeded", invoiceId: "invoice-1" }),
    };
    const service = new FulfillmentService({
      dashboardRepo: {} as any,
      shipmentRepo: {} as any,
      pickupRepo: {} as any,
      dbInstance: fakeDb as any,
      billingAutomationService: billingAutomationService as any,
    });

    await expect((service as any).ensureTerminalBilling({
      organizationId: "org-1", orderId: "order-1", trigger: "picked_up_or_shipped", sourceEvent: "SHIPMENT_SHIPPED", actorUserId: "user-1",
    })).resolves.toMatchObject({ status: "failed_controlled_error" });
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toMatchObject({ actionType: "FULFILLMENT_BILLING_RECONCILIATION_REQUIRED", entityId: "order-1" });

    await expect(service.reconcileTerminalBilling("org-1", "order-1", "user-1")).resolves.toMatchObject({ status: "succeeded" });
    expect(billingAutomationService.ensureOrderBackedInvoiceForOrderTrigger).toHaveBeenLastCalledWith(expect.objectContaining({
      organizationId: "org-1", orderId: "order-1", trigger: "picked_up_or_shipped",
    }));
  });

  test("ready-for-pickup notification does not replace quantity-aware handoffs with a checklist gate", async () => {
    const service = new FulfillmentService({
      dashboardRepo: {} as any,
      shipmentRepo: {} as any,
      pickupRepo: {} as any,
      dbInstance: {} as any,
    });
    const requireChecklist = jest.spyOn(service as any, "requireChecklistComplete");
    jest.spyOn(service, "createOrGetPickupTicket").mockResolvedValue({ id: "ticket-1" } as any);
    jest.spyOn(service, "markPickupReady").mockResolvedValue({ billingAutomation: null } as any);
    jest.spyOn(service, "getOrderDetail").mockResolvedValue({ orderId: "order-1", status: "READY_FOR_PICKUP" } as any);

    await expect(service.markOrderReadyForPickup("org-1", "order-1", {}, "user-1", "manager")).resolves.toMatchObject({ orderId: "order-1" });
    expect(requireChecklist).not.toHaveBeenCalled();
  });

  test("mark shipped uses remaining order quantity rather than readiness or reported production", async () => {
    const fakeShipmentRepo = {
      getShipmentById: jest.fn(async () => ({
        id: "shipment-1",
        status: "DRAFT",
        orders: [{ orderId: "order-1", orderState: "production_complete", orderStatus: "in_production", orderCanceledAt: null }],
        items: [{ orderId: "order-1", orderLineItemId: "line-1", quantity: 1 }],
      })),
      markShipped: jest.fn(async () => ({ ok: true, shipment: { id: "shipment-1" } })),
    };
    const fakeDashboardRepo = {
      getOrdersForCombinedShipmentValidation: jest.fn(async () => [{ id: "order-1", shippingMethod: "ship" }]),
      logChecklistVerified: jest.fn(async () => undefined),
      listLineEligibility: jest.fn(async () => [{
        id: "line-1",
        orderId: "order-1",
        projection: { requiresFulfillment: true, readyWaitingQuantity: 0, eligibleQuantity: 0, remainingQuantity: 1, shippedQuantity: 0 },
      }]),
    };
    const select = jest.fn().mockImplementationOnce(() => selectChain([{ settings: { preferences: { fulfillment: { verificationPolicy: "strict_separate_verification" } } } }]));
    const service = new FulfillmentService({
      dashboardRepo: fakeDashboardRepo as any,
      shipmentRepo: fakeShipmentRepo as any,
      pickupRepo: {} as any,
      dbInstance: { select } as any,
      billingAutomationService: { ensureOrderBackedInvoiceForOrderTrigger: jest.fn(async () => ({ status: "skipped" })) } as any,
    });
    await expect(service.markShipmentShipped("org-1", "shipment-1", "user-1")).resolves.toMatchObject({ id: "shipment-1" });
    expect(fakeShipmentRepo.markShipped).toHaveBeenCalled();
  });
});
