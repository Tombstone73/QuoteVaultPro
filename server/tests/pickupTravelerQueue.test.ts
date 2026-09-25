import { beforeEach, expect, jest, test } from "@jest/globals";
import { getTableName } from "drizzle-orm";
import { buildPickupTravelerProgressSnapshot } from "../../shared/pickupTravelerProgress";

const lineQuantities = [{ orderLineItemId: "signs", quantity: 150 }];
const context = { fulfillmentMode: "pickup", boxCount: 1, box: { current: 2, total: 3 }, pickupHandoffId: "completed-pickup", lineQuantities,
  progressSnapshot: buildPickupTravelerProgressSnapshot([{ id: "signs", production: { orderedQuantity: 500, pickedUpQuantity: 250, remainingQuantity: 250 } }], lineQuantities, "2026-09-25T12:00:00Z") };
let rows: Record<string, any[]>;
const writes: Array<{ table: string; values: any }> = [];
const detail = jest.fn(async () => ({ fulfillmentType: "PICKUP", lineItems: [{ id: "signs", production: { orderedQuantity: 500, pickedUpQuantity: 250, remainingQuantity: 250 } }] }));
const source = jest.fn(async () => ({ orderId: "order", orderNumber: "20538", customerName: "Customer", lineItems: [{ orderLineItemId: "signs", description: "Coroplast", quantity: 150 }] }));
const fakeDb = {
  select: () => { let table = ""; const chain: any = { from: (t: any) => { table = getTableName(t); return chain; },
    then: (resolve: any) => Promise.resolve(rows[table] ?? []).then(resolve) };
    for (const method of ["where", "innerJoin", "limit"]) chain[method] = () => chain; return chain; },
  insert: (t: any) => ({ values: (values: any) => { writes.push({ table: getTableName(t), values }); return {
    onConflictDoNothing: () => ({ returning: async () => [{ id: "new-job", status: "queued" }] }),
  }; } }),
  update: () => { throw new Error("Print endpoint must not update physical or financial state"); },
};
jest.unstable_mockModule("../db", () => ({ db: fakeDb }));
jest.unstable_mockModule("../storage", () => ({ storage: {} }));
jest.unstable_mockModule("../tenantContext", () => ({ getRequestOrganizationId: () => "org" }));
jest.unstable_mockModule("../services/printAgentWake", () => ({ publishPrintAgentWake: async () => ({ published: true, attempts: 1 }) }));
jest.unstable_mockModule("../services/fulfillment/canonicalFulfillmentOperations", () => ({ canonicalFulfillmentOperations: { getOrderDetail: detail } }));
jest.unstable_mockModule("../services/orderTravelerSourceService", () => ({ getOrderTravelerSource: source }));
const { registerPrinterProfileRoutes } = await import("../routes/printerProfiles.routes");
const handlers = new Map<string, any>();
const app: any = {};
for (const method of ["get", "post", "patch", "delete", "put"]) app[method] = (path: string, ...callbacks: any[]) => handlers.set(method + path, callbacks.at(-1));
registerPrinterProfileRoutes(app, { isAuthenticated: () => {}, tenantContext: () => {}, isAdminOrOwner: () => {} });
async function request(body: any) {
  let code = 200, response: any;
  const res: any = { status: (value: number) => { code = value; return res; }, json: (value: any) => { response = value; return res; } };
  await handlers.get("post/api/orders/:orderId/direct-print/pickup-travelers")({ params: { orderId: "order" }, body, user: {}, header: () => "request-key" }, res);
  return { code, response };
}
beforeEach(() => { writes.length = 0; jest.clearAllMocks(); rows = {
  direct_print_jobs: [{ printContext: context }],
  printer_profiles: [{ id: "printer", printAgentId: "agent", windowsQueueName: "thermal", displayName: "Thermal", trailingFeedMm: 0 }],
  local_bridge_agents: [{ id: "agent", configuredTravelerPrinterName: "thermal", tokenHash: "fixture" }],
}; });
test("completed/reversed reprint bypasses current remaining eligibility and copies saved context into only a print job", async () => {
  const before = JSON.stringify(context);
  expect((await request({ destinationId: "printer", reprintJobId: "original-job" })).code).toBe(202);
  expect(detail).not.toHaveBeenCalled();
  expect(source).not.toHaveBeenCalled();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ table: "direct_print_jobs", values: { copies: 1, printContext: { ...context, reprintOf: "original-job" } } });
  expect(JSON.stringify(context)).toBe(before);
});
test("completion-event snapshot prints through the same endpoint", async () => {
  rows.pickup_handoffs = [{ payloadJson: { travelerContext: context } }];
  expect((await request({ destinationId: "printer", reprintJobId: "handoff:completed-pickup" })).code).toBe(202);
  expect(detail).not.toHaveBeenCalled();
  expect(writes[0].values.printContext.reprintOf).toBe("handoff:completed-pickup");
});
test("new preparation uses current canonical quantities and omits unspecified box label", async () => {
  expect((await request({ destinationId: "printer", currentBox: "", totalBoxes: "", lineQuantities })).code).toBe(202);
  expect(detail).toHaveBeenCalledWith("org", "order");
  expect(writes[0].values.printContext).toMatchObject({ box: null, boxCount: 1,
    progressSnapshot: { lines: [{ afterPickupQuantity: 400, remainingAfterPickupQuantity: 100 }] }, documentSnapshot: { orderNumber: "20538" } });
});
test("invalid box pair and altered reprint snapshots are rejected without a write", async () => {
  expect((await request({ destinationId: "printer", currentBox: 4, totalBoxes: 3, lineQuantities })).code).toBe(400);
  expect((await request({ destinationId: "printer", reprintJobId: "original-job", lineQuantities })).code).toBe(400);
  expect(writes).toEqual([]);
});
test("missing or unscoped saved context cannot print", async () => {
  rows.direct_print_jobs = [];
  expect((await request({ destinationId: "printer", reprintJobId: "missing" })).code).toBe(404);
  expect(writes).toEqual([]);
});
