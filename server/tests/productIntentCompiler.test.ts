import {
  DEFAULT_PRODUCT_INTENT_COMPILER_MAX_OUTPUT_TOKENS,
  PRODUCT_INTENT_COMPILER_MAX_REPAIR_ATTEMPTS,
  ProductIntentCompiler,
  resolveProductIntentCompilerMaxOutputTokens,
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

const yardSignsPayload = {
  kind: "complete_intent",
  intent: {
    operation: "new_product",
    identity: { name: "Yard Signs Test", description: "", category: { state: "unresolved", label: "Signs" } },
    lifecycle: { productStatus: "inactive", published: false }, measurement: { mode: "quantity_only" }, quantity: { behavior: "customer_entered", minimum: 1 },
    pricing: {
      model: "two_dimensional_matrix", unit: "unresolved", rowOptionKey: "thickness", columnOptionKey: "sides",
      cells: [{ row: "3mm", column: "single", priceCents: 1200 }, { row: "3mm", column: "double", priceCents: 1800 }, { row: "6mm", column: "single", priceCents: 1600 }, { row: "6mm", column: "double", priceCents: 2200 }],
    },
    material: { state: "explicitly_unset" },
    optionGroups: [
      { key: "thickness", label: "Thickness", required: true, selectionMode: "single", values: [{ key: "3mm", label: "3mm", isDefault: true }, { key: "6mm", label: "6mm", isDefault: false }] },
      { key: "sides", label: "Sides", required: true, selectionMode: "single", values: [{ key: "single", label: "Single-sided", isDefault: true }, { key: "double", label: "Double-sided", isDefault: false }] },
    ],
    workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "explicitly_unset" }, configuration: {} }, visibility: { catalogVisible: false },
    unresolvedFields: [{ path: "pricing.unit", code: "PRICING_UNIT_UNRESOLVED", question: "Are these matrix prices per piece or per square foot?" }], fieldMetadata: { "pricing.unit": { source: "unresolved" }, "optionGroups.thickness.default": { source: "selected_template" }, "optionGroups.sides.default": { source: "selected_template" } },
  },
};

function providerResponse(rawText: string) {
  return { rawText, provider: "openai_compatible", model: "deepseek-test", requestMetadata: { providerRequestId: "req_1" } };
}

describe("ProductIntentCompiler", () => {
  test("uses a dedicated bounded structured-output budget for complex product intent", async () => {
    const generateJson = jest.fn(async () => providerResponse(JSON.stringify(yardSignsPayload)));
    const compiler = new ProductIntentCompiler({ generateJson });
    await compiler.compile(compilerInput);
    expect(generateJson).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: DEFAULT_PRODUCT_INTENT_COMPILER_MAX_OUTPUT_TOKENS, timeoutUseCase: "product_intent_compiler" }));
    expect(resolveProductIntentCompilerMaxOutputTokens({ AI_PRODUCT_INTENT_COMPILER_MAX_OUTPUT_TOKENS: "99999" } as NodeJS.ProcessEnv)).toBe(DEFAULT_PRODUCT_INTENT_COMPILER_MAX_OUTPUT_TOKENS);
    expect(resolveProductIntentCompilerMaxOutputTokens({ AI_PRODUCT_INTENT_COMPILER_MAX_OUTPUT_TOKENS: "128" } as NodeJS.ProcessEnv)).toBe(512);
  });

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
    expect(requests[0].system).toContain("preserve every existing business field");
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

  test.each([
    ["plain JSON", JSON.stringify(yardSignsPayload)],
    ["a Markdown fence", `\`\`\`json\n${JSON.stringify(yardSignsPayload)}\n\`\`\``],
    ["prose before and after JSON", `Result follows: ${JSON.stringify(yardSignsPayload)} Thank you.`],
  ])("accepts valid Yard Signs compiler JSON inside %s and applies server-owned fields", async (_case, rawText) => {
    const compiler = new ProductIntentCompiler({ generateJson: jest.fn(async () => providerResponse(rawText)) });
    const result = await compiler.compile({ ...compilerInput, request: "I want to add a new product called Yard Signs Test. It has 3mm and 6mm thicknesses, each available single-sided or double-sided. Prices are $12/$18 for 3mm and $16/$22 for 6mm." });

    expect(result).toMatchObject({ ok: true, result: { kind: "complete_intent", intent: { organizationId: "org_test", revision: 0, state: "compiling", pricing: { model: "two_dimensional_matrix", unit: "unresolved", cells: expect.arrayContaining([{ row: "3mm", column: "single", priceCents: 1200 }, { row: "6mm", column: "double", priceCents: 2200 }]) } } } });
    if (result.ok && result.result.kind === "complete_intent") expect(result.result.intent.intentId).toEqual(expect.any(String));
  });

  test("requires semantic operations for a continuation and builds its server-owned patch", async () => {
    const initialCompiler = new ProductIntentCompiler({ generateJson: jest.fn(async () => providerResponse(JSON.stringify(yardSignsPayload))) });
    const initial = await initialCompiler.compile(compilerInput);
    if (!initial.ok || initial.result.kind !== "complete_intent") throw new Error("Expected initial compiler result.");
    const requests: any[] = [];
    const compiler = new ProductIntentCompiler({ generateJson: jest.fn(async (request) => {
      requests.push(request);
      return providerResponse(JSON.stringify({ kind: "semantic_operations", operations: [{ op: "set_pricing_basis", basis: "per_piece" }] }));
    }) });

    const result = await compiler.compile({
      ...compilerInput,
      request: "Set the current pricing unit.",
      currentIntent: initial.result.intent,
      currentRevision: 0,
      activeRequiredIssues: [{ issueId: "0:pricing.matrix.unit:required", canonicalPath: "pricing.matrix.unit", answerType: "choice", allowedChoices: [{ displayLabel: "Per piece", canonicalValue: "per_piece", safeAliases: ["per piece", "piece"] }, { displayLabel: "Per square foot", canonicalValue: "per_square_foot", safeAliases: ["per square foot", "square foot", "per sqft"] }], baseRevision: 0 }],
    });

    expect(result).toMatchObject({ ok: true, result: { kind: "intent_patch", patch: { contractVersion: 1, baseRevision: 0, preserveUnchanged: true, operations: expect.arrayContaining([expect.objectContaining({ op: "set_pricing", value: expect.objectContaining({ unit: "per_piece" }) })]) } } });
    expect(requests[0].system).toContain("This is a continuation");
    expect(requests[0].user).toContain("Per piece");
    expect(requests[0].user).toContain("semanticOperationContract");
    expect(requests[0].user).toContain("currentBusinessContext");
    expect(requests[0].user).not.toContain("currentIntent");
    expect(requests[0].user).not.toContain("currentRevision");
  });

  test("derives a safe hourly service intent from explicit Design fee language and asks only for the missing rate", async () => {
    const payload = structuredClone(yardSignsPayload);
    payload.intent.identity = { name: "Design", description: "", category: { state: "unresolved", label: "Product category" } };
    const compiler = new ProductIntentCompiler({ generateJson: jest.fn(async () => providerResponse(JSON.stringify(payload))) });
    const result = await compiler.compile({ ...compilerInput, request: "I need to make a new product for design. It will be a fee product and will be charged by the hour." });
    expect(result).toMatchObject({ ok: true, result: { kind: "complete_intent", intent: {
      identity: { category: { state: "unresolved", label: "Fees" } }, measurement: { mode: "quantity_only" }, quantity: { behavior: "not_applicable" },
      pricing: { model: "unresolved", unit: "per_hour" }, material: { state: "explicitly_unset" },
      workflow: { kind: "service_fee", requiresProofApproval: false, requiresProductionJob: false }, production: { route: { state: "explicitly_unset" } },
      unresolvedFields: expect.arrayContaining([expect.objectContaining({ code: "HOURLY_RATE_UNRESOLVED" })]),
    } } });
  });

  test("applies a stated hourly rate on a service-fee continuation without converting it to per-piece", async () => {
    const current: any = { ...yardSignsPayload.intent, contractVersion: 1, intentId: "hourly-1", organizationId: "org_test", revision: 0, state: "needs_answers", revisionMetadata: { parentRevision: null }, operationContext: {},
      identity: { name: "Design", description: "", category: { state: "resolved", id: "fees", label: "Fees" } }, measurement: { mode: "quantity_only" }, quantity: { behavior: "not_applicable" }, pricing: { model: "unresolved", unit: "per_hour" }, material: { state: "explicitly_unset" }, optionGroups: [], workflow: { kind: "service_fee", requiresProofApproval: false, requiresProductionJob: false }, production: { route: { state: "explicitly_unset" }, configuration: {} }, unresolvedFields: [{ path: "pricing", code: "HOURLY_RATE_UNRESOLVED" }], fieldMetadata: { pricing: { source: "unresolved" } } };
    const compiler = new ProductIntentCompiler({ generateJson: jest.fn(async () => providerResponse(JSON.stringify({ kind: "semantic_operations", operations: [{ op: "set_scalar_price", priceCents: 6000, basis: "per_piece" }] }))) });
    const result = await compiler.compile({ ...compilerInput, request: "$60", currentIntent: current, currentRevision: 0 });
    expect(result).toMatchObject({ ok: true, result: { kind: "intent_patch", patch: { operations: expect.arrayContaining([expect.objectContaining({ op: "set_pricing", value: { model: "scalar", unit: "per_hour", priceCents: 6000 } })]) } } });
  });

  test("repairs invalid JSON once with issue paths and preserves the Yard Signs matrix", async () => {
    const requests: any[] = [];
    const compiler = new ProductIntentCompiler({ generateJson: jest.fn(async (request) => {
      requests.push(request);
      return providerResponse(requests.length === 1 ? "not JSON" : JSON.stringify(yardSignsPayload));
    }) });
    const result = await compiler.compile(compilerInput);

    expect(result).toMatchObject({ ok: true, result: { kind: "complete_intent", intent: { pricing: { unit: "unresolved", cells: expect.arrayContaining([{ row: "3mm", column: "double", priceCents: 1800 }]) } } } });
    expect(requests).toHaveLength(2);
    expect(requests[1].user).toContain("validationIssuePaths");
    expect(requests[1].user).toContain("json_extraction_failure");
    expect(requests[1].system).toContain("Do not add commentary, Markdown, or code fences");
  });

  test.each([
    ["unknown fields", { ...yardSignsPayload, intent: { ...yardSignsPayload.intent, unexpected: true } }, "intent.unexpected"],
    ["missing operation", (() => { const { operation: _operation, ...intent } = yardSignsPayload.intent; return { ...yardSignsPayload, intent }; })(), "intent.operation"],
  ])("rejects %s with safe schema diagnostics after one repair", async (_case, payload, expectedPath) => {
    const compiler = new ProductIntentCompiler({ generateJson: jest.fn(async () => providerResponse(JSON.stringify(payload))) });
    const result = await compiler.compile(compilerInput);

    expect(result).toMatchObject({ ok: false, error: { code: "invalid_contract", diagnosticCode: expect.stringMatching(/^pic-/) }, diagnostics: { stage: "repair_response_schema_rejection", schemaIssuePaths: expect.arrayContaining([expectedPath]) } });
  });

  test.each([
    ["HTTP failure", Object.assign(new Error("HTTP 400"), { kind: "http_failure", status: 400, providerRequestId: "req_http" }), "provider_http_failure"],
    ["empty response", Object.assign(new Error("empty"), { kind: "empty_response", status: 200, providerRequestId: "req_empty" }), "provider_empty_response"],
  ])("returns a safe diagnostic reference for provider %s", async (_case, error, stage) => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const compiler = new ProductIntentCompiler({ generateJson: jest.fn(async () => { throw error; }) });
    await expect(compiler.compile(compilerInput)).resolves.toMatchObject({ ok: false, error: { code: "provider_failure", diagnosticCode: expect.stringMatching(/^pic-/) }, diagnostics: { stage } });
    expect(warn).toHaveBeenCalledWith("[PRODUCT_INTENT_COMPILER] Compilation failed.", expect.objectContaining({
      organizationId: "org_test",
      correlationId: expect.stringMatching(/^pic-/),
      stage,
      providerRequestId: error.providerRequestId,
    }));
  });

  test("compiles dependent finishing as exclusive base-relative alternatives", async () => {
    const dependentOptionPayload = {
      ...yardSignsPayload,
      intent: {
        ...yardSignsPayload.intent,
        identity: { ...yardSignsPayload.intent.identity, name: "Translucent Vinyl - Multilayer Print Test 6" },
        measurement: { mode: "dimensions_required" },
        pricing: { model: "two_dimensional_matrix", unit: "per_square_foot", rowOptionKey: "layers", columnOptionKey: "surface", cells: [{ row: "3_layers", column: "first_surface", priceCents: 500 }, { row: "3_layers", column: "second_surface", priceCents: 500 }, { row: "5_layers", column: "first_surface", priceCents: 600 }, { row: "5_layers", column: "second_surface", priceCents: 600 }] },
        optionGroups: [
          { key: "surface", label: "Surface", required: true, selectionMode: "single", values: [{ key: "first_surface", label: "1st Surface (Right Reading)", isDefault: false }, { key: "second_surface", label: "2nd Surface (Reverse Printed)", isDefault: false }] },
          { key: "layers", label: "Layers", required: true, selectionMode: "single", values: [{ key: "3_layers", label: "3 Layers", isDefault: false }, { key: "5_layers", label: "5 Layers", isDefault: false }] },
          { key: "finishing", label: "Finishing", required: false, selectionMode: "single", values: [{ key: "none", label: "None", isDefault: false, priceImpact: { kind: "percentage_of_base", percent: 0 } }, { key: "contour_cutting", label: "Contour Cutting", isDefault: false, priceImpact: { kind: "percentage_of_base", percent: 10 } }, { key: "contour_cutting_weed_tape", label: "Contour Cutting + Weed and Tape", isDefault: false, priceImpact: { kind: "percentage_of_base", percent: 30 } }] },
        ],
      },
    };
    const compiler = new ProductIntentCompiler({ generateJson: jest.fn(async () => providerResponse(JSON.stringify(dependentOptionPayload))) });
    const result = await compiler.compile({ ...compilerInput, request: "Create translucent vinyl with dependent finishing options." });
    expect(result).toMatchObject({ ok: true, result: { kind: "complete_intent", intent: { revision: 0, measurement: { mode: "dimensions_required" }, quantity: { behavior: "customer_entered" }, pricing: { model: "two_dimensional_matrix", unit: "per_square_foot", cells: expect.arrayContaining([{ row: "3_layers", column: "first_surface", priceCents: 500 }, { row: "5_layers", column: "second_surface", priceCents: 600 }]) }, material: { state: "explicitly_unset" }, production: { route: { state: "explicitly_unset" } } } } });
    if (!result.ok || result.result.kind !== "complete_intent") throw new Error("Expected a complete complex product intent.");
    const finishing = result.result.intent.optionGroups.find((group) => group.key === "finishing");
    expect(finishing).toMatchObject({ required: false, selectionMode: "single", values: expect.arrayContaining([
      expect.objectContaining({ key: "none", priceImpact: { kind: "percentage_of_base", percent: 0 } }),
      expect.objectContaining({ key: "contour_cutting", priceImpact: { kind: "percentage_of_base", percent: 10 } }),
      expect.objectContaining({ key: "contour_cutting_weed_tape", priceImpact: { kind: "percentage_of_base", percent: 30 } }),
    ]) });
  });

  test("does not retain a provider-selected first meaningful option without an authoritative default source", async () => {
    const payload = structuredClone(yardSignsPayload);
    payload.intent.fieldMetadata = { "pricing.unit": { source: "unresolved" } };
    const compiler = new ProductIntentCompiler({ generateJson: jest.fn(async () => providerResponse(JSON.stringify(payload))) });

    const result = await compiler.compile(compilerInput);

    expect(result).toMatchObject({ ok: true, result: { kind: "complete_intent" } });
    if (!result.ok || result.result.kind !== "complete_intent") throw new Error("Expected a complete intent.");
    expect(result.result.intent.optionGroups.find((group) => group.key === "thickness")?.values.every((value) => !value.isDefault)).toBe(true);
    expect(result.result.intent.optionGroups.find((group) => group.key === "sides")?.values.every((value) => !value.isDefault)).toBe(true);
  });

  test.each([
    ["explicit user", "explicit_user", "Create Yard Signs Test 3. Default to 3mm and Single-sided."],
    ["selected template", "selected_template", compilerInput.request],
  ])("preserves a meaningful option default from an authoritative %s source", async (_label, source, request) => {
    const payload = structuredClone(yardSignsPayload);
    payload.intent.fieldMetadata = {
      "pricing.unit": { source: "unresolved" },
      "optionGroups.thickness.default": { source },
      "optionGroups.sides.default": { source },
    };
    const compiler = new ProductIntentCompiler({ generateJson: jest.fn(async () => providerResponse(JSON.stringify(payload))) });

    const result = await compiler.compile({ ...compilerInput, request });

    expect(result).toMatchObject({ ok: true, result: { kind: "complete_intent" } });
    if (!result.ok || result.result.kind !== "complete_intent") throw new Error("Expected a complete intent.");
    expect(result.result.intent.optionGroups.find((group) => group.key === "thickness")?.values.find((value) => value.isDefault)?.key).toBe("3mm");
    expect(result.result.intent.fieldMetadata["optionGroups.thickness.default"]).toEqual({ source });
  });

  test("preserves a structured candidate option default", async () => {
    const payload = structuredClone(yardSignsPayload);
    payload.intent.fieldMetadata = {
      "pricing.unit": { source: "unresolved" },
      "optionGroups.thickness.default": { source: "structured_candidate" },
      "optionGroups.sides.default": { source: "structured_candidate" },
    };
    const compiler = new ProductIntentCompiler({ generateJson: jest.fn(async () => providerResponse(JSON.stringify(payload))) });

    const result = await compiler.compile(compilerInput);

    expect(result).toMatchObject({ ok: true, result: { kind: "complete_intent" } });
    if (!result.ok || result.result.kind !== "complete_intent") throw new Error("Expected a complete intent.");
    expect(result.result.intent.optionGroups.find((group) => group.key === "thickness")?.values.find((value) => value.isDefault)?.key).toBe("3mm");
    expect(result.result.intent.fieldMetadata["optionGroups.thickness.default"]).toEqual({ source: "structured_candidate" });
  });
});
