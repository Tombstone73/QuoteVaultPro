import { describe, expect, test } from "@jest/globals";
import { sanitizePbv2PricingMatrix } from "../pricingMatrixSanitizer";
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "../validator";

function makeTree(overrides: Record<string, any> = {}) {
  return {
    schemaVersion: 2,
    status: "DRAFT",
    rootNodeIds: ["base"],
    nodes: {
      base: {
        id: "base",
        kind: "computed",
        type: "COMPUTE",
        status: "ENABLED",
        label: "Base",
      },
      thickness: {
        id: "thickness",
        kind: "question",
        type: "INPUT",
        status: "ENABLED",
        label: "Thickness",
        input: { type: "select", selectionKey: "thickness" },
        choices: [
          { value: "choice_3mm", label: "3mm" },
          { value: "choice_6mm", label: "6mm" },
        ],
      },
      sides: {
        id: "sides",
        kind: "question",
        type: "INPUT",
        status: "ENABLED",
        label: "Sides",
        input: { type: "select", selectionKey: "sides" },
        choices: [
          { value: "choice_single", label: "Single" },
          { value: "choice_double", label: "Double" },
        ],
      },
      ...overrides.nodes,
    },
    edges: [],
    meta: {
      baseWeightOz: 1,
      pricingV2: { base: { perSqftCents: 100 } },
      ...overrides.meta,
    },
    pricingMatrix: overrides.pricingMatrix ?? {
      dimensions: ["thickness", "sides"],
      rows: [
        {
          id: "row_3mm_single",
          when: { thickness: "choice_3mm", sides: "choice_single" },
          variables: { base_price: 500 },
          tierBasis: "computed_sheet_usage",
          qtyTiers: [{ id: "tier_10", minQty: 10, perSqftCents: 450 }],
          metadata: { note: "keep me" },
        },
        {
          id: "row_6mm_double",
          when: { thickness: "choice_6mm", sides: "choice_double" },
          variables: { base_price: 825 },
        },
      ],
    },
  };
}

describe("sanitizePbv2PricingMatrix", () => {
  test("removes unknown dimensions and affected row conditions", () => {
    const tree = makeTree({
      nodes: { sides: undefined },
      pricingMatrix: {
        dimensions: ["thickness", "deleted_group"],
        rows: [
          { id: "row", when: { thickness: "choice_3mm", deleted_group: "old" }, variables: { base_price: 500 } },
        ],
      },
    });
    delete (tree.nodes as any).sides;

    const result = sanitizePbv2PricingMatrix(tree);

    expect(result.changed).toBe(true);
    expect((result.tree as any).pricingMatrix.dimensions).toEqual(["thickness"]);
    expect((result.tree as any).pricingMatrix.rows).toEqual([
      { id: "row", when: { thickness: "choice_3mm" }, variables: { base_price: 500 } },
    ]);
  });

  test("deleting an option group removes the matrix when no valid dimensions remain", () => {
    const tree = makeTree({
      nodes: { thickness: undefined, sides: undefined },
      pricingMatrix: {
        dimensions: ["thickness"],
        rows: [{ id: "row", when: { thickness: "choice_3mm" }, variables: { base_price: 500 } }],
      },
    });
    delete (tree.nodes as any).thickness;
    delete (tree.nodes as any).sides;

    const result = sanitizePbv2PricingMatrix(tree);

    expect(result.changed).toBe(true);
    expect((result.tree as any).pricingMatrix).toBeUndefined();
    expect(result.changes.some((change) => change.code === "PBV2_MATRIX_REMOVED")).toBe(true);
  });

  test("removes dimension-only matrix by default for strict repair and publish paths", () => {
    const tree = makeTree({
      pricingMatrix: {
        dimensions: ["thickness", "sides"],
        rows: [],
      },
    });

    const result = sanitizePbv2PricingMatrix(tree);

    expect(result.changed).toBe(true);
    expect((result.tree as any).pricingMatrix).toBeUndefined();
  });

  test("preserves selected dimensions without rows during draft editing", () => {
    const tree = makeTree({
      pricingMatrix: {
        dimensions: ["thickness", "sides"],
        rows: [],
      },
    });

    const result = sanitizePbv2PricingMatrix(tree, { allowIncompleteMatrix: true });

    expect(result.changed).toBe(false);
    expect((result.tree as any).pricingMatrix).toEqual({
      dimensions: ["thickness", "sides"],
      rows: [],
    });
  });

  test("draft editing keeps valid PBV2 dimensions when removed legacy keys leave no rows", () => {
    const tree = makeTree({
      pricingMatrix: {
        dimensions: ["thickness", "legacy_option_id"],
        rows: [{ id: "row", when: { legacy_option_id: "old" }, variables: { base_price: 500 } }],
      },
    });

    const result = sanitizePbv2PricingMatrix(tree, { allowIncompleteMatrix: true });

    expect(result.changed).toBe(true);
    expect((result.tree as any).pricingMatrix).toEqual({
      dimensions: ["thickness"],
      rows: [],
    });
    expect(result.changes.some((change) => change.code === "PBV2_MATRIX_DIMENSION_REMOVED")).toBe(true);
  });

  test("deleting an option choice removes affected rows only", () => {
    const tree = makeTree();
    (tree.nodes.sides as any).choices = [{ value: "choice_single", label: "Single" }];

    const result = sanitizePbv2PricingMatrix(tree);

    expect((result.tree as any).pricingMatrix.rows).toHaveLength(1);
    expect((result.tree as any).pricingMatrix.rows[0].id).toBe("row_3mm_single");
  });

  test("preserves valid variables, row qty tiers, tier basis, and metadata", () => {
    const tree = makeTree();

    const result = sanitizePbv2PricingMatrix(tree);
    const row = (result.tree as any).pricingMatrix.rows[0];

    expect(result.changed).toBe(false);
    expect(row.variables).toEqual({ base_price: 500 });
    expect(row.qtyTiers).toEqual([{ id: "tier_10", minQty: 10, perSqftCents: 450 }]);
    expect(row.tierBasis).toBe("computed_sheet_usage");
    expect(row.metadata).toEqual({ note: "keep me" });
  });

  test("sanitized broken product passes pricing matrix publish validation without database repair", () => {
    const tree = makeTree({
      pricingMatrix: {
        dimensions: ["thickness", "missing"],
        rows: [
          { id: "row", when: { thickness: "choice_3mm", missing: "old" }, variables: { base_price: 500 } },
        ],
      },
    });

    expect(validateTreeForPublish(tree as any, DEFAULT_VALIDATE_OPTS).errors.some((finding: any) => finding.code === "PBV2_E_PRICING_MATRIX_DIMENSION_UNKNOWN")).toBe(true);

    const result = sanitizePbv2PricingMatrix(tree);
    const validation = validateTreeForPublish(result.tree as any, DEFAULT_VALIDATE_OPTS);

    expect(result.changed).toBe(true);
    expect(validation.errors.filter((finding: any) => String(finding.code).startsWith("PBV2_E_PRICING_MATRIX"))).toEqual([]);
  });
});
