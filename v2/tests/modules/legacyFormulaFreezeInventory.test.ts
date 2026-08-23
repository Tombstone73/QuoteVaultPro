import { describe, expect, test } from "@jest/globals";
import { planLegacyFormulaFreeze, type LegacyFormulaFreezeCandidate } from "../../src/modules/pricing/legacyFormulaFreezeInventory";

const candidate = (evidence: LegacyFormulaFreezeCandidate["evidence"]): LegacyFormulaFreezeCandidate => ({
  organizationId: "tenant-a",
  productId: "product-a",
  productName: "Formula test product",
  productVersionId: "version-a",
  lifecycle: "ACTIVE",
  evidence,
});

describe("legacy Formula freeze inventory", () => {
  test("uses the established compatibility precedence and plans a stable binding", () => {
    const result = planLegacyFormulaFreeze(candidate([
      { source: "legacy_product_formula", expression: "q * 1" },
      { source: "embedded_product_version", expression: "q * 2" },
      { source: "legacy_formula_library", formulaId: "formula-a", formulaRevisionId: "revision-7", expression: "q * 3", declaredInputs: [{ key: "p", type: "number" }], inputValues: { p: 3 } },
    ]));
    expect(result).toMatchObject({
      disposition: "bind_existing_revision",
      currentSource: "legacy_formula_library",
      expression: "q * 3",
      candidateFormulaId: "formula-a",
      candidateFormulaRevisionId: "revision-7",
      productName: "Formula test product",
      compatibilityBindingRequired: true,
      declaredInputEvidence: [{ key: "p", type: "number" }],
      inputValueEvidence: { p: 3 },
    });
  });

  test("does not migrate an internally ambiguous legacy source", () => {
    const result = planLegacyFormulaFreeze(candidate([
      { source: "legacy_formula_library", formulaId: "formula-a", expression: "q * p" },
      { source: "legacy_formula_library", formulaId: "formula-a", expression: "q * (p + 1)" },
    ]));
    expect(result).toMatchObject({ disposition: "ambiguous", compatibilityBindingRequired: false });
    expect(result.conflicts[0]).toContain("conflicting");
  });

  test("does not infer a revision for blank or incomplete evidence", () => {
    const result = planLegacyFormulaFreeze(candidate([
      { source: "legacy_product_formula", expression: "   " },
    ]));
    expect(result).toMatchObject({ disposition: "ambiguous", compatibilityBindingRequired: false });
  });

  test("reports a pre-existing canonical binding as already frozen", () => {
    expect(planLegacyFormulaFreeze(candidate([
      { source: "formula_revision_binding", formulaId: "formula-a", formulaRevisionId: "revision-1", expression: "ceil(sqft) * p" },
      { source: "legacy_formula_library", formulaId: "formula-a", expression: "ceil(sqft) * p" },
    ]))).toMatchObject({
      disposition: "already_frozen",
      currentSource: "formula_revision_binding",
      compatibilityBindingRequired: false,
    });
  });

  test("keeps a legacy embedded expression exact and requires an append-only compatibility binding", () => {
    expect(planLegacyFormulaFreeze(candidate([
      { source: "embedded_product_version", expression: "ceil((((w+.25)*(h+.25))*q)/144)*p", inputValues: { p: 3 } },
    ]))).toMatchObject({
      disposition: "create_revision_and_bind",
      currentSource: "embedded_product_version",
      expression: "ceil((((w+.25)*(h+.25))*q)/144)*p",
      compatibilityBindingRequired: true,
    });
  });

  test("reports observed legacy values without inventing typed input declarations", () => {
    const result = planLegacyFormulaFreeze(candidate([
      { source: "legacy_product_formula", expression: "q * p", inputValues: { p: 3, allow_rotation: true } },
    ]));
    expect(result).toMatchObject({ inputValueEvidence: { p: 3, allow_rotation: true } });
    expect(result.declaredInputEvidence).toBeUndefined();
  });

  test("preserves Draft lifecycle and Product name in the emitted plan", () => {
    const result = planLegacyFormulaFreeze({ ...candidate([
      { source: "embedded_product_version", expression: "q * p" },
    ]), productName: "Open Formula Draft", lifecycle: "DRAFT" });
    expect(result).toMatchObject({ productName: "Open Formula Draft", lifecycle: "DRAFT" });
  });

  test("leaves non-Formula ProductVersions outside the backfill", () => {
    expect(planLegacyFormulaFreeze(candidate([]))).toMatchObject({ disposition: "not_formula_backed", compatibilityBindingRequired: false });
  });
});
