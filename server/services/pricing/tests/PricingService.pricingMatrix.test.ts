import { describe, expect, test } from "@jest/globals";
import {
  evaluatePricingPreviewFromTree,
  type Pbv2DefinitionValidationError,
  type Pbv2OptionRuleValidationError,
  type Pbv2PricingMatrixError,
} from "../PricingService";
import { resolvePricingV2BaseRates } from "../../../../shared/pbv2/pricingAdapter";

const acmFormula =
  "sheet_consumption_sqft(w, h, q, sheet_width, sheet_length, usable_drop_min, billable_length_increment, minimum_billable_sqft) * base_price";

const formulaVariables = {
  sheet_width: 48,
  sheet_length: 96,
  usable_drop_min: 0,
  billable_length_increment: 1,
  minimum_billable_sqft: 0,
};

function makeAcmTree(pricingMatrix?: any) {
  return {
    schemaVersion: 2 as const,
    rootNodeIds: ["thickness", "sides"],
    pricingMatrix: pricingMatrix ?? {
      dimensions: ["thickness", "sides"],
      rows: [
        { id: "3mm_single", when: { thickness: "3mm", sides: "choice_single" }, variables: { base_price: 500 } },
        { id: "3mm_double", when: { thickness: "3mm", sides: "choice_double" }, variables: { base_price: 575 } },
        { id: "6mm_single", when: { thickness: "6mm", sides: "choice_single" }, variables: { base_price: 700 } },
        { id: "6mm_double", when: { thickness: "6mm", sides: "choice_double" }, variables: { base_price: 825 } },
      ],
    },
    nodes: {
      thickness: {
        id: "thickness",
        kind: "question" as const,
        label: "Thickness",
        input: { type: "select" as const, selectionKey: "thickness" },
        choices: [
          { value: "3mm", label: "3mm" },
          { value: "6mm", label: "6mm" },
        ],
      },
      sides: {
        id: "sides",
        kind: "question" as const,
        label: "Sides",
        input: { type: "select" as const, selectionKey: "sides" },
        choices: [
          { value: "choice_single", label: "Single sided" },
          { value: "choice_double", label: "Double sided" },
        ],
      },
    },
    meta: {
      pricingV2: {
        base: { perSqftCents: 100 },
      },
    },
  };
}

function makeRuleMatrixTree() {
  return {
    schemaVersion: 2 as const,
    rootNodeIds: ["finishing", "welded_hems", "pole_pocket_size"],
    optionRules: [
      {
        id: "rule_pole_pockets",
        when: { all: [{ optionGroup: "finishing", operator: "equals", value: "pole_pockets" }] },
        then: [
          { action: "hide", targetOptionGroup: "welded_hems" },
          { action: "clear", targetOptionGroup: "welded_hems" },
          { action: "show", targetOptionGroup: "pole_pocket_size" },
          { action: "require", targetOptionGroup: "pole_pocket_size" },
        ],
      },
    ],
    pricingMatrix: {
      dimensions: ["finishing", "welded_hems"],
      rows: [
        { when: { finishing: "pole_pockets", welded_hems: true }, variables: { base_price: 100 } },
      ],
    },
    nodes: {
      finishing: {
        id: "finishing",
        kind: "question" as const,
        label: "Finishing",
        input: { type: "select" as const, selectionKey: "finishing" },
        choices: [{ value: "pole_pockets", label: "Pole Pockets" }],
      },
      welded_hems: {
        id: "welded_hems",
        kind: "question" as const,
        label: "Welded Hems",
        input: { type: "boolean" as const, selectionKey: "welded_hems" },
      },
      pole_pocket_size: {
        id: "pole_pocket_size",
        kind: "question" as const,
        label: "Pocket Size",
        input: { type: "select" as const, selectionKey: "pole_pocket_size" },
        choices: [{ value: "3in", label: "3 in" }],
      },
    },
    meta: {
      pricingV2: { base: { perSqftCents: 100 } },
    },
  };
}

function runPreview(
  treeJson: any,
  selections: Record<string, any>,
  formula = acmFormula,
  quantity = 1,
  formulaVariablesOverride: Record<string, number> = formulaVariables,
) {
  return evaluatePricingPreviewFromTree({
    treeJson,
    widthIn: 24,
    heightIn: 36,
    quantity,
    pbv2ExplicitSelections: selections,
    pricingFormulaOverride: formula,
    formulaVariables: formulaVariablesOverride,
    debug: true,
  });
}

function expectPricingMatrixError(fn: () => unknown): Pbv2PricingMatrixError {
  try {
    fn();
  } catch (error: any) {
    expect(error.code).toBe("PBV2_PRICING_MATRIX_ERROR");
    return error as Pbv2PricingMatrixError;
  }
  throw new Error("Expected PBV2 pricing matrix error");
}

function expectPricingDefinitionError(fn: () => unknown): Pbv2DefinitionValidationError {
  try {
    fn();
  } catch (error: any) {
    expect(error.code).toBe("PBV2_DEFINITION_VALIDATION_FAILED");
    return error as Pbv2DefinitionValidationError;
  }
  throw new Error("Expected PBV2 definition validation error");
}

function expectOptionRuleError(fn: () => unknown): Pbv2OptionRuleValidationError {
  try {
    fn();
  } catch (error: any) {
    expect(error.code).toBe("PBV2_OPTION_RULE_VALIDATION_FAILED");
    return error as Pbv2OptionRuleValidationError;
  }
  throw new Error("Expected PBV2 option rule validation error");
}

describe("PricingService pricing matrix variable resolution", () => {
  test.each([
    ["3mm", "choice_single", 30],
    ["3mm", "choice_double", 34.5],
    ["6mm", "choice_single", 42],
    ["6mm", "choice_double", 49.5],
  ])("ACM %s + %s resolves base_price and evaluates formula", (thickness, sides, expectedTotal) => {
    const result = runPreview(makeAcmTree(), {
      thickness: { value: thickness },
      sides: { value: sides },
    });

    expect(result.totalPrice).toBeCloseTo(expectedTotal, 2);
    expect(result.debug?.variables.base_price).toBe(expectedTotal / 6);
  });

  test("missing matrix row returns a clear pricing error", () => {
    const error = expectPricingMatrixError(() =>
      runPreview(makeAcmTree(), {
        thickness: { value: "10mm" },
        sides: { value: "choice_single" },
      })
    );

    expect(error.details).toEqual([
      expect.objectContaining({
        code: "PBV2_PRICING_MATRIX_ROW_NOT_FOUND",
      }),
    ]);
  });

  test("matrix resolution does not run before option rules", () => {
    const error = expectOptionRuleError(() =>
      runPreview(makeRuleMatrixTree(), {
        finishing: { value: "pole_pockets" },
      })
    );

    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          optionGroup: "pole_pocket_size",
          code: "OPTION_RULE_REQUIRED_MISSING",
        }),
      ])
    );
  });

  test("hidden or cleared option selections do not resolve pricing", () => {
    const error = expectOptionRuleError(() =>
      runPreview(makeRuleMatrixTree(), {
        finishing: { value: "pole_pockets" },
        welded_hems: { value: true },
        pole_pocket_size: { value: "3in" },
      })
    );

    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          optionGroup: "welded_hems",
          code: "PBV2_OPTION_SELECTION_CLEARED_BY_RULE",
        }),
      ])
    );
  });

  test("products without pricingMatrix still price as before", () => {
    const tree = makeAcmTree(null);
    delete (tree as any).pricingMatrix;

    const result = runPreview(
      tree,
      {},
      "sqft * base_price * q"
    );

    expect(result.totalPrice).toBeCloseTo(6, 2);
    expect(result.debug?.tierResolution).toEqual(expect.objectContaining({
      enabled: false,
      source: "none",
      originalBaseRate: 1,
      effectiveBaseRateBeforeMatrix: 1,
      finalBaseRateUsed: 1,
    }));
  });

  test("PBV2 qty tier applies tier rate before formula when no matrix overrides base_price", () => {
    const tree = makeAcmTree(null);
    delete (tree as any).pricingMatrix;
    (tree as any).meta.pricingV2.qtyTiers = [
      { id: "tier_5", label: "5+", minQty: 5, perSqftCents: 80 },
    ];

    const result = runPreview(tree, {}, "sqft * base_price * q", 5);

    expect(result.totalPrice).toBeCloseTo(24, 2);
    expect(result.debug?.variables).toEqual(expect.objectContaining({
      base_price: 0.8,
      original_base_price: 1,
      tier_base_price: 0.8,
      tier_rate: 0.8,
      effective_base_price: 0.8,
    }));
    expect(result.debug?.tierResolution).toEqual(expect.objectContaining({
      enabled: true,
      source: "pbv2_product",
      matchedTierId: "tier_5",
      matchedTierLabel: "5+",
      originalBaseRate: 1,
      tierBaseRate: 0.8,
      effectiveBaseRateBeforeMatrix: 0.8,
      matrixBasePriceOverride: false,
      finalBaseRateUsed: 0.8,
    }));
  });

  test("matrix base_price override wins after tier resolution and emits metadata", () => {
    const tree = makeAcmTree({
      dimensions: ["thickness"],
      rows: [
        { id: "matrix_override", when: { thickness: "3mm" }, variables: { base_price: 500 } },
      ],
    });
    (tree as any).meta.pricingV2.qtyTiers = [
      { id: "tier_5", label: "5+", minQty: 5, perSqftCents: 80 },
    ];

    const result = runPreview(tree, { thickness: { value: "3mm" } }, "sqft * base_price * q", 5);

    expect(result.totalPrice).toBeCloseTo(150, 2);
    expect(result.debug?.variables.base_price).toBe(5);
    expect(result.debug?.tierResolution).toEqual(expect.objectContaining({
      matchedTierId: "tier_5",
      tierBaseRate: 0.8,
      effectiveBaseRateBeforeMatrix: 0.8,
      matrixBasePriceOverride: true,
      finalBaseRateUsed: 5,
    }));
    expect(result.debug?.tierResolution?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PBV2_TIER_MATRIX_BASE_PRICE_OVERRIDE" }),
      ])
    );
  });

  test("row-level qty tier applies for the matched matrix row", () => {
    const tree = makeAcmTree({
      dimensions: ["thickness", "sides"],
      rows: [
        {
          id: "3mm_single",
          when: { thickness: "3mm", sides: "choice_single" },
          variables: { base_price: 500 },
          qtyTiers: [{ id: "row_tier_10", label: "10+", minQty: 10, perSqftCents: 450 }],
        },
      ],
    });

    const result = runPreview(
      tree,
      { thickness: { value: "3mm" }, sides: { value: "choice_single" } },
      "sqft * base_price * q",
      10
    );

    expect(result.totalPrice).toBeCloseTo(270, 2);
    expect(result.debug?.variables.base_price).toBe(4.5);
    expect(result.debug?.tierResolution).toEqual(expect.objectContaining({
      enabled: true,
      source: "matrix_row",
      matrixRowId: "3mm_single",
      matchedTierId: "row_tier_10",
      matchedTierLabel: "10+",
      matrixStaticBaseRate: 5,
      matrixStaticBaseRateUsedAsFallback: false,
      productTierFallbackUsed: false,
      finalBaseRateUsed: 4.5,
    }));
  });

  test("different matrix rows can resolve different row-level qty tier rates", () => {
    const tree = makeAcmTree({
      dimensions: ["thickness", "sides"],
      rows: [
        {
          id: "3mm_single",
          when: { thickness: "3mm", sides: "choice_single" },
          qtyTiers: [{ id: "single_25", minQty: 25, perSqftCents: 400 }],
        },
        {
          id: "6mm_double",
          when: { thickness: "6mm", sides: "choice_double" },
          qtyTiers: [{ id: "double_25", minQty: 25, perSqftCents: 675 }],
        },
      ],
    });

    const single = runPreview(
      tree,
      { thickness: { value: "3mm" }, sides: { value: "choice_single" } },
      "sqft * base_price * q",
      25
    );
    const double = runPreview(
      tree,
      { thickness: { value: "6mm" }, sides: { value: "choice_double" } },
      "sqft * base_price * q",
      25
    );

    expect(single.totalPrice).toBeCloseTo(600, 2);
    expect(single.debug?.variables.base_price).toBe(4);
    expect(single.debug?.tierResolution?.matrixRowId).toBe("3mm_single");
    expect(double.totalPrice).toBeCloseTo(1012.5, 2);
    expect(double.debug?.variables.base_price).toBe(6.75);
    expect(double.debug?.tierResolution?.matrixRowId).toBe("6mm_double");
  });

  test("row without qty tiers falls back to product-level PBV2 tiers", () => {
    const tree = makeAcmTree({
      dimensions: ["thickness"],
      rows: [
        { id: "3mm", when: { thickness: "3mm" }, variables: { setup_fee: 200 } },
      ],
    });
    (tree as any).meta.pricingV2.qtyTiers = [
      { id: "product_tier_5", minQty: 5, perSqftCents: 80 },
    ];

    const result = runPreview(tree, { thickness: { value: "3mm" } }, "sqft * base_price * q", 5);

    expect(result.totalPrice).toBeCloseTo(24, 2);
    expect(result.debug?.variables.base_price).toBe(0.8);
    expect(result.debug?.tierResolution).toEqual(expect.objectContaining({
      source: "pbv2_product",
      matchedTierId: "product_tier_5",
      productTierFallbackUsed: true,
      finalBaseRateUsed: 0.8,
    }));
  });

  test("row qty tiers with no match use static base_price fallback and warn", () => {
    const tree = makeAcmTree({
      dimensions: ["thickness"],
      rows: [
        {
          id: "3mm",
          when: { thickness: "3mm" },
          variables: { base_price: 500 },
          qtyTiers: [{ id: "row_tier_10", minQty: 10, perSqftCents: 450 }],
        },
      ],
    });

    const result = runPreview(tree, { thickness: { value: "3mm" } }, "sqft * base_price * q", 1);

    expect(result.totalPrice).toBeCloseTo(30, 2);
    expect(result.debug?.variables.base_price).toBe(5);
    expect(result.debug?.tierResolution).toEqual(expect.objectContaining({
      source: "matrix_row",
      matrixRowId: "3mm",
      matchedTierId: null,
      matrixStaticBaseRate: 5,
      matrixStaticBaseRateUsedAsFallback: true,
      finalBaseRateUsed: 5,
    }));
    expect(result.debug?.tierResolution?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PBV2_TIER_MATRIX_ROW_NO_MATCH" }),
        expect.objectContaining({ code: "PBV2_TIER_MATRIX_STATIC_BASE_FALLBACK" }),
      ])
    );
  });

  test("row tier match wins over static matrix base_price", () => {
    const tree = makeAcmTree({
      dimensions: ["thickness"],
      rows: [
        {
          id: "3mm",
          when: { thickness: "3mm" },
          variables: { base_price: 500 },
          qtyTiers: [{ id: "row_tier_10", minQty: 10, perSqftCents: 450 }],
        },
      ],
    });

    const result = runPreview(tree, { thickness: { value: "3mm" } }, "sqft * base_price * q", 10);

    expect(result.totalPrice).toBeCloseTo(270, 2);
    expect(result.debug?.variables.base_price).toBe(4.5);
    expect(result.debug?.tierResolution).toEqual(expect.objectContaining({
      matchedTierId: "row_tier_10",
      matrixStaticBaseRate: 5,
      matrixStaticBaseRateUsedAsFallback: false,
      matrixBasePriceOverride: false,
      finalBaseRateUsed: 4.5,
    }));
  });

  test("formula tier variables fall back safely and warn when no tier system exists", () => {
    const tree = makeAcmTree(null);
    delete (tree as any).pricingMatrix;

    const result = runPreview(tree, {}, "sqft * tier_base_price * q", 1);

    expect(result.totalPrice).toBeCloseTo(6, 2);
    expect(result.debug?.variables.tier_base_price).toBe(1);
    expect(result.debug?.tierResolution?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PBV2_TIER_FORMULA_REFERENCE_WITHOUT_TIER_SYSTEM" }),
      ])
    );
  });

  test("formula variables cannot shadow protected tier variables", () => {
    const tree = makeAcmTree(null);
    delete (tree as any).pricingMatrix;
    (tree as any).meta.pricingV2.qtyTiers = [
      { minQty: 1, perSqftCents: 80 },
    ];

    const result = runPreview(
      tree,
      {},
      "tier_base_price + original_base_price + effective_base_price",
      1,
      { tier_base_price: 999, original_base_price: 999, effective_base_price: 999 }
    );

    expect(result.totalPrice).toBeCloseTo(2.6, 2);
    expect(result.debug?.variables.tier_base_price).toBe(0.8);
    expect(result.debug?.variables.original_base_price).toBe(1);
    expect(result.debug?.variables.effective_base_price).toBe(0.8);
  });

  test("no tier match falls back to base rate with structured warning", () => {
    const tree = makeAcmTree(null);
    delete (tree as any).pricingMatrix;
    (tree as any).meta.pricingV2.qtyTiers = [
      { id: "tier_10", minQty: 10, perSqftCents: 80 },
    ];

    const result = runPreview(tree, {}, "sqft * base_price * q", 1);

    expect(result.totalPrice).toBeCloseTo(6, 2);
    expect(result.debug?.tierResolution).toEqual(expect.objectContaining({
      enabled: true,
      matchedTierId: null,
      tierBaseRate: null,
      effectiveBaseRateBeforeMatrix: 1,
      finalBaseRateUsed: 1,
    }));
    expect(result.debug?.tierResolution?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PBV2_TIER_NO_MATCH" }),
      ])
    );
  });

  test("invalid tier rate falls back safely with structured warning", () => {
    const tree = makeAcmTree(null) as any;
    delete tree.pricingMatrix;
    tree.meta.pricingV2.qtyTiers = [
      { id: "bad_tier", minQty: 1, perSqftCents: "bad" },
    ];

    const result = resolvePricingV2BaseRates(tree, {}, { widthIn: 24, heightIn: 36, quantity: 1, sqft: 6 });

    expect(result.perSqftCents).toBe(100);
    expect(result.tierResolution).toEqual(expect.objectContaining({
      matchedTierId: "bad_tier",
      originalBaseRate: 1,
      effectiveBaseRateBeforeMatrix: 1,
      finalBaseRateUsed: 1,
    }));
    expect(result.tierResolution.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PBV2_TIER_INVALID_RATE" }),
      ])
    );
  });

  test("matrix matching uses stable choice values when labels change", () => {
    const tree = makeAcmTree();
    tree.nodes.sides.choices = [
      { value: "choice_single", label: "Front only" },
      { value: "choice_double", label: "Front and back" },
    ];

    const result = runPreview(tree, {
      thickness: { value: "6mm" },
      sides: { value: "choice_double" },
    });

    expect(result.totalPrice).toBeCloseTo(49.5, 2);
    expect(result.debug?.variables.base_price).toBe(8.25);
  });

  test("protected dimensional built-ins cannot be shadowed by matrix variables", () => {
    const error = expectPricingDefinitionError(() =>
      runPreview(
        makeAcmTree({
          dimensions: ["thickness"],
          rows: [
            {
              when: { thickness: "3mm" },
              variables: { base_price: 5, q: 999, sqft: 999, total_sqft: 999, tier_base_price: 999 },
            },
          ],
        }),
        { thickness: { value: "3mm" } },
        "q + sqft + total_sqft + base_price"
      )
    );

    expect(error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PBV2_E_PRICING_MATRIX_VARIABLE_PROTECTED" }),
      ])
    );
  });
});
