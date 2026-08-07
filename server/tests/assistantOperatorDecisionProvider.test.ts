import { describe, expect, jest, test } from "@jest/globals";

process.env.DATABASE_URL ??= "postgresql://readonly:readonly@127.0.0.1:1/quotevault_test";

describe("ConfiguredAssistantOperatorDecisionProvider", () => {
  test("passes retained trusted observations to the provider for a direct follow-up answer", async () => {
    const { ConfiguredAssistantOperatorDecisionProvider } = await import("../services/assistant/operatorDecisionProvider");
    const generateJson = jest.fn(async (request: any) => {
      expect(request.system).toContain("A direct complete response is a first-class outcome");
      const body = JSON.parse(request.user);
      expect(body.goal).toBe("all 5");
      expect(body.observations).toEqual([]);
      expect(body.activeTask.trustedObservations).toEqual([expect.objectContaining({
        toolName: "quotes.search",
        data: expect.objectContaining({ totalMatchingQuotes: 5 }),
      })]);
      return { rawText: JSON.stringify({ kind: "complete", response: "QT-1\nQT-2\nQT-3\nQT-4\nQT-5" }) };
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

    expect(decision).toEqual({ kind: "complete", response: "QT-1\nQT-2\nQT-3\nQT-4\nQT-5" });
    expect(generateJson).toHaveBeenCalledTimes(1);
  });
});
