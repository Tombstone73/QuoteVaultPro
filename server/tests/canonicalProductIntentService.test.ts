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
    expect(persistedIntent).toMatchObject({ state: "needs_answers", identity: { category: { state: "unresolved", label: "Product category" } }, material: { state: "explicitly_unset" }, production: { route: { state: "explicitly_unset" } }, pricing: { unit: "unresolved" } });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "0:identity.category:candidate", code: "CATEGORY_UNRESOLVED" }),
      expect.objectContaining({ id: "0:pricing.matrix.unit:required", code: "PRICING_UNIT_UNRESOLVED", path: "pricing.matrix.unit" }),
    ]));
    expect(result.card.candidateResolutions.filter((action) => action.kind === "select_category")).toHaveLength(2);
    expect(result.card.requiredQuestions).toEqual([expect.objectContaining({ id: "0:pricing.matrix.unit:required", path: "pricing.matrix.unit" })]);
    expect(result.session.specification.latestUnresolvedQuestions).toEqual({ questions: expect.arrayContaining([
      expect.objectContaining({ id: "0:identity.category:candidate", path: "identity.category" }),
      expect.objectContaining({ id: "0:pricing.matrix.unit:required", path: "pricing.matrix.unit" }),
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
});
