import { describe, expect, test } from "@jest/globals";
import {
  isPbv2ProductPayloadLike,
  sanitizeLegacyPriceBreaksForPbv2,
} from "../pbv2/legacyPriceBreaks";

const activePriceBreaks = {
  enabled: true,
  type: "quantity" as const,
  tiers: [{ minValue: 1, discountType: "percentage" as const, discountValue: 10 }],
};

describe("PBV2 legacy priceBreaks sanitizer", () => {
  test("PBV2 product update clears active legacy priceBreaks", () => {
    const payload = {
      priceBreaks: activePriceBreaks,
    };
    const existingProduct = {
      pbv2ActiveTreeVersionId: "tree_1",
    };

    const sanitized = sanitizeLegacyPriceBreaksForPbv2(payload, existingProduct);

    expect(sanitized.priceBreaks).toEqual({ enabled: false, type: "quantity", tiers: [] });
  });

  test("non-PBV2 product keeps legacy priceBreaks", () => {
    const payload = {
      name: "Static Product",
      priceBreaks: activePriceBreaks,
    };

    const sanitized = sanitizeLegacyPriceBreaksForPbv2(payload);

    expect(sanitized.priceBreaks).toBe(activePriceBreaks);
  });

  test("detects PBV2 payloads from active tree id, option tree, or export wrapper", () => {
    expect(isPbv2ProductPayloadLike({ pbv2ActiveTreeVersionId: "tree_1" })).toBe(true);
    expect(isPbv2ProductPayloadLike({ optionTreeJson: { schemaVersion: 2, nodes: {}, rootNodeIds: [] } })).toBe(true);
    expect(isPbv2ProductPayloadLike({ pbv2: { hasActiveTree: true } })).toBe(true);
    expect(isPbv2ProductPayloadLike({ priceBreaks: activePriceBreaks })).toBe(false);
  });
});
