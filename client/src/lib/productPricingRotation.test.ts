/// <reference types="jest" />

import {
  buildPricingConfigWithAllowRotation,
  getAllowRotationFromPricingConfig,
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

  it("shows the pricing engine rotation control when the formula uses sheet consumption", () => {
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

  it("keeps top-level allowRotation and formulaVariables.allow_rotation synchronized", () => {
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
    expect(next.formulaVariables.allow_rotation).toBe(true);
    expect(next.formulaVariables.sheet_width).toBe(48);
    expect(getAllowRotationFromPricingConfig(next)).toBe(true);
  });
});
