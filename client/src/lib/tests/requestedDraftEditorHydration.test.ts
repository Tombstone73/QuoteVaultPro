import { describe, expect, test } from "@jest/globals";
import { resolveRequestedDraftEditorContext } from "../pbv2/requestedDraftEditorHydration";

describe("requested PBV2 DRAFT editor hydration", () => {
  test("uses the exact DRAFT sheet and rotation settings over active/default product pricing", () => {
    const result = resolveRequestedDraftEditorContext({
      requestedDraftTreeVersionId: "0294f126-0e78-4064-b086-fef419fb77be",
      productIntake: { sheet: { widthIn: 48, heightIn: 96, materialForm: "sheet", allowRotation: true }, draftRouting: { stationName: "Flatbed" } },
      pricingProfileConfig: { sheetWidth: 24, sheetHeight: 48, allowRotation: false, formulaVariables: { minimum_billable_sqft: 3 } },
    });
    expect(result).toMatchObject({
      route: "Flatbed",
      pricingProfileKey: "flat_goods",
      pricingProfileConfig: { sheetWidth: 48, sheetHeight: 96, materialType: "sheet", allowRotation: true, formulaVariables: { minimum_billable_sqft: 3 } },
    });
  });

  test("does not override ordinary product loading or malformed requested DRAFT metadata", () => {
    expect(resolveRequestedDraftEditorContext({ requestedDraftTreeVersionId: null, productIntake: { sheet: { widthIn: 48, heightIn: 96, allowRotation: true } } })).toBeNull();
    expect(resolveRequestedDraftEditorContext({ requestedDraftTreeVersionId: "draft", productIntake: { sheet: { widthIn: 0, heightIn: 96, allowRotation: true } } })).toBeNull();
  });
});
