import { describe, expect, test } from "@jest/globals";
import { buildBugReviewPrompt } from "../services/ai/prompts/bugReviewPrompt";

describe("buildBugReviewPrompt", () => {
  test("requires advisory-only structured output fields", () => {
    const prompt = buildBugReviewPrompt({
      id: "bug_1",
      title: "Save fails",
      description: "The save button fails.",
      severity: "high",
      url: "https://app.example.com/quotes/123?token=secret",
      screenWidth: 1440,
      screenHeight: 900,
      metadata: {},
    });

    expect(prompt.system).toContain("advisory-only");
    expect(prompt.user).toContain("workflowImpact");
    expect(prompt.user).toContain("revenueRisk");
    expect(prompt.user).toContain("suggestedOwner");
    expect(prompt.user).toContain("unknowns");
  });

  test("redacts non-allowlisted metadata and URL query values from input snapshot", () => {
    const prompt = buildBugReviewPrompt({
      id: "bug_1",
      title: "Save fails",
      description: "The save button fails.",
      severity: "high",
      url: "https://app.example.com/quotes/123?token=secret",
      screenWidth: null,
      screenHeight: null,
      metadata: {
        route: "/quotes/:id",
        sessionToken: "secret",
        cookie: "also-secret",
      },
    });

    expect(JSON.stringify(prompt.inputSnapshot)).toContain("/quotes/:id");
    expect(JSON.stringify(prompt.inputSnapshot)).not.toContain("secret");
    expect(JSON.stringify(prompt.inputSnapshot)).not.toContain("token=");
  });
});
