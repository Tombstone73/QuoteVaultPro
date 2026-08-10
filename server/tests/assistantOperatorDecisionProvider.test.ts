import { describe, expect, jest, test } from "@jest/globals";
import { AiProviderResponseError } from "../services/ai/providers/AiProviderAdapter";

process.env.DATABASE_URL ??= "postgresql://readonly:readonly@127.0.0.1:1/quotevault_test";

describe("ConfiguredAssistantOperatorDecisionProvider", () => {
  test("passes retained trusted observations to the provider for a direct follow-up answer", async () => {
    const { ConfiguredAssistantOperatorDecisionProvider } = await import("../services/assistant/operatorDecisionProvider");
    const generateJson = jest.fn(async (request: any) => {
      expect(request.system).toContain("A direct complete response is a first-class outcome");
      expect(request.system).toContain("Treat a user's requested presentation as part of the goal");
      expect(request.system).toContain("If multiple records share the extreme value");
      expect(request.system).toContain("PrintersHero is not read-only");
      const body = JSON.parse(request.user);
      expect(body.goal).toBe("all 5");
      expect(body.observations).toEqual([]);
      expect(body.activeTask.trustedObservations).toEqual([expect.objectContaining({
        toolName: "quotes.search",
        data: expect.objectContaining({ totalMatchingQuotes: 5 }),
      })]);
      expect(body.activeTask.businessContext).toMatchObject({
        taskType: "quote_investigation",
        businessStateSummary: "Five open quotes found.",
        unresolvedDecisions: [{ item: "quote selection" }],
        recentOperations: ["quotes.search"],
        trustedSelections: [{ field: "customer", label: "Acme", provenance: "trusted_read" }],
        readiness: "needs_input",
      });
      return { rawText: JSON.stringify({ kind: "complete", response: "**QT-1**\nCustomer: Acme\n\n**QT-2**\nCustomer: Beta" }) };
    });
    const provider = new ConfiguredAssistantOperatorDecisionProvider(
      "org_1",
      { generateJson } as any,
      { resolveProvider: jest.fn(async () => ({ enabled: true, provider: "openai_compatible", endpoint: "https://provider.test", apiKey: "test", model: "test" })) } as any,
    );

    const decision = await provider.decide({
      goal: "all 5",
      taskId: "task_quotes",
      step: 1,
      remainingSteps: 3,
      toolCatalog: [],
      observations: [],
      safeWorkingSummary: "Found five open quotes.",
      task: {
        id: "task_quotes",
        domain: "quotes",
        canonicalProductIntentProposalId: null,
        businessContext: {
          taskType: "quote_investigation", businessStateSummary: "Five open quotes found.",
          unresolvedDecisions: [{ item: "quote selection" }], recentOperations: ["quotes.search"],
          trustedSelections: [{ field: "customer", label: "Acme", provenance: "trusted_read" }], readiness: "needs_input",
          constraints: ["Use registered tools only."], capabilities: ["quotes.search"],
        },
        entityReferences: [],
        trustedObservations: [{
          toolName: "quotes.search",
          data: { totalMatchingQuotes: 5, quotes: [{ quoteNumber: "QT-1" }] },
          capturedAt: "2026-08-07T12:00:00.000Z",
        }],
        missingInformation: [],
      },
    });

    expect(decision).toEqual({ kind: "complete", response: "**QT-1**\nCustomer: Acme\n\n**QT-2**\nCustomer: Beta" });
    expect(generateJson).toHaveBeenCalledTimes(1);
    expect(generateJson.mock.calls[0]?.[0]).toMatchObject({ timeoutMs: 120000, timeoutUseCase: "assistant_operator_decision" });
  });

  test("uses the native DeepSeek Responses path and carries only function output between decisions", async () => {
    const { ConfiguredAssistantOperatorDecisionProvider } = await import("../services/assistant/operatorDecisionProvider");
    const generateOperatorDecision = jest.fn()
      .mockResolvedValueOnce({ rawText: JSON.stringify({ kind: "call_tools", calls: [{ toolName: "quotes.search", arguments: { status: "open" } }] }), requestMetadata: {}, operatorContinuation: { items: [{ type: "reasoning", content: [{ type: "reasoning_text", text: "hidden" }] }, { type: "function_call", call_id: "call_1", name: "quotes.search", arguments: '{"status":"open"}' }], functionCalls: [{ callId: "call_1", toolName: "quotes.search" }] } })
      .mockResolvedValueOnce({ rawText: JSON.stringify({ kind: "complete", response: "Five open quotes found." }), requestMetadata: { nativeWebSources: [{ title: "Market reference", url: "https://example.com/market", domain: "example.com" }] } });
    const provider = new ConfiguredAssistantOperatorDecisionProvider(
      "org_1", { generateJson: jest.fn(), generateOperatorDecision } as any,
      { resolveProvider: jest.fn(async () => ({ enabled: true, provider: "openai_compatible", endpoint: "https://api.deepseek.com/chat/completions", apiKey: "test", model: "deepseek-v4-flash" })) } as any,
    );
    const base = { goal: "Find my 5 most recent open quotes.", taskId: "task_1", remainingSteps: 2, toolCatalog: [{ name: "quotes.search", description: "Search quotes" }], safeWorkingSummary: null };
    await provider.decide({ ...base, step: 1, observations: [] });
    const result = await provider.decide({ ...base, step: 2, observations: [{ step: 1, toolName: "quotes.search", status: "succeeded", result: { status: "succeeded", data: { quotes: [] } } as any }] });
    expect(result).toEqual({ kind: "complete", response: "Five open quotes found.\n\nProvider-verified sources:\n- [Market reference](https://example.com/market) (example.com)" });
    const second = generateOperatorDecision.mock.calls[1]?.[0];
    expect(second.responseContinuation).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function_call", call_id: "call_1" }),
      expect.objectContaining({ type: "function_call_output", call_id: "call_1" }),
    ]));
    expect(generateOperatorDecision.mock.calls.map((call) => call[0].operatorRequestSequence)).toEqual([1, 2]);
    expect(generateOperatorDecision.mock.calls.map((call) => call[0].timeoutMs)).toEqual([120000, 120000]);
    expect(generateOperatorDecision).toHaveBeenCalledTimes(2);
  });

  test("keeps a native-search continuation inside the same Operator provider lifecycle", async () => {
    const { ConfiguredAssistantOperatorDecisionProvider } = await import("../services/assistant/operatorDecisionProvider");
    const generateOperatorDecision = jest.fn()
      .mockResolvedValueOnce({ rawText: JSON.stringify({ kind: "continue", workingSummary: "Continuing public research." }), requestMetadata: {}, operatorContinuation: { items: [{ type: "web_search_call", action: { type: "search", query: "sidewalk vinyl" } }], functionCalls: [] } })
      .mockResolvedValueOnce({ rawText: JSON.stringify({ kind: "complete", response: "Here are the current options." }), requestMetadata: { nativeWebSources: [{ title: "Supplier", url: "https://example.com/vinyl", domain: "example.com" }] } });
    const provider = new ConfiguredAssistantOperatorDecisionProvider(
      "org_1", { generateJson: jest.fn(), generateOperatorDecision } as any,
      { resolveProvider: jest.fn(async () => ({ enabled: true, provider: "openai_compatible", endpoint: "https://api.deepseek.com/chat/completions", apiKey: "test", model: "deepseek-v4-flash" })) } as any,
    );
    const base = { goal: "Research sidewalk vinyl.", taskId: "task_web", remainingSteps: 2, toolCatalog: [], safeWorkingSummary: null };

    expect(await provider.decide({ ...base, step: 1, observations: [] })).toEqual({ kind: "continue", workingSummary: "Continuing public research." });
    expect(await provider.decide({ ...base, step: 2, observations: [] })).toEqual({ kind: "complete", response: "Here are the current options.\n\nProvider-verified sources:\n- [Supplier](https://example.com/vinyl) (example.com)" });
    expect(generateOperatorDecision.mock.calls[1]?.[0].responseContinuation).toEqual([expect.objectContaining({ type: "web_search_call" })]);
  });

  test("keeps a one-level JSON-string-wrapped continuation inside the Operator lifecycle", async () => {
    const { ConfiguredAssistantOperatorDecisionProvider } = await import("../services/assistant/operatorDecisionProvider");
    const rawText = JSON.stringify(JSON.stringify({ kind: "continue", workingSummary: "Continuing to check whether the product exists and establish a trusted product reference before configuring the new product." }));
    const generateOperatorDecision = jest.fn(async () => ({ rawText, requestMetadata: {}, operatorContinuation: { items: [], functionCalls: [] } }));
    const provider = new ConfiguredAssistantOperatorDecisionProvider("org_1", { generateJson: jest.fn(), generateOperatorDecision } as any, { resolveProvider: jest.fn(async () => ({ enabled: true, provider: "openai_compatible", endpoint: "https://api.deepseek.com/chat/completions", apiKey: "test", model: "deepseek-v4-flash" })) } as any);
    await expect(provider.decide({ goal: "Create Translucent Vinyl.", taskId: "task_wrapped", step: 1, remainingSteps: 15, toolCatalog: [], observations: [], safeWorkingSummary: null })).resolves.toEqual({ kind: "continue", workingSummary: "Continuing to check whether the product exists and establish a trusted product reference before configuring the new product." });
  });

  test("keeps provider-verified sources on a long researched response", async () => {
    const { ConfiguredAssistantOperatorDecisionProvider } = await import("../services/assistant/operatorDecisionProvider");
    const response = `Long comparison: ${"commercial-print evidence. ".repeat(430)}`;
    expect(response.length).toBeGreaterThan(8_000);
    const generateOperatorDecision = jest.fn(async () => ({ rawText: JSON.stringify({ kind: "complete", response }), requestMetadata: { nativeWebSources: [{ title: "Long source", url: "https://example.com/long", domain: "example.com" }] }, operatorContinuation: { items: [], functionCalls: [] } }));
    const provider = new ConfiguredAssistantOperatorDecisionProvider("org_1", { generateJson: jest.fn(), generateOperatorDecision } as any, { resolveProvider: jest.fn(async () => ({ enabled: true, provider: "openai_compatible", endpoint: "https://api.deepseek.com/chat/completions", apiKey: "test", model: "deepseek-v4-flash" })) } as any);

    const decision = await provider.decide({ goal: "Research current printable sidewalk vinyl.", taskId: "task_long_web", step: 1, remainingSteps: 15, toolCatalog: [], observations: [], safeWorkingSummary: null });

    expect(decision).toMatchObject({ kind: "complete", response: expect.stringContaining("Provider-verified sources:") });
    expect((decision as any).response.length).toBeGreaterThan(8_000);
  });

  test("converts a typed incomplete provider result into a useful safe failure", async () => {
    const { ConfiguredAssistantOperatorDecisionProvider } = await import("../services/assistant/operatorDecisionProvider");
    const provider = new ConfiguredAssistantOperatorDecisionProvider(
      "org_1", { generateJson: jest.fn(), generateOperatorDecision: jest.fn(async () => { throw new AiProviderResponseError({ kind: "truncated_output", message: "hidden provider detail" }); }) } as any,
      { resolveProvider: jest.fn(async () => ({ enabled: true, provider: "openai_compatible", endpoint: "https://api.deepseek.com/chat/completions", apiKey: "test", model: "deepseek-v4-flash" })) } as any,
    );

    await expect(provider.decide({ goal: "Research sidewalk vinyl.", taskId: "task_failure", step: 1, remainingSteps: 2, toolCatalog: [], observations: [], safeWorkingSummary: null }))
      .resolves.toEqual({ kind: "fail", response: "The AI provider did not return a complete investigation result before its output limit." });
  });

  test("keeps a malformed or empty provider result as a safe failure", async () => {
    const { ConfiguredAssistantOperatorDecisionProvider } = await import("../services/assistant/operatorDecisionProvider");
    const provider = new ConfiguredAssistantOperatorDecisionProvider(
      "org_1", { generateJson: jest.fn(), generateOperatorDecision: jest.fn(async () => { throw new AiProviderResponseError({ kind: "empty_response", message: "empty" }); }) } as any,
      { resolveProvider: jest.fn(async () => ({ enabled: true, provider: "openai_compatible", endpoint: "https://api.deepseek.com/chat/completions", apiKey: "test", model: "deepseek-v4-flash" })) } as any,
    );

    await expect(provider.decide({ goal: "Verify the active draft", taskId: "task_empty_provider", step: 1, remainingSteps: 2, toolCatalog: [], observations: [], safeWorkingSummary: null }))
      .resolves.toEqual({ kind: "fail", response: "The AI provider did not return a usable investigation result." });
  });

  test("never returns provider control protocol as terminal assistant text", async () => {
    const { ConfiguredAssistantOperatorDecisionProvider } = await import("../services/assistant/operatorDecisionProvider");
    const provider = new ConfiguredAssistantOperatorDecisionProvider("org_1", { generateJson: jest.fn(), generateOperatorDecision: jest.fn(async () => ({ rawText: JSON.stringify({ kind: "complete", response: "<｜DSML｜tool_calls>" }), requestMetadata: {}, operatorContinuation: { items: [], functionCalls: [] } })) } as any, { resolveProvider: jest.fn(async () => ({ enabled: true, provider: "openai_compatible", endpoint: "https://api.deepseek.com/chat/completions", apiKey: "test", model: "deepseek-v4-flash" })) } as any);
    await expect(provider.decide({ goal: "Create product", taskId: "task_protocol", step: 1, remainingSteps: 15, toolCatalog: [], observations: [], safeWorkingSummary: null })).resolves.toEqual({ kind: "fail", response: "The AI provider returned an unusable investigation result." });
  });

  test("accepts a bounded six-call pricing decision from a native provider", async () => {
    const { ConfiguredAssistantOperatorDecisionProvider } = await import("../services/assistant/operatorDecisionProvider");
    const calls = Array.from({ length: 6 }, () => ({ toolName: "products.preview_draft_pricing", arguments: { scenarios: [{ squareFeet: 10 }] } }));
    const provider = new ConfiguredAssistantOperatorDecisionProvider("org_1", { generateJson: jest.fn(), generateOperatorDecision: jest.fn(async () => ({ rawText: JSON.stringify({ kind: "call_tools", calls }), requestMetadata: { requestSequence: 1 }, operatorContinuation: { items: [], functionCalls: [] } })) } as any, { resolveProvider: jest.fn(async () => ({ enabled: true, provider: "openai_compatible", endpoint: "https://api.deepseek.com/chat/completions", apiKey: "test", model: "deepseek-v4-flash" })) } as any);
    await expect(provider.decide({ goal: "Show six pricing scenarios", taskId: "task_six_calls", step: 1, remainingSteps: 15, toolCatalog: [], observations: [], safeWorkingSummary: null }))
      .resolves.toEqual(expect.objectContaining({ kind: "call_tools", calls: expect.arrayContaining([expect.objectContaining({ toolName: "products.preview_draft_pricing" })]) }));
  });

  test("keeps a rejected provider decision's safe response shape", async () => {
    const { ConfiguredAssistantOperatorDecisionProvider } = await import("../services/assistant/operatorDecisionProvider");
    const provider = new ConfiguredAssistantOperatorDecisionProvider("org_1", { generateJson: jest.fn(), generateOperatorDecision: jest.fn(async () => ({
      rawText: JSON.stringify({ kind: "call_tools", calls: Array.from({ length: 13 }, () => ({ toolName: "products.get_pricing", arguments: {} })) }),
      requestMetadata: { outputItemCount: 13, outputItemTypes: ["function_call", "function_call"], functionCallCount: 13, functionArgumentDecodeSucceeded: true, messageOutputTextPresent: false, finalTextLength: 0, responseStatus: "completed", terminalClassification: "operator_decision", parseClassification: "function_calls", controlProtocolDetected: false },
      operatorContinuation: { items: [], functionCalls: [] },
    })) } as any, { resolveProvider: jest.fn(async () => ({ enabled: true, provider: "openai_compatible", endpoint: "https://api.deepseek.com/chat/completions", apiKey: "test", model: "deepseek-v4-flash" })) } as any);

    await expect(provider.decide({ goal: "Show six persisted pricing scenarios.", taskId: "task_pricing", step: 1, remainingSteps: 15, toolCatalog: [], observations: [], safeWorkingSummary: null }))
      .resolves.toEqual(expect.objectContaining({ kind: "fail", providerDecisionShape: expect.objectContaining({ responseItemCount: 13, functionCallCount: 13, outputTextPresent: false, decisionParseStage: "operator_decision_parse" }) }));
  });
});
