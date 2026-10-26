import { describe, expect, test } from "@jest/globals";
import { quotePricingSnapshotForFingerprint } from "../services/assistant/quoteProposalFingerprint";

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
});
