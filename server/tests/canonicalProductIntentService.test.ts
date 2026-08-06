import { jest } from "@jest/globals";
import { z } from "zod";
import { CanonicalProductIntentService } from "../services/productIntentCompiler/canonicalProductIntentService";
import { ProductIntentCompiler } from "../services/productIntentCompiler/productIntentCompiler";
import { ProductIntentPersistenceService, type CanonicalProductIntentProposalRow, type CanonicalProductIntentProposalStore } from "../services/productIntentCompiler/productIntentPersistence";

const yardSignsPayload = {
  kind: "complete_intent",
  intent: {
    operation: "new_product",
    identity: { name: "Yard Signs Test 3", description: "", category: { state: "unresolved", label: "Product category" } },
    lifecycle: { productStatus: "inactive", published: false }, measurement: { mode: "quantity_only" }, quantity: { behavior: "customer_entered", minimum: 1 },
    pricing: { model: "two_dimensional_matrix", unit: "unresolved", rowOptionKey: "thickness", columnOptionKey: "sides", cells: [{ row: "3mm", column: "single", priceCents: 1200 }, { row: "3mm", column: "double", priceCents: 1800 }, { row: "6mm", column: "single", priceCents: 1600 }, { row: "6mm", column: "double", priceCents: 2200 }] },
    material: { state: "resolved", id: "provider-guessed-pvc", label: "PVC - 3mm (Foamed PVC Sheets)" },
    optionGroups: [{ key: "thickness", label: "Thickness", required: true, selectionMode: "single", values: [{ key: "3mm", label: "3mm", isDefault: true }, { key: "6mm", label: "6mm", isDefault: false }] }, { key: "sides", label: "Sides", required: true, selectionMode: "single", values: [{ key: "single", label: "Single-sided", isDefault: true }, { key: "double", label: "Double-sided", isDefault: false }] }],
    workflow: { kind: "standard_production", requiresProofApproval: false, requiresProductionJob: true }, production: { route: { state: "resolved", id: "provider-guessed-flatbed", label: "Flatbed" }, configuration: {} }, visibility: { catalogVisible: false },
    unresolvedFields: [{ path: "pricing.unit", code: "PRICING_UNIT_UNRESOLVED", question: "Are these matrix prices per piece or per square foot?" }],
    fieldMetadata: { "identity.category": { source: "ai_interpreted", confidence: 0.5 }, material: { source: "ai_interpreted", confidence: 0.5 }, "production.route": { source: "ai_interpreted", confidence: 0.5 }, "pricing.unit": { source: "unresolved" } },
  },
};

class MemoryStore implements CanonicalProductIntentProposalStore {
  rows = new Map<string, CanonicalProductIntentProposalRow>();
  async insert(input: Omit<CanonicalProductIntentProposalRow, "createdAt" | "updatedAt">) { const row = { ...structuredClone(input), createdAt: new Date(), updatedAt: new Date() }; this.rows.set(row.id, row); return structuredClone(row); }
  async getById(input: { organizationId: string; proposalId: string }) { const row = this.rows.get(input.proposalId); return row?.organizationId === input.organizationId ? structuredClone(row) : null; }
  async getByConversation(input: { organizationId: string; conversationId: string }) { return structuredClone(Array.from(this.rows.values()).find((row) => row.organizationId === input.organizationId && row.conversationId === input.conversationId) ?? null); }
  async compareAndSet(input: Parameters<CanonicalProductIntentProposalStore["compareAndSet"]>[0]) { const row = this.rows.get(input.proposalId); if (!row) return null; const next = { ...row, specification: structuredClone(input.specification), fingerprint: input.fingerprint, status: input.status, updatedAt: new Date() }; this.rows.set(next.id, next); return structuredClone(next); }
}

function compilerInput() {
  return { orgId: "org-1", request: "Create Yard Signs Test 3", operationContext: { operation: "new_product" }, schemaDescription: "Product intent", allowedEnums: {}, supportedArchetypes: [], serverConstraints: [] };
}

describe("CanonicalProductIntentService compiler failures", () => {
  test("persists nothing and has no legacy fallback when both compiler attempts fail", async () => {
    const compiler = new ProductIntentCompiler({
      generateJson: jest.fn(async () => ({ rawText: "not-json", provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })),
    });
    const persistence = { create: jest.fn() } as any;
    const service = new CanonicalProductIntentService(compiler, persistence, { categories: [], materials: [], productionRoutes: [] });

    const result = await service.create({
      organizationId: "org-1", actorUserId: "user-1", conversationId: "conversation-1",
      compilerInput: {
        orgId: "org-1", request: "Create Yard Signs Test", operationContext: { operation: "new_product" }, schemaDescription: "Product intent", allowedEnums: {}, supportedArchetypes: [], serverConstraints: [],
      },
    });

    expect(result).toMatchObject({ ok: false, code: "invalid_json" });
    expect(persistence.create).not.toHaveBeenCalled();
  });

  test("persists the Yard Signs unresolved matrix as initial revision zero", async () => {
    const compiler = new ProductIntentCompiler({
      generateJson: jest.fn(async () => ({ rawText: JSON.stringify(yardSignsPayload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: { providerRequestId: "req_yard_signs" } })),
    });
    const service = new CanonicalProductIntentService(compiler, new ProductIntentPersistenceService(new MemoryStore()), {
      categories: [{ id: "flatbed-printing", label: "Flatbed Printing" }, { id: "roll-printing", label: "Roll Printing" }],
      materials: [{ id: "pvc-3", label: "PVC - 3mm (Foamed PVC Sheets)" }],
      productionRoutes: [{ id: "flatbed", label: "Flatbed" }],
    });

    const result = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "yard-signs-3", compilerInput: compilerInput() });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected the Yard Signs canonical session to persist.");
    const persistedIntent = result.session.specification.session.revisions[0]!.intent;
    expect(result.session.status).toBe("needs_answers");
    expect(result.session.specification.session.currentRevision).toBe(0);
    expect(persistedIntent).toMatchObject({ state: "needs_answers", identity: { category: { state: "unresolved", label: "Product category" } }, material: { state: "unresolved" }, production: { route: { state: "explicitly_unset" } }, pricing: { unit: "unresolved" } });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "0:identity.category:candidate", code: "CATEGORY_UNRESOLVED" }),
      expect.objectContaining({ id: "0:pricing.matrix.unit:required", code: "PRICING_UNIT_UNRESOLVED", path: "pricing.matrix.unit" }),
    ]));
    expect(result.card.candidateResolutions.filter((action) => action.kind === "select_category")).toHaveLength(2);
    expect(result.card.requiredQuestions).toEqual([expect.objectContaining({ id: "0:pricing.matrix.unit:required", path: "pricing.matrix.unit", answer: expect.objectContaining({ answerType: "choice", allowedChoices: expect.arrayContaining([expect.objectContaining({ canonicalValue: "per_piece" }), expect.objectContaining({ canonicalValue: "per_square_foot" })]) }) })]);
    expect(result.session.specification.latestUnresolvedQuestions).toEqual({ baseRevision: 0, questions: expect.arrayContaining([
      expect.objectContaining({ id: "0:identity.category:candidate", path: "identity.category" }),
      expect.objectContaining({ id: "0:pricing.matrix.unit:required", path: "pricing.matrix.unit", answer: expect.objectContaining({ issueId: "0:pricing.matrix.unit:required", canonicalPath: "pricing.matrix.unit", baseRevision: 0 }) }),
    ]) });
  });

  test("returns a safe correlated failure when persistence rejects a canonical session", async () => {
    const compiler = new ProductIntentCompiler({
      generateJson: jest.fn(async () => ({ rawText: JSON.stringify(yardSignsPayload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })),
    });
    const persistence = { create: jest.fn(async () => z.object({ persisted: z.literal(true) }).parse({ persisted: false })) } as any;
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const service = new CanonicalProductIntentService(compiler, persistence, { categories: [], materials: [], productionRoutes: [] });

    const result = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "yard-signs-3", compilerInput: compilerInput() });

    expect(result).toMatchObject({ ok: false, code: "PRODUCT_INTENT_SESSION_CREATION_FAILED", message: expect.stringMatching(/^The canonical product intent could not be prepared safely\. Nothing was created\. Reference: pic-/) });
    expect(errorSpy).toHaveBeenCalledWith("[PRODUCT_INTENT_PIPELINE] Initial canonical session failed.", expect.objectContaining({ stage: "persistence_preparation", code: "PRODUCT_INTENT_SCHEMA_REJECTION", schemaIssuePaths: ["persisted"] }));
    errorSpy.mockRestore();
  });

  test.each(["Per piece.", "PIECE", "Per sqft"])('resolves the active matrix-unit question for "%s" without calling the provider', async (answer) => {
    const provider = jest.fn(async () => ({ rawText: JSON.stringify(yardSignsPayload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} }));
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: provider }), new ProductIntentPersistenceService(new MemoryStore()), {
      categories: [{ id: "flatbed-printing", label: "Flatbed Printing" }], materials: [{ id: "pvc-3", label: "PVC - 3mm (Foamed PVC Sheets)" }], productionRoutes: [{ id: "flatbed", label: "Flatbed" }],
    });
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: `yard-${answer}`, compilerInput: compilerInput() });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("Expected canonical session creation.");

    const continued = await service.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: answer, compilerInput: compilerInput() });

    expect(continued.ok).toBe(true);
    if (!continued.ok) throw new Error("Expected deterministic required-answer continuation.");
    const intent = continued.session.specification.session.revisions.at(-1)!.intent;
    expect(provider).toHaveBeenCalledTimes(1);
    expect(intent.revision).toBe(1);
    expect(intent.pricing).toMatchObject({ model: "two_dimensional_matrix", unit: answer.toLocaleLowerCase().includes("sqft") ? "per_square_foot" : "per_piece", cells: expect.arrayContaining([{ row: "3mm", column: "single", priceCents: 1200 }, { row: "6mm", column: "double", priceCents: 2200 }]) });
    expect(intent.identity.category).toMatchObject({ state: "unresolved" });
    expect(intent.material).toMatchObject({ state: "unresolved" });
    expect(intent.production.route).toEqual({ state: "explicitly_unset" });
    expect(continued.issues).toEqual([expect.objectContaining({ code: "CATEGORY_UNRESOLVED", id: "1:identity.category:candidate" })]);
    expect(continued.card.requiredQuestions).toEqual([]);
    expect(continued.card.candidateResolutions.filter((action) => action.kind === "select_category")).toHaveLength(1);
  });

  test("does not turn unrelated or already-resolved answers into a deterministic patch", async () => {
    const provider = jest.fn(async () => ({ rawText: JSON.stringify(yardSignsPayload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} }));
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: provider }), new ProductIntentPersistenceService(new MemoryStore()), { categories: [], materials: [], productionRoutes: [] });
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "yard-unmatched", compilerInput: compilerInput() });
    if (!created.ok) throw new Error("Expected canonical session creation.");
    const unrelated = await service.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: "Make it excellent", compilerInput: compilerInput() });
    expect(unrelated).toMatchObject({ ok: false, code: "PRODUCT_INTENT_REQUIRED_ANSWER_UNMATCHED" });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  test("uses a scoped provider patch fallback when an answer is not an exact server alias", async () => {
    let calls = 0;
    const provider = jest.fn(async (request) => {
      calls += 1;
      if (calls === 1) return { rawText: JSON.stringify(yardSignsPayload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} };
      const currentIntent = JSON.parse(request.user).currentIntent;
      return { rawText: JSON.stringify({ kind: "intent_patch", patch: { operations: [{ op: "set_pricing", value: { ...currentIntent.pricing, unit: "per_piece" } }, { op: "set_unresolved_fields", value: [] }, { op: "merge_field_metadata", value: { "pricing.unit": { source: "explicit_user" } } }] } }), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} };
    });
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: provider }), new ProductIntentPersistenceService(new MemoryStore()), { categories: [], materials: [], productionRoutes: [] });
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "yard-provider-patch", compilerInput: compilerInput() });
    if (!created.ok) throw new Error("Expected canonical session creation.");

    const continued = await service.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: "Use the standard basis", compilerInput: compilerInput() });

    expect(continued).toMatchObject({ ok: true, session: { specification: { session: { currentRevision: 1 } } } });
    expect(provider).toHaveBeenCalledTimes(2);
    if (continued.ok) expect(continued.session.specification.session.revisions.at(-1)!.intent.pricing).toMatchObject({ unit: "per_piece", cells: expect.arrayContaining([{ row: "3mm", column: "single", priceCents: 1200 }]) });
  });

  test("persists a selected tenant category without changing the independent pricing or route fields", async () => {
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({
      generateJson: jest.fn(async () => ({ rawText: JSON.stringify(yardSignsPayload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })),
    }), new ProductIntentPersistenceService(new MemoryStore()), {
      categories: [{ id: "flatbed-printing", label: "Flatbed Printing" }, { id: "roll-printing", label: "Roll Printing" }],
      materials: [{ id: "pvc-3", label: "PVC - 3mm (Foamed PVC Sheets)" }], productionRoutes: [{ id: "flatbed", label: "Flatbed" }],
    });
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "yard-category-first", compilerInput: compilerInput() });
    if (!created.ok) throw new Error("Expected canonical session creation.");
    const categoryAction = created.card.candidateResolutions.find((action) => action.kind === "select_category" && action.candidate?.id === "flatbed-printing");
    if (!categoryAction) throw new Error("Expected Flatbed Printing candidate action.");

    const selected = await service.applyCandidateAction({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, actionId: categoryAction.id });
    expect(selected.outcome).toMatchObject({ ok: true, session: { specification: { session: { currentRevision: 1 } } } });
    if (!selected.outcome?.ok) throw new Error("Expected category selection to persist.");
    const selectedIntent = selected.outcome.session.specification.session.revisions.at(-1)!.intent;
    expect(selectedIntent.identity.category).toEqual({ state: "resolved", id: "flatbed-printing", label: "Flatbed Printing" });
    expect(selectedIntent.fieldMetadata["identity.category"]).toEqual(expect.objectContaining({ source: "explicit_user" }));
    expect(selectedIntent.pricing).toMatchObject({ model: "two_dimensional_matrix", unit: "unresolved", cells: yardSignsPayload.intent.pricing.cells });
    expect(selectedIntent.optionGroups).toEqual(yardSignsPayload.intent.optionGroups);
    expect(selectedIntent.material).toMatchObject({ state: "unresolved" });
    expect(selectedIntent.production.route).toEqual({ state: "explicitly_unset" });
    expect(selected.outcome.issues).not.toEqual(expect.arrayContaining([expect.objectContaining({ code: "CATEGORY_UNRESOLVED" })]));
    expect(selected.outcome.card.candidateResolutions.filter((action) => action.kind === "select_category")).toEqual([]);
    expect(selected.outcome.card.requiredQuestions).toEqual([expect.objectContaining({ path: "pricing.matrix.unit" })]);

    const finished = await service.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: "Per piece", compilerInput: compilerInput() });
    expect(finished).toMatchObject({ ok: true, session: { specification: { session: { currentRevision: 2 } } }, card: { readiness: { ready: true }, requiredQuestions: [] } });
    if (finished.ok) expect(finished.session.specification.session.revisions.at(-1)!.intent).toMatchObject({ identity: { category: { state: "resolved", id: "flatbed-printing", label: "Flatbed Printing" } }, pricing: { model: "two_dimensional_matrix", unit: "per_piece", cells: yardSignsPayload.intent.pricing.cells }, production: { route: { state: "explicitly_unset" } } });
  });

  test("resolves category after pricing and rejects reused category actions without appending another revision", async () => {
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({
      generateJson: jest.fn(async () => ({ rawText: JSON.stringify(yardSignsPayload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })),
    }), new ProductIntentPersistenceService(new MemoryStore()), {
      categories: [{ id: "flatbed-printing", label: "Flatbed Printing" }], materials: [], productionRoutes: [],
    });
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "yard-pricing-first", compilerInput: compilerInput() });
    if (!created.ok) throw new Error("Expected canonical session creation.");
    const priced = await service.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: "piece", compilerInput: compilerInput() });
    if (!priced.ok) throw new Error("Expected pricing continuation.");
    const categoryAction = priced.card.candidateResolutions.find((action) => action.kind === "select_category" && action.candidate?.id === "flatbed-printing");
    if (!categoryAction) throw new Error("Expected current Flatbed Printing candidate action.");

    const selected = await service.applyCandidateAction({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, actionId: categoryAction.id });
    expect(selected.outcome).toMatchObject({ ok: true, session: { specification: { session: { currentRevision: 2 } } }, card: { readiness: { ready: true }, requiredQuestions: [] } });
    if (!selected.outcome?.ok) throw new Error("Expected category selection to persist.");
    expect(selected.outcome.session.specification.session.revisions).toHaveLength(3);
    expect(selected.outcome.session.specification.session.revisions.at(-1)!.intent).toMatchObject({ identity: { category: { state: "resolved", id: "flatbed-printing", label: "Flatbed Printing" } }, pricing: { unit: "per_piece", cells: yardSignsPayload.intent.pricing.cells } });

    await expect(service.applyCandidateAction({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, actionId: categoryAction.id })).rejects.toThrow("PRODUCT_INTENT_INTERACTION_STALE");
    const current = selected.outcome.session.specification.session;
    expect(current.currentRevision).toBe(2);
    expect(current.revisions).toHaveLength(3);
  });

  test("rejects a server-issued candidate patch with no semantic change without appending a revision", async () => {
    const store = new MemoryStore();
    const persistence = new ProductIntentPersistenceService(store);
    const service = new CanonicalProductIntentService(new ProductIntentCompiler({
      generateJson: jest.fn(async () => ({ rawText: JSON.stringify(yardSignsPayload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} })),
    }), persistence, { categories: [{ id: "flatbed-printing", label: "Flatbed Printing" }], materials: [], productionRoutes: [] });
    const created = await service.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "yard-no-op", compilerInput: compilerInput() });
    if (!created.ok) throw new Error("Expected canonical session creation.");
    const categoryAction = created.card.candidateResolutions.find((action) => action.kind === "select_category");
    if (!categoryAction) throw new Error("Expected category candidate action.");
    const originalPresentation = (service as any).presentation.bind(service);
    (service as any).presentation = async (currentIntent: any, currentIssues: any[]) => ({
      ...(await originalPresentation(currentIntent, currentIssues)),
      candidateResolutions: [{ ...categoryAction, patch: { contractVersion: 1, baseRevision: currentIntent.revision, preserveUnchanged: true, operations: [{ op: "set_identity", value: currentIntent.identity }] } }],
    });

    const result = await service.applyCandidateAction({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, actionId: categoryAction.id });
    expect(result.outcome).toMatchObject({ ok: false, code: "PRODUCT_INTENT_ACTION_NO_CHANGE" });
    const persisted = await persistence.load({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId });
    expect(persisted.specification.session.currentRevision).toBe(0);
    expect(persisted.specification.session.revisions).toHaveLength(1);
  });

  test("inspects the latest ready revision without a compiler, patch validation, persistence write, or fingerprint change", async () => {
    const provider = jest.fn(async () => ({ rawText: JSON.stringify(yardSignsPayload), provider: "openai_compatible", model: "deepseek-test", requestMetadata: {} }));
    const persistence = new ProductIntentPersistenceService(new MemoryStore());
    const candidates = { categories: [{ id: "flatbed-printing", label: "Flatbed Printing" }], materials: [], productionRoutes: [] };
    const writer = new CanonicalProductIntentService(new ProductIntentCompiler({ generateJson: provider }), persistence, candidates);
    const created = await writer.create({ organizationId: "org-1", actorUserId: "user-1", conversationId: "yard-read-only", compilerInput: compilerInput() });
    if (!created.ok) throw new Error("Expected canonical session creation.");
    const category = created.card.candidateResolutions.find((action) => action.kind === "select_category");
    if (!category) throw new Error("Expected category candidate.");
    const selected = await writer.applyCandidateAction({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, actionId: category.id });
    if (!selected.outcome?.ok) throw new Error("Expected category selection.");
    const ready = await writer.continue({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId, request: "Per piece", compilerInput: compilerInput() });
    if (!ready.ok) throw new Error("Expected deterministic pricing answer.");
    const before = await persistence.load({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId });

    const reader = new CanonicalProductIntentService(null, persistence, candidates);
    const inspected = await reader.inspect({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId });
    const after = await persistence.load({ organizationId: "org-1", actorUserId: "user-1", proposalId: created.session.proposalId });

    expect(inspected).toMatchObject({ session: { fingerprint: before.fingerprint, specification: { session: { currentRevision: 2 } } }, card: { readiness: { ready: true }, optionalRecommendations: [expect.objectContaining({ kind: "enable_proof_approval" })] } });
    expect(inspected.card.fields).toMatchObject({ Category: "Flatbed Printing", Proof: "Not required", "Production route": "Not set" });
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.specification.session.revisions).toHaveLength(before.specification.session.revisions.length);
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
