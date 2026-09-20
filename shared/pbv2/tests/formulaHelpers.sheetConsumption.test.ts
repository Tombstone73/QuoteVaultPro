import { describe, expect, test } from "@jest/globals";
import {
  calculateSheetYield,
  formulaHelperScope,
  sheetConsumptionSqft,
} from "../formulaHelpers";

const SHEET_WIDTH = 48;
const SHEET_LENGTH = 96;
const USABLE_DROP_MIN = 24;
const BILLABLE_LENGTH_INCREMENT = 12;
const MINIMUM_BILLABLE_SQFT = 3;

function calculate(width: number, height: number, allowRotation = true) {
  return calculateSheetYield(
    width,
    height,
    1,
    SHEET_WIDTH,
    SHEET_LENGTH,
    USABLE_DROP_MIN,
    BILLABLE_LENGTH_INCREMENT,
    MINIMUM_BILLABLE_SQFT,
    allowRotation,
  );
}

describe("sheet_consumption_sqft 4x8 drop billing", () => {
  test("48x72 preserves an exactly 24-inch end drop and bills 24 sqft", () => {
    const result = calculate(48, 72);

    expect(result.consumedSqft).toBe(24);
    expect(result.billedSheetSqft).toBe(24);
    expect(result.leftoverDropWidth).toBe(0);
    expect(result.leftoverDropLength).toBe(24);
    expect(result.lengthDropUsable).toBe(true);
    expect(result.dropUsable).toBe(true);
  });

  test("72x48 uses rotation and preserves the same 48x24 drop", () => {
    const result = calculate(72, 48);

    expect(result.orientationUsed).toBe("rotated");
    expect(result.billedSheetSqft).toBe(24);
    expect(result.leftoverDropLength).toBe(24);
    expect(result.lengthDropUsable).toBe(true);
  });

  test("72x48 fails closed when rotation is disabled", () => {
    expect(() => calculate(72, 48, false)).toThrow("without rotation");
  });

  test.each([
    { width: 48, height: 73, expected: 32, usable: false },
    { width: 48, height: 48, expected: 16, usable: true },
    { width: 48, height: 96, expected: 32, usable: false },
    { width: 24, height: 96, expected: 16, usable: true },
  ])("$width x $height bills $expected sqft", ({ width, height, expected, usable }) => {
    const result = calculate(width, height);

    expect(result.billedSheetSqft).toBe(expected);
    expect(result.dropUsable).toBe(usable);
  });

  test("returns exact billable sqft without a 32.064 floating artifact", () => {
    const result = sheetConsumptionSqft(48, 72, 1, 48, 96, 24, 12, 3, true);

    expect(result).toBe(24);
    expect(result * 5).toBe(120);
    expect(result).not.toBeCloseTo(32.064, 6);
  });

  test("uses finished area as the pricing basis when a valid item requires paneling", () => {
    expect(sheetConsumptionSqft(238, 24, 1, 48, 96, 24, 12, 3, true)).toBeCloseTo((238 * 24) / 144, 6);
  });

  test("formula helper scope honors configured rotation when the optional argument is omitted", () => {
    const helper = formulaHelperScope(true).sheet_consumption_sqft;

    expect(helper(72, 48, 1, 48, 96, 24, 12, 3)).toBe(24);
  });

  test("compares final-row billable consumption so rotation makes swapped dimensions price-invariant", () => {
    const args = [22, SHEET_WIDTH, SHEET_LENGTH, USABLE_DROP_MIN, BILLABLE_LENGTH_INCREMENT, MINIMUM_BILLABLE_SQFT] as const;
    const portrait = sheetConsumptionSqft(12, 48, ...args, true);
    const landscape = sheetConsumptionSqft(48, 12, ...args, true);

    expect(portrait).toBe(88);
    expect(landscape).toBe(88);
    expect(portrait * 2.1875).toBe(192.5);
    expect(landscape * 2.1875).toBe(192.5);
  });

  test("retains orientation-specific consumption when rotation is disabled", () => {
    expect(sheetConsumptionSqft(12, 48, 22, SHEET_WIDTH, SHEET_LENGTH, USABLE_DROP_MIN, BILLABLE_LENGTH_INCREMENT, MINIMUM_BILLABLE_SQFT, false)).toBe(96);
    expect(sheetConsumptionSqft(48, 12, 22, SHEET_WIDTH, SHEET_LENGTH, USABLE_DROP_MIN, BILLABLE_LENGTH_INCREMENT, MINIMUM_BILLABLE_SQFT, false)).toBe(88);
  });
});
