import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { AiProviderResponseError, AiProviderTimeoutError } from "../services/ai/providers/AiProviderAdapter";
import {
  composeOpenAiChatCompletionsEndpoint,
  composeDeepSeekResponsesEndpoint,
  OpenAiCompatibleBugReviewProvider,
  resolveAiJsonMaxTokens,
  resolveAiProviderTimeoutMs,
} from "../services/ai/providers/configuredProvider";
import { resolveOpenAiCompatibleRequestPolicy } from "../services/ai/providers/providerRequestPolicy";

const originalFetch = global.fetch;

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

function managedConfig(overrides: Partial<Parameters<OpenAiCompatibleBugReviewProvider["generateJson"]>[0]["providerConfig"]> = {}) {
  return {
    enabled: true,
    provider: "openai_compatible",
    model: "deepseek-v4-flash",
    endpoint: "https://api.deepseek.com/chat/completions",
    apiKey: "secret-test-key",
    mode: "printershero_managed",
    source: "printershero_managed_env",
    ...overrides,
  } as const;
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: {
      get: (name: string) => init.headers?.[name.toLowerCase()] ?? init.headers?.[name] ?? null,
    },
    json: async () => body,
    clone() {
      return jsonResponse(body, init);
    },
  } as any;
}

function baseRequest(overrides: Partial<Parameters<OpenAiCompatibleBugReviewProvider["generateJson"]>[0]> = {}) {
  return {
    orgId: "org_1",
    feature: "assistant" as const,
    system: "system",
    user: "user",
    promptVersion: "assistant-stage-2-planner-v1",
    providerConfig: managedConfig(),
    ...overrides,
  };
}

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

  test("preserves the configured DeepSeek chat completions endpoint", () => {
    expect(composeOpenAiChatCompletionsEndpoint("https://api.deepseek.com/chat/completions", "openai_compatible"))
      .toBe("https://api.deepseek.com/chat/completions");
  });

  test("translates only official DeepSeek Chat Completions URLs to Responses", () => {
    expect(composeDeepSeekResponsesEndpoint("https://api.deepseek.com/chat/completions"))
      .toBe("https://api.deepseek.com/responses");
    expect(composeDeepSeekResponsesEndpoint("https://proxy.example.test/chat/completions"))
      .toBe("https://proxy.example.test/chat/completions");
  });

  test("uses DeepSeek Responses with native functions and server-side web search", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({
      id: "resp_1",
      model: "deepseek-v4-flash",
      output: [{ type: "reasoning", content: [{ type: "reasoning_text", text: "private" }] }, {
        type: "web_search_call", action: { type: "search", query: "banner prices Indianapolis" },
      }, {
        type: "function_call", call_id: "call_1", name: "ph_0_quotes_search", arguments: '{"status":"open"}',
      }],
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const provider = new OpenAiCompatibleBugReviewProvider();
    const result = await provider.generateOperatorDecision!({ ...baseRequest(), toolCatalog: [{ name: "quotes.search", description: "Search authorized quotes." }] });
    expect(fetchMock).toHaveBeenCalledWith("https://api.deepseek.com/responses", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.tool_choice).toBe("auto");
    expect(body.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function", name: "ph_0_quotes_search" }),
      { type: "web_search" },
    ]));
    expect(JSON.parse(result.rawText)).toMatchObject({ kind: "call_tools", calls: [{ toolName: "quotes.search", arguments: { status: "open" } }] });
    expect(result.requestMetadata).toMatchObject({ apiSurface: "deepseek_responses", nativeWebSearch: true });
    expect(result.operatorContinuation?.functionCalls).toEqual([{ callId: "call_1", toolName: "quotes.search" }]);
    expect(JSON.stringify(result.requestMetadata)).not.toContain("private");
  });

  test("returns a direct Responses API answer without exposing reasoning", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ output: [
      { type: "reasoning", content: [{ type: "reasoning_text", text: "hidden chain" }] },
      { type: "message", content: [{ type: "output_text", text: '{"kind":"complete","response":"Ready."}', annotations: [{ title: "Example supplier", url: "https://example.com/products" }] }] },
    ] })) as unknown as typeof fetch;
    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [] });
    expect(result.rawText).toContain("Ready.");
    expect(result.rawText).not.toContain("hidden chain");
    expect(result.requestMetadata.nativeWebSources).toEqual([{ title: "Example supplier", url: "https://example.com/products" }]);
  });

  test("detects only the official DeepSeek API hostname", () => {
    expect(resolveOpenAiCompatibleRequestPolicy("https://api.deepseek.com/chat/completions")).toMatchObject({
      family: "deepseek",
      disableThinking: true,
    });
    expect(resolveOpenAiCompatibleRequestPolicy("https://proxy.example.test/api.deepseek.com/chat/completions").disableThinking).toBe(false);
    expect(resolveOpenAiCompatibleRequestPolicy("not a url").disableThinking).toBe(false);
  });

  test("uses bounded JSON max tokens with safe fallbacks", () => {
    expect(resolveAiJsonMaxTokens(undefined, {} as NodeJS.ProcessEnv)).toBe(2048);
    expect(resolveAiJsonMaxTokens(undefined, { AI_PROVIDER_JSON_MAX_TOKENS: "not-a-number" } as NodeJS.ProcessEnv)).toBe(2048);
    expect(resolveAiJsonMaxTokens(undefined, { AI_PROVIDER_JSON_MAX_TOKENS: "-1" } as NodeJS.ProcessEnv)).toBe(2048);
    expect(resolveAiJsonMaxTokens(undefined, { AI_PROVIDER_JSON_MAX_TOKENS: "999999" } as NodeJS.ProcessEnv)).toBe(4096);
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

  test("DeepSeek requests disable thinking and keep JSON mode with bounded output", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({
      id: "chatcmpl_deepseek",
      choices: [{ finish_reason: "stop", message: { content: "{\"intent\":\"lookup\"}" } }],
      usage: { prompt_tokens: 7, completion_tokens: 11, total_tokens: 18 },
    }, { headers: { "x-request-id": "req_deepseek_1" } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenAiCompatibleBugReviewProvider();
    const result = await provider.generateJson(baseRequest());

    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(endpoint).toBe("https://api.deepseek.com/chat/completions");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBe(2048);
    expect(result).toMatchObject({
      rawText: "{\"intent\":\"lookup\"}",
      provider: "openai_compatible",
      model: "deepseek-v4-flash",
      requestMetadata: {
        providerRequestId: "req_deepseek_1",
        usage: { prompt_tokens: 7, completion_tokens: 11, total_tokens: 18 },
        maxTokens: 2048,
        providerFamily: "deepseek",
      },
    });
    expect(result.requestMetadata.latencyMs).toEqual(expect.any(Number));
  });

  test("non-DeepSeek OpenAI-compatible requests do not include thinking", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({
      id: "chatcmpl_generic",
      choices: [{ finish_reason: "stop", message: { content: "{\"summary\":\"ok\"}" } }],
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new OpenAiCompatibleBugReviewProvider();
    await provider.generateJson(baseRequest({
      providerConfig: managedConfig({
        endpoint: "https://compatible.example.test/v1/chat/completions",
        model: "compatible-model",
      }),
    }));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.thinking).toBeUndefined();
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBe(2048);
  });

  test.each([
    ["missing", {}],
    ["null", { choices: [{ finish_reason: "stop", message: { content: null } }] }],
    ["whitespace", { choices: [{ finish_reason: "stop", message: { content: "   \n\t" } }] }],
  ])("fails safely when provider content is %s", async (_case, responseBody) => {
    global.fetch = jest.fn(async () => jsonResponse(responseBody, { headers: { "x-request-id": "req_empty" } })) as unknown as typeof fetch;
    jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const provider = new OpenAiCompatibleBugReviewProvider();
    await expect(provider.generateJson(baseRequest())).rejects.toMatchObject({
      name: "AiProviderResponseError",
      kind: "empty_response",
      providerRequestId: "req_empty",
    });
  });

  test("treats finish_reason length as truncated output", async () => {
    global.fetch = jest.fn(async () => jsonResponse({
      id: "chatcmpl_truncated",
      choices: [{ finish_reason: "length", message: { content: "{\"intent\":\"lookup\"" } }],
    })) as unknown as typeof fetch;
    jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const provider = new OpenAiCompatibleBugReviewProvider();
    await expect(provider.generateJson(baseRequest())).rejects.toMatchObject({
      name: "AiProviderResponseError",
      kind: "truncated_output",
    });
  });

  test.each([
    [400, "http_failure"],
    [401, "authentication_failure"],
    [429, "rate_limit"],
    [500, "http_failure"],
  ])("classifies HTTP %s provider failures safely", async (status, kind) => {
    global.fetch = jest.fn(async () => jsonResponse({
      id: `err_${status}`,
      error: {
        type: "invalid_request_error",
        code: `status_${status}`,
        message: "RAW_PROVIDER_BODY_WITH_SECRET secret-test-key FULL_PROMPT_TEXT",
      },
    }, { ok: false, status, headers: { "x-request-id": `req_${status}` } })) as unknown as typeof fetch;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const provider = new OpenAiCompatibleBugReviewProvider();
    let thrown: unknown;
    try {
      await provider.generateJson(baseRequest({
        system: "FULL_PROMPT_TEXT",
        user: "USER_PROMPT_TEXT",
      }));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AiProviderResponseError);
    expect(thrown).toMatchObject({ kind, status, providerRequestId: `req_${status}` });
    const diagnosticText = JSON.stringify({ warn: warn.mock.calls, message: thrown instanceof Error ? thrown.message : "" });
    expect(diagnosticText).not.toContain("secret-test-key");
    expect(diagnosticText).not.toContain("Authorization");
    expect(diagnosticText).not.toContain("FULL_PROMPT_TEXT");
    expect(diagnosticText).not.toContain("USER_PROMPT_TEXT");
    expect(diagnosticText).not.toContain("RAW_PROVIDER_BODY_WITH_SECRET");
    expect(diagnosticText).toContain(`status_${status}`);
  });

  test("timeout behavior produces the typed timeout failure with safe metadata", async () => {
    jest.useFakeTimers();
    try {
      global.fetch = jest.fn((_endpoint: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
      jest.spyOn(console, "warn").mockImplementation(() => undefined);

      const provider = new OpenAiCompatibleBugReviewProvider();
      const request = provider.generateJson(baseRequest({ timeoutMs: 5 })).catch((error) => error);
      await jest.advanceTimersByTimeAsync(5);

      const error = await request;
      expect(error).toBeInstanceOf(AiProviderTimeoutError);
      expect(error).toMatchObject({
        name: "AiProviderTimeoutError",
        timeoutMs: 5,
        provider: "openai_compatible",
        model: "deepseek-v4-flash",
        useCase: "assistant",
      });
    } finally {
      jest.useRealTimers();
    }
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
