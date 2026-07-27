import { describe, expect, test } from "@jest/globals";
import { ExecutionPlanError } from "../services/assistant/execution/types";
import { RetryableProductDraftBatchError, aggregateProductDraftBatchState, classifyProductDraftBatchFailure, resumeEligibleProductDraftBatchRows } from "../services/assistant/productInactiveDraftBatchRecovery";

describe("product draft batch recovery", () => {
  test("classifies only explicit typed transient failures as retryable", () => {
    expect(classifyProductDraftBatchFailure(new RetryableProductDraftBatchError("DEPENDENCY_TIMEOUT", "Timed out")).retryable).toBe(true);
    expect(classifyProductDraftBatchFailure(new ExecutionPlanError("PRODUCT_INTAKE_NOT_READY", "Not ready")).retryable).toBe(false);
    expect(classifyProductDraftBatchFailure(new Error("socket reset"))).toEqual({ code: "MANUAL_REVIEW_REQUIRED", message: "This row needs manual review before it can be retried.", retryable: false });
  });
  test("derives exact batch state without treating pending or failures as full completion", () => {
    expect(aggregateProductDraftBatchState(["created", "created"])).toBe("completed");
    expect(aggregateProductDraftBatchState(["created", "failed_terminal"])).toBe("completed_with_failures");
    expect(aggregateProductDraftBatchState(["created", "failed_retryable"])).toBe("partially_completed");
    expect(aggregateProductDraftBatchState(["failed_terminal"])).toBe("failed");
  });
  test("resumes only pending and explicitly retryable rows", () => {
    expect(resumeEligibleProductDraftBatchRows([{ executionState: "created" as const }, { executionState: "pending" as const }, { executionState: "failed_retryable" as const }, { executionState: "failed_terminal" as const }]).map((row) => row.executionState)).toEqual(["pending", "failed_retryable"]);
  });
});
