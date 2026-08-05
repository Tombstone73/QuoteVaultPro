import {
  PRODUCT_INTENT_COMPILER_MAX_REPAIR_ATTEMPTS,
  ProductIntentCompiler,
} from "../services/productIntentCompiler/productIntentCompiler";
import { jest } from "@jest/globals";

const compilerInput = {
  orgId: "org_test",
  request: "Create a sign product and keep everything else unchanged.",
  currentIntent: null,
  currentRevision: 3,
  operationContext: { mode: "correction" },
  schemaDescription: "Canonical ProductIntentCompilerResult JSON schema",
  allowedEnums: { lifecycle: ["inactive"] },
  supportedArchetypes: ["standard_dimensions"],
  candidateLabels: { materials: ["3mm PVC"], productionRoutes: ["Flatbed"] },
  serverConstraints: ["lifecycle must remain inactive"],
};

describe("ProductIntentCompiler", () => {
  test("uses one bounded repair attempt after malformed provider JSON without interpreting prose", async () => {
    const requests: any[] = [];
    const compiler = new ProductIntentCompiler({
      generateJson: jest.fn(async (request) => {
        requests.push(request);
        return {
          rawText: requests.length === 1 ? "Here is the result: {not json}" : "{}",
          provider: "openai_compatible",
          model: "deepseek-test",
          requestMetadata: { providerRequestId: "req_1", apiKey: "never-copy" },
        };
      }),
    });

    const result = await compiler.compile(compilerInput);

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_contract", retryable: true } });
    expect(requests).toHaveLength(PRODUCT_INTENT_COMPILER_MAX_REPAIR_ATTEMPTS + 1);
    expect(requests[0]).toMatchObject({ feature: "feature_review", repairAttempt: false, timeoutUseCase: "product_intent_compiler" });
    expect(requests[1]).toMatchObject({ repairAttempt: true });
    expect(requests[0].system).toContain("preserve every existing authoritative intent field");
    expect(requests[0].user).toContain("3mm PVC");
    expect(requests[0].user).not.toContain("org_test");
  });

  test("fails safely when no compatible provider is configured", async () => {
    const compiler = new ProductIntentCompiler({
      generateJson: jest.fn(async () => {
        const error = new Error("disabled");
        error.name = "AiProviderUnavailableError";
        throw error;
      }),
    });

    await expect(compiler.compile(compilerInput)).resolves.toMatchObject({
      ok: false,
      error: { code: "provider_unavailable", retryable: false },
    });
  });
});
