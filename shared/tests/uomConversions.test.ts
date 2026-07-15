import { describe, expect, test } from "@jest/globals";
import { calculateUsableRollCapacity, normalizeMaterialUnit } from "../materialUnits";
import { convertReservationInputToBaseQty, getAllowedInputUomsForMaterial } from "../uomConversions";

const roll = {
  materialForm: "roll",
  inventoryUnit: "square_foot",
  consumptionUnit: "linear_foot",
  width: 54,
  rollLengthFt: 150,
};

describe("explicit material units", () => {
  test("calculates usable roll square feet without waste", () => {
    expect(calculateUsableRollCapacity(roll)).toEqual({ ok: true, value: { usableWidthInches: 54, usableLengthFeet: 150, usableSquareFeet: 675 } });
  });

  test("calculates usable roll square feet with gutter and lead/tail waste", () => {
    const result = calculateUsableRollCapacity({ ...roll, edgeWasteInPerSide: 2, leadWasteFt: 3, tailWasteFt: 2 });
    expect(result).toEqual({ ok: true, value: { usableWidthInches: 50, usableLengthFeet: 145, usableSquareFeet: 604.1666666666667 } });
  });

  test("converts linear-foot consumption to square-foot inventory using usable width", () => {
    const result = convertReservationInputToBaseQty({ material: { ...roll, edgeWasteInPerSide: 2 }, inputUom: "linear_ft", inputQuantity: 10 });
    expect(result).toEqual(expect.objectContaining({ ok: true, baseUom: "square_foot", convertedQty: 41.666667 }));
  });

  test("leaves square-foot consumption unchanged", () => {
    expect(convertReservationInputToBaseQty({ material: roll, inputUom: "sqft", inputQuantity: 10 })).toEqual(expect.objectContaining({ ok: true, convertedQty: 10 }));
  });

  test("blocks missing width and excessive waste", () => {
    expect(convertReservationInputToBaseQty({ material: { ...roll, width: null }, inputUom: "linear_foot", inputQuantity: 1 })).toEqual(expect.objectContaining({ ok: false, code: "missing_width" }));
    expect(calculateUsableRollCapacity({ ...roll, edgeWasteInPerSide: 27 })).toEqual(expect.objectContaining({ ok: false, code: "non_positive_capacity" }));
    expect(calculateUsableRollCapacity({ ...roll, leadWasteFt: 149, tailWasteFt: 1 })).toEqual(expect.objectContaining({ ok: false, code: "non_positive_capacity" }));
  });

  test("accepts exact aliases without numerically relabeling volume", () => {
    expect(normalizeMaterialUnit("sqft")).toBe("square_foot");
    expect(normalizeMaterialUnit("ft")).toBe("linear_foot");
    expect(normalizeMaterialUnit("ea")).toBe("each");
    expect(normalizeMaterialUnit("ml")).toBe("milliliter");
    expect(normalizeMaterialUnit("fluid_ounce")).toBeNull();
    expect(getAllowedInputUomsForMaterial(roll)).toEqual(["square_foot", "linear_foot"]);
  });
});
