/// <reference types="jest" />

import {
  buildPricingConfigWithAllowRotation,
  getAllowRotationFromPricingConfig,
  mergeFormulaLibraryConfigWithProductConfig,
  normalizeProductPricingRotationConfig,
  shouldShowPricingEngineRotationControl,
} from "./productPricingRotation";

describe("product pricing rotation helpers", () => {
  it("shows the pricing engine rotation control for flat goods products", () => {
    expect(shouldShowPricingEngineRotationControl({
      pricingProfileKey: "flat_goods",
      pricingFormula: "total_sqft * p",
      pricingProfileConfig: {},
    })).toBe(true);
  });

  it("shows the pricing engine rotation control in formula library mode when the resolved formula uses sheet consumption", () => {
    expect(shouldShowPricingEngineRotationControl({
      pricingProfileKey: "default",
      pricingFormula: "sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,24,12,3) * base_price",
      pricingProfileConfig: {},
    })).toBe(true);
  });

  it("shows the pricing engine rotation control when existing config has rotation state", () => {
    expect(shouldShowPricingEngineRotationControl({
      pricingProfileKey: "default",
      pricingFormula: "total_sqft * p",
      pricingProfileConfig: { formulaVariables: { allow_rotation: false } },
    })).toBe(true);
  });

  it("persists allowRotation only in the canonical top-level product field", () => {
    const next = buildPricingConfigWithAllowRotation({
      sheetWidth: 48,
      sheetHeight: 96,
      allowRotation: false,
      formulaVariables: {
        sheet_width: 48,
        allow_rotation: false,
      },
    }, true);

    expect(next.allowRotation).toBe(true);
    expect(next.formulaVariables.allow_rotation).toBeUndefined();
    expect(next.formulaVariables.sheet_width).toBe(48);
    expect(getAllowRotationFromPricingConfig(next)).toBe(true);
  });

  it("normalizes nested legacy rotation without dropping pricing variables", () => {
    const next = normalizeProductPricingRotationConfig({
      variables: { sheet_width: 48, allow_rotation: "yes" },
      formulaVariables: { sheet_length: 96, allow_rotation: false },
    });

    expect(next.allowRotation).toBe(false);
    expect(next.variables).toBeUndefined();
    expect(next.formulaVariables).toEqual({ sheet_width: 48, sheet_length: 96 });
  });

  it("keeps the saved product rotation when formula-library defaults hydrate", () => {
    expect(mergeFormulaLibraryConfigWithProductConfig(
      { variables: { sheet_width: 48, sheet_length: 96, allow_rotation: true } },
      { allowRotation: false, formulaVariables: { minimum_billable_sqft: 3 } },
    )).toEqual({
      formulaVariables: { sheet_width: 48, sheet_length: 96, minimum_billable_sqft: 3 },
      allowRotation: false,
    });
  });

  it("uses a fail-closed rotation value when neither product nor library configured it", () => {
    expect(mergeFormulaLibraryConfigWithProductConfig(
      { variables: { sheet_width: 48, sheet_length: 96 } },
      null,
    )).toEqual({
      formulaVariables: { sheet_width: 48, sheet_length: 96 },
      allowRotation: false,
    });
  });
});
