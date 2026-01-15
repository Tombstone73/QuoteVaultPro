import { describe, expect, test } from "@jest/globals";

import {
  convertReservationInputToBaseQty,
  getAllowedInputUomsForMaterial,
} from "../uomConversions";

describe("uomConversions", () => {
  test("allows only base unit for sheet/ml/ea", () => {
    expect(getAllowedInputUomsForMaterial({ unitOfMeasure: "sheet", width: 60 })).toEqual(["sheet"]);
    expect(getAllowedInputUomsForMaterial({ unitOfMeasure: "ml", width: 60 })).toEqual(["ml"]);
    expect(getAllowedInputUomsForMaterial({ unitOfMeasure: "ea", width: 60 })).toEqual(["ea"]);
  });

  test("sqft base allows linear_ft only when width exists", () => {
    expect(getAllowedInputUomsForMaterial({ unitOfMeasure: "sqft", width: null })).toEqual(["sqft", "linear_ft"]);
    expect(getAllowedInputUomsForMaterial({ unitOfMeasure: "sqft", width: "" })).toEqual(["sqft", "linear_ft"]);
    expect(getAllowedInputUomsForMaterial({ unitOfMeasure: "sqft", width: "60" })).toEqual(["sqft", "linear_ft"]);
  });

  test("linear_ft base allows sqft only when width exists", () => {
    expect(getAllowedInputUomsForMaterial({ unitOfMeasure: "linear_ft", width: null })).toEqual(["linear_ft", "sqft"]);
    expect(getAllowedInputUomsForMaterial({ unitOfMeasure: "linear_ft", width: "48" })).toEqual(["linear_ft", "sqft"]);
  });

  test("linear_ft -> sqft conversion uses width inches", () => {
    const r = convertReservationInputToBaseQty({
      material: { unitOfMeasure: "sqft", width: 60 },
      inputUom: "linear_ft",
      inputQuantity: 10,
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      // widthFactor = 60/12 = 5 sqft per linear ft
      expect(r.convertedQty).toBe(50);
      expect(r.baseUom).toBe("sqft");
    }
  });

  test("sqft -> linear_ft conversion uses width inches", () => {
    const r = convertReservationInputToBaseQty({
      material: { unitOfMeasure: "linear_ft", width: "60" },
      inputUom: "sqft",
      inputQuantity: 50,
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      // widthFactor = 60/12 = 5 sqft per linear ft
      expect(r.convertedQty).toBe(10);
      expect(r.baseUom).toBe("linear_ft");
    }
  });

  test("blocks conversion when width missing", () => {
    const r = convertReservationInputToBaseQty({
      material: { unitOfMeasure: "sqft", width: null },
      inputUom: "linear_ft",
      inputQuantity: 10,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("missing_width");
      expect(r.message).toContain("Cannot convert without material width");
    }
  });
});
