import { afterEach, describe, expect, jest, test } from "@jest/globals";
import express from "express";
import request from "supertest";
import { fulfillmentEvents, organizations, pickupHandoffs, users } from "@shared/schema";
import { effectivePickupDateSchema } from "@shared/pickupEffectiveDate";
import { pickupDetailsSchema, pickupHandoffSchema } from "../services/fulfillment/schemas";
import { FulfillmentDashboardRepo } from "../services/fulfillment/repository";
import { FulfillmentService } from "../services/fulfillment/service";
import { canonicalFulfillmentOperations } from "../services/fulfillment/canonicalFulfillmentOperations";
import { registerFulfillmentRoutes } from "../routes/fulfillment.routes";

afterEach(() => jest.restoreAllMocks());

test("accepts a real historical calendar date and rejects invalid or distant future dates", () => {
  expect(effectivePickupDateSchema.parse("2026-10-02")).toBe("2026-10-02");
  for (const value of ["2026-02-30", "2026-13-01", "not-a-date", "9999-01-01"]) {
    expect(effectivePickupDateSchema.safeParse(value).success).toBe(false);
  }
  expect(pickupHandoffSchema.parse({ items: [{ orderLineItemId: "line", quantity: 250 }], effectivePickupDate: "2026-10-02", notes: "Confirmed by email" }).items[0].quantity).toBe(250);
  expect(pickupDetailsSchema.safeParse({ effectivePickupDate: "2026-10-02", quantity: 1 }).success).toBe(false);
});

function fixture(noteEvents: Array<{ payloadJson: Record<string, unknown> }> = [], timezone?: string) {
  const handoff = { id: "handoff", pickupTicketId: "ticket", notes: "Original", effectivePickupDate: null, handedOffAt: new Date("2026-10-07T12:00:00Z") };
  const writes: Array<{ table: unknown; value: any }> = [];
  const updates: Array<{ table: unknown; value: any }> = [];
  const tx: any = {
    execute: jest.fn(async () => []),
    select: jest.fn(() => ({
      from: (table: unknown) => {
        const chain: any = {
          innerJoin: () => chain,
          where: () => chain,
          orderBy: async () => noteEvents,
          limit: async () => table === pickupHandoffs ? [handoff] : table === users ? [{ id: "staff" }] : table === organizations ? [{ settings: { timezone } }] : [],
        };
        return chain;
      },
    })),
    update: jest.fn((table: unknown) => ({ set: (value: any) => ({ where: async () => { updates.push({ table, value }); } }) })),
    insert: jest.fn((table: unknown) => ({ values: async (value: any) => { writes.push({ table, value }); } })),
  };
  const db: any = { transaction: async (run: (tx: any) => Promise<unknown>) => run(tx) };
  return { repo: new FulfillmentDashboardRepo(db), writes, updates, tx, handoff };
}

describe("pickup metadata correction", () => {
  test("changes only effective date, preserves original timestamps and writes an attributed audit event", async () => {
    const { repo, writes, updates, handoff } = fixture();
    const createdAt = new Date("2026-10-07T12:00:00Z");
    const result = await repo.updatePickupDetails("org", "order", "handoff", { effectivePickupDate: "2026-10-02" }, "staff");
    expect(result).toEqual({ ok: true });
    expect(updates).toEqual([{ table: pickupHandoffs, value: { effectivePickupDate: "2026-10-02" } }]);
    expect(writes).toHaveLength(1);
    expect(writes[0].table).toBe(fulfillmentEvents);
    expect(writes[0].value).toMatchObject({
      organizationId: "org", actorUserId: "staff", entityId: "ticket", eventType: "PICKUP_EFFECTIVE_DATE_UPDATED",
      payloadJson: { orderId: "order", pickupHandoffId: "handoff", previousEffectiveDate: "2026-10-07", newEffectiveDate: "2026-10-02" },
    });
    expect(updates[0].value).not.toHaveProperty("createdAt");
    expect(updates[0].value).not.toHaveProperty("handedOffAt");
    expect(updates[0].value).not.toHaveProperty("quantity");
    expect(handoff.handedOffAt).toEqual(createdAt);
  });

  test("note edit stores the event note and retains its prior value in the audit ledger", async () => {
    const { repo, writes, updates } = fixture([{ payloadJson: { orderId: "order", pickupHandoffId: "handoff", note: "Earlier correction" } }]);
    await repo.updatePickupDetails("org", "order", "handoff", { note: "Customer confirmed by email" }, "staff");
    expect(updates).toEqual([{ table: pickupHandoffs, value: { notes: "Customer confirmed by email" } }]);
    expect(writes[0].value).toMatchObject({ eventType: "PICKUP_HISTORY_NOTE_UPDATED", payloadJson: { previousNote: "Earlier correction", note: "Customer confirmed by email" } });
  });

  test("legacy timestamp fallback uses the organization's calendar date near UTC midnight", async () => {
    const { repo, writes, handoff } = fixture([], "America/Indiana/Indianapolis");
    handoff.handedOffAt = new Date("2026-10-08T02:00:00Z");
    await repo.updatePickupDetails("org", "order", "handoff", { effectivePickupDate: "2026-10-02" }, "staff");
    expect(writes[0].value.payloadJson.previousEffectiveDate).toBe("2026-10-07");
  });

  test("does not create audit work when values are unchanged", async () => {
    const { repo, writes, updates } = fixture();
    await repo.updatePickupDetails("org", "order", "handoff", { effectivePickupDate: "2026-10-07", note: "Original" }, "staff");
    expect(updates).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });
});

test("historical date edit requires Owner/Admin; ordinary fulfillment staff can edit the note", async () => {
  const updatePickupDetails = jest.fn(async () => ({ ok: true as const }));
  const service = new FulfillmentService({ dashboardRepo: { updatePickupDetails } as any, dbInstance: {} as any, shipmentRepo: {} as any, pickupRepo: {} as any, billingAutomationService: {} as any, autoCloseReconciler: jest.fn() as any });
  await expect(service.updatePickupDetails("org", "order", "handoff", { effectivePickupDate: "2026-10-02" }, "staff", "employee")).rejects.toMatchObject({ status: 403 });
  expect(updatePickupDetails).not.toHaveBeenCalled();
  await service.updatePickupDetails("org", "order", "handoff", { note: "Confirmed" }, "staff", "employee");
  expect(updatePickupDetails).toHaveBeenCalledTimes(1);
  await service.updatePickupDetails("org", "order", "handoff", { effectivePickupDate: "2026-10-02" }, "staff", "admin");
  expect(updatePickupDetails).toHaveBeenCalledTimes(2);
});

test("HTTP scopes date correction to the authenticated organization role and rejects quantity in the edit body", async () => {
  const updatePickupDetails = jest.fn(async () => ({ ok: true as const }));
  const service = new FulfillmentService({ dashboardRepo: { updatePickupDetails } as any, dbInstance: {} as any, shipmentRepo: {} as any, pickupRepo: {} as any, billingAutomationService: {} as any, autoCloseReconciler: jest.fn() as any });
  jest.spyOn(canonicalFulfillmentOperations, "updatePickupDetails").mockImplementation((...args) => service.updatePickupDetails(...args));
  const app = express();
  app.use(express.json());
  registerFulfillmentRoutes(app, {
    isAuthenticated: (req: any, res: any, next: any) => { req.user = { id: "staff" }; next(); },
    tenantContext: (req: any, _res: any, next: any) => { req.organizationId = "org"; req.orgRole = String(req.get("Test-Role") || "employee"); next(); },
  });
  const url = "/api/fulfillment/orders/11111111-1111-4111-8111-111111111111/pickup-handoffs/22222222-2222-4222-8222-222222222222/details";
  expect((await request(app).patch(url).set("Test-Role", "employee").send({ effectivePickupDate: "2026-10-02" })).status).toBe(403);
  expect((await request(app).patch(url).set("Test-Role", "employee").send({ note: "Confirmed" })).status).toBe(200);
  expect((await request(app).patch(url).set("Test-Role", "admin").send({ effectivePickupDate: "2026-10-02", note: "Corrected" })).status).toBe(200);
  expect((await request(app).patch(url).set("Test-Role", "admin").send({ quantity: 250 })).status).toBe(400);
  expect(updatePickupDetails).toHaveBeenCalledTimes(2);
});
