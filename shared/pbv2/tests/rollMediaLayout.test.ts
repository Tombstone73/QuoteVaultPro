import { describe, expect, test } from "@jest/globals";
import { formulaHelperScope } from "../formulaHelpers";
import {
  calculateRollMediaLayout,
  deriveRollPrintableWidth,
  rollNestingBillableSqft,
  RollMediaLayoutError,
} from "../rollMediaLayout";

const baseRoll = {
  physicalRollWidthIn: 54,
  printableWidthIn: 50,
  edgeWasteInPerSide: 2,
  productionAllowanceXIn: 0.25,
  productionAllowanceYIn: 0.25,
  registrationWasteIn: 4,
  billingWidthIncrementIn: 12,
  billingLengthIncrementIn: 12,
  allowRotation: false,
};

describe("roll media nesting layout", () => {
  test("derives printable width from physical roll width and per-side edge waste", () => {
    expect(deriveRollPrintableWidth({ physicalRollWidthIn: 54, edgeWasteInPerSide: 2 })).toBe(50);
  });

  test("calculates 100 4x4 pieces as 16 billable sqft and 3.875 consumed linear feet", () => {
    const layout = calculateRollMediaLayout({
      ...baseRoll,
      finishedWidthIn: 4,
      finishedHeightIn: 4,
      quantity: 100,
    });

    expect(layout).toEqual(expect.objectContaining({
      orientation: "normal",
      productionWidthIn: 4.25,
      productionLengthIn: 4.25,
      piecesAcross: 11,
      rowsRequired: 10,
      occupiedProductionWidthIn: 46.75,
      billingPanelWidthIn: 48,
      rawBillingLengthIn: 40,
      billingLengthIn: 48,
      billableSqft: 16,
      actualConsumedLengthIn: 46.5,
      actualConsumedLinearFeet: 3.875,
    }));

    expect(layout.billableSqft * 3).toBe(48);
  });

  test("calculates 6 32x32 pieces as 48 billable sqft and 16.458333 consumed linear feet", () => {
    const layout = calculateRollMediaLayout({
      ...baseRoll,
      finishedWidthIn: 32,
      finishedHeightIn: 32,
      quantity: 6,
    });

    expect(layout).toEqual(expect.objectContaining({
      piecesAcross: 1,
      rowsRequired: 6,
      occupiedProductionWidthIn: 32.25,
      unusedPrintableWidthIn: 17.75,
      billingPanelWidthIn: 36,
      rawBillingLengthIn: 192,
      billingLengthIn: 192,
      billableSqft: 48,
      actualConsumedLengthIn: 197.5,
      actualConsumedLinearFeet: 16.458333,
    }));

    expect(layout.billableSqft * 3).toBe(144);
  });

  test.each([
    { quantity: 2, rowsRequired: 1, billingPanelWidthIn: 12 },
    { quantity: 11, rowsRequired: 1, billingPanelWidthIn: 48 },
    { quantity: 12, rowsRequired: 2, billingPanelWidthIn: 48 },
  ])("handles row boundaries for quantity $quantity", ({ quantity, rowsRequired, billingPanelWidthIn }) => {
    const layout = calculateRollMediaLayout({
      ...baseRoll,
      finishedWidthIn: 4,
      finishedHeightIn: 4,
      quantity,
    });

    expect(layout.rowsRequired).toBe(rowsRequired);
    expect(layout.billingPanelWidthIn).toBe(billingPanelWidthIn);
  });

  test("fails closed when the production width exceeds printable roll width", () => {
    expect(() => calculateRollMediaLayout({
      ...baseRoll,
      finishedWidthIn: 51,
      finishedHeightIn: 4,
      quantity: 1,
    })).toThrow(RollMediaLayoutError);

    try {
      calculateRollMediaLayout({
        ...baseRoll,
        finishedWidthIn: 51,
        finishedHeightIn: 4,
        quantity: 1,
      });
    } catch (error: any) {
      expect(error.code).toBe("PRODUCTION_WIDTH_EXCEEDS_PRINTABLE_WIDTH");
    }
  });

  test("uses an allowed rotated orientation before declaring the roll width impossible", () => {
    const layout = calculateRollMediaLayout({
      ...baseRoll,
      finishedWidthIn: 51,
      finishedHeightIn: 24,
      quantity: 1,
      allowRotation: true,
    });

    expect(layout.orientation).toBe("rotated");
  });

  test("keeps an oversized roll item priceable without inventing a roll length", () => {
    expect(rollNestingBillableSqft(60, 24, 1, 50, 0, 0, 12, 12)).toBe(10);
  });

  test("formula helper uses the same calculator for billable square footage", () => {
    expect(rollNestingBillableSqft(4, 4, 100, 50, 0.25, 0.25, 12, 12)).toBe(16);
    expect(formulaHelperScope().roll_nesting_billable_sqft(4, 4, 100, 50, 0.25, 0.25, 12, 12)).toBe(16);
  });
});
