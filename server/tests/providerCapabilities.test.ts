import { describe, expect, test } from "@jest/globals";
import { resolveAiProviderCapabilities } from "../services/ai/providers/providerCapabilities";
const config = (model: string, endpoint = "https://api.deepseek.com/chat/completions") => ({ provider: "openai_compatible" as const, model, endpoint });
describe("validated provider capability descriptors", () => {
  test.each(["deepseek-flash", "deepseek-v4-flash-vision-exp"])("shares validated Flash vision mechanics for %s", model => {
    expect(resolveAiProviderCapabilities(config(model))).toMatchObject({ descriptor: "deepseek.flash.vision", vision: true, functionTools: true, responsesApi: true, nativeWebSearch: false, reasoning: "deepseek_toggle" });
  });
  test("Pro supports tools/search but does not inherit Flash vision", () => {
    expect(resolveAiProviderCapabilities(config("deepseek-v4-pro"))).toMatchObject({ functionTools: true, responsesApi: true, nativeWebSearch: true, vision: false });
    expect(resolveAiProviderCapabilities(config("deepseek-v4-flash"))).toMatchObject({ functionTools: true, nativeWebSearch: false, vision: false });
  });
  test.each(["https://proxy.example.test", "http://api.deepseek.com", "https://api.deepseek.com.evil.test", "https://api.deepseek.com:8443"])("does not trust provider-specific capabilities at %s", endpoint => {
    expect(resolveAiProviderCapabilities(config("deepseek-flash", endpoint)).descriptor).toBe("unverified");
  });
  test("unknown model names fail closed without changing tenant configuration", () => {
    const original = config("deepseek-flash-made-up");
    expect(resolveAiProviderCapabilities(original)).toMatchObject({ vision: false, functionTools: false, responsesApi: false });
    expect(original.model).toBe("deepseek-flash-made-up");
  });
});
