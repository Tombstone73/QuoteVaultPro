import { describe, expect, jest, test } from "@jest/globals";

process.env.DATABASE_URL ??= "postgresql://readonly:readonly@127.0.0.1:1/quotevault_test";

describe("ConfiguredAssistantOperatorDecisionProvider", () => {
  test("passes retained trusted observations to the provider for a direct follow-up answer", async () => {
    const { ConfiguredAssistantOperatorDecisionProvider } = await import("../services/assistant/operatorDecisionProvider");
    const generateJson = jest.fn(async (request: any) => {
      expect(request.system).toContain("A direct complete response is a first-class outcome");
      expect(request.system).toContain("Treat a user's requested presentation as part of the goal");
      expect(request.system).toContain("If multiple records share the extreme value");
      const body = JSON.parse(request.user);
      expect(body.goal).toBe("all 5");
      expect(body.observations).toEqual([]);
      expect(body.activeTask.trustedObservations).toEqual([expect.objectContaining({
        toolName: "quotes.search",
        data: expect.objectContaining({ totalMatchingQuotes: 5 }),
      })]);
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
  });

  test("uses the native DeepSeek Responses path and carries only function output between decisions", async () => {
    const { ConfiguredAssistantOperatorDecisionProvider } = await import("../services/assistant/operatorDecisionProvider");
    const generateOperatorDecision = jest.fn()
      .mockResolvedValueOnce({ rawText: JSON.stringify({ kind: "call_tools", calls: [{ toolName: "quotes.search", arguments: { status: "open" } }] }), requestMetadata: {}, operatorContinuation: { items: [{ type: "reasoning", content: [{ type: "reasoning_text", text: "hidden" }] }, { type: "function_call", call_id: "call_1", name: "quotes.search", arguments: '{"status":"open"}' }], functionCalls: [{ callId: "call_1", toolName: "quotes.search" }] } })
      .mockResolvedValueOnce({ rawText: JSON.stringify({ kind: "complete", response: "Five open quotes found." }), requestMetadata: { nativeWebSources: [{ title: "Market reference", url: "https://example.com/market" }] } });
    const provider = new ConfiguredAssistantOperatorDecisionProvider(
      "org_1", { generateJson: jest.fn(), generateOperatorDecision } as any,
      { resolveProvider: jest.fn(async () => ({ enabled: true, provider: "openai_compatible", endpoint: "https://api.deepseek.com/chat/completions", apiKey: "test", model: "deepseek-v4-flash" })) } as any,
    );
    const base = { goal: "Find my 5 most recent open quotes.", taskId: "task_1", remainingSteps: 2, toolCatalog: [{ name: "quotes.search", description: "Search quotes" }], safeWorkingSummary: null };
    await provider.decide({ ...base, step: 1, observations: [] });
    const result = await provider.decide({ ...base, step: 2, observations: [{ step: 1, toolName: "quotes.search", status: "succeeded", result: { status: "succeeded", data: { quotes: [] } } as any }] });
    expect(result).toEqual({ kind: "complete", response: "Five open quotes found.\n\nSources:\n- Market reference: https://example.com/market" });
    const second = generateOperatorDecision.mock.calls[1]?.[0];
    expect(second.responseContinuation).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function_call", call_id: "call_1" }),
      expect.objectContaining({ type: "function_call_output", call_id: "call_1" }),
    ]));
    expect(generateOperatorDecision).toHaveBeenCalledTimes(2);
  });
});
