import { describe, expect, jest, test } from "@jest/globals";
import {
  ConfiguredAssistantIntentPlannerProvider,
} from "../services/assistant/intentPlannerProvider";

const validPlan = {
  version: 1,
  operation: "create",
  domain: "products",
  mode: "mutation",
  capabilityId: "canonical_product_intent_compiler",
  confidence: "high",
  target: { kind: "new_entity", entityId: null },
  contextUsage: { workspaceIsAuthoritative: false, workspaceRelevance: "supporting", activeSessionId: null },
  requiresClarification: false,
  clarificationQuestion: null,
  reasonCode: "explicit_new_entity_request",
} as const;

function resolver() {
  return {
    resolveProvider: jest.fn(async () => ({
      enabled: true,
      provider: "openai_compatible",
      endpoint: "https://api.deepseek.com/chat/completions",
      apiKey: "not-a-real-key",
      model: "deepseek-test",
      mode: "printershero_managed",
      source: "test",
    })),
  } as any;
}

function input() {
  return {
    organizationId: "org_1",
    system: "Return strict planner JSON.",
    user: JSON.stringify({ request: "Create a new product called Translucent Vinyl" }),
    promptVersion: "ai-first-intent-planner-v1",
    timeoutMs: 12_000,
  };
}

describe("AI-first intent planner provider boundary", () => {
  test.each([
    ["DeepSeek through the existing OpenAI-compatible adapter", "openai_compatible", "deepseek-test"],
    ["a future provider adapter", "future_provider", "future-model"],
  ])("normalizes %s output into the same typed plan", async (_label, providerName, model) => {
    const provider = {
      generateJson: jest.fn(async () => ({
        rawText: JSON.stringify(validPlan), provider: providerName, model, requestMetadata: { providerRequestId: "req_safe", usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } },
      })),
    } as any;
    const planner = new ConfiguredAssistantIntentPlannerProvider(provider, resolver());

    const result = await planner.plan(input());

    expect(result).toMatchObject({ ok: true, plan: validPlan, diagnostics: { provider: providerName, model, attempts: 1, stage: "success" } });
    expect(provider.generateJson).toHaveBeenCalledWith(expect.objectContaining({
      feature: "assistant",
      repairAttempt: false,
      providerConfig: expect.objectContaining({ apiKey: "not-a-real-key" }),
    }));
    expect((result.ok && result.diagnostics.providerMetadata)).toEqual(expect.objectContaining({ providerRequestId: "req_safe", usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }));
  });

  test("repairs an unknown contract field exactly once before returning a typed plan", async () => {
    const provider = {
      generateJson: jest.fn()
        .mockResolvedValueOnce({ rawText: JSON.stringify({ ...validPlan, unexpectedRoute: "legacy_keyword_router" }), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })
        .mockResolvedValueOnce({ rawText: JSON.stringify(validPlan), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} }),
    } as any;
    const planner = new ConfiguredAssistantIntentPlannerProvider(provider, resolver());

    const result = await planner.plan(input());

    expect(result).toMatchObject({ ok: true, diagnostics: { attempts: 2, repairAttempted: true } });
    expect(provider.generateJson).toHaveBeenCalledTimes(2);
    expect(provider.generateJson.mock.calls[1]?.[0]).toMatchObject({ repairAttempt: true });
    expect(provider.generateJson.mock.calls[1]?.[0]?.system).toContain("previous response was invalid");
    expect(provider.generateJson.mock.calls[1]?.[0]?.user).toContain("unexpectedRoute");
  });

  test.each([
    ["a JSON markdown fence", `\`\`\`json\n${JSON.stringify(validPlan)}\n\`\`\``],
    ["a prose-wrapped JSON object", `Here is the plan: ${JSON.stringify(validPlan)} Thanks.`],
  ])("accepts %s while preserving strict contract validation", async (_label, rawText) => {
    const provider = { generateJson: jest.fn(async () => ({ rawText, provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })) } as any;
    const planner = new ConfiguredAssistantIntentPlannerProvider(provider, resolver());

    await expect(planner.plan(input())).resolves.toMatchObject({ ok: true, plan: validPlan, diagnostics: { attempts: 1 } });
  });

  test("rejects malformed output after one repair without logging customer content or selecting a fallback", async () => {
    const customerMessage = "CUSTOMER_CONTENT_MUST_NOT_APPEAR_IN_LOGS";
    const provider = {
      generateJson: jest.fn(async () => ({ rawText: "not JSON", provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })),
    } as any;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const planner = new ConfiguredAssistantIntentPlannerProvider(provider, resolver());

    const result = await planner.plan({ ...input(), user: JSON.stringify({ request: customerMessage }) });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_json", retryable: true }, diagnostics: { attempts: 2, stage: "invalid_json", repairAttempted: true } });
    expect(provider.generateJson).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(customerMessage);
    if (!result.ok) expect(result.error.message).toContain(result.error.correlationId);
    warn.mockRestore();
  });

  test("returns a safe provider failure without a keyword-routing retry", async () => {
    const provider = { generateJson: jest.fn(async () => { throw new Error("provider down"); }) } as any;
    const planner = new ConfiguredAssistantIntentPlannerProvider(provider, resolver());
    jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await planner.plan(input());

    expect(result).toMatchObject({ ok: false, error: { code: "provider_failure", retryable: true }, diagnostics: { attempts: 1, stage: "provider_failure" } });
    expect(provider.generateJson).toHaveBeenCalledTimes(1);
  });
});
