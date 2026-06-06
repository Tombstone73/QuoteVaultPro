import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  composeOpenAiChatCompletionsEndpoint,
  OpenAiCompatibleBugReviewProvider,
  resolveAiProviderTimeoutMs,
} from "../services/ai/providers/configuredProvider";

const originalFetch = global.fetch;

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe("configured AI provider", () => {
  test("keeps existing default timeout for non-overridden provider calls", () => {
    const previousProviderTimeout = process.env.AI_PROVIDER_TIMEOUT_MS;
    const previousBugReviewTimeout = process.env.AI_BUG_REVIEW_TIMEOUT_MS;
    delete process.env.AI_PROVIDER_TIMEOUT_MS;
    delete process.env.AI_BUG_REVIEW_TIMEOUT_MS;
    try {
      expect(resolveAiProviderTimeoutMs()).toBe(30000);
    } finally {
      restoreEnv("AI_PROVIDER_TIMEOUT_MS", previousProviderTimeout);
      restoreEnv("AI_BUG_REVIEW_TIMEOUT_MS", previousBugReviewTimeout);
    }
  });

  test("uses explicit request timeout before global provider timeout", () => {
    const previousProviderTimeout = process.env.AI_PROVIDER_TIMEOUT_MS;
    process.env.AI_PROVIDER_TIMEOUT_MS = "45000";
    try {
      expect(resolveAiProviderTimeoutMs(60000)).toBe(60000);
    } finally {
      restoreEnv("AI_PROVIDER_TIMEOUT_MS", previousProviderTimeout);
    }
  });

  test("composes OpenAI base endpoint to chat completions endpoint", () => {
    expect(composeOpenAiChatCompletionsEndpoint("https://api.openai.com", "openai"))
      .toBe("https://api.openai.com/v1/chat/completions");
    expect(composeOpenAiChatCompletionsEndpoint("https://api.openai.com/v1", "openai"))
      .toBe("https://api.openai.com/v1/chat/completions");
    expect(composeOpenAiChatCompletionsEndpoint("https://api.openai.com/v1/chat/completions", "openai"))
      .toBe("https://api.openai.com/v1/chat/completions");
  });

  test("posts OpenAI requests to composed chat completions endpoint", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        id: "chatcmpl_test",
        choices: [{ message: { content: "{\"summary\":\"ok\"}" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    } as any));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenAiCompatibleBugReviewProvider();
    await provider.generateBugReview({
      orgId: "org_1",
      feature: "bug_review",
      system: "system",
      user: "user",
      promptVersion: "bug-review-v1",
      providerConfig: {
        enabled: true,
        provider: "openai",
        model: "gpt-4o-mini",
        endpoint: "https://api.openai.com/v1",
        apiKey: "secret-test-key",
        mode: "printershero_managed",
        source: "printershero_managed_env",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("provider HTTP errors include safe diagnostics without API key", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 404,
    } as any));
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const provider = new OpenAiCompatibleBugReviewProvider();
    let message = "";
    try {
      await provider.generateBugReview({
        orgId: "org_1",
        feature: "bug_review",
        system: "system",
        user: "user",
        promptVersion: "bug-review-v1",
        providerConfig: {
          enabled: true,
          provider: "openai",
          model: "gpt-4o-mini",
          endpoint: "https://api.openai.com/v1",
          apiKey: "secret-test-key",
          mode: "printershero_managed",
          source: "printershero_managed_env",
        },
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("AI provider endpoint/model is not configured correctly.");
    expect(message).toContain("api.openai.com/v1/chat/completions");
    expect(message).toContain("gpt-4o-mini");
    expect(message).not.toContain("secret-test-key");
  });
});
