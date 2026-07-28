import { classifyProductDraftBatchFailure, type ProductDraftBatchAggregateState } from "./productInactiveDraftBatchRecovery";

export type ProductDraftBulkUpdateChildState = "pending" | "running" | "updated" | "no_change" | "failed_retryable" | "failed_terminal" | "stale" | "excluded" | "skipped" | "already_completed";
export type ProductDraftBulkUpdateResumeEligibility = { available: boolean; pendingCount: number; retryableCount: number; terminalCount: number; staleCount: number; completedCount: number; noChangeCount: number; requiresNewProposal: boolean };

/** One calculation is shared by result cards, detail, history, and resume. */
export function productDraftBulkUpdateResumeEligibility(rows: readonly { executionState: ProductDraftBulkUpdateChildState }[]): ProductDraftBulkUpdateResumeEligibility {
  const count = (state: ProductDraftBulkUpdateChildState) => rows.filter((row) => row.executionState === state).length;
  const pendingCount = count("pending"); const retryableCount = count("failed_retryable"); const terminalCount = count("failed_terminal"); const staleCount = count("stale");
  return { available: pendingCount + retryableCount > 0, pendingCount, retryableCount, terminalCount, staleCount, completedCount: count("updated") + count("already_completed") + count("skipped"), noChangeCount: count("no_change"), requiresNewProposal: terminalCount + staleCount > 0 };
}

export function resumableProductDraftBulkUpdateRows<T extends { executionState: ProductDraftBulkUpdateChildState }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.executionState === "pending" || row.executionState === "failed_retryable");
}

export function classifyProductDraftBulkUpdateFailure(error: unknown): { code: string; message: string; retryable: boolean; state: "failed_retryable" | "failed_terminal" } {
  const result = classifyProductDraftBatchFailure(error);
  return { ...result, state: result.retryable ? "failed_retryable" : "failed_terminal" };
}

export function aggregateProductDraftBulkUpdateState(rows: readonly { executionState: ProductDraftBulkUpdateChildState }[]): ProductDraftBatchAggregateState {
  const states = rows.map((row) => row.executionState === "updated" ? "created" : row.executionState === "no_change" ? "skipped" : row.executionState === "stale" ? "failed_terminal" : row.executionState);
  if (!states.length || states.every((state) => state === "excluded" || state === "skipped")) return "completed";
  if (states.includes("running")) return "running";
  if (states.includes("pending") || states.includes("failed_retryable")) return states.some((state) => state === "created") ? "partially_completed" : "confirmed";
  if (states.includes("failed_terminal")) return states.some((state) => state === "created") ? "completed_with_failures" : "failed";
  return "completed";
}
