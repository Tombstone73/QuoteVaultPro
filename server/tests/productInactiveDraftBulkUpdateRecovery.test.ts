import { describe, expect, test } from "@jest/globals";
import { aggregateProductDraftBulkUpdateState, productDraftBulkUpdateResumeEligibility, resumableProductDraftBulkUpdateRows } from "../services/assistant/productInactiveDraftBulkUpdateRecovery";

describe("inactive draft bulk-update recovery", () => {
  test("shares resume eligibility and never retries completed, terminal, or stale rows", () => {
    const rows = [
      { executionState: "pending" as const }, { executionState: "failed_retryable" as const }, { executionState: "updated" as const },
      { executionState: "no_change" as const }, { executionState: "failed_terminal" as const }, { executionState: "stale" as const },
    ];
    expect(resumableProductDraftBulkUpdateRows(rows).map((row) => row.executionState)).toEqual(["pending", "failed_retryable"]);
    expect(productDraftBulkUpdateResumeEligibility(rows)).toEqual({ available: true, pendingCount: 1, retryableCount: 1, terminalCount: 1, staleCount: 1, completedCount: 1, noChangeCount: 1, requiresNewProposal: true });
    expect(aggregateProductDraftBulkUpdateState(rows)).toBe("partially_completed");
  });

  test("does not report full completion while retryable work remains", () => {
    expect(aggregateProductDraftBulkUpdateState([{ executionState: "updated" as const }, { executionState: "failed_retryable" as const }])).toBe("partially_completed");
  });
});
