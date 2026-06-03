import React from "react";
import { describe, expect, test } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";
import { AiReviewPanel } from "./AiReviewPanel";
import type { AiReviewDto, CurrentBugAiReviewResponse } from "@shared/aiReviewContracts";

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;

const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");

function baseReview(overrides: Partial<AiReviewDto>): AiReviewDto {
  return {
    id: "review_1",
    orgId: "org_1",
    bugReportId: "bug_1",
    reviewKind: "bug_review",
    status: "completed",
    isCurrent: true,
    requestedByEmail: "admin@example.com",
    provider: "test",
    model: "test-model",
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
    createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    updatedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    ...overrides,
  };
}

function renderPanel(data: CurrentBugAiReviewResponse | null | undefined) {
  return renderToStaticMarkup(
    <AiReviewPanel
      data={data}
      isLoading={false}
      isActionPending={false}
      onRun={() => undefined}
      onRerun={() => undefined}
    />,
  );
}

describe("AiReviewPanel", () => {
  test("renders empty state with advisory labeling and run action when enabled", () => {
    const html = renderPanel({
      review: null,
      featureFlags: { enabled: true, adminsOnly: true },
      canRun: true,
    });

    expect(html).toContain("AI Advisory");
    expect(html).toContain("No review yet");
    expect(html).toContain("Run AI Review");
  });

  test("hides run action when feature flag is disabled", () => {
    const html = renderPanel({
      review: null,
      featureFlags: { enabled: false, adminsOnly: true },
      canRun: false,
    });

    expect(html).toContain("AI Advisory");
    expect(html).not.toContain("Run AI Review");
  });

  test("renders pending and processing states", () => {
    const pending = renderPanel({
      review: baseReview({ status: "pending" }),
      featureFlags: { enabled: true, adminsOnly: true },
      canRun: true,
    });
    const processing = renderPanel({
      review: baseReview({ status: "processing" }),
      featureFlags: { enabled: true, adminsOnly: true },
      canRun: true,
    });

    expect(pending).toContain("AI review is queued");
    expect(processing).toContain("AI review is processing");
  });

  test("renders completed state with all advisory fields", () => {
    const html = renderPanel({
      review: baseReview({
        status: "completed",
        summary: "Save fails on quotes.",
        confidence: 0.82,
        severityAssessment: "high",
        workflowImpact: "moderate",
        revenueRisk: "medium",
        suggestedOwner: "Quotes",
        businessImpact: "high",
        urgency: "medium",
        implementationPriority: "high",
        result: {
          summary: "Save fails on quotes.",
          severityAssessment: "high",
          businessImpact: "high",
          urgency: "medium",
          implementationPriority: "high",
          workflowImpact: "moderate",
          revenueRisk: "medium",
          suggestedOwner: "Quotes",
          affectedModules: ["Quotes"],
          reasoning: ["Quote save is blocked."],
          unknowns: ["No stack trace provided."],
          confidence: 0.82,
        },
      }),
      featureFlags: { enabled: true, adminsOnly: true },
      canRun: true,
    });

    expect(html).toContain("AI Advisory");
    expect(html).toContain("Summary");
    expect(html).toContain("Confidence");
    expect(html).toContain("Severity Assessment");
    expect(html).toContain("Workflow Impact");
    expect(html).toContain("Revenue Risk");
    expect(html).toContain("Suggested Owner");
    expect(html).toContain("Business Impact");
    expect(html).toContain("Urgency");
    expect(html).toContain("Implementation Priority");
    expect(html).toContain("Affected Modules");
    expect(html).toContain("Reasoning");
    expect(html).toContain("Unknowns");
  });

  test("renders failed state with rerun action when allowed", () => {
    const html = renderPanel({
      review: baseReview({ status: "failed", errorMessage: "Provider unavailable." }),
      featureFlags: { enabled: true, adminsOnly: true },
      canRun: true,
    });

    expect(html).toContain("Failed");
    expect(html).toContain("Provider unavailable");
    expect(html).toContain("Rerun AI Review");
  });
});
