import { describe, expect, test } from "@jest/globals";
import { resolveAiProviderCapabilities } from "../services/ai/providers/providerCapabilities";

describe("provider capability detection", () => {
  test("enables native Responses web search only for official DeepSeek V4-Flash", () => {
    expect(resolveAiProviderCapabilities({ provider: "openai_compatible", model: "deepseek-v4-flash", endpoint: "https://api.deepseek.com/chat/completions" } as any))
      .toEqual({ functionTools: true, nativeWebSearch: true, responsesApi: true });
    expect(resolveAiProviderCapabilities({ provider: "openai_compatible", model: "deepseek-v4-pro", endpoint: "https://api.deepseek.com/chat/completions" } as any).nativeWebSearch).toBe(false);
    expect(resolveAiProviderCapabilities({ provider: "openai_compatible", model: "deepseek-v4-flash", endpoint: "https://proxy.example.test" } as any).nativeWebSearch).toBe(false);
  });
});
