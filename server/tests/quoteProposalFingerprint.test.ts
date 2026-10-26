import { describe, expect, test } from "@jest/globals";
import { quotePricingSnapshotForFingerprint, quoteProductPricingInputsForFingerprint } from "../services/assistant/quoteProposalFingerprint";

describe("Quote approval pricing fingerprint", () => {
  test("ignores fresh pricing capture clocks but keeps price, tree, and selections", () => {
    const snapshot = { pricedAt: "2026-10-25T10:00:00.000Z", treeVersionId: "tree_1", treeJson: { meta: { pricingV2: { base: { perSqftCents: 100 } } } },
      selections: { finish: "none" }, pricing: { totalCents: 700 }, pbv2PricingSnapshot: { capturedAt: "2026-10-25T10:00:00.000Z", tierResolution: { capturedAt: "2026-10-25T10:00:00.000Z", finalBaseRateUsed: 100 } } };
    const normalized = quotePricingSnapshotForFingerprint(snapshot);
    expect(quotePricingSnapshotForFingerprint({ ...snapshot, pricedAt: "2026-10-25T10:01:00.000Z", pbv2PricingSnapshot: { capturedAt: "2026-10-25T10:01:00.000Z", tierResolution: { capturedAt: "2026-10-25T10:01:00.000Z", finalBaseRateUsed: 100 } } })).toEqual(normalized);
    expect(quotePricingSnapshotForFingerprint({ ...snapshot, pricing: { totalCents: 800 } })).not.toEqual(normalized);
    expect(quotePricingSnapshotForFingerprint({ ...snapshot, treeJson: { meta: { pricingV2: { base: { perSqftCents: 125 } } } } })).not.toEqual(normalized);
    expect(quotePricingSnapshotForFingerprint({ ...snapshot, selections: { finish: "laminate" } })).not.toEqual(normalized);
  });

  test("binds Product pricing and tax inputs without incidental update clocks", () => {
    const product = { id: "p1", name: "Board", pricingMode: "area", pricingProfileConfig: { baseRate: 75 },
      isTaxable: true, isActive: true, updatedAt: new Date("2026-10-25T10:00:00Z"), description: "Old copy" };
    const fingerprint = quoteProductPricingInputsForFingerprint(product);
    expect(quoteProductPricingInputsForFingerprint({ ...product, updatedAt: new Date("2026-10-25T11:00:00Z"), description: "New copy" })).toEqual(fingerprint);
    expect(quoteProductPricingInputsForFingerprint({ ...product, pricingProfileConfig: { baseRate: 125 } })).not.toEqual(fingerprint);
    expect(quoteProductPricingInputsForFingerprint({ ...product, isTaxable: false })).not.toEqual(fingerprint);
  });
});
