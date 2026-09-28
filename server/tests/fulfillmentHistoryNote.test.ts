import { afterEach, describe, expect, jest, test } from "@jest/globals";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { fulfillmentEvents, pickupHandoffs } from "@shared/schema";
import { currentPickupHistoryNote, fulfillmentHistoryNoteSchema, PICKUP_HISTORY_NOTE_UPDATED } from "@shared/fulfillmentHistoryNote";
import { terminalReversalQuantitiesByLine } from "@shared/fulfillmentTerminalReversal";
import { FulfillmentDashboardRepo } from "../services/fulfillment/repository";
import { FulfillmentService } from "../services/fulfillment/service";
import { canonicalFulfillmentOperations } from "../services/fulfillment/canonicalFulfillmentOperations";
import { registerFulfillmentRoutes } from "../routes/fulfillment.routes";

const event = (note: string, handoffId = "22222222-2222-4222-8222-222222222222") => ({
  eventType: PICKUP_HISTORY_NOTE_UPDATED, payloadJson: { orderId: "11111111-1111-4111-8111-111111111111", pickupHandoffId: handoffId, note },
  createdAt: "2026-09-28T12:00:00Z", actorUserId: "staff", actorFirstName: "Dale", actorLastName: null,
});
afterEach(() => jest.restoreAllMocks());

describe("pickup history note projection", () => {
  test("isolates handoffs and Orders, retains attribution, and uses the latest valid update", () => {
    const events = [event("new"), event("other event", "handoff-b"), event("old")];
    expect(currentPickupHistoryNote("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", events)).toMatchObject({ text: "new", actorUserId: "staff", actorName: "Dale", updatedAt: new Date(event("").createdAt).toISOString() });
    expect(currentPickupHistoryNote("11111111-1111-4111-8111-111111111111", "handoff-b", events)?.text).toBe("other event");
    expect(currentPickupHistoryNote("other-order", "22222222-2222-4222-8222-222222222222", events)).toBeNull();
    expect(currentPickupHistoryNote("11111111-1111-4111-8111-111111111111", "missing", events)).toBeNull();
    expect(currentPickupHistoryNote("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", [{ ...event("invalid"), payloadJson: { ...event("").payloadJson, note: null } }, ...events])?.text).toBe("new");
  });
  test("clearing does not resurrect an older note or remove its audit evidence", () => {
    const events = [event(" \n "), event("3 boxes")];
    expect(currentPickupHistoryNote("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", events)).toBeNull();
    expect(events).toHaveLength(2);
    expect(events[1].payloadJson.note).toBe("3 boxes");
  });
  test("trims plain text, allows clearing/multiline, limits length, rejects invalid payloads", () => {
    expect(fulfillmentHistoryNoteSchema.parse({ note: "  3 boxes\nJohn picked up  " }).note).toBe("3 boxes\nJohn picked up");
    expect(fulfillmentHistoryNoteSchema.parse({ note: "   " }).note).toBe("");
    expect(fulfillmentHistoryNoteSchema.parse({ note: "x".repeat(2000) }).note).toHaveLength(2000);
    for (const body of [{ note: "x".repeat(2001) }, { note: null }, {}, { note: "x", quantity: 1 }]) expect(fulfillmentHistoryNoteSchema.safeParse(body).success).toBe(false);
  });
  test("annotation events cannot change reversal quantities even with unrelated payload data", () => {
    const notes = [{ ...event("3 boxes"), payloadJson: { ...event("").payloadJson, items: [{ orderLineItemId: "line", quantity: 250 }] } }];
    expect(terminalReversalQuantitiesByLine(notes, ["line"]).pickup.size).toBe(0);
  });
});

function fixture() {
  const values = jest.fn(async (_value: any) => undefined);
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const dialect = new PgDialect();
  const db = {
    select: () => ({ from: (table: unknown) => {
      const chain: any = {
        innerJoin: (_table: unknown, join: any) => { queries.push(dialect.sqlToQuery(join)); return chain; },
        where: (where: any) => { queries.push(dialect.sqlToQuery(where)); return { limit: async () => {
          if (table !== pickupHandoffs) return [{ id: "staff" }];
          return JSON.stringify(queries.at(-1)?.params) === JSON.stringify(["org", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"])
            ? [{ id: "22222222-2222-4222-8222-222222222222", pickupTicketId: "ticket" }] : [];
        } }; },
      };
      return chain;
    } }),
    insert: jest.fn((_table: unknown) => ({ values })),
  };
  const repo = new FulfillmentDashboardRepo(db as any);
  const service = new FulfillmentService({ dashboardRepo: repo, dbInstance: {} as any, shipmentRepo: {} as any, pickupRepo: {} as any, billingAutomationService: {} as any, autoCloseReconciler: jest.fn() as any });
  return { service, db, values, queries };
}

describe("single-purpose annotation write", () => {
  test.each(["owner", "admin", "manager", "employee"])("%s can append/update/clear without touching immutable or financial records", async role => {
    const { service, db, values, queries } = fixture();
    for (const note of ["  3 boxes  ", "Customer returned before leaving", ""]) await service.updatePickupHistoryNote("org", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", note, "staff", role);
    expect(db.insert).toHaveBeenCalledTimes(3);
    for (const [table] of db.insert.mock.calls) expect(table).toBe(fulfillmentEvents);
    expect(values.mock.calls.map(([value]) => value.payloadJson.note)).toEqual(["3 boxes", "Customer returned before leaving", ""]);
    expect(values.mock.calls[0][0]).toMatchObject({ organizationId: "org", actorUserId: "staff", entityType: "PICKUP_TICKET", entityId: "ticket", eventType: PICKUP_HISTORY_NOTE_UPDATED, payloadJson: { orderId: "11111111-1111-4111-8111-111111111111", pickupHandoffId: "22222222-2222-4222-8222-222222222222" } });
    expect(queries[0].sql).toContain('"orders"."organization_id"');
    expect(queries[1].sql).toContain('"pickup_handoffs"."organization_id"');
    expect(queries[1].sql).toContain('"pickup_handoffs"."order_id"');
    expect(queries[1].sql).toContain('"pickup_handoffs"."id"');
    // The mock exposes no update/delete/lifecycle/billing/Traveler methods: any such side effect fails this test.
  });
  test.each(["member", "customer", "viewer", "", undefined])("denies role %s before any write", async role => {
    const { service, db } = fixture();
    await expect(service.updatePickupHistoryNote("org", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "x", "staff", role)).rejects.toMatchObject({ status: 403 });
    expect(db.insert).not.toHaveBeenCalled();
  });
  test.each([["other-org", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"], ["org", "other-order", "22222222-2222-4222-8222-222222222222"], ["org", "11111111-1111-4111-8111-111111111111", "missing"]])("safely rejects unmatched tenant/order/handoff %s %s %s", async (org, order, handoff) => {
    const { service, db } = fixture();
    await expect(service.updatePickupHistoryNote(org, order, handoff, "x", "staff", "admin")).rejects.toMatchObject({ status: 404 });
    expect(db.insert).not.toHaveBeenCalled();
  });
  test("does not fabricate missing actor attribution", async () => {
    const { service, values } = fixture();
    await service.updatePickupHistoryNote("org", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "x", null, "admin");
    expect(values.mock.calls[0][0].actorUserId).toBeNull();
  });
});

function appFor(role = "admin", org = "org", authenticated = true) {
  const { service, values } = fixture();
  jest.spyOn(canonicalFulfillmentOperations, "updatePickupHistoryNote").mockImplementation((...args) => service.updatePickupHistoryNote(...args));
  const app = express(); app.use(express.json());
  registerFulfillmentRoutes(app, {
    isAuthenticated: (req: any, res: any, next: any) => { if (!authenticated) return res.sendStatus(401); req.user = { id: "staff", role: "admin" }; next(); },
    tenantContext: (req: any, _res: any, next: any) => { req.organizationId = org; req.orgRole = role; next(); },
  });
  return { app, values };
}
const url = "/api/fulfillment/orders/11111111-1111-4111-8111-111111111111/pickup-handoffs/22222222-2222-4222-8222-222222222222/note";
test("HTTP uses trusted membership role, success envelope, and safe input/not-found errors", async () => {
  expect((await request(appFor().app).put(url).send({ note: "3 boxes" })).body).toMatchObject({ success: true, data: { pickupHandoffId: "22222222-2222-4222-8222-222222222222" } });
  expect((await request(appFor("member").app).put(url).send({ note: "x" })).status).toBe(403);
  expect((await request(appFor("admin", "other-org").app).put(url).send({ note: "x" })).status).toBe(404);
  expect((await request(appFor().app).put(url).send({ note: "x".repeat(2001) })).status).toBe(400);
  expect((await request(appFor("admin", "org", false).app).put(url).send({ note: "x" })).status).toBe(401);
});
