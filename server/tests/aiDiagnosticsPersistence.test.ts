import { beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";

const inserted: any[] = [];
const insertValues = jest.fn(async (value: unknown) => { inserted.push(value); });
jest.unstable_mockModule("../db", () => ({ db: { insert: jest.fn(() => ({ values: insertValues })) } }));
jest.unstable_mockModule("@shared/schema", () => ({ aiAuditEvents: {} }));

let persistAiDiagnostic: typeof import("../services/aiDiagnosticsService").persistAiDiagnostic;
let ConfiguredAssistantIntentPlannerProvider: typeof import("../services/assistant/intentPlannerProvider").ConfiguredAssistantIntentPlannerProvider;

const diagnostic = (referenceId = "aip-11111111-1111-4111-8111-111111111111") => ({
  version: 1 as const, referenceId, correlationId: referenceId, diagnosticType: "ai_planner" as const, tenantId: "org_1", actorId: null, conversationId: null,
  provider: "openai_compatible", model: "test", providerRequestId: null, stage: "invalid_contract", errorCode: "invalid_contract", providerResponseState: "contract_failed" as const, parseMethod: "repaired_json" as const, repairAttempted: true, repairResult: "failed" as const, validationSchema: "AssistantIntentPlan", validationIssuePaths: ["capabilityId"], validationIssueCodes: ["invalid_type"], returnedTopLevelKeys: [], missingRequiredKeys: ["capabilityId"], unknownKeys: [], plannerOperation: null, selectedCapability: null, specialistName: null, optionNormalizationStage: null, resolverStage: null, persistenceAttempted: false, persistenceResult: "not_attempted" as const, createdAt: "2026-08-06T12:00:00.000Z",
});

beforeAll(async () => {
  ({ persistAiDiagnostic } = await import("../services/aiDiagnosticsService"));
  ({ ConfiguredAssistantIntentPlannerProvider } = await import("../services/assistant/intentPlannerProvider"));
});

describe("AI diagnostic persistence", () => {
  beforeEach(() => { inserted.splice(0); jest.clearAllMocks(); });

  test("persists the planner's exact public aip reference as both metadata reference and correlation", async () => {
    const planner = new ConfiguredAssistantIntentPlannerProvider({ generateJson: jest.fn(async () => ({ rawText: "{}", provider: "openai_compatible", model: "test", requestMetadata: {} })) } as any, { resolveProvider: jest.fn(async () => ({ enabled: true, provider: "openai_compatible", endpoint: "https://example.test", apiKey: "test", model: "test" })) } as any);
    const result = await planner.plan({ organizationId: "org_1", system: "strict", user: "safe", promptVersion: "test" });

    expect(result).toMatchObject({ ok: false, error: { correlationId: expect.stringMatching(/^aip-/) } });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toEqual(expect.objectContaining({ orgId: "org_1", correlationId: result.ok ? "" : result.error.correlationId, metadata: expect.objectContaining({ referenceId: result.ok ? "" : result.error.correlationId, correlationId: result.ok ? "" : result.error.correlationId, diagnosticType: "ai_planner" }) }));
  });

  test("logs only safe persistence identifiers when an audit insert fails", async () => {
    insertValues.mockRejectedValueOnce(Object.assign(new Error("postgres://secret@host"), { code: "23503" }));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(persistAiDiagnostic(diagnostic())).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith("[AI_DIAGNOSTICS] Persistence failed.", expect.objectContaining({ reference: "aip-11111111-1111-4111-8111-111111111111", diagnosticType: "ai_planner", persistenceStage: "insert", databaseErrorCode: "23503", tenantId: "org_1" }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("postgres://secret@host");
  });
});
