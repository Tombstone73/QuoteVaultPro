import {
  buildNormalizedMaterialReservationPlan,
  normalizeMaterialReservation,
} from "../materialReservationNormalization";

const coroplastSheet = {
  id: "coroplast-4mm",
  name: "4mm Coroplast",
  materialForm: "sheet",
  inventoryUnit: "sheet",
  consumptionUnit: "sheet",
  width: 48,
  height: 96,
};

describe("material reservation normalization", () => {
  it("uses flat-stock yield to reserve five sheets for 24x18 qty 50", () => {
    const result = normalizeMaterialReservation({
      material: coroplastSheet,
      requestedUom: "sqft",
      requestedQty: 150,
      flatSheet: { pieceWidthIn: 24, pieceHeightIn: 18, allowRotation: false },
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      baseUom: "sheet",
      convertedQty: 5,
      method: "flat_sheet_yield",
      layout: expect.objectContaining({ piecesPerSheet: 10, sheetsRequired: 5 }),
    }));
  });

  it("reserves square feet directly when square feet is the configured inventory unit", () => {
    const result = normalizeMaterialReservation({
      material: { ...coroplastSheet, inventoryUnit: "square_foot", consumptionUnit: "square_foot" },
      requestedUom: "sqft",
      requestedQty: 150,
      flatSheet: { pieceWidthIn: 24, pieceHeightIn: 18 },
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      baseUom: "square_foot",
      convertedQty: 150,
      method: "configured_unit",
    }));
  });

  it("supports explicitly sheet-consumed stock counted as individual inventory items", () => {
    const result = normalizeMaterialReservation({
      material: { ...coroplastSheet, inventoryUnit: "each", consumptionUnit: "sheet" },
      requestedUom: "sqft",
      requestedQty: 150,
      flatSheet: { pieceWidthIn: 24, pieceHeightIn: 18 },
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, baseUom: "each", convertedQty: 5 }));
  });

  it("names the material and both configured units when a conversion is unavailable", () => {
    const result = normalizeMaterialReservation({
      material: { ...coroplastSheet, inventoryUnit: "sheet", consumptionUnit: "sheet" },
      requestedUom: "ft",
      requestedQty: 12,
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "unsupported_conversion" }));
    if (result.ok) throw new Error("Expected conversion failure");
    expect(result.message).toContain('Material "4mm Coroplast"');
    expect(result.message).toContain("requested unit ft");
    expect(result.message).toContain("configured inventory unit sheet");
    expect(result.message).toContain("configured consumption unit sheet");
  });

  it("fails closed when flat-sheet dimensions are incomplete", () => {
    const result = normalizeMaterialReservation({
      material: { ...coroplastSheet, height: null },
      requestedUom: "sqft",
      requestedQty: 150,
      flatSheet: { pieceWidthIn: 24, pieceHeightIn: 18 },
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "missing_sheet_dimensions" }));
  });

  it("preserves the existing roll linear-foot conversion", () => {
    const result = normalizeMaterialReservation({
      material: {
        id: "vinyl-roll",
        name: "54 inch vinyl",
        materialForm: "roll",
        inventoryUnit: "square_foot",
        consumptionUnit: "linear_foot",
        width: 54,
        rollLengthFt: 150,
      },
      requestedUom: "ft",
      requestedQty: 10,
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      baseUom: "square_foot",
      convertedQty: 45,
      method: "roll_width",
    }));
  });

  it("returns an empty plan for products without material usage", () => {
    expect(buildNormalizedMaterialReservationPlan({ requests: [], materials: [] })).toEqual({
      ok: true,
      reservations: [],
    });
  });

  it("produces the same single reservation on retry instead of duplicate keys", () => {
    const input = {
      requests: [{ materialId: "coroplast-4mm", uom: "sqft", qty: 150 }],
      materials: [coroplastSheet],
      flatSheet: { pieceWidthIn: 24, pieceHeightIn: 18 },
    };

    const first = buildNormalizedMaterialReservationPlan(input);
    const retry = buildNormalizedMaterialReservationPlan(input);
    expect(first).toEqual({
      ok: true,
      reservations: [{ materialId: "coroplast-4mm", uom: "sheet", qty: 5 }],
    });
    expect(retry).toEqual(first);
  });
});
