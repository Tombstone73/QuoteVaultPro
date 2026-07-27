import { ExecutionPlanError } from "./execution/types";

export type ProductDraftBatchChildState = "pending" | "running" | "created" | "failed_retryable" | "failed_terminal" | "skipped" | "excluded" | "already_completed";
export type ProductDraftBatchAggregateState = "proposed" | "confirmed" | "running" | "partially_completed" | "completed" | "completed_with_failures" | "failed";

/** Explicit infrastructure wrapper for adapters that can prove a transient failure. */
export class RetryableProductDraftBatchError extends Error { readonly retryable = true; constructor(readonly code: "TRANSIENT_DATABASE" | "TRANSACTION_RETRY" | "DEPENDENCY_TIMEOUT", message: string) { super(message); } }

function isCodedDomainError(error: unknown): error is { errorCode: string; message: string } {
  return Boolean(error && typeof error === "object" && typeof (error as { errorCode?: unknown }).errorCode === "string" && typeof (error as { message?: unknown }).message === "string");
}

export function classifyProductDraftBatchFailure(error: unknown): { code: string; message: string; retryable: boolean } {
  if (error instanceof RetryableProductDraftBatchError) return { code: error.code, message: error.message, retryable: true };
  if (error instanceof ExecutionPlanError) return { code: error.code, message: error.message, retryable: false };
  if (isCodedDomainError(error)) return { code: error.errorCode, message: error.message, retryable: false };
  return { code: "MANUAL_REVIEW_REQUIRED", message: "This row needs manual review before it can be retried.", retryable: false };
}

export function aggregateProductDraftBatchState(states: readonly ProductDraftBatchChildState[]): ProductDraftBatchAggregateState {
  if (!states.length || states.every((state) => state === "pending" || state === "excluded")) return "proposed";
  if (states.includes("running")) return "running";
  const created = states.filter((state) => state === "created" || state === "already_completed").length;
  const pending = states.some((state) => state === "pending" || state === "failed_retryable");
  const terminal = states.filter((state) => state === "failed_terminal").length;
  if (pending && created) return "partially_completed";
  if (pending) return "confirmed";
  if (terminal && created) return "completed_with_failures";
  if (terminal) return "failed";
  return "completed";
}

export function resumeEligibleProductDraftBatchRows<T extends { executionState: ProductDraftBatchChildState }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.executionState === "pending" || row.executionState === "failed_retryable");
}
