import { expect, jest, test } from "@jest/globals";

const persisted: unknown[] = [];
const persistAiDiagnostic = jest.fn(async (value: unknown) => { persisted.push(value); return value; });
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
