import { expect, jest, test } from "@jest/globals";
import { sanitizeAiDiagnosticEnvelope } from "@shared/aiDiagnostics";

const persisted: unknown[] = [];
const persistAiDiagnostic = jest.fn(async (value: unknown) => { const sanitized = sanitizeAiDiagnosticEnvelope(value); persisted.push(sanitized); return sanitized; });
jest.unstable_mockModule("../services/aiDiagnosticsService", () => ({ persistAiDiagnostic }));

const current = {
  proposalId: "proposal_1", organizationId: "org_1", actorUserId: "user_1", conversationId: "conversation_1",
  fingerprint: "fingerprint_1", status: "needs_answers",
  specification: { session: { currentRevision: 4, revisions: [{ intent: {} }] } },
} as any;

function input() {
  return {
    organizationId: "org_1", actorUserId: "user_1", proposalId: "proposal_1", request: "set the current answer",
    compilerInput: { orgId: "org_1", request: "unused", operationContext: {}, schemaDescription: "schema", allowedEnums: {}, supportedArchetypes: [] },
  };
}

async function serviceFor(result: any, appendPatch = jest.fn()) {
  const { CanonicalProductIntentService } = await import("../services/productIntentCompiler/canonicalProductIntentService");
  const service = new CanonicalProductIntentService({ compile: jest.fn(async () => result) } as any, {
    load: jest.fn(async () => current), appendPatch,
  } as any, { categories: [], materials: [], productionRoutes: [] });
  (service as any).validate = jest.fn(async (raw: unknown) => ({ intent: raw, issues: [] }));
  return { service, appendPatch };
}

test("persists the exact displayed pic reference for a continuation result rejection without a revision", async () => {
  persisted.length = 0; persistAiDiagnostic.mockClear();
  const { service, appendPatch } = await serviceFor({ ok: true, result: { kind: "complete_intent" }, diagnostics: { correlationId: "ignored", provider: "openai_compatible", model: "deepseek-test", requestMetadata: {}, attempts: 1, stage: "success" } });

  const outcome = await service.continue(input());

  expect(outcome).toMatchObject({ ok: false, code: "PRODUCT_INTENT_REQUIRED_ANSWER_UNMATCHED" });
  const reference = outcome.ok ? "" : outcome.message.match(/pic-[A-Za-z0-9-]+/)?.[0];
  expect(reference).toBeDefined();
  expect(appendPatch).not.toHaveBeenCalled();
  expect(persistAiDiagnostic).toHaveBeenCalledTimes(1);
  expect(persisted[0]).toMatchObject({ referenceId: reference, correlationId: reference, diagnosticType: "product_intent_compiler", stage: "provider_result_validation", sessionId: "proposal_1", currentRevision: 4, tenantId: "org_1", actorId: "user_1", conversationId: "conversation_1" });
});

test("records patch validation paths and never persists provider text for a rejected continuation patch", async () => {
  persisted.length = 0; persistAiDiagnostic.mockClear();
  const { service, appendPatch } = await serviceFor({ ok: true, result: { kind: "intent_patch", patch: { operations: [{ op: "set_pricing", value: { secret: "provider-output-must-not-persist" } }] } }, diagnostics: { correlationId: "ignored", provider: "openai_compatible", model: "deepseek-test", requestMetadata: {}, attempts: 1, stage: "success" } });

  const outcome = await service.continue(input());

  expect(outcome).toMatchObject({ ok: false, code: "PRODUCT_INTENT_CONTINUATION_REJECTED" });
  expect(appendPatch).not.toHaveBeenCalled();
  expect(persistAiDiagnostic).toHaveBeenCalledTimes(1);
  expect(persisted[0]).toMatchObject({ diagnosticType: "product_intent_compiler", stage: "patch_application", validationSchema: "ProductDraftIntentPatch", patchOperationCount: 1, patchPaths: ["pricing"] });
  expect(JSON.stringify(persisted[0])).not.toContain("provider-output-must-not-persist");
});

test("persists a continuation compiler JSON failure under its caller-issued pic reference", async () => {
  persisted.length = 0; persistAiDiagnostic.mockClear();
  const { ProductIntentCompiler } = await import("../services/productIntentCompiler/productIntentCompiler");
  const compiler = new ProductIntentCompiler({ generateJson: jest.fn(async () => ({ rawText: "not JSON", provider: "openai_compatible", model: "deepseek-test", requestMetadata: { apiKey: "never-persist" } })) });

  const result = await compiler.compile({ orgId: "org_1", request: "continuation answer", operationContext: {}, schemaDescription: "schema", allowedEnums: {}, supportedArchetypes: [], diagnosticReferenceId: "pic-11111111-1111-4111-8111-111111111111", diagnosticContext: { actorId: "user_1", conversationId: "conversation_1", sessionId: "proposal_1", currentRevision: 4 } });

  expect(result).toMatchObject({ ok: false, error: { diagnosticCode: "pic-11111111-1111-4111-8111-111111111111" } });
  expect(persistAiDiagnostic).toHaveBeenCalledTimes(1);
  expect(persisted[0]).toMatchObject({ referenceId: "pic-11111111-1111-4111-8111-111111111111", correlationId: "pic-11111111-1111-4111-8111-111111111111", stage: "json_extraction_failure", parseMethod: "none", repairAttempted: true, repairResult: "failed", sessionId: "proposal_1", currentRevision: 4 });
  expect(JSON.stringify(persisted[0])).not.toContain("never-persist");
});

test("persists an initial canonical pipeline failure under the displayed compiler reference", async () => {
  persisted.length = 0; persistAiDiagnostic.mockClear();
  const { CanonicalProductIntentService } = await import("../services/productIntentCompiler/canonicalProductIntentService");
  const initialIntent = {
    contractVersion: 1, intentId: "intent_1", organizationId: "org_1", revision: 0, state: "ready_for_review", operation: "new_product",
    identity: { name: "Test product", description: "", category: { state: "unresolved", label: "Product category" } },
    lifecycle: { productStatus: "inactive", published: false }, measurement: { mode: "quantity_only" }, quantity: { behavior: "customer_entered", minimum: 1 },
    pricing: { model: "scalar", unit: "per_piece", priceCents: 100 }, material: { state: "explicitly_unset" }, optionGroups: [],
    workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "explicitly_unset" }, configuration: {} },
    visibility: { catalogVisible: false }, unresolvedFields: [], fieldMetadata: {}, revisionMetadata: { parentRevision: null }, operationContext: {},
  };
  const compiler = { compile: jest.fn(async () => ({ ok: true, result: { kind: "complete_intent", intent: initialIntent }, diagnostics: { correlationId: "pic-22222222-2222-4222-8222-222222222222", provider: "openai_compatible", model: "deepseek-v4-flash", requestMetadata: {}, attempts: 1, stage: "success" } })) } as any;
  const persistence = { create: jest.fn(async () => { const error: any = new Error("write conflict"); error.code = "PRODUCT_INTENT_CREATE_CONFLICT"; throw error; }) } as any;
  const service = new CanonicalProductIntentService(compiler, persistence, { categories: [], materials: [], productionRoutes: [] });
  (service as any).validate = jest.fn(async (intent: unknown) => ({ intent, issues: [] }));
  (service as any).presentation = jest.fn(async () => ({ readiness: { ready: true, blockers: [], questions: [] } }));

  const outcome = await service.create({ organizationId: "org_1", actorUserId: "user_1", conversationId: "conversation_1", compilerInput: { orgId: "org_1", request: "Create a product", operationContext: {}, schemaDescription: "schema", allowedEnums: {}, supportedArchetypes: [] } });

  expect(outcome).toMatchObject({ ok: false, code: "PRODUCT_INTENT_SESSION_CREATION_FAILED" });
  expect(persistAiDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ referenceId: "pic-22222222-2222-4222-8222-222222222222", stage: "persistence_preparation", errorCode: "PRODUCT_INTENT_CREATE_CONFLICT", tenantId: "org_1", actorId: "user_1", conversationId: "conversation_1", persistenceAttempted: true, persistenceResult: "succeeded" }));
});

test("records safe ordered-batch failure evidence without persisting a revision", async () => {
  persisted.length = 0; persistAiDiagnostic.mockClear();
  const { CanonicalProductIntentService } = await import("../services/productIntentCompiler/canonicalProductIntentService");
  const semanticCurrent = {
    ...current,
    specification: { session: { currentRevision: 4, revisions: [{ intent: { revision: 4, optionGroups: [] } }] } },
  } as any;
  const appendPatch = jest.fn();
  const service = new CanonicalProductIntentService(null, { load: jest.fn(async () => semanticCurrent), appendPatch } as any, { categories: [], materials: [], productionRoutes: [] });

  const outcome = await service.applySemanticOperations({
    organizationId: "org_1", actorUserId: "user_1", proposalId: "proposal_1", request: "Add the group, then make No its default.",
    operations: [
      { op: "add_option_group", optionGroup: "Weeding and Taping", required: false, selectionMode: "single" },
      { op: "set_option_default", optionGroup: "Weeding and Taping", value: "No" },
    ],
  });

  expect(outcome).toMatchObject({ ok: false, code: "PRODUCT_SEMANTIC_OPERATION_REJECTED" });
  expect(outcome).toMatchObject({
    recovery: {
      retryable: true,
      stage: "semantic_operation_validation",
      code: "PRODUCT_SEMANTIC_OPERATION_REJECTED",
      validation: {
        requestedOperations: ["add_option_group", "set_option_default"],
        semanticBatch: { originalRevisionUnchanged: true },
      },
    },
  });
  expect(JSON.stringify(outcome)).not.toContain("referenceId");
  expect(appendPatch).not.toHaveBeenCalled();
  expect(persistAiDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
    semanticBatch: {
      operationCount: 2,
      operationTypes: ["add_option_group", "set_option_default"],
      // Canonical proposal construction rejects the unresolved choice before
      // the contained legacy adapter performs per-operation attribution.
      failingOperation: null,
      originalRevisionUnchanged: true,
    },
  }));
});
