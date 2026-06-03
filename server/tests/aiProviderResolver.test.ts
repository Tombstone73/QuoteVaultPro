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
    delete process.env.PRINTERSHERO_MANAGED_AI_PROVIDER;
    delete process.env.PRINTERSHERO_MANAGED_AI_ENDPOINT;
    delete process.env.PRINTERSHERO_MANAGED_AI_API_KEY;
    delete process.env.PRINTERSHERO_MANAGED_AI_MODEL;
    process.env.PRINTERSHERO_MANAGED_AI_ENDPOINT = "https://managed.example.test/chat";
    process.env.PRINTERSHERO_MANAGED_AI_API_KEY = "managed-key";
    process.env.PRINTERSHERO_MANAGED_AI_MODEL = "managed-model";
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

  test("resolves Printers Hero managed settings without exposing customer keys", async () => {
    const resolver = new AiProviderResolver(makeRepo({
      id: "settings_1",
      orgId: "org_1",
      mode: "printershero_managed",
      provider: "openai",
      model: null,
      encryptedApiKey: null,
      isEnabled: true,
      bugReviewEnabled: true,
      triageBriefEnabled: true,
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
    expect(resolved.mode).toBe("printershero_managed");
    expect(resolved.apiKey).toBe("managed-key");
    expect(resolved.model).toBe("managed-model");
  });

  test("normalizes legacy managed settings rows to Printers Hero managed mode", async () => {
    const resolver = new AiProviderResolver(makeRepo({
      id: "settings_legacy",
      orgId: "org_1",
      mode: "titanos_managed",
      provider: "openai",
      model: null,
      encryptedApiKey: null,
      isEnabled: true,
      bugReviewEnabled: true,
      triageBriefEnabled: true,
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
    const capabilities = await resolver.getCapabilities("org_1", { canManageSettings: true, canRunBugReview: true });

    expect(resolved.enabled).toBe(true);
    expect(resolved.mode).toBe("printershero_managed");
    expect(capabilities.mode).toBe("printershero_managed");
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
      triageBriefEnabled: false,
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

  test("resolves triage brief as its own enabled AI Foundation feature", async () => {
    const resolver = new AiProviderResolver(makeRepo({
      id: "settings_1",
      orgId: "org_1",
      mode: "printershero_managed",
      provider: "openai",
      model: null,
      encryptedApiKey: null,
      isEnabled: true,
      bugReviewEnabled: false,
      triageBriefEnabled: true,
      featureReviewEnabled: false,
      duplicateDetectionEnabled: false,
      orderParsingEnabled: false,
      emailProcessingEnabled: false,
      customerSupportEnabled: false,
      inventoryRecommendationsEnabled: false,
      productionAssistanceEnabled: false,
      monthlyUsageLimit: null,
    }) as any);

    const resolved = await resolver.resolveProvider({ orgId: "org_1", feature: "triage_brief" });
    const capabilities = await resolver.getCapabilities("org_1", { canManageSettings: true, canRunBugReview: true });

    expect(resolved.enabled).toBe(true);
    expect(resolved.feature).toBe("triage_brief");
    expect(capabilities.features.triageBrief).toBe(true);
    expect(capabilities.permissions.canGenerateTriageBrief).toBe(true);
  });
});
