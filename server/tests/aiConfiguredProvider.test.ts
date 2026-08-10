import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { AiProviderResponseError, AiProviderTimeoutError } from "../services/ai/providers/AiProviderAdapter";
import {
  composeOpenAiChatCompletionsEndpoint,
  composeDeepSeekResponsesEndpoint,
  OpenAiCompatibleBugReviewProvider,
  resolveAiOperatorProviderTimeoutMs,
  resolveAiJsonMaxTokens,
  resolveAiOperatorMaxOutputTokens,
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

  test("keeps the Operator timeout separate from generic provider timeout configuration", () => {
    expect(resolveAiOperatorProviderTimeoutMs({})).toBe(120000);
    expect(resolveAiOperatorProviderTimeoutMs({ AI_PROVIDER_TIMEOUT_MS: "45000" })).toBe(120000);
    expect(resolveAiOperatorProviderTimeoutMs({ AI_OPERATOR_PROVIDER_TIMEOUT_MS: "90000" })).toBe(90000);
    expect(resolveAiOperatorProviderTimeoutMs({ AI_OPERATOR_PROVIDER_TIMEOUT_MS: "invalid" })).toBe(120000);
    expect(resolveAiOperatorProviderTimeoutMs({ AI_OPERATOR_PROVIDER_TIMEOUT_MS: "0" })).toBe(120000);
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
      status: "completed",
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
    expect(body.reasoning).toEqual({ effort: "none" });
    expect(body.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function", name: "ph_0_quotes_search" }),
      { type: "web_search" },
    ]));
    expect(JSON.parse(result.rawText)).toMatchObject({ kind: "call_tools", calls: [{ toolName: "quotes.search", arguments: { status: "open" } }] });
    expect(result.requestMetadata).toMatchObject({ apiSurface: "deepseek_responses", nativeWebSearch: true, responseStatus: "completed", outputItemTypes: ["reasoning", "web_search_call", "function_call"] });
    expect(result.operatorContinuation?.functionCalls).toEqual([{ callId: "call_1", toolName: "quotes.search" }]);
    expect(JSON.stringify(result.requestMetadata)).not.toContain("private");
  });

  test("continues a product search into a pricing function call without leaking control text", async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "completed", output: [{
        type: "function_call", call_id: "call_search", name: "ph_0_search_global", arguments: '{"query":"Translucent Vinyl - backlit with multilayer printing"}',
      }] }))
      .mockResolvedValueOnce(jsonResponse({ status: "completed", output: [{
        type: "function_call", call_id: "call_pricing", name: "ph_1_products_get_pricing", arguments: '{"productId":"product_translucent"}',
      }] }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const provider = new OpenAiCompatibleBugReviewProvider();
    const toolCatalog = [
      { name: "search.global", description: "Search authorized products." },
      { name: "products.get_pricing", description: "Read current pricing for trusted productId." },
    ];

    const first = await provider.generateOperatorDecision!({ ...baseRequest(), toolCatalog });
    const second = await provider.generateOperatorDecision!({
      ...baseRequest(),
      toolCatalog,
      responseContinuation: [
        ...(first.operatorContinuation?.items ?? []),
        { type: "function_call_output", call_id: "call_search", output: '{"status":"succeeded","data":{"productId":"product_translucent"}}' },
      ],
    });

    expect(JSON.parse(first.rawText)).toMatchObject({ kind: "call_tools", calls: [{ toolName: "search.global", arguments: { query: "Translucent Vinyl - backlit with multilayer printing" } }] });
    expect(JSON.parse(second.rawText)).toMatchObject({ kind: "call_tools", calls: [{ toolName: "products.get_pricing", arguments: { productId: "product_translucent" } }] });
    const continuationBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(continuationBody.input).toEqual(expect.arrayContaining([expect.objectContaining({ type: "function_call_output", call_id: "call_search" })]));
    expect(`${first.rawText}${second.rawText}`).not.toMatch(/<think|DSML/i);
  });

  test("returns a direct Responses API answer without exposing reasoning", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ status: "completed", output: [
      { type: "reasoning", content: [{ type: "reasoning_text", text: "hidden chain" }] },
      { type: "message", content: [{ type: "output_text", text: '{"kind":"complete","response":"Ready."}', annotations: [{ title: "Example supplier", url: "https://example.com/products" }] }] },
    ] })) as unknown as typeof fetch;
    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [] });
    expect(result.rawText).toContain("Ready.");
    expect(result.rawText).not.toContain("hidden chain");
    expect(JSON.parse(result.rawText)).toEqual({ kind: "complete", response: "Ready." });
    expect(result.requestMetadata.nativeWebSources).toEqual([{ title: "Example supplier", url: "https://example.com/products", domain: "example.com" }]);
    expect(result.requestMetadata).toMatchObject({ terminalClassification: "operator_decision", parseClassification: "operator_decision" });
  });

  test("accepts an ordinary direct terminal answer without requiring a tool call", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Weeding and Taping is already limited to Contour Cutting = Yes, and its default is No. I did not change anything." }] }] })) as unknown as typeof fetch;
    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [] });
    expect(JSON.parse(result.rawText)).toEqual({ kind: "complete", response: "Weeding and Taping is already limited to Contour Cutting = Yes, and its default is No. I did not change anything." });
  });

  test("uses a separate bounded output budget for Operator Responses", () => {
    expect(resolveAiOperatorMaxOutputTokens({} as NodeJS.ProcessEnv)).toBe(8192);
    expect(resolveAiOperatorMaxOutputTokens({ AI_OPERATOR_MAX_OUTPUT_TOKENS: "12000" } as NodeJS.ProcessEnv)).toBe(12000);
    expect(resolveAiOperatorMaxOutputTokens({ AI_OPERATOR_MAX_OUTPUT_TOKENS: "999999" } as NodeJS.ProcessEnv)).toBe(16384);
    expect(resolveAiOperatorMaxOutputTokens({ AI_OPERATOR_MAX_OUTPUT_TOKENS: "invalid" } as NodeJS.ProcessEnv)).toBe(8192);
  });

  test("preserves a valid Operator continue decision instead of rendering it as native prose", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ status: "completed", output: [{
      type: "message", content: [{ type: "output_text", text: '{"kind":"continue","workingSummary":"Searching the catalog for a trusted banner reference."}' }],
    }] })) as unknown as typeof fetch;

    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [] });

    expect(JSON.parse(result.rawText)).toEqual({ kind: "continue", workingSummary: "Searching the catalog for a trusted banner reference." });
    expect(result.requestMetadata).toMatchObject({ terminalClassification: "operator_decision", parseClassification: "operator_decision" });
  });

  test("preserves a one-level JSON-string-wrapped Operator decision instead of rendering it", async () => {
    const wrapped = JSON.stringify(JSON.stringify({ kind: "continue", workingSummary: "Continuing to check whether the product exists and establish a trusted product reference before configuring the new product." }));
    global.fetch = jest.fn(async () => jsonResponse({ status: "completed", output: [{
      type: "message", content: [{ type: "output_text", text: wrapped }],
    }] })) as unknown as typeof fetch;

    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [] });

    expect(JSON.parse(result.rawText)).toEqual({ kind: "continue", workingSummary: "Continuing to check whether the product exists and establish a trusted product reference before configuring the new product." });
    expect(result.requestMetadata).toMatchObject({ terminalClassification: "operator_decision", parseClassification: "operator_decision" });
  });

  test("keeps malformed or unrelated JSON as ordinary terminal content", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ status: "completed", output: [{
      type: "message", content: [{ type: "output_text", text: '{"kind":"continue"' }],
    }] })) as unknown as typeof fetch;

    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [] });

    expect(JSON.parse(result.rawText)).toEqual({ kind: "complete", response: '{"kind":"continue"' });
    expect(result.requestMetadata).toMatchObject({ terminalClassification: "provider_message", parseClassification: "terminal_completion" });
  });

  test("normalizes a provider-native researched terminal message after web activity", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ id: "resp_sidewalk", status: "completed", output: [
      { type: "web_search_call", status: "completed", action: { type: "search", query: "printable sidewalk vinyl" } },
      { type: "message", status: "completed", content: [{ type: "output_text", text: "For short-term outdoor use, printable textured vinyl is the strongest commercial-print option." , annotations: [{ id: "src_1", title: "Supplier specification", url: "https://supplier.example/vinyl" }] }] },
    ] })) as unknown as typeof fetch;

    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [] });

    expect(JSON.parse(result.rawText)).toEqual({ kind: "complete", response: "For short-term outdoor use, printable textured vinyl is the strongest commercial-print option." });
    expect(result.requestMetadata).toMatchObject({ responseStatus: "completed", outputItemTypes: ["web_search_call", "message"], terminalClassification: "provider_message", parseClassification: "terminal_completion", nativeWebSearchCallCount: 1 });
    expect(result.requestMetadata.nativeWebSources).toEqual([{ title: "Supplier specification", url: "https://supplier.example/vinyl", domain: "supplier.example", providerSourceReference: "src_1" }]);
  });

  test("continues a native web-search-only Responses result instead of treating it as empty", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ status: "completed", output: [
      { type: "reasoning", content: [{ type: "reasoning_text", text: "hidden chain" }] },
      { type: "web_search_call", action: { type: "search", query: "printable sidewalk vinyl" } },
    ] })) as unknown as typeof fetch;

    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [] });

    expect(JSON.parse(result.rawText)).toEqual({ kind: "continue", workingSummary: "Continuing public research." });
    expect(result.requestMetadata).toMatchObject({ nativeWebSearch: true, responseStatus: "completed", nativeWebSearchCallCount: 1, nativeWebSearchActionCount: 1, parseClassification: "native_web_continuation" });
    expect(result.rawText).not.toContain("hidden chain");
    expect(JSON.stringify(result.requestMetadata)).not.toContain("hidden chain");
  });

  test("handles a completed native web item even when optional action detail is absent", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ id: "resp_web_1", status: "completed", output: [
      { type: "web_search_call", status: "completed" },
    ] })) as unknown as typeof fetch;

    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [] });

    expect(JSON.parse(result.rawText)).toMatchObject({ kind: "continue" });
    expect(result.requestMetadata).toMatchObject({ responseStatus: "completed", outputItemStatuses: ["completed"], nativeWebSearchCallCount: 1, nativeWebSearchActionCount: 0 });
  });

  test("rejects an incomplete Responses result instead of treating it as a usable continuation", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ id: "resp_incomplete", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [
      { type: "web_search_call", status: "incomplete", action: { type: "search" } },
    ] })) as unknown as typeof fetch;

    await expect(new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [] }))
      .rejects.toMatchObject({ name: "AiProviderResponseError", kind: "truncated_output", providerRequestId: "resp_incomplete" });
  });

  test("keeps a valid answer when optional source annotations are malformed", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ id: "resp_sources", status: "completed", output: [{
      type: "message", status: "completed", content: [{ type: "output_text", text: '{"kind":"complete","response":"Research complete."}', annotations: [{ url: "not a url" }, { source: { url: "ftp://invalid.example" } }] }],
    }] })) as unknown as typeof fetch;

    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [] });
    expect(result.rawText).toContain("Research complete.");
    expect(result.requestMetadata.nativeWebSources).toEqual([]);
  });

  test("does not mistake prose beside a pending function call for a terminal answer", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ status: "completed", output: [
      { type: "function_call", call_id: "call_1", name: "ph_0_products_get_summary", arguments: '{"query":"Banner"}' },
      { type: "message", content: [{ type: "output_text", text: "I will inspect the product next." }] },
    ] })) as unknown as typeof fetch;

    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [{ name: "products.get_summary", description: "Read product summary" }] });

    expect(JSON.parse(result.rawText)).toMatchObject({ kind: "call_tools", calls: [{ toolName: "products.get_summary" }] });
  });

  test("records only safe structure for a six-scenario pricing tool batch", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ status: "completed", output: Array.from({ length: 6 }, (_, index) => ({
      type: "function_call", call_id: `call_${index + 1}`, name: "ph_0_products_get_pricing", arguments: JSON.stringify({ productId: "product_translucent", scenario: index + 1 }),
    })) })) as unknown as typeof fetch;

    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [{ name: "products.get_pricing", description: "Read persisted pricing." }] });

    expect(JSON.parse(result.rawText)).toMatchObject({ kind: "call_tools", calls: expect.arrayContaining([expect.objectContaining({ toolName: "products.get_pricing" })]) });
    expect(result.requestMetadata).toMatchObject({ outputItemCount: 6, outputItemTypes: ["function_call", "function_call", "function_call", "function_call", "function_call", "function_call"], functionCallCount: 6, functionArgumentDecodeSucceeded: true, messageOutputTextPresent: false, finalTextLength: 0, controlProtocolDetected: false });
    expect(JSON.stringify(result.requestMetadata)).not.toContain("product_translucent");
  });

  test("transports nested initial operations as a structured DeepSeek function call", async () => {
    const initialOperations = [{ op: "set_option_price_impact", optionGroup: "Weeding and Taping", value: "Yes", percent: 30, replacesPercentageWhen: { optionGroup: "Contour Cutting", value: "Yes" } }];
    global.fetch = jest.fn(async () => jsonResponse({ status: "completed", output: [{ type: "function_call", call_id: "call_initial", name: "ph_0_products_begin_draft", arguments: JSON.stringify({ initialOperations }) }] })) as unknown as typeof fetch;
    const schema = {
      type: "object",
      properties: {
        initialOperations: {
          type: "array",
          items: { oneOf: [{ type: "object", required: ["op", "percent"], properties: { op: { const: "set_option_price_impact" }, percent: { type: "number" }, replacesPercentageWhen: { type: "object", properties: { optionGroup: { type: "string" }, value: { type: "string" } } } } }] },
        },
      },
    } as any;
    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [{ name: "products.begin_draft", description: "Begin product draft", inputSchema: schema }] });
    expect(JSON.parse(result.rawText)).toMatchObject({ kind: "call_tools", calls: [{ toolName: "products.begin_draft", arguments: { initialOperations } }] });
    const body = JSON.parse(String((global.fetch as any).mock.calls[0][1].body));
    expect(body.tools[0].parameters.properties.initialOperations.items).not.toHaveProperty("oneOf");
    expect(body.tools[0].parameters.properties.initialOperations.items.properties.op).toEqual({ type: "string" });
  });

  test("transports a nested draft-pricing scenario batch through DeepSeek functions", async () => {
    const scenarios = [{ squareFeet: 10, selections: [{ optionGroup: "Layers", value: "3 Layer" }, { optionGroup: "Contour Cutting", value: "No" }] }, { squareFeet: 10, selections: [{ optionGroup: "Layers", value: "5 Layer" }, { optionGroup: "Contour Cutting", value: "Yes" }, { optionGroup: "Weeding and Taping", value: "Yes" }] }];
    global.fetch = jest.fn(async () => jsonResponse({ status: "completed", output: [{ type: "function_call", call_id: "call_preview", name: "ph_0_products_preview_draft_pricing", arguments: JSON.stringify({ scenarios }) }] })) as unknown as typeof fetch;
    const schema = { type: "object", additionalProperties: false, required: ["scenarios"], properties: { scenarios: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, required: ["squareFeet"], properties: { squareFeet: { type: "number", exclusiveMinimum: 0 }, selections: { type: "array", items: { type: "object", additionalProperties: false, required: ["optionGroup", "value"], properties: { optionGroup: { type: "string" }, value: { type: "string" } } } } } } } } } as any;
    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [{ name: "products.preview_draft_pricing", description: "Preview draft pricing", inputSchema: schema }] });
    expect(JSON.parse(result.rawText)).toMatchObject({ kind: "call_tools", calls: [{ toolName: "products.preview_draft_pricing", arguments: { scenarios } }] });
    const body = JSON.parse(String((global.fetch as any).mock.calls[0][1].body));
    expect(body.tools[0].parameters.properties.scenarios.items.properties.selections.items.required).toEqual(["optionGroup", "value"]);
  });

  test("rejects DSML control text instead of returning it as a chat response", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "<｜DSML｜tool_calls><｜DSML｜invoke name=\"ph_0_products_begin_draft\">" }] }] })) as unknown as typeof fetch;
    await expect(new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [] })).rejects.toMatchObject({ name: "AiProviderResponseError", kind: "provider_protocol_failure" });
  });

  test("normalizes DeepSeek's lone trailing parameter marker after a terminal decision", async () => {
    const terminalDecision = { kind: "complete", response: "The persisted pricing is available.", workingSummary: "Pricing inspection complete." };
    global.fetch = jest.fn(async () => jsonResponse({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: `${JSON.stringify(terminalDecision)}</parameter>` }] }] })) as unknown as typeof fetch;

    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [] });

    expect(JSON.parse(result.rawText)).toEqual(terminalDecision);
    expect(result.requestMetadata.terminalClassification).toBe("operator_decision_parameter_suffix");
  });

  test("preserves a known native call when its arguments are structured and trailing text is a transport marker", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ status: "completed", output: [
      { type: "function_call", call_id: "call_pricing", name: "ph_0_products_get_pricing", arguments: { productId: "product_translucent" } },
      { type: "message", content: [{ type: "output_text", text: "</parameter>" }] },
    ] })) as unknown as typeof fetch;

    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [{ name: "products.get_pricing", description: "Read persisted pricing." }] });

    expect(JSON.parse(result.rawText)).toMatchObject({ kind: "call_tools", calls: [{ toolName: "products.get_pricing", arguments: { productId: "product_translucent" } }] });
    expect(result.requestMetadata).toMatchObject({ functionCallItemCount: 1, functionCallCount: 1, functionArgumentDecodeSucceeded: true, outputTextItemCount: 1, textEndsKnownTransportMarker: true });
    expect(JSON.stringify(result.requestMetadata)).not.toContain("product_translucent");
  });

  test("reassembles split output_text fragments before validating a terminal decision", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ status: "completed", output: [{ type: "message", content: [
      { type: "output_text", text: '{"kind":"complete","response":"Pricing' },
      { type: "output_text", text: ' ready."}' },
    ] }] })) as unknown as typeof fetch;

    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [] });

    expect(JSON.parse(result.rawText)).toEqual({ kind: "complete", response: "Pricing ready." });
    expect(result.requestMetadata).toMatchObject({ outputTextItemCount: 2, outputTextLengths: [expect.any(Number), expect.any(Number)], structuredDecisionPresent: true, decisionDiscriminator: "complete" });
  });

  test("uses top-level output_text fragments without reading provider reasoning", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ status: "completed", output: [
      { type: "reasoning", content: [{ type: "reasoning_text", text: "private reasoning" }] },
      { type: "output_text", text: '{"kind":"complete","response":"Ready."}' },
    ] })) as unknown as typeof fetch;

    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [] });

    expect(JSON.parse(result.rawText)).toEqual({ kind: "complete", response: "Ready." });
    expect(JSON.stringify(result.requestMetadata)).not.toContain("private reasoning");
  });

  test("rejects reasoning/control text and records only its safe response structure", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "<think>private reasoning</think>" }] }] })) as unknown as typeof fetch;

    await expect(new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [] })).rejects.toMatchObject({
      name: "AiProviderResponseError", kind: "provider_protocol_failure", responseMetadata: { outputTextItemCount: 1, controlProtocolDetected: true },
    });
  });

  test("fails an unknown Responses item safely with structural metadata only", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ status: "completed", output: [{ type: "provider_metadata", status: "completed" }] })) as unknown as typeof fetch;

    await expect(new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [] })).rejects.toMatchObject({
      name: "AiProviderResponseError", kind: "empty_response", responseMetadata: expect.objectContaining({ outputItemCount: 1, outputItemTypes: ["provider_metadata"], outputTextItemCount: 0, functionCallItemCount: 0 }),
    });
  });

  test("accepts a long native-web terminal response and preserves source metadata", async () => {
    const longAnswer = `Research summary: ${"current commercial-print comparison. ".repeat(420)}`.trim();
    expect(longAnswer.length).toBeGreaterThan(8_000);
    const fetchMock = jest.fn(async () => jsonResponse({ status: "completed", output: [
      { type: "web_search_call", status: "completed", action: { type: "search", query: "sidewalk vinyl" } },
      { type: "message", content: [{ type: "output_text", text: longAnswer, annotations: [{ id: "long_source", title: "Commercial printable vinyl", url: "https://supplier.example/long-vinyl" }] }] },
    ] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [] });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));

    expect(body.max_output_tokens).toBe(8192);
    expect(JSON.parse(result.rawText)).toEqual({ kind: "complete", response: longAnswer });
    expect(result.requestMetadata.nativeWebSources).toEqual([expect.objectContaining({ title: "Commercial printable vinyl", url: "https://supplier.example/long-vinyl" })]);
  });

  test("gives pending native function calls priority over a valid Operator decision", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ status: "completed", output: [
      { type: "function_call", call_id: "call_1", name: "ph_0_products_get_summary", arguments: '{"query":"Banner"}' },
      { type: "message", content: [{ type: "output_text", text: '{"kind":"continue","workingSummary":"Internal control."}' }] },
    ] })) as unknown as typeof fetch;

    const result = await new OpenAiCompatibleBugReviewProvider().generateOperatorDecision!({ ...baseRequest(), toolCatalog: [{ name: "products.get_summary", description: "Read product summary" }] });

    expect(JSON.parse(result.rawText)).toMatchObject({ kind: "call_tools", calls: [{ toolName: "products.get_summary" }] });
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

  test("passes the compiler's dedicated bounded output request through the DeepSeek Chat Completions path", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ id: "chat_compiler_1", choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const provider = new OpenAiCompatibleBugReviewProvider();
    await provider.generateJson(baseRequest({ feature: "feature_review", maxTokens: 4096, timeoutUseCase: "product_intent_compiler" }));
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ model: "deepseek-v4-flash", max_tokens: 4096, response_format: { type: "json_object" }, thinking: { type: "disabled" } });
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

  test("DeepSeek Responses preserves the supplied Operator timeout and logs a safe timeout diagnostic", async () => {
    jest.useFakeTimers();
    try {
      global.fetch = jest.fn((_endpoint: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
      const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      const provider = new OpenAiCompatibleBugReviewProvider();
      const request = provider.generateOperatorDecision!({ ...baseRequest({ timeoutMs: 7, timeoutUseCase: "assistant_operator_decision" }), toolCatalog: [] }).catch((error) => error);
      await jest.advanceTimersByTimeAsync(7);

      const error = await request;
      expect(error).toBeInstanceOf(AiProviderTimeoutError);
      expect(error).toMatchObject({ timeoutMs: 7, provider: "openai_compatible", model: "deepseek-v4-flash", useCase: "assistant_operator_decision" });
      expect(JSON.stringify(warn.mock.calls)).toContain("DeepSeek Responses request timed out.");
      expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-test-key");
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
