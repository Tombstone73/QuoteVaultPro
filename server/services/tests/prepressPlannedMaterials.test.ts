import { describe, expect, test } from "@jest/globals";
import { computePlannedMaterialsForLineItem } from "../prepressPlannedMaterials";

describe("computePlannedMaterialsForLineItem material authority", () => {
  test("uses the choice override material for planning while retaining consumption quantity rules", () => {
    const result = computePlannedMaterialsForLineItem({
      lineItem: { width: "24", height: "12", quantity: 2, optionSelectionsJson: { thickness: "3mm" } },
      treeJson: {
        schemaVersion: 2,
        rootNodeIds: ["thickness"],
        nodes: {
          thickness: {
            id: "thickness", label: "Thickness", input: { selectionKey: "thickness" },
            choices: [{ value: "3mm", label: "3mm", materialOverride: { materialId: "oppbogga_3mm" }, inventoryConsumption: [{ materialId: "stale_foam", quantityBasis: "area_sqft", multiplier: 1.5, wastePercent: 10 }] }],
          },
        },
      } as any,
    });

    expect(result.materials).toEqual([expect.objectContaining({ materialId: "oppbogga_3mm", qty: 6.6, uom: "sqft", basis: "area_sqft" })]);
  });

  test("retains an independently selected consumption material when the choice has no override", () => {
    const result = computePlannedMaterialsForLineItem({
      lineItem: { quantity: 2, optionSelectionsJson: { packaging: "boxed" } },
      treeJson: {
        schemaVersion: 2,
        rootNodeIds: ["packaging"],
        nodes: { packaging: { id: "packaging", label: "Packaging", input: { selectionKey: "packaging" }, choices: [{ value: "boxed", inventoryConsumption: [{ materialId: "shipping_box", quantityBasis: "each", multiplier: 1 }] }] } },
      } as any,
    });

    expect(result.materials).toEqual([expect.objectContaining({ materialId: "shipping_box", qty: 2, uom: "each" })]);
  });
});
