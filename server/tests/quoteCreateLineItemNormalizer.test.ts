import {
  normalizeQuoteCreateLineItem,
  QuoteCreateLineItemValidationError,
  sanitizeJsonForPostgres,
} from "../lib/quoteCreateLineItemNormalizer";

describe("quote create line item normalization", () => {
  const baseLineItem = {
    productId: "prod_1",
    productName: "ACM Panel",
    productType: "flat_good",
    width: 24,
    height: 36,
    quantity: 12,
    linePrice: 135,
    priceBreakdown: {
      basePrice: 100,
      optionsPrice: 35,
      total: 135,
      lineTotalCents: 13500,
    },
  };

  test("preserves PBV2 snapshot and tier metadata for quote creation", () => {
    const pricedAt = "2026-05-21T12:00:00.000Z";
    const { lineItem, jsonChanges } = normalizeQuoteCreateLineItem({
      ...baseLineItem,
      pbv2TreeVersionId: "tree_version_1",
      pricedAt,
      optionSelectionsJson: { thickness: { value: "choice_3mm" } },
      pbv2SnapshotJson: {
        pricing: { totalCents: 13500 },
        pbv2PricingSnapshot: {
          tierResolution: {
            tierBasis: "computed_sheet_usage",
            tierBasisValue: 2.25,
            tierBasisResolvedFrom: "matrix_row",
            computedSheetUsage: 2.25,
            computedSheetUsageAvailable: true,
            computedSheetUsageMode: "sheet_equivalent",
            fallbackToLineItemQuantity: false,
            matrixRowId: "row_3mm",
            matrixStaticBaseRate: 5.75,
            matrixStaticBaseRateUsedAsFallback: false,
            productTierFallbackUsed: false,
          },
        },
      },
    }, 0, { taxAmount: 10, isTaxableSnapshot: true });

    expect(jsonChanges).toEqual([]);
    expect(lineItem.pbv2TreeVersionId).toBe("tree_version_1");
    expect(lineItem.optionSelectionsJson).toEqual({ thickness: { value: "choice_3mm" } });
    expect(lineItem.pbv2SnapshotJson).toEqual(expect.objectContaining({
      pricing: { totalCents: 13500 },
      pbv2PricingSnapshot: expect.objectContaining({
        tierResolution: expect.objectContaining({
          tierBasis: "computed_sheet_usage",
          computedSheetUsageAvailable: true,
          matrixRowId: "row_3mm",
        }),
      }),
    }));
    expect(lineItem.pricedAt).toEqual(new Date(pricedAt));
  });

  test("rejects invalid numeric quote line item values before database insert", () => {
    expect(() =>
      normalizeQuoteCreateLineItem({
        ...baseLineItem,
        linePrice: Number.NaN,
      }, 0, { taxAmount: 0, isTaxableSnapshot: true })
    ).toThrow(QuoteCreateLineItemValidationError);
  });

  test("sanitizes non-JSON-safe snapshot values instead of persisting them", () => {
    const { value, changes } = sanitizeJsonForPostgres({
      valid: 1,
      missing: undefined,
      badNumber: Infinity,
      nested: [Number.NaN, new Date("2026-05-21T12:00:00.000Z")],
    }, "snapshot");

    expect(value).toEqual({
      valid: 1,
      missing: null,
      badNumber: null,
      nested: [null, "2026-05-21T12:00:00.000Z"],
    });
    expect(changes).toEqual(expect.arrayContaining([
      { path: "snapshot.missing", reason: "undefined" },
      { path: "snapshot.badNumber", reason: "non_finite_number" },
      { path: "snapshot.nested[0]", reason: "non_finite_number" },
      { path: "snapshot.nested[1]", reason: "date" },
    ]));
  });
});
