import { productDraftBulkUpdateResumeEligibility, type ProductDraftBulkUpdateChildState } from "./productInactiveDraftBulkUpdateRecovery";

export type ProductDraftBulkUpdateRowView = { productId: string; productName: string; executionState: ProductDraftBulkUpdateChildState; attemptCount: number; patch: Record<string, unknown>; readinessBefore: Record<string, unknown> | null; readinessAfter: Record<string, unknown> | null; lastErrorCode: string | null; lastErrorMessage: string | null; retryable: boolean };

/** Safe, deterministic data shared by execution result, history, and detail cards. */
export function summarizeProductDraftBulkUpdate(rows: readonly ProductDraftBulkUpdateRowView[]) {
  const resume = productDraftBulkUpdateResumeEligibility(rows);
  const byState = (state: ProductDraftBulkUpdateChildState) => rows.filter((row) => row.executionState === state);
  return {
    ...resume,
    totalCount: rows.length,
    updatedCount: byState("updated").length,
    excludedCount: byState("excluded").length,
    skippedCount: byState("skipped").length + byState("already_completed").length,
    products: rows.map((row) => ({ id: row.productId, name: row.productName, state: row.executionState, fieldsChanged: Object.keys(row.patch.basePricing as object ?? row.patch.configuration as object ?? row.patch.relationships as object ?? {}), readinessBefore: row.readinessBefore?.status ?? "unknown", readinessAfter: row.readinessAfter?.status ?? "unknown" })),
    failures: rows.filter((row) => row.executionState === "failed_retryable" || row.executionState === "failed_terminal" || row.executionState === "stale").map((row) => ({ productId: row.productId, productName: row.productName, code: row.lastErrorCode, message: row.lastErrorMessage, retryable: row.retryable, requiresNewProposal: row.executionState === "stale" || row.executionState === "failed_terminal" })),
    safety: "Updated products remain inactive PBV2 DRAFT; no activation or publication occurred.",
  };
}
