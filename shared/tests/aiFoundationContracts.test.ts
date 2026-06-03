import { describe, expect, test } from "@jest/globals";
import { aiSettingsUpdateSchema, defaultAiFeatureFlags, normalizeAiMode } from "../aiFoundationContracts";

describe("AI foundation contracts", () => {
  test("accepts valid org AI settings updates", () => {
    const parsed = aiSettingsUpdateSchema.parse({
      mode: "bring_your_own",
      provider: "openai",
      model: "gpt-test",
      apiKey: "sk-test",
      bugReviewEnabled: true,
      triageBriefEnabled: true,
      monthlyUsageLimit: 1000,
    });

    expect(parsed.mode).toBe("bring_your_own");
    expect(parsed.provider).toBe("openai");
  });

  test("rejects unknown modes and providers", () => {
    expect(() => aiSettingsUpdateSchema.parse({ mode: "always_on" })).toThrow();
    expect(() => aiSettingsUpdateSchema.parse({ mode: "titanos_managed" })).toThrow();
    expect(() => aiSettingsUpdateSchema.parse({ provider: "plaintext_llm" })).toThrow();
  });

  test("normalizes legacy managed mode on read only", () => {
    expect(normalizeAiMode("titanos_managed")).toBe("printershero_managed");
    expect(normalizeAiMode("printershero_managed")).toBe("printershero_managed");
  });

  test("future AI features default off", () => {
    expect(defaultAiFeatureFlags.bugReview).toBe(false);
    expect(defaultAiFeatureFlags.triageBrief).toBe(false);
    expect(defaultAiFeatureFlags.featureReview).toBe(false);
    expect(defaultAiFeatureFlags.duplicateDetection).toBe(false);
  });
});
