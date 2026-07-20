import { describe, expect, test } from "@jest/globals";
import { normalizeProductRotationForWrite } from "../lib/productPricingRotationWrite";
import { updateProductSchema } from "@shared/schema";

describe("Product Catalog allowRotation writes", () => {
  test.each([true, false])("persists canonical allowRotation=%s", (allowRotation) => {
    const normalized = normalizeProductRotationForWrite({
      pricingProfileKey: "default",
      pricingFormula: "sheet_consumption_sqft(w,h,q,48,96,24,12,3) * base_price",
      pricingProfileConfig: {
        variables: { sheet_width: 48, allow_rotation: !allowRotation },
        formulaVariables: { sheet_length: 96, allow_rotation: !allowRotation },
        allowRotation,
      },
    });

    expect(normalized.pricingProfileConfig).toEqual({
      formulaVariables: { sheet_width: 48, sheet_length: 96 },
      allowRotation,
    });
  });

  test("uses existing product formula context for a partial update", () => {
    const normalized = normalizeProductRotationForWrite({
      pricingProfileConfig: { formulaVariables: { allow_rotation: true } },
    }, {
      pricingProfileKey: "default",
      pricingFormula: "sheet_consumption_sqft(w,h,q,48,96,24,12,3) * base_price",
    });

    expect(normalized.pricingProfileConfig).toEqual({
      formulaVariables: {},
      allowRotation: true,
    });
  });

  test("does not add rotation to unrelated fee pricing config", () => {
    const input = {
      pricingProfileKey: "fee",
      pricingFormula: "flatFee",
      pricingProfileConfig: { formulaVariables: { flatFee: 25 } },
    };
    expect(normalizeProductRotationForWrite(input)).toEqual(input);
  });

  test("product save validation preserves formula variables and defaults missing rotation off", () => {
    const parsed = updateProductSchema.parse({
      pricingProfileConfig: {
        sheetWidth: 48,
        sheetHeight: 96,
        materialType: "sheet",
        formulaVariables: {
          usable_drop_min: 24,
          billable_length_increment: 12,
        },
      },
    });

    expect(parsed.pricingProfileConfig).toEqual(expect.objectContaining({
      allowRotation: false,
      formulaVariables: {
        usable_drop_min: 24,
        billable_length_increment: 12,
      },
    }));
  });
});
