import {
  deriveMaterialConfigurationStatus,
  deriveMaterialInventoryStatus,
} from "../materialInventory";

describe("materialInventory helpers", () => {
  test("marks roll materials with missing operational fields as needs configuration", () => {
    const result = deriveMaterialConfigurationStatus({
      name: "Banner Vinyl",
      materialForm: "roll",
      inventoryUnit: "square_foot",
      consumptionUnit: "square_foot",
      costPerUnit: "1.25",
      stockQuantity: "3",
      minStockAlert: "0",
      width: null,
      rollLengthFt: null,
      costPerRoll: null,
    });

    expect(result.needsConfiguration).toBe(true);
    expect(result.missing).toEqual(expect.arrayContaining(["width", "roll_length_ft", "cost_per_roll", "min_stock_alert"]));
  });

  test("returns on_order before low_stock when an open reorder exists", () => {
    const status = deriveMaterialInventoryStatus({
      isActive: true,
      name: "PVC Sheet",
      materialForm: "sheet",
      inventoryUnit: "sheet",
      consumptionUnit: "sheet",
      costPerUnit: "10",
      width: "48",
      height: "96",
      stockQuantity: "2",
      minStockAlert: "5",
    }, 1);

    expect(status).toBe("on_order");
  });

  test("returns inactive before other derived states", () => {
    const status = deriveMaterialInventoryStatus({
      isActive: false,
      name: "Retired Material",
      materialForm: "each",
      inventoryUnit: "each",
      consumptionUnit: "each",
      costPerUnit: "1",
      stockQuantity: "0",
      minStockAlert: "10",
    }, 1);

    expect(status).toBe("inactive");
  });
});
