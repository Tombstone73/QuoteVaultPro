import { describe, expect, test } from "@jest/globals";
import { validatePbv2MaterialReferences } from "../pbv2MaterialValidation";

function makeTree(materialId = "mat_acm") {
  return {
    schemaVersion: 2,
    rootNodeIds: ["substrate"],
    nodes: {
      substrate: {
        id: "substrate",
        kind: "question",
        label: "Substrate",
        input: { type: "select", selectionKey: "substrate" },
        choices: [
          {
            value: "acm_6mm",
            label: "ACM 6mm",
            materialOverride: { materialId },
          },
        ],
      },
    },
    meta: {
      shippingConfig: { baseWeight: 1, weightUnit: "lb", weightBasis: "per_sqft" },
    },
  };
}

describe("validatePbv2MaterialReferences", () => {
  test("reports missing material reference with human-readable context", () => {
    const findings = validatePbv2MaterialReferences({
      treeJson: makeTree("missing_mat"),
      productPrimaryMaterialId: null,
      materials: [],
    });

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "PBV2_W_MATERIAL_REFERENCE_MISSING",
        severity: "WARNING",
        message: "Material reference missing for Substrate: ACM 6mm",
        context: expect.objectContaining({
          materialId: "missing_mat",
          optionLabel: "Substrate",
          choiceLabel: "ACM 6mm",
        }),
      }),
    ]));
  });

  test("missing material weight warns but does not create an error", () => {
    const findings = validatePbv2MaterialReferences({
      treeJson: makeTree("mat_blank"),
      productPrimaryMaterialId: null,
      materials: [{ id: "mat_blank", name: "Blank ACM", weightOzPerBasis: null }],
    });

    expect(findings.some((finding) => finding.severity === "ERROR")).toBe(false);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "PBV2_W_MATERIAL_WEIGHT_MISSING",
        severity: "WARNING",
        message: "Selected material for Substrate: ACM 6mm has no configured weight",
      }),
      expect.objectContaining({
        code: "PBV2_W_PRODUCT_FALLBACK_WEIGHT_USED",
        severity: "WARNING",
      }),
    ]));
  });

  test("product primary material with missing weight warns separately", () => {
    const findings = validatePbv2MaterialReferences({
      treeJson: { schemaVersion: 2, rootNodeIds: [], nodes: {}, meta: {} },
      productPrimaryMaterialId: "mat_primary",
      materials: [{ id: "mat_primary", name: "Primary ACM", weightOzPerBasis: "" }],
    });

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "PBV2_W_PRODUCT_PRIMARY_MATERIAL_WEIGHT_MISSING",
        severity: "WARNING",
        path: "product.primaryMaterialId",
      }),
    ]));
  });

  test("blocks publication when a Prepress inventory-consumption material is missing", () => {
    const tree = makeTree("mat_destination");
    (tree.nodes.substrate.choices[0] as any).inventoryConsumption = [{ materialId: "source-environment-uuid", quantityBasis: "area_sqft" }];
    const findings = validatePbv2MaterialReferences({
      treeJson: tree,
      productPrimaryMaterialId: null,
      materials: [{ id: "mat_destination", name: "13oz Banner", sku: "BANNER-13OZ", weightOzPerBasis: "13" }],
    });
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PBV2_E_INVENTORY_MATERIAL_REFERENCE_MISSING", severity: "ERROR" }),
    ]));
  });
});
