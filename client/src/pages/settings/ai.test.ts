import { describe, expect, test } from "@jest/globals";
import { buildAiSettingsPayload, type AiSettingsDraft } from "./ai";

describe("AI settings payload", () => {
  test("UI submits printershero_managed for Printers Hero Managed AI", () => {
    const draft: AiSettingsDraft = {
      mode: "printershero_managed",
      provider: "openai",
      model: "gpt-test",
      apiKey: "",
      bugReviewEnabled: true,
      triageBriefEnabled: true,
      featureReviewEnabled: false,
      duplicateDetectionEnabled: false,
      orderParsingEnabled: false,
      assistantEnabled: true,
      monthlyUsageLimit: "",
    };

    expect(buildAiSettingsPayload(draft)).toEqual(expect.objectContaining({
      mode: "printershero_managed",
      isEnabled: true,
      bugReviewEnabled: true,
      triageBriefEnabled: true,
      assistantEnabled: true,
    }));
    expect(JSON.stringify(buildAiSettingsPayload(draft))).not.toContain("titanos_managed");
  });

  test("UI submits Product Planning feature_review toggle", () => {
    const draft: AiSettingsDraft = {
      mode: "bring_your_own",
      provider: "openai",
      model: "gpt-test",
      apiKey: "sk-test",
      bugReviewEnabled: false,
      triageBriefEnabled: false,
      featureReviewEnabled: true,
      duplicateDetectionEnabled: false,
      orderParsingEnabled: false,
      assistantEnabled: false,
      monthlyUsageLimit: "",
    };

    expect(buildAiSettingsPayload(draft)).toEqual(expect.objectContaining({
      mode: "bring_your_own",
      isEnabled: true,
      featureReviewEnabled: true,
      provider: "openai",
      model: "gpt-test",
    }));
  });
});
