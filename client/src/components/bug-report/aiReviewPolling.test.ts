import { describe, expect, test } from "@jest/globals";
import { getAiReviewPollingInterval } from "./aiReviewPolling";
import type { CurrentBugAiReviewResponse } from "@shared/aiReviewContracts";

function response(status: "pending" | "processing" | "completed" | "failed" | null): CurrentBugAiReviewResponse {
  return {
    review: status ? {
      id: "review_1",
      orgId: "org_1",
      bugReportId: "bug_1",
      reviewKind: "bug_review",
      status,
      isCurrent: true,
      requestedByEmail: "admin@example.com",
      provider: null,
      model: null,
      providerMetadata: null,
      promptVersion: "bug-review-v1",
      result: null,
      summary: null,
      severityAssessment: null,
      businessImpact: null,
      urgency: null,
      implementationPriority: null,
      workflowImpact: null,
      revenueRisk: null,
      suggestedOwner: null,
      confidence: null,
      validationErrors: null,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } : null,
    featureFlags: { enabled: true, adminsOnly: true },
    canRun: true,
  };
}

describe("getAiReviewPollingInterval", () => {
  test("polls pending and processing reviews", () => {
    expect(getAiReviewPollingInterval(response("pending"))).toBe(3000);
    expect(getAiReviewPollingInterval(response("processing"))).toBe(3000);
  });

  test("does not poll terminal or empty review states", () => {
    expect(getAiReviewPollingInterval(response("completed"))).toBe(false);
    expect(getAiReviewPollingInterval(response("failed"))).toBe(false);
    expect(getAiReviewPollingInterval(response(null))).toBe(false);
  });
});
