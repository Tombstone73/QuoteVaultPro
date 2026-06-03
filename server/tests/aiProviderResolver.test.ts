import { describe, expect, test, beforeEach } from "@jest/globals";
import { AiProviderResolver } from "../services/ai/aiProviderResolver";
import { encryptAiSecret } from "../services/ai/aiSecretsEncryption";

function makeRepo(settings: any) {
  return {
    getSettings: async () => settings,
    upsertSettings: async () => settings,
    recordUsage: async (data: any) => data,
  };
}

describe("AI provider resolver", () => {
  beforeEach(() => {
    process.env.AI_SETTINGS_ENCRYPTION_KEY = "resolver-test-key";
    process.env.AI_BUG_REVIEW_ENABLED = "false";
    process.env.TITANOS_MANAGED_AI_ENDPOINT = "https://managed.example.test/chat";
    process.env.TITANOS_MANAGED_AI_API_KEY = "managed-key";
    process.env.TITANOS_MANAGED_AI_MODEL = "managed-model";
  });

  test("falls back to legacy env when no settings row exists", async () => {
    process.env.AI_BUG_REVIEW_ENABLED = "true";
    process.env.AI_BUG_REVIEW_ENDPOINT = "https://legacy.example.test/chat";
    process.env.AI_BUG_REVIEW_API_KEY = "legacy-key";
    process.env.AI_BUG_REVIEW_MODEL = "legacy-model";

    const resolver = new AiProviderResolver(makeRepo(null) as any);
    const resolved = await resolver.resolveProvider({ orgId: "org_1", feature: "bug_review" });

    expect(resolved.enabled).toBe(true);
    expect(resolved.mode).toBe("legacy_env");
    expect(resolved.apiKey).toBe("legacy-key");
  });

  test("resolves TitanOS managed settings without exposing customer keys", async () => {
    const resolver = new AiProviderResolver(makeRepo({
      id: "settings_1",
      orgId: "org_1",
      mode: "titanos_managed",
      provider: "openai",
      model: null,
      encryptedApiKey: null,
      isEnabled: true,
      bugReviewEnabled: true,
      featureReviewEnabled: false,
      duplicateDetectionEnabled: false,
      orderParsingEnabled: false,
      emailProcessingEnabled: false,
      customerSupportEnabled: false,
      inventoryRecommendationsEnabled: false,
      productionAssistanceEnabled: false,
      monthlyUsageLimit: null,
    }) as any);

    const resolved = await resolver.resolveProvider({ orgId: "org_1", feature: "bug_review" });

    expect(resolved.enabled).toBe(true);
    expect(resolved.mode).toBe("titanos_managed");
    expect(resolved.apiKey).toBe("managed-key");
    expect(resolved.model).toBe("managed-model");
  });

  test("resolves BYOK by decrypting only in backend provider resolution", async () => {
    const encrypted = encryptAiSecret("customer-key");
    const resolver = new AiProviderResolver(makeRepo({
      id: "settings_1",
      orgId: "org_1",
      mode: "bring_your_own",
      provider: "openai",
      model: "gpt-test",
      encryptedApiKey: encrypted.encrypted,
      isEnabled: true,
      bugReviewEnabled: true,
      featureReviewEnabled: false,
      duplicateDetectionEnabled: false,
      orderParsingEnabled: false,
      emailProcessingEnabled: false,
      customerSupportEnabled: false,
      inventoryRecommendationsEnabled: false,
      productionAssistanceEnabled: false,
      monthlyUsageLimit: null,
    }) as any);

    const resolved = await resolver.resolveProvider({ orgId: "org_1", feature: "bug_review" });

    expect(resolved.enabled).toBe(true);
    expect(resolved.mode).toBe("bring_your_own");
    expect(resolved.apiKey).toBe("customer-key");
    expect(resolved.endpoint).toContain("openai.com");
  });
});
