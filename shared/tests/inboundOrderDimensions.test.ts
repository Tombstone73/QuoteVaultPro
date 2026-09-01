import {
  inboundDimensionsMatchPdf,
  normalizeInboundDimensionsToInches,
  wholeFootBillableDimensions,
} from "../inboundOrderDimensions";

describe("inbound order physical and billable dimensions", () => {
  test("normalizes feet to physical inches without changing the entered facts", () => {
    expect(normalizeInboundDimensionsToInches({ width: 3, height: 8, unit: "ft" })).toEqual({
      actualWidthIn: 36,
      actualHeightIn: 96,
    });
  });

  test.each([
    [{ width: 3, height: 8, unit: "ft" }, 36, 96, 24],
    [{ width: 3, height: 8, unit: "in" }, 12, 12, 1],
    [{ width: 37, height: 97, unit: "in" }, 48, 108, 36],
    [{ width: 24, height: 36, unit: "in" }, 24, 36, 6],
  ])("rounds each dimension independently: %o", (input, billableWidthIn, billableHeightIn, billableSquareFeet) => {
    const actual = normalizeInboundDimensionsToInches(input);
    expect(wholeFootBillableDimensions(actual)).toMatchObject({
      ...actual,
      billableWidthIn,
      billableHeightIn,
      billableSquareFeet,
    });
  });

  test("keeps PDF equivalence unit-aware and rotation-aware", () => {
    expect(inboundDimensionsMatchPdf({ enteredWidth: 3, enteredHeight: 8, enteredUnit: "ft", pdfWidthIn: 96, pdfHeightIn: 36 })).toBe(true);
    expect(inboundDimensionsMatchPdf({ enteredWidth: 3, enteredHeight: 8, enteredUnit: "ft", pdfWidthIn: 36, pdfHeightIn: 96 })).toBe(true);
    expect(inboundDimensionsMatchPdf({ enteredWidth: 3, enteredHeight: 8, enteredUnit: "ft", pdfWidthIn: 48, pdfHeightIn: 96 })).toBe(false);
    expect(inboundDimensionsMatchPdf({ enteredWidth: 3, enteredHeight: 8, enteredUnit: "ft", pdfWidthIn: 36, pdfHeightIn: 108 })).toBe(false);
  });
});
