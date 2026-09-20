import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import { canAppendTerminalFulfillmentReversal, netTerminalFulfillmentQuantity, terminalReversalQuantitiesByLine } from "@shared/fulfillmentTerminalReversal";
import { resolveFulfillmentLineQuantity } from "@shared/fulfillmentReadiness";
import { terminalFulfillmentReversalSchema } from "../services/fulfillment/schemas";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("terminal fulfillment reversal contract", () => {
  test("full and partial pickup/shipment corrections reopen only the net terminal quantity", () => {
    expect(netTerminalFulfillmentQuantity(100, 100)).toBe(0);
    expect(netTerminalFulfillmentQuantity(100, 20)).toBe(80);
    const partial = resolveFulfillmentLineQuantity({
      workflowState: "completed", lifecycleStatus: "complete", orderedQuantity: 100,
      productionCompleteQuantity: 100, shippedQuantity: netTerminalFulfillmentQuantity(100, 20),
    });
    expect(partial.fulfilledQuantity).toBe(80);
    expect(partial.remainingQuantity).toBe(20);
    expect(partial.productionCompleteQuantity).toBe(100);
  });

  test("reversal bounds prevent negative fulfilled quantities and duplicate over-reversal", () => {
    expect(canAppendTerminalFulfillmentReversal({ originalQuantity: 100, alreadyReversedQuantity: 0, requestedQuantity: 100 })).toBe(true);
    expect(canAppendTerminalFulfillmentReversal({ originalQuantity: 100, alreadyReversedQuantity: 20, requestedQuantity: 80 })).toBe(true);
    expect(canAppendTerminalFulfillmentReversal({ originalQuantity: 100, alreadyReversedQuantity: 100, requestedQuantity: 1 })).toBe(false);
    expect(canAppendTerminalFulfillmentReversal({ originalQuantity: 100, alreadyReversedQuantity: 80, requestedQuantity: 21 })).toBe(false);
  });

  test("only append-only terminal reversal events contribute to the net projection", () => {
    const quantities = terminalReversalQuantitiesByLine([
      { eventType: "PICKUP_HANDOFF_REVERSED", payloadJson: { items: [{ orderLineItemId: "pickup-line", quantity: 20 }] } },
      { eventType: "SHIPMENT_REVERSED", payloadJson: { items: [{ orderLineItemId: "shipment-line", quantity: 100 }] } },
      { eventType: "PICKUP_HANDOFF_RECORDED", payloadJson: { items: [{ orderLineItemId: "pickup-line", quantity: 100 }] } },
      { eventType: "PICKUP_HANDOFF_REVERSED", payloadJson: { items: [{ orderLineItemId: "other-line", quantity: 99 }] } },
    ], ["pickup-line", "shipment-line"]);
    expect(quantities.pickup.get("pickup-line")).toBe(20);
    expect(quantities.shipment.get("shipment-line")).toBe(100);
    expect(quantities.pickup.has("other-line")).toBe(false);
  });

  test("requires line-scoped positive quantities and a reason", () => {
    expect(() => terminalFulfillmentReversalSchema.parse({ items: [], reason: "mistake" })).toThrow();
    expect(() => terminalFulfillmentReversalSchema.parse({ items: [{ orderLineItemId: "line", quantity: 1 }], reason: "" })).toThrow();
    expect(terminalFulfillmentReversalSchema.parse({ items: [{ orderLineItemId: "line", quantity: 1 }], reason: "Accidental pickup" })).toMatchObject({ reason: "Accidental pickup" });
  });

  test("uses append-only fulfillment events, keeps source evidence, and enforces Owner/Admin at the API boundary", () => {
    const ledger = source("shared/fulfillmentTerminalReversal.ts");
    const repo = source("server/services/fulfillment/repository.ts");
    const service = source("server/services/fulfillment/service.ts");
    const routes = source("server/routes/fulfillment.routes.ts");

    expect(ledger).toContain("terminalReversalQuantitiesByLine");
    expect(repo).toContain("fulfillmentEvents");
    expect(repo).not.toContain("fulfillmentTerminalReversals");
    expect(repo).toContain("reverseTerminalFulfillment");
    expect(repo).toContain("PICKUP_HANDOFF_REVERSED");
    expect(repo).toContain("SHIPMENT_REVERSED");
    expect(repo).not.toContain("delete(pickupHandoffs)");
    expect(repo).not.toContain("delete(shipments)");
    expect(service).toContain("Organization Owner or Admin authority is required to reverse terminal fulfillment.");
    expect(service).toContain("reconcileOrderAfterTerminalReversal");
    expect(routes).toContain("/api/fulfillment/shipments/:shipmentId/reverse");
    expect(routes).toContain("/api/fulfillment/pickup/handoffs/:handoffId/reverse");
  });

  test("commercial Order recalculation remains separate from terminal fulfillment correction", () => {
    const service = source("server/services/fulfillment/service.ts");
    expect(service).not.toContain("ensureTerminalBilling({ organizationId: orgId, orderId: result.orderId");
    expect(service).toContain("fulfillmentStatus: terminal ? 'delivered' : fulfilledQuantity > 0 ? 'packed' : 'pending'");
  });
});
