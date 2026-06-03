import { describe, expect, test } from "@jest/globals";
import { parseAiJsonObject, validateBugReviewJson } from "../services/ai/bugReviewValidator";

const validResult = {
  summary: "Save fails on quote detail.",
  severityAssessment: "high",
  businessImpact: "high",
  urgency: "medium",
  implementationPriority: "high",
  workflowImpact: "moderate",
  revenueRisk: "medium",
  suggestedOwner: "Quotes",
  affectedModules: ["Quotes"],
  reasoning: ["The bug affects quote editing."],
  unknowns: ["Exact browser console error is unknown."],
  confidence: 0.82,
};

describe("AI bug review validator", () => {
  test("accepts a complete valid AI bug review result", () => {
    const result = validateBugReviewJson(validResult);
    expect(result.success).toBe(true);
  });

  test("rejects invalid workflowImpact", () => {
    const result = validateBugReviewJson({ ...validResult, workflowImpact: "catastrophic" });
    expect(result.success).toBe(false);
    expect(result.errors?.[0].path).toContain("workflowImpact");
  });

  test("rejects invalid revenueRisk", () => {
    const result = validateBugReviewJson({ ...validResult, revenueRisk: "urgent" });
    expect(result.success).toBe(false);
    expect(result.errors?.[0].path).toContain("revenueRisk");
  });

  test("rejects invalid suggestedOwner", () => {
    const result = validateBugReviewJson({ ...validResult, suggestedOwner: "Marketing" });
    expect(result.success).toBe(false);
    expect(result.errors?.[0].path).toContain("suggestedOwner");
  });

  test("rejects missing required fields", () => {
    const { confidence: _confidence, ...missingConfidence } = validResult;
    const result = validateBugReviewJson(missingConfidence);
    expect(result.success).toBe(false);
  });

  test("rejects confidence outside 0 to 1", () => {
    const result = validateBugReviewJson({ ...validResult, confidence: 1.2 });
    expect(result.success).toBe(false);
    expect(result.errors?.[0].path).toContain("confidence");
  });

  test("parses JSON embedded in provider text", () => {
    const parsed = parseAiJsonObject(`Here is JSON:\n${JSON.stringify(validResult)}\nDone`);
    expect(parsed).toMatchObject({ summary: validResult.summary });
  });
});
