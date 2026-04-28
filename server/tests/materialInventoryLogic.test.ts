import {
  assertNoOpenReorderRequest,
  buildInventoryMovementSnapshot,
  buildManualInventoryAdjustment,
  transitionMaterialReorderRequest,
} from "../services/materialInventoryLogic";

describe("materialInventoryLogic", () => {
  test("buildManualInventoryAdjustment computes set-quantity delta and audit snapshot", () => {
    const result = buildManualInventoryAdjustment({
      currentQuantity: 12,
      adjustmentMode: "set_quantity",
      quantity: 9,
      reason: "correction",
      notes: "Cycle count correction",
    });

    expect(result).toMatchObject({
      movementType: "adjustment",
      detailType: "manual_set",
      quantityDelta: -3,
      quantityBefore: 12,
      quantityAfter: 9,
      reason: "correction",
      notes: "Cycle count correction",
    });
  });

  test("buildInventoryMovementSnapshot blocks negative resulting stock", () => {
    expect(() => buildInventoryMovementSnapshot({
      movementType: "receipt",
      detailType: "reorder_receipt",
      currentQuantity: 2,
      quantityDelta: -3,
      reason: "bad",
    })).toThrow("Adjustment would make stock negative");
  });

  test("receipt movement snapshot increases stock for reorder receive", () => {
    const result = buildInventoryMovementSnapshot({
      movementType: "receipt",
      detailType: "reorder_receipt",
      currentQuantity: 2,
      quantityDelta: 5,
      reason: "reorder_received",
      notes: "Received full shipment",
    });

    expect(result.quantityBefore).toBe(2);
    expect(result.quantityAfter).toBe(7);
    expect(result.movementType).toBe("receipt");
  });

  test("duplicate open reorder requests are blocked intentionally", () => {
    expect(() => assertNoOpenReorderRequest("requested")).toThrow("Open reorder request already exists for this material");
    expect(() => assertNoOpenReorderRequest("ordered")).toThrow("Open reorder request already exists for this material");
    expect(() => assertNoOpenReorderRequest("received")).not.toThrow();
  });

  test("received and cancelled states cannot be received again", () => {
    expect(() => transitionMaterialReorderRequest({ currentStatus: "received", action: "receive" })).toThrow(
      "Only requested or ordered reorder requests can be received",
    );
    expect(() => transitionMaterialReorderRequest({ currentStatus: "cancelled", action: "receive" })).toThrow(
      "Only requested or ordered reorder requests can be received",
    );
  });
});