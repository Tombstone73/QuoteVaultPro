import { describe, expect, test } from "@jest/globals";
import { summarizeProductDraftBulkUpdate } from "../services/assistant/productInactiveDraftBulkUpdatePresentation";

describe("inactive draft bulk-update presentation", () => {
  test("reports accurate safe result counts and resume eligibility", () => {
    const result = summarizeProductDraftBulkUpdate([
      { productId: "p1", productName: "A", executionState: "updated" as const, attemptCount: 1, patch: { basePricing: { minimumChargeCents: 100 } }, readinessBefore: { status: "not_ready" }, readinessAfter: { status: "ready" }, lastErrorCode: null, lastErrorMessage: null, retryable: false },
      { productId: "p2", productName: "B", executionState: "stale" as const, attemptCount: 1, patch: { basePricing: { minimumChargeCents: 100 } }, readinessBefore: null, readinessAfter: null, lastErrorCode: "INACTIVE_DRAFT_STALE", lastErrorMessage: "Changed", retryable: false },
    ]);
    expect(result).toMatchObject({ totalCount: 2, updatedCount: 1, staleCount: 1, requiresNewProposal: true, safety: expect.stringContaining("inactive PBV2 DRAFT") });
    expect(result.failures[0]).toMatchObject({ productId: "p2", requiresNewProposal: true });
  });
});
