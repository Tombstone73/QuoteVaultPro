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
      monthlyUsageLimit: "",
    };

    expect(buildAiSettingsPayload(draft)).toEqual(expect.objectContaining({
      mode: "printershero_managed",
      isEnabled: true,
      bugReviewEnabled: true,
      triageBriefEnabled: true,
    }));
    expect(JSON.stringify(buildAiSettingsPayload(draft))).not.toContain("titanos_managed");
  });
});
