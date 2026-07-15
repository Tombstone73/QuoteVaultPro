import { describe, expect, test } from "@jest/globals";

import {
  insertMaterialSchema,
  insertProductSchema,
  updateMaterialSchema,
  updateProductSchema,
} from "@shared/schema";

describe("AI parsing description schemas", () => {
  test("product create/update contracts preserve AI parsing description fields", () => {
    const created = insertProductSchema.parse({
      name: "PVC Signs",
      description: "Customer-facing product copy",
      aiParsingDescription: "Use for PVC signs, Sintra, and 3mm white PVC.",
      aiParsingDescriptionLinkedToDescription: false,
    });

    expect(created.aiParsingDescription).toBe("Use for PVC signs, Sintra, and 3mm white PVC.");
    expect(created.aiParsingDescriptionLinkedToDescription).toBe(false);

    const updated = updateProductSchema.parse({
      aiParsingDescription: "   ",
      aiParsingDescriptionLinkedToDescription: true,
    });

    expect(updated.aiParsingDescription).toBeNull();
    expect(updated.aiParsingDescriptionLinkedToDescription).toBe(true);
  });

  test("product measurement mode saves and reloads through create and update contracts", () => {
    const created = insertProductSchema.parse({
      name: "Economy Yard Sign Stakes",
      description: "Quantity-only fulfillment hardware",
      measurementMode: "quantity_only",
    });
    const updated = updateProductSchema.parse({ measurementMode: "dimensions_required" });

    expect(created.measurementMode).toBe("quantity_only");
    expect(updated.measurementMode).toBe("dimensions_required");
  });

  test("material create/update contracts preserve AI parsing description fields", () => {
    const created = insertMaterialSchema.parse({
      name: "3mm White PVC",
      sku: "PVC-3MM-WHT",
      materialForm: "sheet",
      inventoryUnit: "sheet",
      consumptionUnit: "sheet",
      costPerUnit: "12.50",
      stockQuantity: "10",
      minStockAlert: "2",
      aiParsingDescription: "Use for PVC signs, Sintra, and foam PVC.",
      aiParsingDescriptionLinkedToDescription: false,
    });

    expect(created.aiParsingDescription).toBe("Use for PVC signs, Sintra, and foam PVC.");
    expect(created.aiParsingDescriptionLinkedToDescription).toBe(false);

    const updated = updateMaterialSchema.parse({
      aiParsingDescription: "",
      aiParsingDescriptionLinkedToDescription: true,
    });

    expect(updated.aiParsingDescription).toBeNull();
    expect(updated.aiParsingDescriptionLinkedToDescription).toBe(true);
  });
});
