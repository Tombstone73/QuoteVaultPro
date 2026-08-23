import { describe, expect, test } from "@jest/globals";
import { validateTreeForPublish } from "../../validator/validatePublish";
import { DEFAULT_VALIDATE_OPTS } from "../../validator/types";

function makeTree(patch: Record<string, unknown> = {}) {
  return {
    status: "DRAFT",
    rootNodeIds: ["thickness", "sides", "finishing", "welded_hems", "pole_pocket_size"],
    nodes: [
      {
        id: "thickness",
        type: "INPUT",
        status: "ENABLED",
        key: "thickness",
        input: { selectionKey: "thickness", valueType: "ENUM" },
        choices: [
          { value: "choice_3mm", label: "3mm" },
          { value: "choice_6mm", label: "6mm" },
        ],
      },
      {
        id: "sides",
        type: "INPUT",
        status: "ENABLED",
        key: "sides",
        input: { selectionKey: "sides", valueType: "ENUM" },
        choices: [
          { value: "choice_single", label: "Single sided" },
          { value: "choice_double", label: "Double sided" },
        ],
      },
      {
        id: "finishing",
        type: "INPUT",
        status: "ENABLED",
        key: "finishing",
        input: { selectionKey: "finishing", valueType: "ENUM" },
        choices: [
          { value: "pole_pockets", label: "Pole pockets" },
          { value: "welded_hems", label: "Welded hems" },
        ],
      },
      {
        id: "welded_hems",
        type: "INPUT",
        status: "ENABLED",
        key: "welded_hems",
        input: { selectionKey: "welded_hems", valueType: "BOOLEAN" },
      },
      {
        id: "pole_pocket_size",
        type: "INPUT",
        status: "ENABLED",
        key: "pole_pocket_size",
        input: { selectionKey: "pole_pocket_size", valueType: "ENUM" },
        choices: [
          { value: "3in", label: "3 in" },
          { value: "4in", label: "4 in" },
        ],
      },
    ],
    edges: [],
    meta: {
      baseWeightOz: 1,
      pricingV2: { base: { perSqftCents: 100 } },
    },
    ...patch,
  };
}

function validBannerRule() {
  return {
    id: "rule_pole_pockets",
    enabled: true,
    when: { all: [{ optionGroup: "finishing", operator: "equals", value: "pole_pockets" }] },
    then: [
      { action: "hide", targetOptionGroup: "welded_hems" },
      { action: "clear", targetOptionGroup: "welded_hems" },
      { action: "show", targetOptionGroup: "pole_pocket_size" },
      { action: "require", targetOptionGroup: "pole_pocket_size" },
      { action: "set_default", targetOptionGroup: "pole_pocket_size", value: "3in" },
    ],
    else: [
      { action: "show", targetOptionGroup: "welded_hems" },
      { action: "hide", targetOptionGroup: "pole_pocket_size" },
      { action: "optional", targetOptionGroup: "pole_pocket_size" },
      { action: "clear", targetOptionGroup: "pole_pocket_size" },
    ],
  };
}

function validAcmMatrix() {
  return {
    dimensions: ["thickness", "sides"],
    rows: [
      { id: "3mm_single", match: { thickness: "choice_3mm", sides: "choice_single" }, variables: { base_price: 500 } },
      { id: "3mm_double", match: { thickness: "choice_3mm", sides: "choice_double" }, variables: { base_price: 575 } },
      { id: "6mm_single", match: { thickness: "choice_6mm", sides: "choice_single" }, variables: { base_price: 700 } },
      { id: "6mm_double", match: { thickness: "choice_6mm", sides: "choice_double" }, variables: { base_price: 825 } },
    ],
  };
}

function expectError(tree: Record<string, unknown>, code: string) {
  const result = validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS);
  expect(result.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code }),
    ])
  );
}

describe("pbv2/validator/validatePublish option rules and pricing matrix", () => {
  test("valid banner rules pass", () => {
    const result = validateTreeForPublish(makeTree({ rules: [validBannerRule()] }) as any, DEFAULT_VALIDATE_OPTS);
    expect(result.errors).toHaveLength(0);
  });

  test("products without rules or pricing matrix still pass", () => {
    const result = validateTreeForPublish(makeTree() as any, DEFAULT_VALIDATE_OPTS);
    expect(result.errors).toHaveLength(0);
  });

  test.each([
    ["invalid operator", { when: { all: [{ optionGroup: "finishing", operator: "bad", value: "pole_pockets" }] } }, "PBV2_E_OPTION_RULE_OPERATOR_INVALID"],
    ["missing option group", { when: { all: [{ optionGroup: "missing", operator: "equals", value: "x" }] } }, "PBV2_E_OPTION_RULE_OPTION_GROUP_UNKNOWN"],
    ["invalid action", { then: [{ action: "explode", targetOptionGroup: "welded_hems" }] }, "PBV2_E_OPTION_RULE_ACTION_INVALID"],
    ["invalid target", { then: [{ action: "hide", targetOptionGroup: "missing" }] }, "PBV2_E_OPTION_RULE_TARGET_UNKNOWN"],
    ["invalid set_default value", { then: [{ action: "set_default", targetOptionGroup: "pole_pocket_size", value: "9in" }] }, "PBV2_E_OPTION_RULE_DEFAULT_INVALID"],
    ["contradictory actions", { then: [{ action: "show", targetOptionGroup: "welded_hems" }, { action: "hide", targetOptionGroup: "welded_hems" }] }, "PBV2_E_OPTION_RULE_ACTION_CONFLICT"],
  ])("invalid rule: %s", (_label, patch, code) => {
    expectError(makeTree({ rules: [{ ...validBannerRule(), ...patch }] }), code);
  });

  test("blocks a full option-rule visibility/default dependency cycle", () => {
    const tree = makeTree({
      rules: [
        {
          id: "rule_a", when: { all: [{ optionGroup: "thickness", operator: "equals", value: "choice_3mm" }] },
          then: [{ action: "hide", targetOptionGroup: "sides" }],
        },
        {
          id: "rule_b", when: { all: [{ optionGroup: "sides", operator: "equals", value: "choice_single" }] },
          then: [{ action: "set_default", targetOptionGroup: "thickness", value: "choice_3mm" }],
        },
      ],
    });
    expectError(tree, "PBV2_E_OPTION_RULE_DEPENDENCY_CYCLE");
  });

  test("valid ACM pricing matrix passes", () => {
    const result = validateTreeForPublish(makeTree({ pricingMatrix: validAcmMatrix() }) as any, DEFAULT_VALIDATE_OPTS);
    expect(result.errors).toHaveLength(0);
  });

  test("blocks activation when an unconditioned reachable matrix combination has no row", () => {
    const matrix = validAcmMatrix();
    matrix.rows.pop();
    expectError(makeTree({ pricingMatrix: matrix }), "PBV2_E_PRICING_MATRIX_COVERAGE_MISSING");
  });

  test("does not guess conditional reachability as a Cartesian product", () => {
    const matrix = validAcmMatrix();
    matrix.rows.pop();
    const result = validateTreeForPublish(makeTree({ rules: [validBannerRule()], pricingMatrix: matrix }) as any, DEFAULT_VALIDATE_OPTS);
    expect(result.errors.some((finding) => finding.code === "PBV2_E_PRICING_MATRIX_COVERAGE_MISSING")).toBe(false);
  });

  test.each([
    ["invalid dimension", { dimensions: ["thickness", "missing"], rows: [{ match: { thickness: "choice_3mm", missing: "x" }, variables: { base_price: 500 } }] }, "PBV2_E_PRICING_MATRIX_DIMENSION_UNKNOWN"],
    ["invalid row match key", { dimensions: ["thickness"], rows: [{ match: { thickness: "choice_3mm", sides: "choice_single" }, variables: { base_price: 500 } }] }, "PBV2_E_PRICING_MATRIX_ROW_MATCH_INVALID"],
    ["invalid row match value", { dimensions: ["thickness", "sides"], rows: [{ match: { thickness: "choice_3mm", sides: "label_single" }, variables: { base_price: 500 } }] }, "PBV2_E_PRICING_MATRIX_ROW_VALUE_INVALID"],
    ["duplicate rows", { dimensions: ["thickness"], rows: [{ match: { thickness: "choice_3mm" }, variables: { base_price: 500 } }, { match: { thickness: "choice_3mm" }, variables: { base_price: 600 } }] }, "PBV2_E_PRICING_MATRIX_ROW_DUPLICATE"],
    ["protected built-in override", { dimensions: ["thickness"], rows: [{ match: { thickness: "choice_3mm" }, variables: { q: 2 } }] }, "PBV2_E_PRICING_MATRIX_VARIABLE_PROTECTED"],
    ["non-numeric variable", { dimensions: ["thickness"], rows: [{ match: { thickness: "choice_3mm" }, variables: { base_price: "nope" } }] }, "PBV2_E_PRICING_MATRIX_VARIABLE_INVALID"],
    ["missing dimensions", { dimensions: ["thickness", "sides"], rows: [{ match: { thickness: "choice_3mm" }, variables: { base_price: 500 } }] }, "PBV2_E_PRICING_MATRIX_ROW_MISSING_DIMENSION"],
    ["matrix tier without a rate", { dimensions: ["thickness"], rows: [{ match: { thickness: "choice_3mm" }, qtyTiers: [{ minQty: 1 }] }] }, "PBV2_E_PRICING_MATRIX_TIER_RATE_MISSING"],
    ["matrix tier with invalid minimum", { dimensions: ["thickness"], rows: [{ match: { thickness: "choice_3mm" }, qtyTiers: [{ minQty: 0, perPieceCents: 500 }] }] }, "PBV2_E_PRICING_MATRIX_TIER_BOUND_INVALID"],
    ["matrix tiers out of order", { dimensions: ["thickness"], rows: [{ match: { thickness: "choice_3mm" }, qtyTiers: [{ minQty: 10, perPieceCents: 500 }, { minQty: 10, perPieceCents: 400 }] }] }, "PBV2_E_PRICING_MATRIX_TIER_ORDER_INVALID"],
    ["matrix tier with unsupported basis", { dimensions: ["thickness"], rows: [{ match: { thickness: "choice_3mm" }, tierBasis: "unknown", qtyTiers: [{ minQty: 1, perPieceCents: 500 }] }] }, "PBV2_E_PRICING_MATRIX_TIER_BASIS_INVALID"],
  ])("invalid pricing matrix: %s", (_label, pricingMatrix, code) => {
    expectError(makeTree({ pricingMatrix }), code);
  });
});
