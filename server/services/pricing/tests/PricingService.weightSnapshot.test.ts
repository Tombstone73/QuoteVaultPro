import { describe, expect, test } from "@jest/globals";
import { buildResolvedWeightSnapshotDebug } from "../PricingService";
import type { ResolvedPbv2WeightSource } from "../../pbv2WeightResolver";

describe("PricingService resolved weight snapshot metadata", () => {
  test("omits resolved weight metadata when old snapshots do not have it", () => {
    const oldSnapshot = {
      formula: "",
      formulaVariables: {},
      rawSelections: {},
      effectiveSelections: {},
      resolvedMatrixVariables: {},
      calculatedPrice: 42,
      capturedAt: "2026-05-15T00:00:00.000Z",
    };

    expect(oldSnapshot).not.toHaveProperty("resolvedWeightDebug");
    expect(buildResolvedWeightSnapshotDebug(undefined)).toBeUndefined();
  });

  test("captures resolved weight as explainability metadata without pricing totals", () => {
    const resolvedWeight: ResolvedPbv2WeightSource = {
      totalOz: 40.32,
      source: "choice_material",
      sourceLabel: "Material ACM 6mm",
      materialId: "mat_acm_6mm",
      materialName: "ACM 6mm",
      materialSku: "ACM-6",
      weightValue: 0.42,
      weightUnit: "lb",
      weightBasis: "sqft",
      weightOzPerBasis: 6.72,
      basisQuantity: 6,
      warnings: [],
    };

    const debug = buildResolvedWeightSnapshotDebug(resolvedWeight);

    expect(debug).toEqual({
      totalOz: 40.32,
      source: "choice_material",
      sourceLabel: "Material ACM 6mm",
      materialId: "mat_acm_6mm",
      materialName: "ACM 6mm",
      materialSku: "ACM-6",
      weightValue: 0.42,
      weightUnit: "lb",
      weightBasis: "sqft",
      weightOzPerBasis: 6.72,
      basisQuantity: 6,
      warnings: [],
    });
    expect(debug).not.toHaveProperty("calculatedPrice");
    expect(debug).not.toHaveProperty("baseCents");
    expect(debug).not.toHaveProperty("optionsCents");
  });

  test("saved metadata stays stable if material-derived source data changes later", () => {
    const resolvedWeight: ResolvedPbv2WeightSource = {
      totalOz: 30.72,
      source: "choice_material",
      sourceLabel: "Material ACM 3mm",
      materialId: "mat_acm_3mm",
      materialName: "ACM 3mm",
      materialSku: "ACM-3",
      weightValue: 0.32,
      weightUnit: "lb",
      weightBasis: "sqft",
      weightOzPerBasis: 5.12,
      basisQuantity: 6,
      warnings: [{ code: "PBV2_W_MATERIAL_WEIGHT_NOTE", message: "Snapshot test warning" }],
    };

    const debug = buildResolvedWeightSnapshotDebug(resolvedWeight);
    resolvedWeight.materialName = "ACM 3mm edited later";
    resolvedWeight.weightOzPerBasis = 99;
    resolvedWeight.warnings[0].message = "Edited later";

    expect(debug?.materialName).toBe("ACM 3mm");
    expect(debug?.weightOzPerBasis).toBe(5.12);
    expect(debug?.warnings).toEqual([{ code: "PBV2_W_MATERIAL_WEIGHT_NOTE", message: "Snapshot test warning" }]);
  });
});
