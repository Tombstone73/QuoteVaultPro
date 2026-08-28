import { describe, expect, test } from "@jest/globals";
import {
  normalizePbv2ChoiceConsumptionMaterialAuthority,
  synchronizeChoiceInventoryConsumptionMaterial,
} from "../materialAuthority";

describe("PBV2 choice material authority", () => {
  test("uses materialOverride for a choice consumption while preserving consumption parameters", () => {
    const choice = {
      value: "3mm",
      materialOverride: { materialId: "oppbogga_3mm" },
      inventoryConsumption: [{ materialId: "foam_board_half", quantityBasis: "area_sqft", multiplier: 1.25, wastePercent: 8, fixedQty: undefined }],
    };

    expect(synchronizeChoiceInventoryConsumptionMaterial(choice)).toEqual({
      ...choice,
      inventoryConsumption: [{ materialId: "oppbogga_3mm", quantityBasis: "area_sqft", multiplier: 1.25, wastePercent: 8, fixedQty: undefined }],
    });
  });

  test("leaves an independent consumption material unchanged when there is no override", () => {
    const choice = { value: "packaging", inventoryConsumption: [{ materialId: "shipping_box", quantityBasis: "each", multiplier: 1 }] };
    expect(synchronizeChoiceInventoryConsumptionMaterial(choice)).toBe(choice);
  });

  test("normalizes each choice to its own override without changing the source tree", () => {
    const tree = {
      schemaVersion: 2,
      nodes: {
        thickness: {
          id: "thickness",
          choices: [
            { value: "2mm", materialOverride: { materialId: "oppbogga_2mm" }, inventoryConsumption: [{ materialId: "foam_3_16", quantityBasis: "area_sqft", multiplier: 1 }] },
            { value: "3mm", materialOverride: { materialId: "oppbogga_3mm" }, inventoryConsumption: [{ materialId: "foam_half", quantityBasis: "area_sqft", multiplier: 2, wastePercent: 5 }] },
          ],
        },
      },
    };

    const normalized = normalizePbv2ChoiceConsumptionMaterialAuthority(tree);
    expect(normalized.changes).toHaveLength(2);
    expect((normalized.tree as any).nodes.thickness.choices.map((choice: any) => choice.inventoryConsumption[0].materialId)).toEqual(["oppbogga_2mm", "oppbogga_3mm"]);
    expect((normalized.tree as any).nodes.thickness.choices[1].inventoryConsumption[0]).toMatchObject({ quantityBasis: "area_sqft", multiplier: 2, wastePercent: 5 });
    expect(tree.nodes.thickness.choices[0].inventoryConsumption[0].materialId).toBe("foam_3_16");
  });
});
