import { describe, expect, test } from "@jest/globals";
import type { OptionRuntimeSelectionContext, OptionTreeV2 } from "../../../shared/optionTreeV2";
import {
  collectPbv2WeightMaterialIds,
  resolvePbv2WeightSource,
  type Pbv2WeightMaterialRecord,
} from "../pbv2WeightResolver";

function runtimeContext(materialId?: string): OptionRuntimeSelectionContext {
  return {
    selectedChoices: materialId ? { substrate: materialId } : {},
    resolvedChoices: materialId
      ? {
          substrate: {
            nodeId: "substrate",
            selectionKey: "substrate",
            optionLabel: "Substrate",
            choiceValue: materialId,
            choiceLabel: materialId,
            material: { materialId },
            role: "variant",
          },
        }
      : {},
    visibleNodeIds: [],
    visibleGroupIds: [],
    visibleChoiceIds: [],
    workflowTags: [],
    appliedPricingOverrides: [],
    hiddenSelectionWarnings: [],
  };
}

function fallbackTree(baseWeightOz = 12): OptionTreeV2 {
  return {
    schemaVersion: 2,
    rootNodeIds: [],
    nodes: {},
    meta: { baseWeightOz },
  };
}

const acm3mm: Pbv2WeightMaterialRecord = {
  id: "mat_acm_3mm",
  name: "ACM 3mm",
  sku: "ACM-3",
  weightValue: 0.32,
  weightUnit: "lb",
  weightBasis: "sqft",
  weightOzPerBasis: 5.12,
};

const acm6mm: Pbv2WeightMaterialRecord = {
  id: "mat_acm_6mm",
  name: "ACM 6mm",
  sku: "ACM-6",
  weightValue: 0.42,
  weightUnit: "lb",
  weightBasis: "sqft",
  weightOzPerBasis: 6.72,
};

describe("resolvePbv2WeightSource", () => {
  test("choice material with sqft weight beats product fallback", () => {
    const result = resolvePbv2WeightSource({
      treeJson: fallbackTree(10),
      selections: { schemaVersion: 2, selected: {} },
      runtimeSelectionContext: runtimeContext(acm6mm.id),
      productPrimaryMaterialId: null,
      materialRecords: [acm6mm],
      widthIn: 24,
      heightIn: 36,
      quantity: 1,
    });

    expect(result.source).toBe("choice_material");
    expect(result.materialId).toBe(acm6mm.id);
    expect(result.basisQuantity).toBe(6);
    expect(result.totalOz).toBeCloseTo(40.32, 5);
  });

  test("product primary material beats fallback", () => {
    const result = resolvePbv2WeightSource({
      treeJson: fallbackTree(10),
      selections: { schemaVersion: 2, selected: {} },
      runtimeSelectionContext: runtimeContext(),
      productPrimaryMaterialId: acm3mm.id,
      materialRecords: [acm3mm],
      widthIn: 24,
      heightIn: 36,
      quantity: 1,
    });

    expect(result.source).toBe("product_primary_material");
    expect(result.materialId).toBe(acm3mm.id);
    expect(result.totalOz).toBeCloseTo(30.72, 5);
  });

  test("fallback works when no material is configured", () => {
    const result = resolvePbv2WeightSource({
      treeJson: fallbackTree(14),
      selections: { schemaVersion: 2, selected: {} },
      runtimeSelectionContext: runtimeContext(),
      materialRecords: [],
      widthIn: 24,
      heightIn: 36,
      quantity: 1,
    });

    expect(result.source).toBe("product_fallback");
    expect(result.totalOz).toBe(14);
  });

  test("missing selected material returns warning and fallback", () => {
    const result = resolvePbv2WeightSource({
      treeJson: fallbackTree(9),
      selections: { schemaVersion: 2, selected: {} },
      runtimeSelectionContext: runtimeContext("missing_material"),
      materialRecords: [],
      widthIn: 24,
      heightIn: 36,
      quantity: 1,
    });

    expect(result.source).toBe("product_fallback");
    expect(result.totalOz).toBe(9);
    expect(result.warnings.some((warning) => warning.code === "PBV2_W_MATERIAL_REFERENCE_MISSING")).toBe(true);
  });

  test("selected material missing weight returns warning and fallback", () => {
    const result = resolvePbv2WeightSource({
      treeJson: fallbackTree(9),
      selections: { schemaVersion: 2, selected: {} },
      runtimeSelectionContext: runtimeContext("mat_blank"),
      materialRecords: [{ id: "mat_blank", name: "Blank ACM" }],
      widthIn: 24,
      heightIn: 36,
      quantity: 1,
    });

    expect(result.source).toBe("product_fallback");
    expect(result.totalOz).toBe(9);
    expect(result.warnings.some((warning) => warning.code === "PBV2_W_MATERIAL_WEIGHT_MISSING")).toBe(true);
  });

  test("ACM 3mm vs 6mm selections produce different totalOz", () => {
    const baseInput = {
      treeJson: fallbackTree(9),
      selections: { schemaVersion: 2 as const, selected: {} },
      materialRecords: [acm3mm, acm6mm],
      widthIn: 24,
      heightIn: 36,
      quantity: 1,
    };

    const threeMm = resolvePbv2WeightSource({
      ...baseInput,
      runtimeSelectionContext: runtimeContext(acm3mm.id),
    });
    const sixMm = resolvePbv2WeightSource({
      ...baseInput,
      runtimeSelectionContext: runtimeContext(acm6mm.id),
    });

    expect(threeMm.totalOz).toBeCloseTo(30.72, 5);
    expect(sixMm.totalOz).toBeCloseTo(40.32, 5);
    expect(sixMm.totalOz ?? 0).toBeGreaterThan(threeMm.totalOz ?? 0);
  });

  test("no usable source returns PBV2_W_WEIGHT_MISSING", () => {
    const result = resolvePbv2WeightSource({
      treeJson: fallbackTree(0),
      selections: { schemaVersion: 2, selected: {} },
      runtimeSelectionContext: runtimeContext(),
      materialRecords: [],
      widthIn: 24,
      heightIn: 36,
      quantity: 1,
    });

    expect(result.source).toBe("missing");
    expect(result.totalOz).toBeNull();
    expect(result.warnings.some((warning) => warning.code === "PBV2_W_WEIGHT_MISSING")).toBe(true);
  });

  test("empty material ID list is safe for callers to skip IN queries", () => {
    expect(collectPbv2WeightMaterialIds({ runtimeSelectionContext: runtimeContext(), productPrimaryMaterialId: null })).toEqual([]);
  });
});
