import { describe, test, expect } from "@jest/globals";
import {
  normalizeRow,
  validateNormalizedRow,
  buildMaterialPayload,
  VALID_WEIGHT_UNITS,
  VALID_WEIGHT_BASES,
} from "../server/utils/materialsCsvNormalization";
import { normalizeMaterialWeightMetadata } from "@shared/materialWeight";

/** Minimal valid CSV row — only fields required to pass base validation. */
function makeRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    material_name: "Test Material",
    sku: "TEST-001",
    material_type: "consumable",
    unit_of_measure: "ea",
    cost_per_unit: "1.00",
    ...overrides,
  };
}

// ─── Column presence ──────────────────────────────────────────────────────────

describe("materials CSV weight — column presence", () => {
  test("normalizeRow reads weight_value, weight_unit, weight_basis from CSV row", () => {
    const n = normalizeRow(
      makeRow({ weight_value: "0.42", weight_unit: "lb", weight_basis: "sqft" })
    );
    expect(n.weightValue).toBe(0.42);
    expect(n.weightUnit).toBe("lb");
    expect(n.weightBasis).toBe("sqft");
  });

  test("weight_oz_per_basis CSV column is intentionally not parsed (undefined on normalized row)", () => {
    const n = normalizeRow(
      makeRow({
        weight_value: "0.42",
        weight_unit: "lb",
        weight_basis: "sqft",
        weight_oz_per_basis: "999",
      })
    );
    // The NormalizedMaterialRow type has no weightOzPerBasis property —
    // the CSV column is ignored at parse time.
    expect((n as any).weightOzPerBasis).toBeUndefined();
  });
});

// ─── Blank weight fields ──────────────────────────────────────────────────────

describe("materials CSV weight — blank fields", () => {
  test("all weight fields blank is valid", () => {
    const n = normalizeRow(makeRow());
    expect(validateNormalizedRow(n)).toHaveLength(0);
  });

  test("blank weight fields produce null payload properties", () => {
    const payload = buildMaterialPayload(normalizeRow(makeRow()), null);
    expect(payload.weightValue).toBeNull();
    expect(payload.weightUnit).toBeNull();
    expect(payload.weightBasis).toBeNull();
    expect(payload.weightOzPerBasis).toBeNull();
  });

  test("explicit empty strings for all weight fields are treated as blank", () => {
    const n = normalizeRow(
      makeRow({ weight_value: "", weight_unit: "", weight_basis: "", weight_oz_per_basis: "" })
    );
    expect(validateNormalizedRow(n)).toHaveLength(0);
    const payload = buildMaterialPayload(n, null);
    expect(payload.weightOzPerBasis).toBeNull();
  });
});

// ─── Partial weight fields ────────────────────────────────────────────────────

describe("materials CSV weight — partial fields rejected", () => {
  test("weight_value alone is invalid", () => {
    const errs = validateNormalizedRow(normalizeRow(makeRow({ weight_value: "0.42" })));
    expect(errs.some((e) => e.includes("weight fields must all be present or all be blank"))).toBe(
      true
    );
  });

  test("weight_unit alone is invalid", () => {
    const errs = validateNormalizedRow(normalizeRow(makeRow({ weight_unit: "lb" })));
    expect(errs.some((e) => e.includes("weight fields must all be present or all be blank"))).toBe(
      true
    );
  });

  test("weight_basis alone is invalid", () => {
    const errs = validateNormalizedRow(normalizeRow(makeRow({ weight_basis: "sqft" })));
    expect(errs.some((e) => e.includes("weight fields must all be present or all be blank"))).toBe(
      true
    );
  });

  test("weight_value + weight_unit without weight_basis is invalid", () => {
    const errs = validateNormalizedRow(
      normalizeRow(makeRow({ weight_value: "0.42", weight_unit: "lb" }))
    );
    expect(errs.some((e) => e.includes("weight fields must all be present or all be blank"))).toBe(
      true
    );
  });

  test("weight_value + weight_basis without weight_unit is invalid", () => {
    const errs = validateNormalizedRow(
      normalizeRow(makeRow({ weight_value: "0.42", weight_basis: "sqft" }))
    );
    expect(errs.some((e) => e.includes("weight fields must all be present or all be blank"))).toBe(
      true
    );
  });
});

// ─── Invalid weight_value ─────────────────────────────────────────────────────

describe("materials CSV weight — invalid weight_value", () => {
  test("weight_value of zero is invalid", () => {
    const errs = validateNormalizedRow(
      normalizeRow(makeRow({ weight_value: "0", weight_unit: "lb", weight_basis: "sqft" }))
    );
    expect(errs.some((e) => e.includes("weight_value must be > 0"))).toBe(true);
  });

  test("negative weight_value is invalid", () => {
    const errs = validateNormalizedRow(
      normalizeRow(makeRow({ weight_value: "-0.5", weight_unit: "lb", weight_basis: "sqft" }))
    );
    expect(errs.some((e) => e.includes("weight_value must be > 0"))).toBe(true);
  });

  test("non-numeric weight_value is treated as blank → partial field error", () => {
    // parseNum returns undefined for non-numeric; combined with unit+basis = partial
    const errs = validateNormalizedRow(
      normalizeRow(makeRow({ weight_value: "abc", weight_unit: "lb", weight_basis: "sqft" }))
    );
    expect(errs.some((e) => e.includes("weight fields must all be present or all be blank"))).toBe(
      true
    );
  });
});

// ─── Invalid weight_unit ──────────────────────────────────────────────────────

describe("materials CSV weight — invalid weight_unit", () => {
  test("unrecognized unit is rejected", () => {
    const errs = validateNormalizedRow(
      normalizeRow(makeRow({ weight_value: "1", weight_unit: "ton", weight_basis: "sqft" }))
    );
    expect(errs.some((e) => e.includes("weight_unit must be one of"))).toBe(true);
  });

  VALID_WEIGHT_UNITS.forEach((unit) => {
    test(`valid unit "${unit}" passes`, () => {
      const errs = validateNormalizedRow(
        normalizeRow(makeRow({ weight_value: "1", weight_unit: unit, weight_basis: "sqft" }))
      );
      expect(errs.filter((e) => e.includes("weight_unit"))).toHaveLength(0);
    });
  });
});

// ─── Invalid weight_basis ─────────────────────────────────────────────────────

describe("materials CSV weight — invalid weight_basis", () => {
  test("unrecognized basis is rejected", () => {
    const errs = validateNormalizedRow(
      normalizeRow(makeRow({ weight_value: "1", weight_unit: "lb", weight_basis: "cubic_ft" }))
    );
    expect(errs.some((e) => e.includes("weight_basis must be one of"))).toBe(true);
  });

  VALID_WEIGHT_BASES.forEach((basis) => {
    test(`valid basis "${basis}" passes`, () => {
      const errs = validateNormalizedRow(
        normalizeRow(makeRow({ weight_value: "1", weight_unit: "lb", weight_basis: basis }))
      );
      expect(errs.filter((e) => e.includes("weight_basis"))).toHaveLength(0);
    });
  });
});

// ─── Canonical recomputation (import ignores supplied oz value) ───────────────

describe("materials CSV weight — canonical weight_oz_per_basis recomputation", () => {
  test("supplied weight_oz_per_basis is ignored; server recomputes from value+unit+basis", () => {
    const n = normalizeRow(
      makeRow({
        weight_value: "1",
        weight_unit: "lb",
        weight_basis: "sqft",
        weight_oz_per_basis: "999",  // attacker/user-supplied value — must be ignored
      })
    );
    const payload = buildMaterialPayload(n, null);
    // 1 lb = 16 oz exactly
    expect(payload.weightOzPerBasis).toBe("16");
  });

  test("0.42 lb/sqft recomputes to 6.72 oz/sqft", () => {
    const n = normalizeRow(
      makeRow({ weight_value: "0.42", weight_unit: "lb", weight_basis: "sqft" })
    );
    expect(Number(buildMaterialPayload(n, null).weightOzPerBasis)).toBeCloseTo(6.72, 4);
  });

  test("0.18 lb/sqft (Coroplast 4mm) recomputes correctly", () => {
    const n = normalizeRow(
      makeRow({ weight_value: "0.18", weight_unit: "lb", weight_basis: "sqft" })
    );
    expect(Number(buildMaterialPayload(n, null).weightOzPerBasis)).toBeCloseTo(2.88, 4);
  });

  test("0.15 lb/each (wire stake) recomputes correctly", () => {
    const n = normalizeRow(
      makeRow({
        weight_value: "0.15",
        weight_unit: "lb",
        weight_basis: "each",
        material_type: "consumable",
        unit_of_measure: "ea",
      })
    );
    // 0.15 lb × 16 oz/lb = 2.4 oz
    expect(Number(buildMaterialPayload(n, null).weightOzPerBasis)).toBeCloseTo(2.4, 4);
  });

  test("oz unit passes through without conversion", () => {
    const n = normalizeRow(
      makeRow({ weight_value: "6.72", weight_unit: "oz", weight_basis: "sqft" })
    );
    expect(Number(buildMaterialPayload(n, null).weightOzPerBasis)).toBeCloseTo(6.72, 4);
  });

  test("g unit converts correctly (453.592 g ≈ 16 oz)", () => {
    const n = normalizeRow(
      makeRow({ weight_value: "453.592", weight_unit: "g", weight_basis: "each" })
    );
    expect(Number(buildMaterialPayload(n, null).weightOzPerBasis)).toBeCloseTo(16, 2);
  });

  test("kg unit converts correctly (0.453592 kg ≈ 16 oz)", () => {
    const n = normalizeRow(
      makeRow({ weight_value: "0.453592", weight_unit: "kg", weight_basis: "each" })
    );
    expect(Number(buildMaterialPayload(n, null).weightOzPerBasis)).toBeCloseTo(16, 2);
  });

  test("computed weight_oz_per_basis matches normalizeMaterialWeightMetadata runtime result", () => {
    const weight_value = "0.32";
    const weight_unit = "lb";
    const weight_basis = "sqft";

    const n = normalizeRow(makeRow({ weight_value, weight_unit, weight_basis }));
    const payload = buildMaterialPayload(n, null);

    const runtime = normalizeMaterialWeightMetadata({
      weightValue: weight_value,
      weightUnit: weight_unit,
      weightBasis: weight_basis,
    });

    expect(runtime.success).toBe(true);
    expect(Number(payload.weightOzPerBasis)).toBeCloseTo(runtime.weightOzPerBasis!, 6);
  });
});

// ─── Full round-trip ──────────────────────────────────────────────────────────

describe("materials CSV weight — complete round-trip", () => {
  test("fully configured row passes validation and produces correct payload", () => {
    const row = makeRow({
      weight_value: "0.42",
      weight_unit: "lb",
      weight_basis: "sqft",
      weight_oz_per_basis: "0",  // supplied but must be ignored
    });
    const n = normalizeRow(row);
    expect(validateNormalizedRow(n)).toHaveLength(0);

    const payload = buildMaterialPayload(n, null);
    expect(payload.weightValue).toBe("0.42");
    expect(payload.weightUnit).toBe("lb");
    expect(payload.weightBasis).toBe("sqft");
    expect(Number(payload.weightOzPerBasis)).toBeCloseTo(6.72, 4);
  });

  test("each allowed basis produces a non-null weightOzPerBasis when value+unit are valid", () => {
    for (const basis of VALID_WEIGHT_BASES) {
      const n = normalizeRow(makeRow({ weight_value: "1", weight_unit: "lb", weight_basis: basis }));
      const payload = buildMaterialPayload(n, null);
      expect(payload.weightOzPerBasis).not.toBeNull();
    }
  });
});
