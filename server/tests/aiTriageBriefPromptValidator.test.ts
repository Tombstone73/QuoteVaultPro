import { describe, expect, test } from "@jest/globals";
import {
  activeTriageFeedbackStatusValues,
  getIncludedTriageFeedbackStatuses,
  inactiveTriageFeedbackStatusValues,
} from "@shared/aiTriageBriefContracts";
import { buildTriageBriefPrompt } from "../services/ai/prompts/triageBriefPrompt";
import { validateTriageBriefJson } from "../services/ai/triageBriefValidator";

const validResult = {
  executiveSummary: "Open reports cluster around quote save reliability.",
  topOperationalRisks: [{ title: "Quote save failures", impact: "Operators cannot persist quote changes.", confidence: 0.8, rationale: "Multiple open bugs mention save failures." }],
  topWorkflowRisks: [{ title: "Proofing bottleneck", impact: "Proof approval may slow production.", confidence: 0.6, rationale: "Reports mention proof review confusion." }],
  topRevenueRisks: [{ title: "Checkout friction", impact: "Customers may abandon orders.", confidence: 0.7, rationale: "Payment-related reports affect revenue flow." }],
  topBugClusters: [{ issue: "Quote save fails", reportCount: 2, affectedModules: ["Quotes"], impact: "Blocks quote editing." }],
  topFeatureRequests: [{ feature: "Bulk proof reminders", requestCount: 1, value: "Reduces manual follow-up.", complexity: "unknown; implementation detail not supplied" }],
  duplicateSignals: [{ theme: "Quote save", reportIds: ["bug_1", "bug_2"], rationale: "Same symptom and module.", confidence: 0.8 }],
  suggestedPriorityOrder: [{ item: "Investigate quote save failures", rationale: "Highest workflow impact.", urgency: "high" }],
  recommendedNextSprint: [{ item: "Reproduce quote save failures", rationale: "Needed before fix sizing.", urgency: "high" }],
  unknowns: ["No stack traces supplied."],
  confidence: 0.74,
};

describe("AI triage brief prompt and validator", () => {
  test("normal triage includes only active feedback statuses", () => {
    expect(activeTriageFeedbackStatusValues).toEqual(["open", "in_review"]);
    expect(inactiveTriageFeedbackStatusValues).toEqual(["resolved", "closed"]);
    expect(getIncludedTriageFeedbackStatuses(undefined)).toEqual(["open", "in_review"]);
    expect(getIncludedTriageFeedbackStatuses("all")).toEqual(["open", "in_review"]);
    expect(getIncludedTriageFeedbackStatuses("open")).toEqual(["open"]);
    expect(getIncludedTriageFeedbackStatuses("in_review")).toEqual(["in_review"]);
    expect(getIncludedTriageFeedbackStatuses("resolved")).toEqual([]);
    expect(getIncludedTriageFeedbackStatuses("closed")).toEqual([]);
  });

  test("prompt is collection-level, advisory, and includes visible filters", () => {
    const prompt = buildTriageBriefPrompt({
      filtersSnapshot: { status: "open", type: "all", reportCount: 1 },
      reports: [{
        id: "bug_1",
        type: "bug",
        title: "Save fails",
        description: "Saving a quote fails.",
        severity: "high",
        status: "open",
        url: "https://app.example.test/quotes/1?token=secret",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        createdByEmail: "user@example.test",
        metadata: { module: "Quotes", secret: "do-not-include" },
      }],
    });

    expect(prompt.promptVersion).toBe("triage-brief-v1");
    expect(prompt.system).toContain("advisory-only");
    expect(prompt.system).toContain("must never change ticket status");
    expect(prompt.user).toContain("Filters snapshot");
    expect(prompt.user).toContain("Report snapshot");
    expect(prompt.user).not.toContain("do-not-include");
    expect(prompt.user).not.toContain("token=secret");
  });

  test("accepts the required structured triage output", () => {
    const parsed = validateTriageBriefJson(validResult);

    expect(parsed.success).toBe(true);
    expect(parsed.result?.topBugClusters[0].reportCount).toBe(2);
  });

  test("rejects missing required sections", () => {
    const parsed = validateTriageBriefJson({ executiveSummary: "Missing most sections." });

    expect(parsed.success).toBe(false);
    expect(parsed.errors?.length).toBeGreaterThan(0);
  });
});
