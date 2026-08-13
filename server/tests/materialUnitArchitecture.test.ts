import { describe, expect, test } from "@jest/globals";
import { insertMaterialSchema, updateMaterialSchema } from "@shared/schema";
import { buildMaterialPayload, normalizeRow, validateNormalizedRow } from "../utils/materialsCsvNormalization";

const rollPayload = {
  name: "Oracal 3640",
  sku: "ORACAL-3640-54",
  materialForm: "roll" as const,
  inventoryUnit: "square_foot" as const,
  consumptionUnit: "linear_foot" as const,
  costPerUnit: 0,
  width: 54,
  rollLengthFt: 150,
  costPerRoll: 250,
};

describe("material unit architecture contracts", () => {
  test("creates and duplicates only fully configured rolls", () => {
    const created = insertMaterialSchema.parse(rollPayload);
    const duplicate = insertMaterialSchema.parse({ ...rollPayload, name: "Oracal 3640 Copy", sku: "ORACAL-3640-54-COPY", stockQuantity: 0 });
    expect(created.inventoryUnit).toBe("square_foot");
    expect(duplicate.materialForm).toBe("roll");
  });

  test("allows sparse edit payloads while the route validates the merged material", () => {
    expect(updateMaterialSchema.parse({ color: "White" })).toEqual({ color: "White" });
  });

  test("staged CSV requires explicit form and units", () => {
    const row = normalizeRow({ material_name: "Banner", sku: "BAN-54", material_form: "roll", inventory_unit: "square_foot", consumption_unit: "linear_foot", width: "54", roll_length_ft: "150", cost_per_roll: "220", cost_per_unit: "0" });
    expect(validateNormalizedRow(row)).toEqual([]);
    expect(buildMaterialPayload(row, null)).toEqual(expect.objectContaining({ materialForm: "roll", inventoryUnit: "square_foot", consumptionUnit: "linear_foot" }));
    expect(validateNormalizedRow(normalizeRow({ material_name: "Bad", sku: "BAD", material_type: "roll", unit_of_measure: "sqft" }))).toEqual(expect.arrayContaining(["material_form is required"]));
  });

  test("CSV preserves a vendor lot conversion without treating lot as an inventory unit", () => {
    const row = normalizeRow({
      material_name: "Coroplast",
      sku: "COR-040",
      material_form: "sheet",
      inventory_unit: "sheet",
      consumption_unit: "sheet",
      cost_per_unit: "26.91",
      vendor_cost_unit: "lot",
      vendor_cost_per_unit: "403.65",
      inventory_units_per_purchase_unit: "15",
      minimum_purchase_quantity: "1",
    });
    expect(validateNormalizedRow(row)).toEqual([]);
    expect(buildMaterialPayload(row, null)).toEqual(expect.objectContaining({
      vendorCostUnit: "lot",
      inventoryUnitsPerPurchaseUnit: "15",
      minimumPurchaseQuantity: "1",
    }));
  });
});
