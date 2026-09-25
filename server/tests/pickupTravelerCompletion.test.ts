import { describe, expect, jest, test } from "@jest/globals";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildPickupTravelerProgressSnapshot } from "../../shared/pickupTravelerProgress";

jest.unstable_mockModule("../db", () => ({ db: {} }));
jest.unstable_mockModule("../routes/flatStockNesting.shared", () => ({ buildPrepressOptionRows: () => [], extractFinishingBullets: () => [] }));
jest.unstable_mockModule("../services/artwork/LineItemArtworkReadResolver", () => ({ lineItemArtworkReadResolver: {} }));
const source = jest.fn(async (_org: string, orderId: string, context: any) => ({ orderId, orderNumber: "20538", customerName: "Customer", pickupPrintContext: context,
  lineItems: context.lineQuantities.map((i: any) => ({ ...i, description: "Original Coroplast", pickupProgress: context.progressSnapshot.lines.find((l: any) => l.orderLineItemId === i.orderLineItemId) })) }));
jest.unstable_mockModule("../services/orderTravelerSourceService", () => ({ getOrderTravelerSource: source }));
const { PickupRepo } = await import("../services/fulfillment/repository");
const items = [{ orderLineItemId: "signs", quantity: 150 }];
const saved = () => ({ fulfillmentMode: "pickup", boxCount: 1, box: { current: 1, total: 2 }, lineQuantities: items,
  progressSnapshot: buildPickupTravelerProgressSnapshot([{ id: "signs", production: { orderedQuantity: 500, pickedUpQuantity: 250, remainingQuantity: 250 } }], items, "2026-09-25T12:00:00Z") });

function database(jobs: any[] = [], existing: any[] = []) {
  const writes: Array<{ table: string; values: any }> = [];
  const conditions: string[] = [];
  const ticket = { id: "ticket", orderId: "order", status: "DRAFT" };
  const rows: Record<string, any[]> = { pickup_tickets: [ticket], order_line_items: [{ id: "signs", quantity: 500 }],
    pickup_handoffs: existing, pickup_handoff_items: [{ id: "signs", quantity: 250 }], direct_print_jobs: jobs };
  const tx: any = { execute: async () => [],
    select: () => { let table = ""; const chain: any = { from: (t: any) => { table = getTableName(t); return chain; },
      then: (resolve: any) => Promise.resolve(rows[table] ?? []).then(resolve),
      where: (condition: any) => { conditions.push(new PgDialect().sqlToQuery(condition).sql); return chain; } };
      for (const method of ["innerJoin", "leftJoin", "groupBy", "limit", "for"]) chain[method] = () => chain;
      return chain;
    },
    insert: (t: any) => ({ values: (values: any) => { const table = getTableName(t); writes.push({ table, values });
      return { then: (resolve: any) => Promise.resolve().then(resolve), returning: async () => [{ ...values, id: "new-handoff" }] }; } }),
    update: (t: any) => ({ set: (values: any) => { const table = getTableName(t); writes.push({ table, values });
      return { where: () => ({ then: (resolve: any) => Promise.resolve().then(resolve), returning: async () => [{ ...ticket, ...values }] }) }; } }),
  };
  return { writes, conditions, tx, db: { transaction: async (run: any) => run(tx) } };
}

describe("Complete Pickup paper association in the existing transaction", () => {
  test("explicit matching preparation is bound, retaining the original snapshot", async () => {
    const context = saved(), before = JSON.stringify(context);
    const mock = database([{ id: "paper", printContext: context }]);
    const result = await new PickupRepo(mock.db as any).recordPartialPickup("org", "ticket", { items, travelerJobIds: ["paper"], clientRequestId: "request" });
    expect(result.ok).toBe(true);
    const binding = mock.writes.find(w => w.table === "direct_print_jobs")!;
    expect(Object.keys(binding.values)).toEqual(["printContext"]);
    expect(new PgDialect().sqlToQuery(binding.values.printContext)).toMatchObject({ params: ["new-handoff"] });
    expect(new PgDialect().sqlToQuery(binding.values.printContext).sql).toContain("'{pickupHandoffId}'");
    expect(JSON.stringify(context)).toBe(before);
    expect(mock.conditions.find(s => s.includes('"direct_print_jobs"'))).toContain('"organization_id"');
    expect(mock.writes.filter(w => /invoice|payment|price|production/.test(w.table))).toEqual([]);
  });
  test("without printing first, completion stores the canonical pre-handoff document in existing event JSON", async () => {
    const mock = database();
    await new PickupRepo(mock.db as any).recordPartialPickup("org", "ticket", { items });
    const event = mock.writes.find(w => w.table === "fulfillment_events")!.values;
    expect(event.payloadJson.travelerContext).toMatchObject({ box: null, pickupHandoffId: "new-handoff",
      progressSnapshot: { lines: [{ orderedQuantity: 500, previouslyPickedUpQuantity: 250, thisPickupQuantity: 150, afterPickupQuantity: 400, remainingAfterPickupQuantity: 100 }] },
      documentSnapshot: { lineItems: [{ description: "Original Coroplast" }] } });
    expect(mock.writes.some(w => w.table === "direct_print_jobs")).toBe(false);
  });
  test.each([[], [{ id: "paper", printContext: { ...saved(), pickupHandoffId: "another" } }],
    [{ id: "paper", printContext: { ...saved(), lineQuantities: [{ orderLineItemId: "signs", quantity: 100 }] } }]].map(jobs => ({ jobs })))("rejects missing, already-bound, or mismatched paper before physical writes", async ({ jobs }) => {
    const mock = database(jobs);
    await expect(new PickupRepo(mock.db as any).recordPartialPickup("org", "ticket", { items, travelerJobIds: ["paper"] })).rejects.toMatchObject({ code: "PICKUP_TRAVELER_MISMATCH" });
    expect(mock.writes).toEqual([]);
  });
  test("idempotent completion retry never rewrites the association or creates a second handoff", async () => {
    const mock = database([], [{ id: "existing" }]);
    const result = await new PickupRepo(mock.db as any).recordPartialPickup("org", "ticket", { items, travelerJobIds: ["missing"], clientRequestId: "replay" });
    expect(result).toMatchObject({ ok: true, replayed: true });
    expect(mock.writes).toEqual([]);
  });
});
