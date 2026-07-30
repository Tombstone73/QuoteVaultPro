import { describe, expect, test } from "@jest/globals";
import { enrichRollLinearFootMaterialEffects } from "../rollMaterialEffects";

const vinylRoll = {
  id: "mat-vinyl",
  name: "54 inch printable vinyl",
  materialForm: "roll",
  inventoryUnit: "linear_foot",
  consumptionUnit: "linear_foot",
  width: 54,
  edgeWasteInPerSide: 2,
};

describe("roll linear-foot material effects", () => {
  test("replaces roll linear-foot usage with actual consumed linear feet from nesting", () => {
    const result = enrichRollLinearFootMaterialEffects({
      effects: [{ skuRef: "mat-vinyl", uom: "linear_foot", qty: 16 }],
      materials: [vinylRoll],
      env: { widthIn: 4, heightIn: 4, quantity: 100 },
      formulaVariables: {
        piece_allowance_x: 0.25,
        piece_allowance_y: 0.25,
        registration_waste: 4,
        billing_width_increment: 12,
        billing_length_increment: 12,
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.effects[0]).toEqual(expect.objectContaining({
      skuRef: "mat-vinyl",
      uom: "linear_foot",
      qty: 3.875,
      rollLayout: expect.objectContaining({
        billableSqft: 16,
        actualConsumedLinearFeet: 3.875,
      }),
      originalMaterialEffect: expect.objectContaining({
        qty: 16,
        qtyMeaning: "tree_linear_foot",
      }),
    }));
  });

  test("leaves non-roll and square-foot roll material effects unchanged", () => {
    const effects = [
      { skuRef: "mat-sheet", uom: "each", qty: 2 },
      { skuRef: "mat-vinyl-sqft", uom: "sqft", qty: 16 },
    ];
    const result = enrichRollLinearFootMaterialEffects({
      effects,
      materials: [
        { id: "mat-sheet", materialForm: "sheet", inventoryUnit: "sheet", consumptionUnit: "sheet" },
        { id: "mat-vinyl-sqft", materialForm: "roll", inventoryUnit: "square_foot", consumptionUnit: "square_foot" },
      ],
      env: { widthIn: 4, heightIn: 4, quantity: 100 },
    });

    expect(result.effects).toEqual(effects);
    expect(result.warnings).toEqual([]);
  });

  test("warns without erasing the existing material effect when geometry is missing", () => {
    const result = enrichRollLinearFootMaterialEffects({
      effects: [{ skuRef: "mat-vinyl", uom: "linear_foot", qty: 16 }],
      materials: [vinylRoll],
      env: { widthIn: 4, quantity: 100 },
    });

    expect(result.effects[0]).toEqual({ skuRef: "mat-vinyl", uom: "linear_foot", qty: 16 });
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "ROLL_LAYOUT_MISSING_DIMENSIONS",
        materialId: "mat-vinyl",
      }),
    ]);
  });
});
