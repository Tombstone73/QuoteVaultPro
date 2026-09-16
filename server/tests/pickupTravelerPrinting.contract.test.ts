import fs from "fs";
import path from "path";

const root = path.resolve(process.cwd());
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("pickup traveler printing contract", () => {
  test("keeps pickup quantities as durable print-job context rather than fulfillment state", () => {
    const schema = read("shared/schema.ts");
    const migration = read("server/db/migrations_v2/0202_pickup_traveler_print_context.sql");
    const routes = read("server/routes/printerProfiles.routes.ts");
    expect(schema).toContain('printContext: jsonb("print_context")');
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS print_context jsonb");
    expect(routes).toContain('documentType: "pickup_traveler"');
    expect(routes).toContain("canonicalFulfillmentOperations.getOrderDetail");
    expect(routes).toContain("item.quantity > remaining");
    expect(routes).toContain("copies: 1");
    expect(routes).not.toContain("recordPickupHandoff(");
  });

  test("uses the canonical traveler source with only server-validated positive pickup lines", () => {
    const bridge = read("server/routes/localBridge.routes.ts");
    const source = read("server/services/orderTravelerSourceService.ts");
    expect(bridge).toContain("pickupTravelerContext(job.printContext)");
    expect(bridge).toContain("getOrderTravelerSource(agent.organizationId, job.orderId, context)");
    expect(source).toContain("requestedPickupQuantityByLine");
    expect(source).toContain("requestedPickupQuantityByLine.has(lineItem.id)");
    expect(source).not.toContain("internalNotes");
    expect(source).not.toContain("notesInternal");
  });
});
