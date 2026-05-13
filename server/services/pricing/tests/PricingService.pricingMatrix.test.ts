import { describe, expect, test } from "@jest/globals";
import {
  evaluatePricingPreviewFromTree,
  type Pbv2OptionRuleValidationError,
  type Pbv2PricingMatrixError,
} from "../PricingService";

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
        { id: "3mm_single", when: { thickness: "3mm", sides: "single_sided" }, variables: { base_price: 5 } },
        { id: "3mm_double", when: { thickness: "3mm", sides: "double_sided" }, variables: { base_price: 5.75 } },
        { id: "6mm_single", when: { thickness: "6mm", sides: "single_sided" }, variables: { base_price: 7 } },
        { id: "6mm_double", when: { thickness: "6mm", sides: "double_sided" }, variables: { base_price: 8.25 } },
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
          { value: "single_sided", label: "Single Sided" },
          { value: "double_sided", label: "Double Sided" },
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

function runPreview(treeJson: any, selections: Record<string, any>, formula = acmFormula) {
  return evaluatePricingPreviewFromTree({
    treeJson,
    widthIn: 24,
    heightIn: 36,
    quantity: 1,
    pbv2ExplicitSelections: selections,
    pricingFormulaOverride: formula,
    formulaVariables,
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
    ["3mm", "single_sided", 30],
    ["3mm", "double_sided", 34.5],
    ["6mm", "single_sided", 42],
    ["6mm", "double_sided", 49.5],
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
        sides: { value: "single_sided" },
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
  });

  test("protected dimensional built-ins cannot be shadowed by matrix variables", () => {
    const result = runPreview(
      makeAcmTree({
        dimensions: ["thickness"],
        rows: [
          {
            when: { thickness: "3mm" },
            variables: { base_price: 5, q: 999, sqft: 999, total_sqft: 999 },
          },
        ],
      }),
      { thickness: { value: "3mm" } },
      "q + sqft + total_sqft + base_price"
    );

    expect(result.totalPrice).toBeCloseTo(18, 2);
    expect(result.debug?.variables.q).toBe(1);
    expect(result.debug?.variables.sqft).toBe(6);
    expect(result.debug?.variables.total_sqft).toBe(6);
    expect(result.debug?.variables.base_price).toBe(5);
  });
});
